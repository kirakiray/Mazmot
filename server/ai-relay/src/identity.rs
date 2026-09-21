//! NoneOS 用户身份绑定与请求签名验证。
//!
//! 与 noneos-core 的签名方案对齐（nos/user/base-user.js `_sign`）：
//! - ECDSA P-256 + SHA-256，公钥为 SPKI DER 的 base64，签名为 64 字节 fixed (r||s) 的 base64；
//! - 签名消息 = 签名字段之外的剩余字段**按 key 字母序排序**后 `JSON.stringify`；
//! - `userId` = SHA-256 hex(publicKey 字符串)（nos/util/hash/get-hash.js）。
//!
//! 协议：客户端用 `user.sign({...})` 对
//! `{ k: "relay-auth", userId, ts, method, path, bodyHash }` 签名
//!（_sign 自动附加 `signTime` / `publicKey`），把完整签名对象 base64 后放 `X-Relay-Auth` 头。
//! 激活（`POST /v1/activate`）时该签名对象直接作为请求体（bodyHash 固定为 ""）。

use base64::Engine;
use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{Signature, VerifyingKey};
use p256::pkcs8::DecodePublicKey;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// 容许的签名时间偏差（毫秒）：签名里的 `ts` 字段与服务器时间的最大距离
pub(crate) const TS_WINDOW_MS: i64 = 10 * 60 * 1000;

