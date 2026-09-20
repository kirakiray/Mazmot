//! ai-relay —— AI API 转发服务器：apikey 隔离 + 用户 token 配额统计
//!
//! 架构（与 cred-hub 同风格：axum + redb 单文件持久化 + 内存读缓存）：
//! - 管理 API `/admin/*`：`AI_RELAY_ADMIN_TOKEN`（Bearer）鉴权，未配置时一律 404。
//!   上游 apikey CRUD、用户 CRUD（配额 / key 池 / 禁用）、用量查询与清零、
//!   生成 / 重置用户 bearkey 并签发邀请码（URL-safe Base64 的 JSON `{"u":..,"k":..}`）。
//! - 用户 API `/v1/*`（OpenAI 兼容，Bearer = 用户 bearkey）：
//!   `POST /v1/chat/completions` 转发上游（按模型名前缀从用户 key 池选 key），
//!   流式 SSE 透传并从末 chunk 统计 usage；`GET /v1/models` 合并 key 池上游模型；
//!   `GET /v1/usage` 返回该用户配额 / 已用。
//! - 配额为累计总额（不自动重置），超额返回 402。

mod admin;
mod proxy;
mod store;

use axum::{
    http::{HeaderMap, StatusCode},
    routing::{get, patch, post},
    Json, Router,
};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

use store::{ApiKeyRec, UsageRec, UserRec};

#[derive(Clone)]
pub(crate) struct AppState {
    db: Arc<redb::Database>,
    users: Arc<RwLock<HashMap<String, UserRec>>>,
    apikeys: Arc<RwLock<HashMap<String, ApiKeyRec>>>,
    usage: Arc<RwLock<Vec<UsageRec>>>,
    /// 上游 HTTP 客户端（连接池复用）
    http: reqwest::Client,
    /// 管理 API 令牌（AI_RELAY_ADMIN_TOKEN）；None = /admin/* 一律 404
    admin_token: Option<String>,
    /// 邀请码里 "u" 字段的优先取值（AI_RELAY_PUBLIC_URL）；未配置时按请求 Host 动态推导
    public_url: Option<String>,
    /// 服务器自定义命名（settings 表持久化；初始值取 AI_RELAY_SERVER_NAME env/toml）
    server_name: Arc<RwLock<String>>,
}

impl AppState {
    /// 将一条记录落盘（阻塞 IO 交给 spawn_blocking），成功后同步更新内存
    pub(crate) async fn save_user(&self, user: &UserRec) -> Result<(), String> {
        let db = self.db.clone();
        let json = serde_json::to_vec(user).map_err(|e| e.to_string())?;
        let id = user.id.clone();
        tokio::task::spawn_blocking(move || store::put_row(&db, store::USERS_TABLE, &id, &json))
            .await
            .expect("写任务 panic")?;
        self.users.write().await.insert(user.id.clone(), user.clone());
        Ok(())
    }

    pub(crate) async fn save_apikey(&self, key: &ApiKeyRec) -> Result<(), String> {
        let db = self.db.clone();
        let json = serde_json::to_vec(key).map_err(|e| e.to_string())?;
        let id = key.id.clone();
        tokio::task::spawn_blocking(move || store::put_row(&db, store::APIKEYS_TABLE, &id, &json))
            .await
            .expect("写任务 panic")?;
        self.apikeys.write().await.insert(key.id.clone(), key.clone());
        Ok(())
    }

    /// 追加一条用量流水并累计用户 used_tokens（两处一起落盘）
    pub(crate) async fn record_usage(&self, rec: UsageRec) {
        let user_delta = rec.prompt_tokens + rec.completion_tokens;
        let db = self.db.clone();
        let row_key = store::usage_row_key(&rec.user_id, rec.ts);
        let Ok(json) = serde_json::to_vec(&rec) else { return };
        let row_key2 = row_key.clone();
        let ok = tokio::task::spawn_blocking(move || {
            store::put_row(&db, store::USAGE_TABLE, &row_key2, &json)
        })
        .await
        .expect("写任务 panic");
        if let Err(e) = ok {
            eprintln!("写入用量流水失败: {e}");
            return;
        }
        self.usage.write().await.push(rec.clone());

        // 累计到用户
        let users = self.users.read().await;
        let Some(mut user) = users.get(&rec.user_id).cloned() else { return };
        drop(users);
        user.used_tokens += user_delta;
        user.total_requests += 1;
        if let Err(e) = self.save_user(&user).await {
            eprintln!("累计用户用量失败: {e}");
        }
    }

    pub(crate) async fn delete_user(&self, id: &str) {
        let db = self.db.clone();
        let id2 = id.to_string();
        let _ = tokio::task::spawn_blocking(move || {
            store::remove_row(&db, store::USERS_TABLE, &id2)
        })
        .await;
        self.users.write().await.remove(id);
    }

    pub(crate) async fn delete_apikey(&self, id: &str) {
        let db = self.db.clone();
        let id2 = id.to_string();
        let _ = tokio::task::spawn_blocking(move || {
            store::remove_row(&db, store::APIKEYS_TABLE, &id2)
        })
        .await;
        self.apikeys.write().await.remove(id);
    }
}

