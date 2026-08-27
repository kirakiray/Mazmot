//! 管理 API：Bearer Token 鉴权的只读统计端点
//!
//! - `GET /admin/stats`                总览：凭证总量 / 活跃 / 将淘汰，配对码有效数
//! - `GET /admin/hot?limit=50`         按最后访问时间倒序的热点记录
//! - `GET /admin/expiring?withinDays=30` 未来 N 天内到期的记录（按到期升序）
//!
//! 鉴权：环境变量 CRED_HUB_ADMIN_TOKEN 配置后才存在这三个接口；
//! 未配置时路由虽注册但一律 404（不暴露管理面存在的痕迹）。
//! Token 为双方共享秘密，比对用常数时间实现避免计时侧信道。

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde_json::Value;
use std::collections::HashMap;

use crate::AppState;

/// 常数时间字符串比较（长度不同的串也走完整轮次）
fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        diff |= (x ^ y) as usize;
    }
    diff == 0
}

/// 校验 Authorization: Bearer <token>；未配置 token 或不匹配均返回 false
pub(crate) fn authorized(state: &AppState, headers: &HeaderMap) -> bool {
    let Some(expected) = state.admin_token.as_deref() else {
        return false;
    };
    let Some(given) = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    else {
        return false;
    };
    constant_time_eq(given, expected)
}

fn unauthorized() -> (StatusCode, Json<Value>) {
    (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({ "ok": false, "error": "无效的管理员令牌" })),
    )
}

/// 单条记录的统计视图
fn summary(key: &str, cred: &Value, last_access_ms: i64) -> Value {
    serde_json::json!({
        "id": key,
        "role": cred["role"],
        "issuer": cred["issuer"],
        "subject": cred["subject"],
        "expire": cred.get("expire").cloned().unwrap_or(Value::Null),
        "lastAccessMs": last_access_ms,
    })
}

/// GET /admin/stats —— 总览。
/// active = 最近一半保留期内被访问过；cooling = 存活但超过一半保留期未访问（清扫在即）
pub(crate) async fn stats(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !authorized(&state, &headers) {
        return Err(unauthorized());
    }
    let now = now_ms();
    let half_retention = state.retention_ms / 2;
    let (total, active) = {
        let cache = state.cache.read().await;
        let total = cache.len();
        let active = cache
            .values()
            .filter(|c| now - c.last_access_ms <= half_retention)
            .count();
        (total, active)
    };
    let pairing_active = state.pair.active_codes(now).await;
    Ok(Json(serde_json::json!({
        "ok": true,
        "creds": { "total": total, "active": active, "cooling": total - active },
        "pairing": { "activeCodes": pairing_active },
        "retentionMs": state.retention_ms,
        "nowMs": now,
    })))
}

/// GET /admin/hot?limit=N —— 最后访问倒序的热点列表（默认/上限 200 条）
pub(crate) async fn hot(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !authorized(&state, &headers) {
        return Err(unauthorized());
    }
    let limit = params
        .get("limit")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(50)
        .clamp(1, 200);
    let mut items: Vec<(i64, Value)> = {
        let cache = state.cache.read().await;
        cache
            .iter()
            .map(|(key, c)| (c.last_access_ms, summary(key, &c.cred, c.last_access_ms)))
            .collect()
    };
    // 倒序取前 N：先排序再截断即可，数据规模为内存缓存上限
    items.sort_by(|a, b| b.0.cmp(&a.0));
    items.truncate(limit);
    Ok(Json(serde_json::json!({ "ok": true, "items": items.into_iter().map(|(_, v)| v).collect::<Vec<_>>() })))
}

/// GET /admin/expiring?withinDays=N —— 未过期且在未来 N 天内到期的记录（到期升序），默认 30 天
pub(crate) async fn expiring(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !authorized(&state, &headers) {
        return Err(unauthorized());
    }
    let within_days: i64 = params
        .get("withinDays")
        .and_then(|v| v.parse().ok())
        .unwrap_or(30)
        .clamp(1, 3650);
    let now = now_ms();
    let horizon = now + within_days * 24 * 3600 * 1000;

    let mut items: Vec<(i64, Value)> = {
        let cache = state.cache.read().await;
        cache
            .iter()
            .filter_map(|(key, c)| {
                // expire 缺省/null = 永不过期，不在快过期之列
                let expire = crate::validate::parse_timestamp(c.cred.get("expire")?)?;
                if expire > now && expire <= horizon {
                    Some((expire, summary(key, &c.cred, c.last_access_ms)))
                } else {
                    None
                }
            })
            .collect()
    };
    items.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(Json(
        serde_json::json!({ "ok": true, "withinDays": within_days, "items": items.into_iter().map(|(_, v)| v).collect::<Vec<_>>() }),
    ))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}
