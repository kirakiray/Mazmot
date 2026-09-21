//! 用户 API（OpenAI 兼容）：`/v1/chat/completions`、`/v1/models`、`/v1/usage`。
//! 鉴权：Bearer = 用户 bearkey（遍历比对用常数时间比较）。

use axum::{
    body::Body,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures::StreamExt;
use serde_json::Value;
use tokio::sync::mpsc;

use crate::store::{self, Provider, UsageRec, UserRec};
use crate::{api_error, identity, AppState};

/// 签名请求头（base64 后的完整签名对象，含 signature / publicKey / signTime）
const AUTH_HEADER: &str = "x-relay-auth";

/// 绑定模式下的请求签名校验：未绑定记录时报"需先激活"，否则验签并核对 userId
fn check_bound_signature(
    user: &UserRec,
    headers: &HeaderMap,
    method: &str,
    path: &str,
    body: &[u8],
) -> Result<(), (StatusCode, Json<Value>)> {
    if user.bind_mode != "bound" {
        return Ok(());
    }
    if !user.binding_enforced() {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "该邀请码要求绑定用户，但尚未有任何用户激活绑定；请先在客户端激活",
        ));
    }
    let auth = headers
        .get(AUTH_HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            api_error(
                StatusCode::FORBIDDEN,
                "该邀请码已绑定用户，请求需要携带签名头（X-Relay-Auth）",
            )
        })?;
    let sig_user = identity::verify_request_signature(auth, &user.bound_pubkey, method, path, body)
        .map_err(|e| api_error(StatusCode::FORBIDDEN, format!("用户身份校验失败: {e}")))?;
    if sig_user != user.bound_user_id {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "签名用户与绑定用户不一致",
        ));
    }
    Ok(())
}

/// 按 bearkey 找用户（未命中 / 已禁用分别处理）
async fn auth_user(state: &AppState, headers: &HeaderMap) -> Result<UserRec, (StatusCode, Json<Value>)> {
    let Some(given) = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    else {
        return Err(api_error(StatusCode::UNAUTHORIZED, "缺少 Bearer bearkey"));
    };
    let users = state.users.read().await;
    let user = users
        .values()
        .find(|u| crate::constant_time_eq(given, &u.bearkey))
        .cloned();
    drop(users);
    match user {
        None => Err(api_error(StatusCode::UNAUTHORIZED, "bearkey 无效")),
        Some(u) if u.disabled => Err(api_error(StatusCode::FORBIDDEN, "该用户已被禁用")),
        Some(u) => Ok(u),
    }
}

fn quota_exceeded(user: &UserRec) -> bool {
    user.quota_tokens.map(|q| user.used_tokens >= q).unwrap_or(false)
}

/// 从用户 key 池里挑一个能服务该模型的可用 key（随机取一个）
async fn pick_upstream_key(
    state: &AppState,
    user: &UserRec,
    model: &str,
) -> Result<crate::store::ApiKeyRec, (StatusCode, Json<Value>)> {
    let keys = state.apikeys.read().await;
    let mut pool: Vec<crate::store::ApiKeyRec> = user
        .api_key_ids
        .iter()
        .filter_map(|id| keys.get(id))
        .filter(|k| !k.disabled && k.provider.serves_model(model))
        .cloned()
        .collect();
    drop(keys);
    if pool.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            format!("该用户的 key 池中没有可服务模型 {model} 的可用上游 key"),
        ));
    }
    use rand::Rng;
    let idx = rand::rng().random_range(0..pool.len());
    Ok(pool.swap_remove(idx))
}

