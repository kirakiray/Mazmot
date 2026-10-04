//! Web 抓取端点：`POST /v1/web/fetch` —— 服务端代理抓取网页 / 接口文本。
//!
//! 浏览器直抓任意站点受 CORS 限制，此端点让 relay 用户零配置获得联网能力
//! （客户端入口：mz/ai/supplier/relay.js 的 `webFetch`，协议契约见 mz/net/README.md）。
//!
//! 鉴权与 `/v1/chat/completions` 完全一致：Bearer bearkey + 绑定模式签名头。
//! 抓取**不计入** token 配额（ bearkey + 签名本身就是门槛；配额化是后续可选项）。
//!
//! 安全约束（防 SSRF / 防滥用）：
//! - 仅 http/https；拒绝内部主机名（localhost / *.local / *.internal / *.arpa）
//! - 目标先 DNS 解析，解析出的**每一个** IP 都过私网黑名单（IP 字面量同样校验）
//! - 重定向手动跟随（reqwest 客户端禁自动跳转），最多 3 跳，每跳重新走一遍校验
//!   —— 防止「首跳合法、302 跳内网」绕过防护
//! - 响应体上限 2 MB（超出截断并置 truncated）；总超时 15 s
//! - Content-Type 仅放行文本类，二进制拒绝
//! - 上游 4xx/5xx 不算网关错误：状态码与文本照常返回（调用方自行判断）

use axum::{extract::State, http::{HeaderMap, StatusCode}, Json};
use serde_json::Value;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::OnceLock;
use std::time::Duration;

use crate::{api_error, AppState};

/// 响应体大小上限（2 MB）
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
/// 重定向最大跳数（手动跟随，每跳重新校验）
const MAX_REDIRECTS: u8 = 3;
/// 总超时（连接 + 响应体读取）
const FETCH_TIMEOUT_SECS: u64 = 15;

/// web fetch 专用客户端：禁自动重定向（手动逐跳校验）+ 总超时。
/// 与上游 AI 转发用的 state.http 分开，互不影响对方的重定向策略。
static WEB_HTTP: OnceLock<reqwest::Client> = OnceLock::new();

fn web_http() -> &'static reqwest::Client {
    WEB_HTTP.get_or_init(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
            .user_agent("ai-relay-web-fetch/1.0")
            .build()
            .expect("构建 web fetch HTTP 客户端失败")
    })
}

/// 私网 / 保留地址黑名单（v4 常规段 + v6 ULA/链路本地/环回，含 v6 映射的 v4）
fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_private_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_private_v4(mapped);
            }
            let seg = v6.segments();
            v6.is_loopback()
                || v6.is_unspecified()
                || (0xfc00..=0xfdff).contains(&seg[0])          // ULA fc00::/7
                || (0xfe80..=0xfebf).contains(&seg[0])          // 链路本地 fe80::/10
                || (seg[0] & 0xff00) == 0xff00                  // 组播 ff00::/8
        }
    }
}

fn is_private_v4(v4: Ipv4Addr) -> bool {
    let o = v4.octets();
    o[0] == 0                                              // 0.0.0.0/8
        || o[0] == 10                                      // 10/8
        || (o[0] == 100 && (64..=127).contains(&o[1]))     // 100.64/10 CGNAT
        || o[0] == 127                                     // 环回
        || (o[0] == 169 && o[1] == 254)                    // 链路本地
        || (o[0] == 172 && (16..=31).contains(&o[1]))      // 172.16/12
        || (o[0] == 192 && o[1] == 168)                    // 192.168/16
        || (o[0] == 192 && o[1] == 0 && o[2] == 0)         // 192.0.0/24
        || (o[0] == 198 && (18..=19).contains(&o[1]))      // 198.18/15 基准测试
        || o[0] >= 224                                     // 组播 + 保留段
}

/// scheme + 主机名校验（IP 字面量直接查黑名单；域名解析后逐 IP 查）
async fn check_target(target: &url::Url) -> Result<(), String> {
    let scheme = target.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("仅支持 http/https，收到 {scheme:?}"));
    }
    let host = target
        .host_str()
        .ok_or("URL 缺少主机名")?
        .to_lowercase();
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.ends_with(".arpa")
    {
        return Err(format!("拒绝访问内部主机名 {host}"));
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        return if is_private_ip(ip) {
            Err(format!("拒绝访问私有地址 {ip}"))
        } else {
            Ok(())
        };
    }
    let port = target
        .port_or_known_default()
        .ok_or("URL 缺少端口")?;
    let addrs = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|e| format!("域名解析失败 {host}: {e}"))?;
    for addr in addrs {
        if is_private_ip(addr.ip()) {
            return Err(format!(
                "域名 {host} 解析到私有地址 {}，拒绝访问",
                addr.ip()
            ));
        }
    }
    Ok(())
}

/// 解析 + 校验目标 URL（首跳入口）
fn validate_target(raw: &str) -> Result<url::Url, String> {
    url::Url::parse(raw).map_err(|e| format!("URL 无法解析: {e}"))
}