/// SHA-256 hex（与 noneos get-hash.js 一致，输入为字符串原文）
pub(crate) fn sha256_hex(data: &str) -> String {
    let digest = Sha256::digest(data.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// 解码 `X-Relay-Auth` 头：base64(JSON) → 签名对象
fn decode_auth_header(raw: &str) -> Result<BTreeMap<String, Value>, String> {
    let json = base64::engine::general_purpose::STANDARD
        .decode(raw.trim())
        .map_err(|e| format!("X-Relay-Auth base64 解码失败: {e}"))?;
    let v: Value = serde_json::from_slice(&json).map_err(|e| format!("X-Relay-Auth 不是合法 JSON: {e}"))?;
    match v {
        Value::Object(map) => Ok(map.into_iter().collect()),
        _ => Err("X-Relay-Auth 不是 JSON 对象".into()),
    }
}

/// 验证一个签名对象（key → value）：
/// 剥离 signature 后按 key 字母序规范化 stringify，用 pubkey 验签。
fn verify_signed_map(
    pubkey_b64: &str,
    data: &BTreeMap<String, Value>,
    signature_b64: &str,
) -> Result<(), String> {
    let pubkey_bytes = base64::engine::general_purpose::STANDARD
        .decode(pubkey_b64.trim())
        .map_err(|e| format!("公钥 base64 解码失败: {e}"))?;
    let verifying_key = VerifyingKey::from_public_key_der(&pubkey_bytes)
        .map_err(|e| format!("公钥解析失败: {e}"))?;

    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(signature_b64.trim())
        .map_err(|e| format!("签名 base64 解码失败: {e}"))?;
    // WebCrypto ECDSA 输出 64 字节 fixed (r||s)
    let signature = Signature::from_slice(&sig_bytes).map_err(|e| format!("签名格式非法: {e}"))?;

    // noneos 规范化：按 key 字母序排序后 JSON.stringify
    let canonical = serde_json::to_string(data).map_err(|e| e.to_string())?;
    verifying_key
        .verify(canonical.as_bytes(), &signature)
        .map_err(|_| "签名验证失败".to_string())
}

/// 验证 `X-Relay-Auth` 请求签名，返回签名对象里的 userId。
///
/// 校验链：结构完整 → 公钥与绑定一致 → userId 与公钥哈希一致 →
/// ts 时间窗 → 字段与实际请求一致（method / path / bodyHash）→ ECDSA 验签。
pub(crate) fn verify_request_signature(
    auth_header: &str,
    bound_pubkey: &str,
    method: &str,
    path: &str,
    body: &[u8],
) -> Result<String, String> {
    let mut data = decode_auth_header(auth_header)?;

    let Some(Value::String(signature)) = data.remove("signature") else {
        return Err("缺少 signature 字段".into());
    };
    let pubkey_of_req = data
        .get("publicKey")
        .and_then(|v| v.as_str())
        .ok_or("缺少 publicKey 字段")?;
    if pubkey_of_req.trim() != bound_pubkey.trim() {
        return Err("签名公钥与绑定用户不一致".into());
    }

    let user_id = data
        .get("userId")
        .and_then(|v| v.as_str())
        .ok_or("缺少 userId 字段")?;
    if sha256_hex(pubkey_of_req) != user_id {
        return Err("userId 与公钥不匹配".into());
    }

    let ts = data.get("ts").and_then(|v| v.as_i64()).ok_or("缺少 ts 字段")?;
    let now = store_now_ms();
    if (now - ts).abs() > TS_WINDOW_MS {
        return Err("签名时间戳超出容许窗口".into());
    }

    let expect_method = method.to_uppercase();
    if data.get("method").and_then(|v| v.as_str()) != Some(expect_method.as_str()) {
        return Err("签名 method 与请求不一致".into());
    }
    if data.get("path").and_then(|v| v.as_str()) != Some(path) {
        return Err("签名 path 与请求不一致".into());
    }
    let body_hash = sha256_hex(&String::from_utf8_lossy(body));
    if data.get("bodyHash").and_then(|v| v.as_str()) != Some(body_hash.as_str()) {
        return Err("签名 bodyHash 与请求体不一致".into());
    }
    if data.get("k").and_then(|v| v.as_str()) != Some("relay-auth") {
        return Err("签名用途标记 k 不合法".into());
    }

    verify_signed_map(bound_pubkey, &data, &signature)?;
    Ok(user_id.to_string())
}

/// 验证激活请求体（即签名对象本身），返回 (userId, pubkey)。
/// 激活消息的 bodyHash 固定为 ""（请求体就是签名对象自身，无需再哈希）。
pub(crate) fn verify_activate_body(body: &[u8]) -> Result<(String, String), String> {
    let v: Value = serde_json::from_slice(body).map_err(|e| format!("请求体不是合法 JSON: {e}"))?;
    let Value::Object(map) = v else {
        return Err("请求体不是 JSON 对象".into());
    };
    let mut data: BTreeMap<String, Value> = map.into_iter().collect();

    let Some(Value::String(signature)) = data.remove("signature") else {
        return Err("缺少 signature 字段".into());
    };
    let pubkey = data
        .get("publicKey")
        .and_then(|v| v.as_str())
        .ok_or("缺少 publicKey 字段")?
        .to_string();
    let user_id = data
        .get("userId")
        .and_then(|v| v.as_str())
        .ok_or("缺少 userId 字段")?
        .to_string();
    if sha256_hex(&pubkey) != user_id {
        return Err("userId 与公钥不匹配".into());
    }
    let ts = data.get("ts").and_then(|v| v.as_i64()).ok_or("缺少 ts 字段")?;
    if (store_now_ms() - ts).abs() > TS_WINDOW_MS {
        return Err("签名时间戳超出容许窗口".into());
    }
    if data.get("k").and_then(|v| v.as_str()) != Some("relay-auth") {
        return Err("签名用途标记 k 不合法".into());
    }
    if data.get("bodyHash").and_then(|v| v.as_str()) != Some("") {
        return Err("激活签名 bodyHash 必须为空字符串".into());
    }
    // 顺手验一下公钥本身可解析（绑定前确保是合法 P-256 公钥）
    let pubkey_bytes = base64::engine::general_purpose::STANDARD
        .decode(pubkey.trim())
        .map_err(|e| format!("公钥 base64 解码失败: {e}"))?;
    VerifyingKey::from_public_key_der(&pubkey_bytes).map_err(|e| format!("公钥解析失败: {e}"))?;

    verify_signed_map(&pubkey, &data, &signature)?;
    Ok((user_id, pubkey))
}

fn store_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use p256::ecdsa::signature::Signer;
    use p256::ecdsa::{SigningKey, VerifyingKey};
    use p256::pkcs8::EncodePublicKey;
    use serde_json::json;

    /// noneos `_sign` 的对应实现（测试用）：附加 signTime/publicKey、按 key 排序后 stringify 签名
    fn noneos_sign(signing: &SigningKey, mut data: serde_json::Map<String, Value>) -> (BTreeMap<String, Value>, String) {
        let vk = VerifyingKey::from(signing);
        let pubkey_b64 = base64::engine::general_purpose::STANDARD
            .encode(vk.to_public_key_der().unwrap().as_bytes());
        data.insert("signTime".into(), json!(1_700_000_000_000i64));
        data.insert("publicKey".into(), json!(pubkey_b64));
        let sorted: BTreeMap<String, Value> = data.into_iter().collect();
        let msg = serde_json::to_string(&sorted).unwrap();
        let sig: p256::ecdsa::Signature = signing.sign(msg.as_bytes());
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(sig.to_bytes());
        (sorted, sig_b64)
    }

    fn to_auth_header(sorted: &BTreeMap<String, Value>, sig_b64: &str) -> String {
        let mut full = sorted.clone();
        full.insert("signature".into(), Value::String(sig_b64.to_string()));
        let json = serde_json::to_string(&full).unwrap();
        base64::engine::general_purpose::STANDARD.encode(json)
    }

    #[test]
    fn sha256_hex_matches_known_vector() {
        assert_eq!(
            sha256_hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn request_signature_roundtrip() {
        let signing = SigningKey::from_slice(&[7u8; 32]).unwrap();
        let vk = VerifyingKey::from(&signing);
        let pubkey_b64 = base64::engine::general_purpose::STANDARD
            .encode(vk.to_public_key_der().unwrap().as_bytes());
        let user_id = sha256_hex(&pubkey_b64);
        let body = br#"{"model":"glm-5.3"}"#;

        let (sorted, sig_b64) = noneos_sign(
            &signing,
            serde_json::json!({
                "k": "relay-auth",
                "userId": user_id,
                "ts": store_now_ms(),
                "method": "POST",
                "path": "/v1/chat/completions",
                "bodyHash": sha256_hex(&String::from_utf8_lossy(body)),
            })
            .as_object()
            .unwrap()
            .clone(),
        );
        let header = to_auth_header(&sorted, &sig_b64);

        let got = verify_request_signature(&header, &pubkey_b64, "POST", "/v1/chat/completions", body);
        assert_eq!(got.unwrap(), user_id);
    }

    #[test]
    fn tampered_body_rejected() {
        let signing = SigningKey::from_slice(&[8u8; 32]).unwrap();
        let vk = VerifyingKey::from(&signing);
        let pubkey_b64 = base64::engine::general_purpose::STANDARD
            .encode(vk.to_public_key_der().unwrap().as_bytes());
        let (sorted, sig_b64) = noneos_sign(
            &signing,
            serde_json::json!({
                "k": "relay-auth",
                "userId": sha256_hex(&pubkey_b64),
                "ts": store_now_ms(),
                "method": "POST",
                "path": "/v1/chat/completions",
                "bodyHash": sha256_hex("{}"),
            })
            .as_object()
            .unwrap()
            .clone(),
        );
        let header = to_auth_header(&sorted, &sig_b64);
        assert!(verify_request_signature(&header, &pubkey_b64, "POST", "/v1/chat/completions", b"{\"x\":1}").is_err());
    }

    #[test]
    fn stale_timestamp_rejected() {
        let signing = SigningKey::from_slice(&[9u8; 32]).unwrap();
        let vk = VerifyingKey::from(&signing);
        let pubkey_b64 = base64::engine::general_purpose::STANDARD
            .encode(vk.to_public_key_der().unwrap().as_bytes());
        let (sorted, sig_b64) = noneos_sign(
            &signing,
            serde_json::json!({
                "k": "relay-auth",
                "userId": sha256_hex(&pubkey_b64),
                "ts": store_now_ms() - 2 * TS_WINDOW_MS,
                "method": "GET",
                "path": "/v1/usage",
                "bodyHash": sha256_hex(""),
            })
            .as_object()
            .unwrap()
            .clone(),
        );
        let header = to_auth_header(&sorted, &sig_b64);
        let err = verify_request_signature(&header, &pubkey_b64, "GET", "/v1/usage", b"").unwrap_err();
        assert!(err.contains("时间戳"), "实际错误: {err}");
    }

    #[test]
    fn wrong_pubkey_rejected() {
        let signing = SigningKey::from_slice(&[10u8; 32]).unwrap();
        let vk = VerifyingKey::from(&signing);
        let pubkey_b64 = base64::engine::general_purpose::STANDARD
            .encode(vk.to_public_key_der().unwrap().as_bytes());
        let (sorted, sig_b64) = noneos_sign(
            &signing,
            serde_json::json!({
                "k": "relay-auth",
                "userId": sha256_hex(&pubkey_b64),
                "ts": store_now_ms(),
                "method": "GET",
                "path": "/v1/usage",
                "bodyHash": sha256_hex(""),
            })
            .as_object()
            .unwrap()
            .clone(),
        );
        let header = to_auth_header(&sorted, &sig_b64);
        assert!(verify_request_signature(&header, "AAAA", "GET", "/v1/usage", b"").is_err());
    }

    #[test]
    fn activate_body_roundtrip() {
        let signing = SigningKey::from_slice(&[11u8; 32]).unwrap();
        let vk = VerifyingKey::from(&signing);
        let pubkey_b64 = base64::engine::general_purpose::STANDARD
            .encode(vk.to_public_key_der().unwrap().as_bytes());
        let user_id = sha256_hex(&pubkey_b64);
        let (sorted, sig_b64) = noneos_sign(
            &signing,
            serde_json::json!({
                "k": "relay-auth",
                "userId": user_id,
                "ts": store_now_ms(),
                "method": "POST",
                "path": "/v1/activate",
                "bodyHash": "",
            })
            .as_object()
            .unwrap()
            .clone(),
        );
        let mut full = sorted.clone();
        full.insert("signature".into(), Value::String(sig_b64));
        let body = serde_json::to_vec(&full).unwrap();

        let (got_user, got_pubkey) = verify_activate_body(&body).unwrap();
        assert_eq!(got_user, user_id);
        assert_eq!(got_pubkey, pubkey_b64);
    }
}
