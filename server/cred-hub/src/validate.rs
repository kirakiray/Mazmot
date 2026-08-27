//! cred 数据校验模块
//!
//! 与 NoneOS Core 的签名方案保持一致：
//! - ECDSA P-256 + SHA-256
//! - publicKey：base64(SPKI DER)
//! - signature：base64(WebCrypto raw r||s，64 字节)
//! - 待签内容：剥离 `signature` 字段后 JSON.stringify；
//!   证书统一导入路径按 key 字母序排序序列化（与 BaseUser._sign 一致），
//!   这里采用同样的规范化排序验签，不依赖字段顺序。

use base64::Engine as _;
use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{Signature, VerifyingKey};
use p256::pkcs8::DecodePublicKey;
use serde_json::{Map, Value};

fn b64_decode(s: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|e| format!("base64 解码失败: {e}"))
}

/// 复刻 JS `JSON.stringify`：对象 key 按字母序排序（递归），紧凑无空白。
fn to_canonical_json(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let items: Vec<String> = keys
                .into_iter()
                .map(|k| {
                    format!(
                        "{}:{}",
                        json_escape(k),
                        to_canonical_json(&map[k])
                    )
                })
                .collect();
            format!("{{{}}}", items.join(","))
        }
        Value::Array(items) => {
            let parts: Vec<String> = items.iter().map(to_canonical_json).collect();
            format!("[{}]", parts.join(","))
        }
        other => other.to_string(),
    }
}

fn json_escape(s: &str) -> String {
    Value::String(s.to_string()).to_string()
}

/// 校验 cred 数据合法性，成功返回 ()
pub fn validate_cred(cred: &Value) -> Result<(), String> {
    let obj = cred
        .as_object()
        .ok_or("cred 必须是 JSON 对象")?;

    // 结构校验
    for field in ["id", "role", "issuer", "subject", "signTime", "publicKey", "signature"] {
        require_str_field(obj, field)?;
    }

    check_expire(obj)?;

    verify_signature(obj).map_err(|e| format!("签名验证失败: {e}"))
}

/// 校验用户卡片（profile）：与 cred 的差异是不要求 `id`——core 的 profile API
/// 读回的是签名载荷视图（不含 DB 外层 id）；且豁免 expire 检查（core 对 profile
/// 同样例外）。签名验证方式完全一致，凭提交数据的现有字段规范化验签
pub fn validate_profile_card(card: &Value) -> Result<(), String> {
    let obj = card.as_object().ok_or("用户卡片必须是 JSON 对象")?;
    for field in ["role", "issuer", "subject", "signTime", "publicKey", "signature"] {
        require_str_field(obj, field)?;
    }
    verify_signature(obj).map_err(|e| format!("签名验证失败: {e}"))
}

fn require_str_field(obj: &Map<String, Value>, field: &str) -> Result<(), String> {
    let v = obj.get(field).ok_or_else(|| format!("缺少必填字段 {field}"))?;
    if !matches!(v, Value::String(s) if !s.is_empty()) && !(field == "signTime" && v.is_number()) {
        return Err(format!(
            "字段 {field} 必须是非空字符串（signTime 可为时间戳数字或 ISO 字符串）"
        ));
    }
    if matches!(v, Value::Null) {
        return Err(format!("字段 {field} 不能为 null"));
    }
    Ok(())
}

/// expire 校验：若存在且非 null，必须是晚于 signTime 的毫秒时间戳且未过期
fn check_expire(obj: &Map<String, Value>) -> Result<(), String> {
    let sign_time = parse_timestamp(obj.get("signTime").ok_or("缺少 signTime")?)
        .ok_or("signTime 不是有效时间戳")?;

    match obj.get("expire") {
        None | Some(Value::Null) => Ok(()),
        Some(v) => {
            let expire = parse_timestamp(v).ok_or("expire 不是有效时间戳")?;
            if expire <= sign_time {
                return Err("expire 必须晚于 signTime".into());
            }
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64;
            if expire < now_ms {
                return Err("cred 已过期".into());
            }
            Ok(())
        }
    }
}

/// 时间戳兼容数字毫秒值或 ISO-8601 / 纯数字字符串（admin.rs 统计过期时也用）
pub(crate) fn parse_timestamp(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Value::String(s) => {
            if let Ok(n) = s.parse::<i64>() {
                return Some(n);
            }
            // 简易 ISO-8601 解析
            chrono_like_parse_iso8601(s)
        }
        _ => None,
    }
}

/// 轻量 ISO-8601 UTC 时间解析（形如 2024-01-02T03:04:05.678Z），避免引入 chrono
fn chrono_like_parse_iso8601(s: &str) -> Option<i64> {
    fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
        let y = if m <= 2 { y - 1 } else { y };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let mp = (m + 9) % 12;
        let doy = (153 * mp + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146097 + doe - 719468
    }
    let s = s.trim();
    if s.len() < 19 {
        return None;
    }
    let digits: Vec<i64> = s
        .chars()
        .filter(|c| c.is_ascii_digit())
        .map(|c| c as i64 - '0' as i64)
        .collect();
    if digits.len() < 14 {
        return None;
    }
    let year: i64 = digits[0] * 1000 + digits[1] * 100 + digits[2] * 10 + digits[3];
    let month: i64 = digits[4] * 10 + digits[5];
    let day: i64 = digits[6] * 10 + digits[7];
    let hour: i64 = digits[8] * 10 + digits[9];
    let min: i64 = digits[10] * 10 + digits[11];
    let sec: i64 = digits[12] * 10 + digits[13];
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    Some((days_from_civil(year, month, day) * 86400 + hour * 3600 + min * 60 + sec) * 1000)
}

/// ECDSA P-256 验签（规范化排序序列化）
fn verify_signature(obj: &Map<String, Value>) -> Result<(), String> {
    let signature_b64 = obj
        .get("signature")
        .and_then(Value::as_str)
        .ok_or("缺少 signature")?;
    let public_key_b64 = obj
        .get("publicKey")
        .and_then(Value::as_str)
        .ok_or("缺少 publicKey")?;

    // 剥离 signature 后构建待签数据（保留其余全部字段）
    let mut data_map = obj.clone();
    data_map.remove("signature");
    let message = to_canonical_json(&Value::Object(data_map));

    // 公钥：base64(SPKI DER)
    let spki_der = b64_decode(public_key_b64)?;
    let verifying_key = VerifyingKey::from_public_key_der(&spki_der)
        .map_err(|e| format!("公钥解析失败（需 base64 SPKI DER P-256）: {e}"))?;

    // WebCrypto 输出 raw r||s（64 字节）；p256 可直接解析
    let sig_bytes = b64_decode(signature_b64)?;
    let signature = Signature::from_slice(&sig_bytes)
        .map_err(|_| format!("签名格式非法（期望 64 字节 raw r||s，实际 {} 字节）", sig_bytes.len()))?;

    verifying_key
        .verify(message.as_bytes(), &signature)
        .map_err(|_| "签名与数据/公钥不匹配".to_string())
}