/// 从 OpenAI 风格 usage 对象取 token 明细：
/// (prompt, completion, cache_hit, cache_miss)。
/// 缓存命中两家字段不同：DeepSeek 扁平 prompt_cache_hit_tokens / prompt_cache_miss_tokens，
/// GLM（含 Coding Plan）走 OpenAI 风格 usage.prompt_tokens_details.cached_tokens；
/// 只有命中没有未命中字段时按 输入 - 命中 推导，全无则记 0
fn tokens_of(usage: &Value) -> Option<(i64, i64, i64, i64)> {
    let prompt = usage.get("prompt_tokens")?.as_i64()?;
    let completion = usage.get("completion_tokens")?.as_i64()?;
    let hit = usage
        .get("prompt_cache_hit_tokens")
        .and_then(|v| v.as_i64())
        .or_else(|| {
            usage
                .get("prompt_tokens_details")
                .and_then(|d| d.get("cached_tokens"))
                .and_then(|v| v.as_i64())
        })
        .unwrap_or(0);
    let miss = usage
        .get("prompt_cache_miss_tokens")
        .and_then(|v| v.as_i64())
        .unwrap_or_else(|| (prompt - hit).max(0));
    Some((prompt, completion, hit, miss))
}

/// 在 SSE 文本里找最后一个带 usage 的 data chunk
fn extract_sse_usage(buffer: &str) -> Option<(i64, i64, i64, i64)> {
    let mut found = None;
    for line in buffer.lines() {
        let Some(data) = line.strip_prefix("data: ") else { continue };
        if data.trim() == "[DONE]" {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(data) {
            if let Some(usage) = v.get("usage").filter(|u| !u.is_null()) {
                found = tokens_of(usage);
            }
        }
    }
    found
}

/// 上游 key 可用性探测：GET /models；端点不提供 models（404/405）时
/// 降级为 1 token 最小对话探测（GLM Coding Plan 等订阅端点的兼容路径）
pub(crate) async fn probe_key(
    http: &reqwest::Client,
    key: &crate::store::ApiKeyRec,
) -> Result<(), String> {
    let base = key.provider.upstream_base();
    let fallback_model = if key.provider == Provider::Deepseek {
        "deepseek-chat"
    } else {
        "glm-4.7"
    };

    let resp = http
        .get(format!("{base}/models"))
        .bearer_auth(&key.api_key)
        .send()
        .await
        .map_err(|e| format!("无法连接上游: {e}"))?;
    if resp.status().is_success() {
        return Ok(());
    }
    if !matches!(resp.status().as_u16(), 404 | 405) {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "上游探测失败: {status} {}",
            body.chars().take(200).collect::<String>()
        ));
    }
    let resp = http
        .post(format!("{base}/chat/completions"))
        .bearer_auth(&key.api_key)
        .json(&serde_json::json!({
            "model": fallback_model,
            "messages": [{ "role": "user", "content": "hi" }],
            "max_tokens": 1,
        }))
        .send()
        .await
        .map_err(|e| format!("无法连接上游: {e}"))?;
    if resp.status().is_success() {
        return Ok(());
    }
    Err(format!("上游探测失败（对话探测）: {}", resp.status()))
}

/// POST /v1/activate —— NoneOS 用户激活绑定（请求体即签名对象，见 identity 模块说明）。
/// 仅 bind_mode=bound 的用户会真正落绑定；open 模式直接返回（行为不变）。
pub(crate) async fn activate(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user = auth_user(&state, &headers).await?;
    if user.bind_mode != "bound" {
        return Ok(Json(serde_json::json!({ "ok": true, "mode": "open" })));
    }
    if user.binding_enforced() {
        // 幂等重放：绑定的本人再次激活视为成功；其他人则拒绝
        match identity::verify_activate_body(&body) {
            Ok((uid, _)) if uid == user.bound_user_id => {
                return Ok(Json(serde_json::json!({
                    "ok": true,
                    "mode": "bound",
                    "alreadyBound": true,
                    "boundUserId": user.bound_user_id,
                })));
            }
            _ => return Err(api_error(StatusCode::CONFLICT, "该邀请码已被其他用户绑定")),
        }
    }

    let (uid, pubkey) = identity::verify_activate_body(&body)
        .map_err(|e| api_error(StatusCode::UNAUTHORIZED, format!("激活校验失败: {e}")))?;
    let mut user = user;
    user.bound_user_id = uid;
    user.bound_pubkey = pubkey;
    user.bound_at = store::now_ms();
    state.save_user(&user).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": { "message": e, "type": "ai_relay_error" } })),
        )
    })?;
    Ok(Json(serde_json::json!({
        "ok": true,
        "mode": "bound",
        "boundUserId": user.bound_user_id,
        "boundAt": user.bound_at,
    })))
}

