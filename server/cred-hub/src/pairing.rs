//! 配对码（pairing）模块 —— 用户卡片交换的短码中转
//!
//! 解决「首次交换需要手输超长 userId」的问题：用户提交自己的签名 profile
//! 卡片，服务器返回一个 6-10 位小写字母+数字的短配对码；任何人凭码可解析
//! 回完整卡片。信任边界与 /creds 一致——验签全部由客户端在拿到卡片后自行
//! 完成，服务器只做中转、不构成身份权威。
//!
//! 规则：
//! - 配对码由 `sha256(secret || userId || ":" || 窗口号)` 派生（secret 前缀
//!   MAC，secret 不暴露给哈希长度扩展攻击面），5 分钟一个窗口；同一用户在
//!   同窗口重复提交得到同一个码并覆盖存储（同一次「提交 + 取码」动作）
//! - 码的解读期 = 窗口剩余时间 + 一个完整窗口（跨窗宽限），到期的条目惰性
//!   删除；因此条目均为短生命周期，存内存即可，重启清空无碍
//! - resolve 按字面码查找（无需知道 userId），带每 IP 分钟级简易限流防字典扫描

use axum::{
    extract::{ConnectInfo, Query, State},
    http::StatusCode,
    Json,
};
use redb::ReadableTable;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, net::SocketAddr, sync::Arc};
use tokio::sync::RwLock;

use crate::AppState;

/// 配对码窗口：5 分钟
pub const WINDOW_MS: i64 = 5 * 60 * 1000;
/// 窗口切换后的解读宽限期（同 window_ms），合计约 10 分钟
pub const GRACE_MS: i64 = WINDOW_MS;
/// 码长自适应：活跃码少时用 6 位（好念好传），多时升 8 位压低命中率
pub const CODE_LEN_SHORT: usize = 6;
pub const CODE_LEN_LONG: usize = 8;
/// 有效码条目数 ≤ 此阈值时发 6 位码，否则 8 位
const SHORT_LEN_ACTIVE_LIMIT: usize = 300;
const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
/// 未命中解析（疑似扫描尝试）每 IP 每分钟允许次数；成功解析不计数
const RESOLVE_RATE_PER_MIN: u32 = 30;

#[derive(Clone)]
pub struct PairState {
    /// 派生配对码的服务端密钥
    secret: Arc<Vec<u8>>,
    /// code -> 卡片条目（内存存储，重启即空，见模块注释）
    cards: Arc<RwLock<HashMap<String, PairCard>>>,
    /// IP -> (分钟桶起点, 计数)，resolve 简易固定窗口限流
    resolve_hits: Arc<std::sync::Mutex<HashMap<String, (i64, u32)>>>,
}

struct PairCard {
    card: Value,
    /// 该码失效时刻 = 所在窗口结束 + 宽限
    expires_at_ms: i64,
}

impl PairState {
    /// 当前有效（未过期）的配对码数量，供管理 API 统计
    pub async fn active_codes(&self, now_ms: i64) -> usize {
        self.cards
            .read()
            .await
            .values()
            .filter(|entry| entry.expires_at_ms > now_ms)
            .count()
    }

    /// 从 redb meta 表加载密钥；首次启动时基于时间+pid 生成并持久化，
    /// 保证重启后同窗口派生出相同的码
    pub fn load(db: &redb::Database) -> Result<Self, String> {
        const META_TABLE: redb::TableDefinition<&str, &[u8]> =
            redb::TableDefinition::new("meta");
        let write_tx = db.begin_write().map_err(|e| e.to_string())?;
        let secret: Vec<u8> = {
            let mut table = write_tx.open_table(META_TABLE).map_err(|e| e.to_string())?;
            let existing = table
                .get("pairing-secret")
                .map_err(|e| e.to_string())?
                .map(|v| v.value().to_vec());
            if let Some(bytes) = existing {
                bytes
            } else {
                let seed = format!(
                    "{}:{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_nanos(),
                    std::process::id()
                );
                let bytes = Sha256::digest(seed.as_bytes()).to_vec();
                table
                    .insert("pairing-secret", bytes.as_slice())
                    .map_err(|e| e.to_string())?;
                bytes
            }
        };
        write_tx.commit().map_err(|e| e.to_string())?;
        Ok(Self {
            secret: Arc::new(secret),
            cards: Arc::new(RwLock::new(HashMap::new())),
            resolve_hits: Arc::new(std::sync::Mutex::new(HashMap::new())),
        })
    }