/// POST /v1/web/fetch —— body: `{ "url": "https://..." }`
pub(crate) async fn web_fetch(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    const PATH: &str = "/v1/web/fetch";
    let user = crate::proxy::auth_user(&state, &headers).await?;
    crate::proxy::check_bound_signature(&user, &headers, "POST", PATH, &body)?;

    let payload: Value = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "请求体不是合法 JSON"))?;
    let raw_url = payload
        .get("url")
        .and_then(|u| u.as_str())
        .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "缺少 url 字段"))?;

    let mut current = validate_target(raw_url)
        .map_err(|e| api_error(StatusCode::BAD_REQUEST, e))?;
    check_target(&current)
        .await
        .map_err(|e| api_error(StatusCode::UNPROCESSABLE_ENTITY, e))?;

    // 手动重定向：每一跳都重新过 scheme + SSRF 校验
    let mut hops: u8 = 0;
    let mut resp = loop {
        let resp = web_http()
            .get(current.clone())
            .header(
                reqwest::header::ACCEPT,
                "text/html,application/xhtml+xml,application/json,text/*;q=0.9,*/*;q=0.1",
            )
            .send()
            .await
            .map_err(|e| api_error(StatusCode::BAD_GATEWAY, format!("抓取失败: {e}")))?;
        if !resp.status().is_redirection() {
            break resp;
        }
        hops += 1;
        if hops > MAX_REDIRECTS {
            return Err(api_error(
                StatusCode::BAD_GATEWAY,
                format!("重定向超过 {MAX_REDIRECTS} 跳"),
            ));
        }
        let loc = resp
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| api_error(StatusCode::BAD_GATEWAY, "重定向响应缺少 Location 头"))?;
        let next = current
            .join(loc)
            .map_err(|_| api_error(StatusCode::BAD_GATEWAY, "重定向 Location 无法解析"))?;
        check_target(&next)
            .await
            .map_err(|e| api_error(StatusCode::UNPROCESSABLE_ENTITY, e))?;
        current = next;
    };

    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let ct = content_type.to_lowercase();
    let text_like = ct.is_empty()
        || ct.starts_with("text/")
        || ct.contains("json")
        || ct.contains("xml")
        || ct.contains("javascript")
        || ct.contains("yaml");
    if !text_like {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("不支持的内容类型「{content_type}」，仅支持文本类（HTML/JSON/XML 等）"),
        ));
    }

    // 分块读取 + 大小上限（超限截断而非整体失败：抓到大页面的前 2MB 同样有用）
    let mut bytes: Vec<u8> = Vec::new();
    let mut truncated = false;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| api_error(StatusCode::BAD_GATEWAY, format!("读取响应体失败: {e}")))?
    {
        if bytes.len() + chunk.len() > MAX_BODY_BYTES {
            bytes.extend_from_slice(&chunk[..MAX_BODY_BYTES - bytes.len()]);
            truncated = true;
            break;
        }
        bytes.extend_from_slice(&chunk);
    }
    let text = String::from_utf8_lossy(&bytes).into_owned();

    Ok(Json(serde_json::json!({
        "url": current.as_str(),
        "status": resp.status().as_u16(),
        "contentType": content_type,
        "text": text,
        "truncated": truncated,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_v4_ranges_blocked() {
        for ip in [
            "0.0.0.0", "10.1.2.3", "100.64.0.1", "100.127.255.254", "127.0.0.1",
            "169.254.1.1", "172.16.0.1", "172.31.255.255", "192.168.1.1",
            "198.18.0.1", "224.0.0.1", "255.255.255.255",
        ] {
            assert!(is_private_ip(ip.parse().unwrap()), "{ip} 应命中黑名单");
        }
    }

    #[test]
    fn public_v4_allowed() {
        for ip in ["8.8.8.8", "1.1.1.1", "172.32.0.1", "198.20.0.1", "100.128.0.1"] {
            assert!(!is_private_ip(ip.parse().unwrap()), "{ip} 不应在黑名单");
        }
    }

    #[test]
    fn private_v6_and_mapped_v4_blocked() {
        for ip in ["::1", "::", "fc00::1", "fe80::1", "ff02::1", "::ffff:192.168.1.1"] {
            assert!(is_private_ip(ip.parse().unwrap()), "{ip} 应命中黑名单");
        }
        assert!(!is_private_ip("2606:4700::1111".parse().unwrap()));
    }

    #[tokio::test]
    async fn target_validation() {
        assert!(check_target(&url::Url::parse("ftp://example.com").unwrap())
            .await
            .is_err());
        assert!(check_target(&url::Url::parse("http://localhost/x").unwrap())
            .await
            .is_err());
        assert!(check_target(&url::Url::parse("http://127.0.0.1/x").unwrap())
            .await
            .is_err());
        assert!(check_target(&url::Url::parse("http://foo.internal/x").unwrap())
            .await
            .is_err());
        // 公网域名（DNS 结果公网）应放行
        assert!(check_target(&url::Url::parse("https://example.com/docs?a=1").unwrap())
            .await
            .is_ok());
        // 不存在的域名应解析失败拒绝
        assert!(check_target(
            &url::Url::parse("http://this-domain-does-not-exist-abcxyz.invalid/x").unwrap()
        )
        .await
        .is_err());
    }
}
