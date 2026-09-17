//! 数据模型与 redb 持久化。
//!
//! 三张表：
//! - `users`   用户（含 bearkey、配额、累计用量、可用 apikey 池）
//! - `apikeys` 上游 apikey（deepseek / glm）
//! - `usage`   token 用量流水，key = `{user_id}\u{0}{ts_ms}\u{0}{nonce}`
//!
//! 与 cred-hub 一致：redb 是权威数据，内存 HashMap 为读缓存（本服务数据规模
//! 小——用户 / key 均为人工创建，全量驻留内存，写路径先落盘再改内存）。

use rand::Rng;
use redb::ReadableDatabase;
use redb::ReadableTable;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub(crate) const USERS_TABLE: redb::TableDefinition<&str, &[u8]> = redb::TableDefinition::new("users");
pub(crate) const APIKEYS_TABLE: redb::TableDefinition<&str, &[u8]> =
    redb::TableDefinition::new("apikeys");
pub(crate) const USAGE_TABLE: redb::TableDefinition<&str, &[u8]> = redb::TableDefinition::new("usage");

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// 随机 id / bearkey（URL 安全，无歧义字符）
pub(crate) fn random_token(len: usize) -> String {
    const ALPHABET: &[u8] = b"abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::rng();
    (0..len)
        .map(|_| ALPHABET[rng.random_range(0..ALPHABET.len())] as char)
        .collect()
}

/// 上游提供商。模型名前缀路由的依据也在此（`glm-*` → Glm，`deepseek-*` → Deepseek）
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Debug)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Provider {
    Deepseek,
    Glm,
}

impl Provider {
    /// OpenAI 兼容上游基址（与 mz/ai/supplier 保持一致）
    pub(crate) fn upstream_base(&self) -> &'static str {
        match self {
            Provider::Deepseek => "https://api.deepseek.com",
            Provider::Glm => "https://open.bigmodel.cn/api/paas/v4",
        }
    }

    pub(crate) fn parse(s: &str) -> Option<Self> {
        match s {
            "deepseek" => Some(Provider::Deepseek),
            "glm" => Some(Provider::Glm),
            _ => None,
        }
    }

    /// 按模型名前缀路由上游；不匹配返回 None
    pub(crate) fn of_model(model: &str) -> Option<Self> {
        if model.starts_with("deepseek") {
            Some(Provider::Deepseek)
        } else if model.starts_with("glm") {
            Some(Provider::Glm)
        } else {
            None
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub(crate) struct ApiKeyRec {
    pub(crate) id: String,
    pub(crate) provider: Provider,
    pub(crate) label: String,
    /// 明文只存服务器本地，管理接口一律只回 masked
    pub(crate) api_key: String,
    pub(crate) masked_key: String,
    pub(crate) disabled: bool,
    pub(crate) created_at: i64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub(crate) struct UserRec {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) note: String,
    /// None = 无限
    pub(crate) quota_tokens: Option<i64>,
    pub(crate) used_tokens: i64,
    pub(crate) bearkey: String,
    pub(crate) disabled: bool,
    pub(crate) created_at: i64,
    /// 该用户可用的上游 apikey id 池
    pub(crate) api_key_ids: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub(crate) struct UsageRec {
    pub(crate) user_id: String,
    pub(crate) ts: i64,
    pub(crate) model: String,
    pub(crate) prompt_tokens: i64,
    pub(crate) completion_tokens: i64,
    pub(crate) key_id: String,
}

pub(crate) fn mask_key(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 8 {
        return "*".repeat(chars.len());
    }
    format!("{}...{}", &key[..4], &key[chars.len() - 4..])
}

/// 从 redb 加载全量数据到内存（启动自愈）
pub(crate) fn load_all(
    db: &redb::Database,
) -> Result<
    (
        HashMap<String, UserRec>,
        HashMap<String, ApiKeyRec>,
        Vec<UsageRec>,
    ),
    String,
> {
    let read_tx = db.begin_read().map_err(|e| e.to_string())?;
    let mut users = HashMap::new();
    let mut apikeys = HashMap::new();
    let mut usage = Vec::new();

    if let Ok(table) = read_tx.open_table(USERS_TABLE) {
        for row in table.iter().map_err(|e| e.to_string())? {
            let (_, v) = row.map_err(|e| e.to_string())?;
            if let Ok(u) = serde_json::from_slice::<UserRec>(v.value()) {
                users.insert(u.id.clone(), u);
            }
        }
    }
    if let Ok(table) = read_tx.open_table(APIKEYS_TABLE) {
        for row in table.iter().map_err(|e| e.to_string())? {
            let (_, v) = row.map_err(|e| e.to_string())?;
            if let Ok(k) = serde_json::from_slice::<ApiKeyRec>(v.value()) {
                apikeys.insert(k.id.clone(), k);
            }
        }
    }
    if let Ok(table) = read_tx.open_table(USAGE_TABLE) {
        for row in table.iter().map_err(|e| e.to_string())? {
            let (_, v) = row.map_err(|e| e.to_string())?;
            if let Ok(u) = serde_json::from_slice::<UsageRec>(v.value()) {
                usage.push(u);
            }
        }
    }
    usage.sort_by_key(|u| u.ts);
    Ok((users, apikeys, usage))
}

// ———— 单行持久化辅助（阻塞 IO，调用方须放在 spawn_blocking 内） ————

pub(crate) fn put_row(db: &redb::Database, table: redb::TableDefinition<&str, &[u8]>, key: &str, value: &[u8]) -> Result<(), String> {
    let write_tx = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut t = write_tx.open_table(table).map_err(|e| e.to_string())?;
        t.insert(key, value).map_err(|e| e.to_string())?;
    }
    write_tx.commit().map_err(|e| e.to_string())
}

pub(crate) fn remove_row(db: &redb::Database, table: redb::TableDefinition<&str, &[u8]>, key: &str) -> Result<(), String> {
    let write_tx = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut t = write_tx.open_table(table).map_err(|e| e.to_string())?;
        t.remove(key).map_err(|e| e.to_string())?;
    }
    write_tx.commit().map_err(|e| e.to_string())
}

/// 生成用量流水表 key（同毫秒多次请求靠 nonce 区分）
pub(crate) fn usage_row_key(user_id: &str, ts: i64) -> String {
    format!("{user_id}\u{0}{ts}\u{0}{}", random_token(6))
}

// ———— 邀请码：URL-safe Base64 的 JSON {"u": serverUrl, "k": bearkey} ————

pub(crate) fn encode_invite(server_url: &str, bearkey: &str) -> String {
    use base64::Engine;
    let payload = serde_json::json!({ "u": server_url, "k": bearkey });
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload.to_string())
}