/// 常数时间字符串比较（仿 cred-hub，长度不同也走完整轮次）
pub(crate) fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        diff |= (x ^ y) as usize;
    }
    diff == 0
}

/// 校验 Authorization: Bearer <token>（与期望值常数时间比较）
pub(crate) fn bearer_matches(headers: &HeaderMap, expected: &str) -> bool {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|given| constant_time_eq(given, expected))
        .unwrap_or(false)
}

/// OpenAI 风格错误体
pub(crate) fn api_error(status: StatusCode, message: impl Into<String>) -> (StatusCode, Json<Value>) {
    (
        status,
        Json(serde_json::json!({
            "error": { "message": message.into(), "type": "ai_relay_error" }
        })),
    )
}

/// TOML 配置（[vars] 段与 env 同名键，env 优先），仿 cred-hub
#[derive(serde::Deserialize, Default)]
struct FileConfig {
    #[serde(default)]
    vars: HashMap<String, String>,
}

fn resolve_str(env_key: &str, vars: &HashMap<String, String>) -> Option<String> {
    std::env::var(env_key)
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| vars.get(env_key).cloned().filter(|v| !v.is_empty()))
}

#[tokio::main]
async fn main() {
    let config_path = std::env::var("AI_RELAY_CONFIG").unwrap_or_else(|_| "ai-relay.toml".into());
    let file_cfg = match std::fs::read_to_string(&config_path) {
        Ok(raw) => toml::from_str::<FileConfig>(&raw)
            .unwrap_or_else(|e| panic!("解析配置文件 {config_path} 失败: {e}")),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => FileConfig::default(),
        Err(err) => panic!("读取配置文件 {config_path} 失败: {err}"),
    };

    let port: u16 = resolve_str("AI_RELAY_PORT", &file_cfg.vars)
        .and_then(|p| p.parse().ok())
        .unwrap_or(8791);
    let data_path =
        PathBuf::from(resolve_str("AI_RELAY_DATA", &file_cfg.vars).unwrap_or_else(|| "data/ai-relay.redb".into()));
    let admin_token = resolve_str("AI_RELAY_ADMIN_TOKEN", &file_cfg.vars);
    let public_url = resolve_str("AI_RELAY_PUBLIC_URL", &file_cfg.vars);
    let server_name = resolve_str("AI_RELAY_SERVER_NAME", &file_cfg.vars)
        .unwrap_or_else(|| "AI Relay".into());
    // 浏览器直连是主场景，默认放行；反代部署时可关闭交给 nginx
    let cors = resolve_str("AI_RELAY_CORS", &file_cfg.vars).unwrap_or_else(|| "1".into());
    let enable_cors = cors == "1" || cors.eq_ignore_ascii_case("true");

    if let Some(parent) = data_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let db = redb::Database::create(&data_path).expect("打开存储失败");
    let (users, apikeys, usage, settings) = store::load_all(&db).expect("加载存储失败");
    println!(
        "ai-relay: {} users, {} apikeys, {} usage records",
        users.len(),
        apikeys.len(),
        usage.len()
    );

    let state = AppState {
        db: Arc::new(db),
        users: Arc::new(RwLock::new(users)),
        apikeys: Arc::new(RwLock::new(apikeys)),
        usage: Arc::new(RwLock::new(usage)),
        http: reqwest::Client::new(),
        admin_token,
        public_url,
        server_name: Arc::new(RwLock::new(
            if settings.server_name.is_empty() { server_name } else { settings.server_name },
        )),
    };

    let app = Router::new()
        // 管理 API（未配置 AI_RELAY_ADMIN_TOKEN 时 handler 内一律 404）
        .route("/admin/overview", get(admin::overview))
        .route("/admin/apikeys", get(admin::list_apikeys).post(admin::create_apikey))
        .route(
            "/admin/apikeys/{id}",
            patch(admin::update_apikey).delete(admin::delete_apikey),
        )
        .route("/admin/apikeys/{id}/test", post(admin::test_apikey))
        .route("/admin/users", get(admin::list_users).post(admin::create_user))
        .route(
            "/admin/users/{id}",
            patch(admin::update_user).delete(admin::delete_user),
        )
        .route("/admin/users/{id}/invite", get(admin::get_invite))
        .route("/admin/users/{id}/models", get(admin::user_models))
        .route("/admin/users/{id}/reset-bearkey", post(admin::reset_bearkey))
        .route("/admin/users/{id}/reset-usage", post(admin::reset_usage))
        .route("/admin/usage", get(admin::list_usage))
        .route(
            "/admin/settings",
            get(admin::get_settings).patch(admin::update_settings),
        )
        // 用户 API（OpenAI 兼容）
        .route("/v1/chat/completions", post(proxy::chat_completions))
        .route("/v1/models", get(proxy::models))
        .route("/v1/usage", get(proxy::usage))
        .route("/v1/server", get(proxy::server_info))
        .route("/health", get(|| async { "ok" }))
        .with_state(state);
    let app = if enable_cors {
        app.layer(tower_http::cors::CorsLayer::permissive())
    } else {
        app
    };

    let addr = format!("0.0.0.0:{port}");
    println!("ai-relay listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("绑定端口失败");
    axum::serve(listener, app).await.expect("服务启动失败");
}