/// POST /v1/chat/completions
pub(crate) async fn chat_completions(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let user = auth_user(&state, &headers).await?;
    check_bound_signature(&user, &headers, "POST", "/v1/chat/completions", &body)?;
    if quota_exceeded(&user) {
        return Err(api_error(
            StatusCode::PAYMENT_REQUIRED,
            format!(
                "token 配额已用完（已用 {}/{}）；请联系管理员调整",
                user.used_tokens,
                user.quota_tokens.unwrap_or(0)
            ),
        ));
    }

    let payload: Value = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "请求体不是合法 JSON"))?;
    let model = payload
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_string();
    if model.is_empty() {
        return Err(api_error(StatusCode::BAD_REQUEST, "缺少 model 字段"));
    }
    let is_stream = payload.get("stream").and_then(|s| s.as_bool()).unwrap_or(false);
    if Provider::Deepseek.serves_model(&model) || Provider::Glm.serves_model(&model) {
        // 支持的前缀，继续挑 key
    } else {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            format!("无法从模型名 {model} 识别上游（支持 glm-* / deepseek-*）"),
        ));
    }
    // 用户级模型白名单（空 = 不限制）
    if !store::model_allowed(&user.allowed_models, &model) {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            format!("模型 {model} 不在该用户的可用模型范围内"),
        ));
    }
    let upstream_key = pick_upstream_key(&state, &user, &model).await?;

    // 流式请求注入 include_usage，上游末 chunk 才会带 usage 供统计
    let mut upstream_body = payload.clone();
    if is_stream {
        let obj = upstream_body.as_object_mut().unwrap();
        obj.entry("stream_options")
            .or_insert_with(|| serde_json::json!({ "include_usage": true }));
    }

    let url = format!("{}/chat/completions", upstream_key.provider.upstream_base());
    let response = state
        .http
        .post(&url)
        .bearer_auth(&upstream_key.api_key)
        .json(&upstream_body)
        .send()
        .await
        .map_err(|e| api_error(StatusCode::BAD_GATEWAY, format!("上游请求失败: {e}")))?;

    let status = response.status();
    if !status.is_success() {
        // 上游错误原样透传给调用方，便于排查（额度 / 模型名错误等）
        let text = response.text().await.unwrap_or_default();
        let resp = Response::builder()
            .status(StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY))
            .header("content-type", "application/json")
            .body(Body::from(text))
            .unwrap();
        return Ok(resp);
    }

    if !is_stream {
        let data: Value = response
            .json()
            .await
            .map_err(|e| api_error(StatusCode::BAD_GATEWAY, format!("上游响应解析失败: {e}")))?;
        let usage = data.get("usage").filter(|u| !u.is_null()).and_then(tokens_of);
        let (prompt, completion, cache_hit, cache_miss) = usage.unwrap_or((0, 0, 0, 0));
        state
            .record_usage(UsageRec {
                user_id: user.id.clone(),
                ts: store::now_ms(),
                model: model.clone(),
                prompt_tokens: prompt,
                completion_tokens: completion,
                cache_hit_tokens: cache_hit,
                cache_miss_tokens: cache_miss,
                key_id: upstream_key.id.clone(),
            })
            .await;
        return Ok(Json(data).into_response());
    }

    // 流式：边透传边扫描 SSE chunk 里的 usage，流结束时落一条用量记录
    let (tx, rx) = mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(16);
    let relay_state = state.clone();
    let (user_id, key_id) = (user.id.clone(), upstream_key.id.clone());
    let model2 = model.clone();
    tokio::spawn(async move {
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    if buffer.len() < 1 << 20 {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));
                    }
                    if tx.send(Ok(bytes)).await.is_err() {
                        break; // 客户端断开
                    }
                }
                Err(e) => {
                    let _ = tx.send(Err(std::io::Error::other(e.to_string()))).await;
                    return;
                }
            }
        }
        let (prompt, completion, cache_hit, cache_miss) =
            extract_sse_usage(&buffer).unwrap_or((0, 0, 0, 0));
        relay_state
            .record_usage(UsageRec {
                user_id,
                ts: store::now_ms(),
                model: model2,
                prompt_tokens: prompt,
                completion_tokens: completion,
                cache_hit_tokens: cache_hit,
                cache_miss_tokens: cache_miss,
                key_id,
            })
            .await;
    });

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/event-stream")
        .header("cache-control", "no-cache")
        .body(Body::from_stream(tokio_stream::wrappers::ReceiverStream::new(rx)))
        .unwrap())
}

