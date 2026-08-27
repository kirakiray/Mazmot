//! cred-hub —— 专门用于存储 cred（NoneOS 凭证）数据的 HTTP 服务器
//!
//! 接口：
//! - `POST /creds`       上传 cred 数据，服务器校验结构 / 有效期 / ECDSA P-256 签名后存储
//! - `GET  /creds/{key}` 按 cred key（即记录的 id）返回数据
//! - `GET  /health`      健康检查
//!
//! 目前无认证（任何人都可访问），后续再加鉴权。
//!
//! 持久化用 redb（纯 Rust 嵌入式 KV，ACID，单文件）。记录以内部信封
//! `{ cred, lastAccessMs }` 存储：写入时初始化、GET 命中时刷新，
//! 后台清扫任务按「最后访问时间 + 保留期」淘汰冷数据——活跃凭证自动续命，
//! 无需关心证书自身的 expire 字段。保留期经 CRED_HUB_RETENTION_MS 配置（默认 7 天）。
//! 覆盖语义与 core 一致：同 key 新记录 signTime 更晚才覆盖。

mod admin;
mod pairing;
mod validate;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use std::net::SocketAddr;
use redb::{ReadableDatabase, ReadableTable};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

const CRED_TABLE: redb::TableDefinition<&str, &[u8]> = redb::TableDefinition::new("creds");

#[derive(Clone)]
pub(crate) struct AppState {
    db: Arc<redb::Database>,
    /// key -> 记录 的内存读缓存；权威数据在 redb
    cache: Arc<RwLock<HashMap<String, Cached>>>,
    /// 到期索引：(淘汰截止时间 = 最后访问 + 保留期, key)，有序集合；
    /// 清扫任务只弹出截止时间已过的条目，不做全量扫描
    expiry_index: Arc<std::sync::Mutex<BTreeSet<(i64, String)>>>,
    retention_ms: i64,
    /// 配对码（pairing）子模块状态，见 src/pairing.rs
    pair: pairing::PairState,
    /// 管理 API 令牌（CRED_HUB_ADMIN_TOKEN）；None = 管理 API 关闭（/admin/* 一律 404）
    admin_token: Option<String>,
    /// 单条 cred 请求体大小上限（字节，CRED_HUB_MAX_CRED_BYTES，默认 2048）
    max_cred_bytes: usize,
}

struct Cached {
    cred: Value,
    last_access_ms: i64,
}

impl Cached {
    fn deadline(&self, retention_ms: i64) -> i64 {
        self.last_access_ms.saturating_add(retention_ms)
    }
}

/// redb 内部存储信封；对外接口仍返回裸 cred
#[derive(serde::Serialize, serde::Deserialize)]
struct Envelope {
    cred: Value,
    #[serde(rename = "lastAccessMs")]
    last_access_ms: i64,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn ts_of(v: &Value) -> i64 {
    v.get("signTime")
        .and_then(|t| match t {
            Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
            Value::String(s) => s.parse().ok(),
            _ => None,
        })
        .unwrap_or(i64::MIN)
}

/// 打开 redb 数据库并加载内存缓存与到期索引（重启自愈）
fn open_store(
    path: &std::path::Path,
) -> Result<(redb::Database, HashMap<String, Cached>, BTreeSet<(i64, String)>), String> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let db = redb::Database::create(path).map_err(|e| e.to_string())?;
    let mut cache = HashMap::new();
    let mut index = BTreeSet::new();
    let read_tx = db.begin_read().map_err(|e| e.to_string())?;
    if let Ok(table) = read_tx.open_table(CRED_TABLE) {
        for row in table.iter().map_err(|e| e.to_string())? {
            let (k, v) = row.map_err(|e| e.to_string())?;
            let Ok(envelope) = serde_json::from_slice::<Envelope>(v.value()) else {
                continue;
            };
            index.insert((envelope.last_access_ms, k.value().to_string()));
            cache.insert(
                k.value().to_string(),
                Cached { cred: envelope.cred, last_access_ms: envelope.last_access_ms },
            );
        }
    }
    Ok((db, cache, index))
}