    fn derive_code(&self, user_id: &str, window: i64, len: usize) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.secret.as_slice());
        hasher.update(user_id.as_bytes());
        hasher.update(b":");
        hasher.update(window.to_string().as_bytes());
        let digest = hasher.finalize();
        digest
            .iter()
            .take(len)
            .map(|b| ALPHABET[(*b as usize) % ALPHABET.len()] as char)
            .collect()
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

/// POST /pairing/register —— 提交签名用户卡片，换取当前窗口的配对码。
/// 同一用户同窗口重复提交幂等（同码覆盖）；响应携带窗口到期时刻供前端倒计时
pub async fn register(
    State(state): State<AppState>,
    Json(card): Json<Value>,
) -> (StatusCode, Json<Value>) {
    // profile 卡片走专用校验（不要求 id，豁免 expire，见 validate.rs）
    if let Err(err) = crate::validate::validate_profile_card(&card) {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({ "ok": false, "error": err })),
        );
    }
    if card["role"].as_str() != Some("profile") {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({ "ok": false, "error": "配对码仅接受用户卡片（role=profile）" })),
        );
    }
    // profile 是自签证书，issuer 与 subject 必须一致且都是持卡人本人
    let user_id = card["subject"].as_str().unwrap_or_default().to_string();
    if user_id.is_empty() || card["issuer"].as_str() != Some(user_id.as_str()) {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({ "ok": false, "error": "用户卡片必须自签（issuer 与 subject 一致）" })),
        );
    }

    let now = now_ms();
    let window = now.div_euclid(WINDOW_MS);
    let expires_at_ms = (window + 1) * WINDOW_MS;

    let code = {
        let mut cards = state.pair.cards.write().await;
        // 同一用户换码后旧窗口的码立即作废，避免堆积过期映射
        cards.retain(|_, entry| entry.card["subject"].as_str() != Some(user_id.as_str()));
        // 顺手清理全局过期条目（_map 很小，代价可忽略）
        cards.retain(|_, entry| entry.expires_at_ms > now);
        // 自适应码长：活跃码少时 6 位，多时 8 位（存储按字面码索引，长短混存不影响解析）
        let len = if cards.len() <= SHORT_LEN_ACTIVE_LIMIT {
            CODE_LEN_SHORT
        } else {
            CODE_LEN_LONG
        };
        let code = state.pair.derive_code(&user_id, window, len);
        cards.insert(
            code.clone(),
            PairCard { card, expires_at_ms: expires_at_ms + GRACE_MS },
        );
        code
    };

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ok": true,
            "code": code,
            "expiresAt": expires_at_ms,
        })),
    )
}

/// GET /pairing/resolve?code=xxx —— 凭码取回完整用户卡片（裸 JSON，风格同 /creds/{key}）。
/// 有效的码在窗口内及宽限期内均可解析；未命中或已过期一律 404，不区分两种情况。
/// 限流只针对「未命中」：成功解析不占额度（CGNAT 下大量真实用户共享出口 IP，
/// 全量计数会误伤正常使用），而盲扫流量几乎全是未命中，防扫描效果不受影响
pub async fn resolve(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Query(params): Query<HashMap<String, String>>,
) -> (StatusCode, Json<Value>) {
    let code = params
        .get("code")
        .map(|c| c.trim().to_lowercase())
        .unwrap_or_default();

    let mut cards = state.pair.cards.write().await;
    let found = match cards.get(&code) {
        Some(entry) if entry.expires_at_ms > now_ms() => Some(entry.card.clone()),
        Some(_) => {
            cards.remove(&code); // 过期条目惰性删除
            None
        }
        None => None,
    };
    drop(cards);

    let card = match found {
        Some(card) => card,
        None => {
            // 未命中（= 疑似扫描尝试）才计数：每 IP 分钟级固定窗口，超限 429
            let over_limit = {
                let minute = now_ms() / 60_000;
                let ip = addr.ip().to_string();
                let mut hits = state.pair.resolve_hits.lock().unwrap();
                let entry = hits.entry(ip).or_insert((minute, 0));
                if entry.0 != minute {
                    *entry = (minute, 0);
                }
                entry.1 += 1;
                entry.1 > RESOLVE_RATE_PER_MIN
            };
            return if over_limit {
                (
                    StatusCode::TOO_MANY_REQUESTS,
                    Json(serde_json::json!({ "ok": false, "error": "查询过于频繁，请稍后再试" })),
                )
            } else {
                (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "ok": false, "error": "配对码无效或已过期" })),
                )
            };
        }
    };

    (StatusCode::OK, Json(card))
}