/// 聚合 key 池内各上游的模型 id（去重；单个上游失败跳过，全部失败返回 None）
pub(crate) async fn pool_models(
    http: &reqwest::Client,
    pool: &[crate::store::ApiKeyRec],
) -> Option<Vec<String>> {
    let mut ids: Vec<String> = Vec::new();
    let mut any_ok = false;
    for key in pool {
        let url = format!("{}/models", key.provider.upstream_base());
        let Ok(resp) = http.get(&url).bearer_auth(&key.api_key).send().await else {
            continue;
        };
        if let Ok(data) = resp.json::<Value>().await {
            if let Some(list) = data.get("data").and_then(|d| d.as_array()) {
                for m in list {
                    if let Some(id) = m.get("id").and_then(|i| i.as_str()) {
                        if !ids.iter().any(|x| x == id) {
                            ids.push(id.to_string());
                        }
                    }
                }
                any_ok = true;
            }
        }
    }
    if any_ok { Some(ids) } else { None }
}

/// GET /v1/models —— 合并用户 key 池内各上游的模型列表（按白名单过滤）
pub(crate) async fn models(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user = auth_user(&state, &headers).await?;
    check_bound_signature(&user, &headers, "GET", "/v1/models", b"")?;
    let keys = state.apikeys.read().await;
    let pool: Vec<crate::store::ApiKeyRec> = user
        .api_key_ids
        .iter()
        .filter_map(|id| keys.get(id))
        .filter(|k| !k.disabled)
        .cloned()
        .collect();
    drop(keys);

    if pool.is_empty() {
        return Err(api_error(StatusCode::BAD_REQUEST, "该用户未配置任何可用上游 key"));
    }

    let ids = pool_models(&state.http, &pool)
        .await
        .ok_or_else(|| api_error(StatusCode::BAD_GATEWAY, "所有上游模型列表查询失败"))?;
    let ids: Vec<String> = ids
        .into_iter()
        .filter(|id| store::model_allowed(&user.allowed_models, id))
        .collect();
    Ok(Json(serde_json::json!({
        "object": "list",
        "data": ids.into_iter().map(|id| serde_json::json!({ "id": id, "object": "model" })).collect::<Vec<_>>(),
    })))
}

/// GET /v1/server —— 服务器公开信息（命名；无需鉴权，客户端展示用）
pub(crate) async fn server_info(State(state): State<AppState>) -> Json<Value> {
    let name = state.server_name.read().await.clone();
    Json(serde_json::json!({ "name": name }))
}

/// GET /v1/usage —— 该用户自身的配额 / 已用 / 剩余
pub(crate) async fn usage(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user = auth_user(&state, &headers).await?;
    check_bound_signature(&user, &headers, "GET", "/v1/usage", b"")?;
    Ok(Json(serde_json::json!({
        "serverName": state.server_name.read().await.clone(),
        "userId": user.id,
        "name": user.name,
        "quotaTokens": user.quota_tokens,
        "usedTokens": user.used_tokens,
        "totalRequests": user.total_requests,
        "remainingTokens": user.quota_tokens.map(|q| (q - user.used_tokens).max(0)),
    })))
}