/// 写事务：同 key signTime 收敛检查 + 写入在一个 ACID 事务内原子完成。
/// 冲突返回 Err。成功后同步更新内存缓存与到期索引
async fn db_put(state: &AppState, key: &str, cred: &Value) -> Result<(), String> {
    let new_ts = ts_of(cred);
    let cached = Cached { cred: cred.clone(), last_access_ms: now_ms() };
    let json =
        serde_json::to_vec(&Envelope { cred: cred.clone(), last_access_ms: cached.last_access_ms })
            .map_err(|e| format!("序列化失败: {e}"))?;

    // redb 是阻塞型文件 IO，交给 tokio 阻塞线程池避免卡住异步执行器
    let db = state.db.clone();
    let key2 = key.to_string();
    let conflict: Option<String> = tokio::task::spawn_blocking(move || {
        let run = || -> Result<Option<String>, String> {
            let write_tx = db.begin_write().map_err(|e| e.to_string())?;
            {
                let mut table = write_tx.open_table(CRED_TABLE).map_err(|e| e.to_string())?;
                if let Some(existing) = table.get(key2.as_str()).map_err(|e| e.to_string())? {
                    // 与 core 一致：已存在 signTime 更新（或相同）的记录则拒绝覆盖
                    if let Ok(env) = serde_json::from_slice::<Envelope>(existing.value()) {
                        if ts_of(&env.cred) >= new_ts {
                            return Ok(Some("已存在 signTime 更新（或相同）的同 key 记录".into()));
                        }
                    }
                }
                table.insert(key2.as_str(), json.as_slice()).map_err(|e| e.to_string())?;
            }
            // 冲突路径提前返回，事务自动回滚
            write_tx.commit().map_err(|e| e.to_string())?;
            Ok(None)
        };
        match run() {
            Err(e) => Some(format!("存储写入失败: {e}")),
            Ok(Some(msg)) => Some(msg),
            Ok(None) => None,
        }
    })
    .await
    .expect("写任务 panic");

    match conflict {
        Some(msg) => Err(msg),
        None => {
            let mut cache = state.cache.write().await;
            // 同 key 已有旧索引项则按其真实截止时间摘除，再挂新的
            if let Some(old) = cache.get(key) {
                state.expiry_index.lock().unwrap().remove(&(
                    old.last_access_ms.saturating_add(state.retention_ms),
                    key.to_string(),
                ));
            }
            state.expiry_index.lock().unwrap().insert((
                cached.deadline(state.retention_ms),
                key.to_string(),
            ));
            cache.insert(key.to_string(), cached);
            Ok(())
        }
    }
}

/// 从 redb 删除单条记录并清掉缓存；索引项已由清扫收集时弹出，此处无需处理
async fn delete_one(state: &AppState, key: &str) {
    let db = state.db.clone();
    let key2 = key.to_string();
    let _ = tokio::task::spawn_blocking(move || {
        let result = (|| -> Result<(), Box<dyn std::error::Error>> {
            let write_tx = db.begin_write()?;
            {
                let mut table = write_tx.open_table(CRED_TABLE)?;
                table.remove(key2.as_str())?;
            }
            write_tx.commit()?;
            Ok(())
        })();
        if let Err(e) = result {
            eprintln!("删除记录 {key2} 失败: {e}");
        }
    })
    .await;
    state.cache.write().await.remove(key);
}

/// 淘汰最后访问超过保留期的冷数据；到期索引为空时成本近似为零
async fn sweep_due(state: &AppState) {
    let now = now_ms();
    // 先在锁内收集到期条目并从索引摘除，再逐条落盘删除
    let due: Vec<(i64, String)> = {
        let mut index = state.expiry_index.lock().unwrap();
        let mut due = Vec::new();
        while let Some(&(deadline, _)) = index.iter().next() {
            if deadline >= now {
                break;
            }
            if let Some(item) = index.pop_first() {
                due.push(item);
            }
        }
        due
    };
    for (_deadline, key) in due {
        eprintln!("[sweep @{}] evict {key} (deadline {_deadline})", now_ms());
        delete_one(state, &key).await;
    }
}

/// TOML 配置文件结构，与 CF 版 wrangler.toml 的 [vars] 段保持一致：
/// 全部使用 CRED_HUB_* 同名键（字符串值），两版本配置写法互通。
#[derive(serde::Deserialize, Default)]
struct FileConfig {
    #[serde(default)]
    vars: std::collections::HashMap<String, String>,
}

/// 环境变量优先取值：env 存在则用 env，否则用配置文件 [vars] 中的同名键
fn resolve_str(env_key: &str, vars: &std::collections::HashMap<String, String>) -> Option<String> {
    std::env::var(env_key)
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| vars.get(env_key).cloned().filter(|v| !v.is_empty()))
}