/// 客户端（mz/ai/supplier/relay.js）的解码对应实现；服务端仅测试 / 调试用
#[allow(dead_code)]
pub(crate) fn decode_invite(code: &str) -> Option<(String, String)> {
    use base64::Engine;
    let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(code.trim())
        .ok()?;
    let v: serde_json::Value = serde_json::from_slice(&raw).ok()?;
    let u = v.get("u")?.as_str()?.to_string();
    let k = v.get("k")?.as_str()?.to_string();
    if u.is_empty() || k.is_empty() {
        return None;
    }
    Some((u, k))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invite_roundtrip() {
        let code = encode_invite("https://relay.example.com", "bearkey123");
        let (u, k) = decode_invite(&code).unwrap();
        assert_eq!(u, "https://relay.example.com");
        assert_eq!(k, "bearkey123");
    }

    #[test]
    fn invite_decode_rejects_garbage() {
        assert!(decode_invite("not-a-code!!!").is_none());
        assert!(decode_invite("").is_none());
    }

    #[test]
    fn provider_routes_by_model_prefix() {
        assert_eq!(Provider::of_model("glm-5.3"), Some(Provider::Glm));
        assert_eq!(Provider::of_model("deepseek-v4-flash"), Some(Provider::Deepseek));
        assert_eq!(Provider::of_model("gpt-4o"), None);
    }

    #[test]
    fn mask_key_short_and_long() {
        assert_eq!(mask_key("short"), "*****");
        assert_eq!(mask_key("sk-1234567890abcdef"), "sk-1...cdef");
    }

    #[test]
    fn load_all_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let db = redb::Database::create(dir.path().join("t.redb")).unwrap();
        let user = UserRec {
            id: "u1".into(),
            name: "alice".into(),
            note: String::new(),
            quota_tokens: Some(1000),
            used_tokens: 42,
            bearkey: "bk".into(),
            disabled: false,
            created_at: 1,
            api_key_ids: vec!["k1".into()],
        };
        put_row(&db, USERS_TABLE, "u1", serde_json::to_vec(&user).unwrap().as_slice()).unwrap();
        let usage = UsageRec {
            user_id: "u1".into(),
            ts: 9,
            model: "glm-5.3".into(),
            prompt_tokens: 10,
            completion_tokens: 20,
            key_id: "k1".into(),
        };
        put_row(
            &db,
            USAGE_TABLE,
            &usage_row_key("u1", 9),
            serde_json::to_vec(&usage).unwrap().as_slice(),
        )
        .unwrap();

        let (users, apikeys, usage) = load_all(&db).unwrap();
        assert_eq!(users["u1"].name, "alice");
        assert_eq!(users["u1"].used_tokens, 42);
        assert!(apikeys.is_empty());
        assert_eq!(usage.len(), 1);
        assert_eq!(usage[0].completion_tokens, 20);
    }
}