#[tokio::main]
async fn main() {
    // ———— 配置加载：TOML 文件（可选，[vars] 段与 CF 版 wrangler.toml 同构）+ 环境变量覆盖 ————
    let config_path = std::env::var("CRED_HUB_CONFIG").unwrap_or_else(|_| "cred-hub.toml".into());
    let file_cfg = match std::fs::read_to_string(&config_path) {
        Ok(raw) => toml::from_str::<FileConfig>(&raw)
            .unwrap_or_else(|e| panic!("解析配置文件 {config_path} 失败: {e}")),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => FileConfig::default(),
        Err(err) => panic!("读取配置文件 {config_path} 失败: {err}"),
    };

    // 解析优先级：环境变量 > 配置文件 > 内置默认值
    let port: u16 = resolve_str("CRED_HUB_PORT", &file_cfg.vars)
        .and_then(|p| p.parse().ok())
        .unwrap_or(8787);
    let data_path =
        PathBuf::from(resolve_str("CRED_HUB_DATA", &file_cfg.vars).unwrap_or_else(|| "data/cred-store.redb".into()));
    let retention_ms: i64 = resolve_str("CRED_HUB_RETENTION_MS", &file_cfg.vars)
        .and_then(|v| v.parse().ok())
        .unwrap_or(7 * 24 * 3600 * 1000);
    // 单条 cred 大小上限（防灌库/恶意大 payload）；在验签前拦截
    let max_cred_bytes: usize = resolve_str("CRED_HUB_MAX_CRED_BYTES", &file_cfg.vars)
        .and_then(|v| v.parse().ok())
        .filter(|&v| v > 0)
        .unwrap_or(2048);
    // 跨域放行默认关闭；按 "1"/true 开启（与 CF 版 CRED_HUB_CORS 取值语义一致）
    let enable_cors = resolve_str("CRED_HUB_CORS", &file_cfg.vars)
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    // 管理 API 令牌：未配置则 /admin/* 一律 404
    let admin_token = resolve_str("CRED_HUB_ADMIN_TOKEN", &file_cfg.vars);

    let (db, cache, index) = open_store(&data_path).expect("打开存储失败");
    let pair_state = pairing::PairState::load(&db).expect("初始化配对码模块失败");
    let state = AppState {
        db: Arc::new(db),
        cache: Arc::new(RwLock::new(cache)),
        expiry_index: Arc::new(std::sync::Mutex::new(index)),
        retention_ms,
        pair: pair_state,
        admin_token,
        max_cred_bytes,
    };

    // 单个后台清扫任务，周期取保留期的 1/10 且至少 1 秒
    {
        let state = state.clone();
        let sweep_interval =
            std::time::Duration::from_millis((retention_ms / 10).clamp(1000, i64::MAX) as u64);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(sweep_interval).await;
                sweep_due(&state).await;
            }
        });
    }

    let app = Router::new()
        .route("/creds", post(upload_cred))
        .route("/creds/{key}", get(get_cred))
        .route("/pairing/register", post(pairing::register))
        .route("/pairing/resolve", get(pairing::resolve))
        // 管理端点始终注册；未配置 CRED_HUB_ADMIN_TOKEN 时 handler 内一律 404
        .route("/admin/stats", get(admin::stats))
        .route("/admin/hot", get(admin::hot))
        .route("/admin/expiring", get(admin::expiring))
        .route("/health", get(|| async { "ok" }))
        .with_state(state);
    // CORS 可选：本地裸跑（不经反代）时由浏览器直连需要放行；
    // 反代部署时保持默认关闭，CORS 统一交给 nginx，避免 ACAO 头重复被浏览器拒绝
    let app = if enable_cors {
        app.layer(tower_http::cors::CorsLayer::permissive())
    } else {
        app
    };

    let addr = format!("0.0.0.0:{port}");
    println!("cred-hub listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("绑定端口失败");
    // into_make_service_with_connect_info：resolve 限流需要客户端 IP
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .expect("服务启动失败");
}

/// POST /creds —— 上传并校验 cred 数据
async fn upload_cred(
    State(state): State<AppState>,
    body: axum::body::Bytes,
) -> (StatusCode, Json<Value>) {
    // 大小限制在验签前检查：超限请求不值得消耗 ECDSA 运算
    if body.len() > state.max_cred_bytes {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(serde_json::json!({
                "ok": false,
                "error": format!("cred 数据超过大小上限 {} 字节（CRED_HUB_MAX_CRED_BYTES）", state.max_cred_bytes)
            })),
        );
    }
    let Ok(cred) = serde_json::from_slice::<Value>(&body) else {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({ "ok": false, "error": "请求体不是合法 JSON" })),
        );
    };
    if let Err(err) = validate::validate_cred(&cred) {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(serde_json::json!({ "ok": false, "error": err })),
        );
    }

    let key = cred["id"].as_str().expect("validate 已确保 id 存在").to_string();

    // 覆盖语义：同 key 新记录 signTime 更晚才接受，与 core「按 signTime 收敛入库」一致
    if let Err(err) = db_put(&state, &key, &cred).await {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "ok": false, "error": err, "id": key })),
        );
    }

    (
        StatusCode::CREATED,
        Json(serde_json::json!({ "ok": true, "id": key })),
    )
}

/// GET /creds/{key} —— 按 key 取回 cred 数据。
/// 默认命中即刷新热度（续命）；带 `?touch=0` 时只读，不刷新（用于监控/探测等
/// 不应影响记录生命周期的场景）
async fn get_cred(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Query(touch_q): Query<HashMap<String, String>>,
) -> (StatusCode, Json<Value>) {
    let touch = touch_q.get("touch").map(|v| v != "0").unwrap_or(true);
    let found = {
        let mut cache = state.cache.write().await;
        match cache.get_mut(&key) {
            Some(entry) => {
                if touch && entry.last_access_ms != now_ms() {
                    // 更新索引：旧截止时间 → 新截止时间（与写入路径的元组格式一致）
                    let mut index = state.expiry_index.lock().unwrap();
                    let old_deadline = entry.deadline(state.retention_ms);
                    entry.last_access_ms = now_ms();
                    index.remove(&(old_deadline, key.clone()));
                    index.insert((entry.deadline(state.retention_ms), key.clone()));
                }
                Some(entry.cred.clone())
            }
            None => None,
        }
    };
    match found {
        Some(cred) => (StatusCode::OK, Json(cred)),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "ok": false, "error": "未找到该 key 的 cred 数据", "id": key })),
        ),
    }
}
