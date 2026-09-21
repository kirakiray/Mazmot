//! 管理 API：Bearer Token 鉴权（AI_RELAY_ADMIN_TOKEN）。
//! 未配置令牌时路由虽注册但一律 404（不暴露管理面存在），仿 cred-hub。

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

use crate::store::{self, ApiKeyRec, Provider, UsageRec, UserRec};
use crate::{api_error, bearer_matches, AppState};

/// 管理鉴权门：未配置 token 或不匹配分别 404 / 401
fn gate(state: &AppState, headers: &HeaderMap) -> Option<(StatusCode, Json<Value>)> {
    if state.admin_token.is_none() {
        return Some((StatusCode::NOT_FOUND, Json(serde_json::json!({"ok": false}))));
    }
    if !bearer_matches(headers, state.admin_token.as_deref().unwrap()) {
        return Some((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"ok": false, "error": "无效的管理员令牌"})),
        ));
    }
    None
}

fn ok_json(v: Value) -> Json<Value> {
    Json(serde_json::json!({ "ok": true, "data": v }))
}

// ———— 上游 apikey ————

fn apikey_public(k: &ApiKeyRec) -> Value {
    serde_json::json!({
        "id": k.id,
        "provider": k.provider,
        "label": k.label,
        "maskedKey": k.masked_key,
        "disabled": k.disabled,
        "createdAt": k.created_at,
    })
}

pub(crate) async fn list_apikeys(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = gate(&state, &headers) {
        return Err(err);
    }
    let mut keys: Vec<Value> = state
        .apikeys
        .read()
        .await
        .values()
        .map(apikey_public)
        .collect();
    keys.sort_by(|a, b| a["createdAt"].as_i64().cmp(&b["createdAt"].as_i64()));
    Ok(ok_json(serde_json::json!({ "apikeys": keys })))
}

#[derive(Deserialize)]
pub(crate) struct CreateApikeyReq {
    provider: String,
    #[serde(default)]
    label: String,
    #[serde(rename = "apiKey")]
    api_key: String,
}

pub(crate) async fn create_apikey(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateApikeyReq>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if let Some(err) = gate(&state, &headers) {
        return Err(err);
    }
    let Some(provider) = Provider::parse(&req.provider) else {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("provider 不支持: {}（仅 deepseek / glm）", req.provider),
        ));
    };
    if req.api_key.trim().is_empty() {
        return Err(api_error(StatusCode::UNPROCESSABLE_ENTITY, "apiKey 不能为空"));
    }
    let key = ApiKeyRec {
        id: store::random_token(12),
        provider,
        label: req.label.trim().to_string(),
        api_key: req.api_key.trim().to_string(),
        masked_key: store::mask_key(req.api_key.trim()),
        disabled: false,
        created_at: store::now_ms(),
    };
    // 添加前先向上游探测 key 可用性，失败不落库
    crate::proxy::probe_key(&state.http, &key)
        .await
        .map_err(|e| api_error(StatusCode::UNPROCESSABLE_ENTITY, e))?;

    state.save_apikey(&key).await.map_err(api_error_db)?;
    Ok((StatusCode::CREATED, ok_json(apikey_public(&key))))
}

#[derive(Deserialize)]
pub(crate) struct UpdateApikeyReq {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    disabled: Option<bool>,
}

pub(crate) async fn update_apikey(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(req): Json<UpdateApikeyReq>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = gate(&state, &headers) {
        return Err(err);
    }
    let mut key = state
        .apikeys
        .read()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "apikey 不存在"))?;
    if let Some(label) = req.label {
        key.label = label.trim().to_string();
    }
    if let Some(disabled) = req.disabled {
        key.disabled = disabled;
    }
    state.save_apikey(&key).await.map_err(api_error_db)?;
    Ok(ok_json(apikey_public(&key)))
}

pub(crate) async fn delete_apikey(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = gate(&state, &headers) {
        return Err(err);
    }
    // 还有用户绑着这个 key 时拒绝删除，避免产生悬空引用
    let bound: Vec<String> = state
        .users
        .read()
        .await
        .values()
        .filter(|u| u.api_key_ids.iter().any(|k| k == &id))
        .map(|u| u.name.clone())
        .collect();
    if !bound.is_empty() {
        return Err(api_error(
            StatusCode::CONFLICT,
            format!("apikey 仍被用户绑定: {}", bound.join(", ")),
        ));
    }
    state.delete_apikey(&id).await;
    Ok(ok_json(serde_json::json!({ "id": id })))
}

/// POST /admin/apikeys/{id}/test —— 实时探测该 key 当前是否可用（同创建时探测逻辑）
pub(crate) async fn test_apikey(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = gate(&state, &headers) {
        return Err(err);
    }
    let key = state
        .apikeys
        .read()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "apikey 不存在"))?;
    crate::proxy::probe_key(&state.http, &key)
        .await
        .map_err(|e| api_error(StatusCode::UNPROCESSABLE_ENTITY, e))?;
    Ok(ok_json(serde_json::json!({ "id": id, "provider": key.provider })))
}

// ———— 用户 ————

/// bindMode 入参规范化：只认 "bound"，其余一律回退 "open"
fn normalize_bind_mode(mode: Option<String>) -> String {
    match mode.as_deref() {
        Some("bound") => "bound".into(),
        _ => "open".into(),
    }
}

/// POST /admin/users/{id}/unbind —— 清除绑定记录（重新开放激活；bindMode 保持不变）
pub(crate) async fn unbind_user(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = gate(&state, &headers) {
        return Err(err);
    }
    let mut user = state
        .users
        .read()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "用户不存在"))?;
    user.bound_user_id = String::new();
    user.bound_pubkey = String::new();
    user.bound_at = 0;
    state.save_user(&user).await.map_err(api_error_db)?;
    Ok(ok_json(user_public(&user, false)))
}

fn user_public(u: &UserRec, include_bearkey: bool) -> Value {
    let mut v = serde_json::json!({
        "id": u.id,
        "name": u.name,
        "note": u.note,
        "quotaTokens": u.quota_tokens,
        "usedTokens": u.used_tokens,
        "totalRequests": u.total_requests,
        "disabled": u.disabled,
        "createdAt": u.created_at,
        "apiKeyIds": u.api_key_ids,
        "allowedModels": u.allowed_models,
        "bindMode": if u.bind_mode.is_empty() { "open" } else { &u.bind_mode },
        "boundUserId": u.bound_user_id,
        "boundAt": u.bound_at,
    });
    if include_bearkey {
        v["bearkey"] = Value::String(u.bearkey.clone());
    }
    v
}

pub(crate) async fn list_users(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = gate(&state, &headers) {
        return Err(err);
    }
    let mut users: Vec<Value> = state
        .users
        .read()
        .await
        .values()
        .map(|u| user_public(u, false))
        .collect();
    users.sort_by(|a, b| a["createdAt"].as_i64().cmp(&b["createdAt"].as_i64()));
    Ok(ok_json(serde_json::json!({ "users": users })))
}

#[derive(Deserialize)]
pub(crate) struct CreateUserReq {
    name: String,
    #[serde(default)]
    note: String,
    #[serde(rename = "quotaTokens")]
    quota_tokens: Option<i64>,
    #[serde(default, rename = "apiKeyIds")]
    api_key_ids: Vec<String>,
    #[serde(default, rename = "allowedModels")]
    allowed_models: Vec<String>,
    /// "open"（默认）| "bound"（仅限绑定的 NoneOS 用户）
    #[serde(default, rename = "bindMode")]
    bind_mode: Option<String>,
}

pub(crate) async fn create_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateUserReq>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if let Some(err) = gate(&state, &headers) {
        return Err(err);
    }
    let name = req.name.trim().to_string();
    if name.is_empty() {
        return Err(api_error(StatusCode::UNPROCESSABLE_ENTITY, "用户名不能为空"));
    }
    if req.quota_tokens.map(|q| q <= 0).unwrap_or(false) {
        return Err(api_error(StatusCode::UNPROCESSABLE_ENTITY, "配额必须为正数"));
    }
    // 只接受真实存在的 apikey id
    let keys = state.apikeys.read().await;
    let api_key_ids: Vec<String> = req
        .api_key_ids
        .into_iter()
        .filter(|id| keys.contains_key(id))
        .collect();
    drop(keys);

    let user = UserRec {
        id: store::random_token(10),
        name,
        note: req.note.trim().to_string(),
        quota_tokens: req.quota_tokens,
        used_tokens: 0,
        total_requests: 0,
        bearkey: format!("ar-{}", store::random_token(32)),
        disabled: false,
        created_at: store::now_ms(),
        api_key_ids,
        allowed_models: req.allowed_models,
        bind_mode: normalize_bind_mode(req.bind_mode),
        bound_user_id: String::new(),
        bound_pubkey: String::new(),
        bound_at: 0,
    };
    state.save_user(&user).await.map_err(api_error_db)?;
    Ok((StatusCode::CREATED, ok_json(user_public(&user, true))))
}

#[derive(Deserialize)]
pub(crate) struct UpdateUserReq {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    note: Option<String>,
    /// null = 改为无限
    #[serde(default, rename = "quotaTokens", skip_serializing_if = "Option::is_none")]
    quota_tokens: Option<Option<i64>>,
    #[serde(default, rename = "apiKeyIds", skip_serializing_if = "Option::is_none")]
    api_key_ids: Option<Vec<String>>,
    #[serde(default, rename = "allowedModels", skip_serializing_if = "Option::is_none")]
    allowed_models: Option<Vec<String>>,
    /// "open" | "bound"
    #[serde(default, rename = "bindMode", skip_serializing_if = "Option::is_none")]
    bind_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    disabled: Option<bool>,
}

pub(crate) async fn update_user(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(req): Json<UpdateUserReq>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = gate(&state, &headers) {
        return Err(err);
    }
    let mut user = state
        .users
        .read()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "用户不存在"))?;
    if let Some(name) = req.name {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err(api_error(StatusCode::UNPROCESSABLE_ENTITY, "用户名不能为空"));
        }
        user.name = name;
    }
    if let Some(note) = req.note {
        user.note = note.trim().to_string();
    }
    if let Some(quota) = req.quota_tokens {
        if quota.map(|q| q <= 0).unwrap_or(false) {
            return Err(api_error(StatusCode::UNPROCESSABLE_ENTITY, "配额必须为正数"));
        }
        user.quota_tokens = quota;
    }
    if let Some(ids) = req.api_key_ids {
        let keys = state.apikeys.read().await;
        user.api_key_ids = ids.into_iter().filter(|id| keys.contains_key(id)).collect();
    }
    if let Some(disabled) = req.disabled {
        user.disabled = disabled;
    }
    if let Some(models) = req.allowed_models {
        user.allowed_models = models.into_iter().map(|m| m.trim().to_string()).filter(|m| !m.is_empty()).collect();
    }
    if let Some(mode) = req.bind_mode {
        user.bind_mode = normalize_bind_mode(Some(mode));
    }
    state.save_user(&user).await.map_err(api_error_db)?;
    Ok(ok_json(user_public(&user, false)))
}

pub(crate) async fn delete_user(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = gate(&state, &headers) {
        return Err(err);
    }
    state.delete_user(&id).await;
    Ok(ok_json(serde_json::json!({ "id": id })))
}

// ———— 邀请码 / bearkey ————

/// 邀请码里的服务器地址：AI_RELAY_PUBLIC_URL 优先，否则按请求 Host 推导
fn server_url_of(state: &AppState, headers: &HeaderMap) -> String {
    if let Some(url) = &state.public_url {
        return url.clone();
    }
    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost");
    let scheme = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("http");
    format!("{scheme}://{host}")
}

fn invite_payload(state: &AppState, headers: &HeaderMap, user: &UserRec) -> Value {
    let server_url = server_url_of(state, headers);
    let code = store::encode_invite(&server_url, &user.bearkey);
    serde_json::json!({ "code": code, "serverUrl": server_url, "bearkey": user.bearkey })
}

/// GET /admin/users/{id}/invite —— 当前 bearkey 对应的邀请码
pub(crate) async fn get_invite(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = gate(&state, &headers) {
        return Err(err);
    }
    let user = state
        .users
        .read()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "用户不存在"))?;
    Ok(ok_json(invite_payload(&state, &headers, &user)))
}

/// POST /admin/users/{id}/reset-bearkey —— 作废旧 bearkey 并签发新的
pub(crate) async fn reset_bearkey(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = gate(&state, &headers) {
        return Err(err);
    }
    let mut user = state
        .users
        .read()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "用户不存在"))?;
    user.bearkey = format!("ar-{}", store::random_token(32));
    state.save_user(&user).await.map_err(api_error_db)?;
    Ok(ok_json(invite_payload(&state, &headers, &user)))
}

/// GET /admin/users/{id}/models —— key 池聚合的模型清单（不过滤白名单，供管理台编辑参考）
pub(crate) async fn user_models(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = gate(&state, &headers) {
        return Err(err);
    }
    let user = state
        .users
        .read()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "用户不存在"))?;
    let keys = state.apikeys.read().await;
    let pool: Vec<crate::store::ApiKeyRec> = user
        .api_key_ids
        .iter()
        .filter_map(|k| keys.get(k))
        .filter(|k| !k.disabled)
        .cloned()
        .collect();
    drop(keys);
    let ids = crate::proxy::pool_models(&state.http, &pool)
        .await
        .ok_or_else(|| api_error(StatusCode::BAD_GATEWAY, "所有上游模型列表查询失败"))?;
    Ok(ok_json(serde_json::json!({ "models": ids })))
}

// ———— 服务器设置 ————

/// GET /admin/settings 请求体
#[derive(Deserialize)]
pub(crate) struct UpdateSettingsReq {
    #[serde(rename = "serverName")]
    server_name: String,
}

/// GET /admin/settings
pub(crate) async fn get_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = gate(&state, &headers) {
        return Err(err);
    }
    let name = state.server_name.read().await.clone();
    Ok(ok_json(serde_json::json!({ "serverName": name })))
}

/// PATCH /admin/settings —— 服务器自定义命名（持久化 settings 表；env 仅作初始值）
pub(crate) async fn update_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<UpdateSettingsReq>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = gate(&state, &headers) {
        return Err(err);
    }
    let name = req.server_name.trim().to_string();
    if name.is_empty() || name.len() > 64 {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "serverName 需为 1-64 字符",
        ));
    }
    {
        let mut cur = state.server_name.write().await;
        *cur = name.clone();
    }
    let rec = store::SettingsRec { server_name: name };
    let db = state.db.clone();
    let json = serde_json::to_vec(&rec).map_err(|e| api_error_db(e.to_string()))?;
    let _ = tokio::task::spawn_blocking(move || {
        store::put_row(&db, store::SETTINGS_TABLE, store::SETTINGS_KEY, &json)
    })
    .await;
    Ok(ok_json(serde_json::json!({ "serverName": rec.server_name })))
}

// ———— 用量 ————

/// POST /admin/users/{id}/reset-usage —— 清零累计用量（流水保留，仅计数归零）
pub(crate) async fn reset_usage(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = gate(&state, &headers) {
        return Err(err);
    }
    let mut user = state
        .users
        .read()
        .await
        .get(&id)
        .cloned()
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "用户不存在"))?;
    user.used_tokens = 0;
    user.total_requests = 0;
    state.save_user(&user).await.map_err(api_error_db)?;
    Ok(ok_json(user_public(&user, false)))
}

/// GET /admin/usage?userId=&limit= —— 用量流水（时间倒序）
pub(crate) async fn list_usage(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = gate(&state, &headers) {
        return Err(err);
    }
    let limit = params
        .get("limit")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(100)
        .clamp(1, 1000);
    let user_filter = params.get("userId");
    let usage = state.usage.read().await;
    let mut items: Vec<&UsageRec> = usage
        .iter()
        .filter(|u| user_filter.map(|f| &u.user_id == f).unwrap_or(true))
        .collect();
    items.sort_by(|a, b| b.ts.cmp(&a.ts));
    items.truncate(limit);
    Ok(ok_json(serde_json::json!({
        "items": items
            .iter()
            .map(|u| serde_json::json!({
                "userId": u.user_id,
                "ts": u.ts,
                "model": u.model,
                "promptTokens": u.prompt_tokens,
                "completionTokens": u.completion_tokens,
                "totalTokens": u.total_tokens(),
                "cacheHitTokens": u.cache_hit_tokens,
                "cacheMissTokens": u.cache_miss_tokens,
                "keyId": u.key_id,
            }))
            .collect::<Vec<_>>(),
    })))
}

/// GET /admin/overview —— 总览
pub(crate) async fn overview(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(err) = gate(&state, &headers) {
        return Err(err);
    }
    let server_name = state.server_name.read().await.clone();
    let (users, keys) = (state.users.read().await, state.apikeys.read().await);
    let total_used: i64 = users.values().map(|u| u.used_tokens).sum();
    Ok(ok_json(serde_json::json!({
        "serverName": server_name,
        "users": { "total": users.len(), "disabled": users.values().filter(|u| u.disabled).count() },
        "apikeys": { "total": keys.len(), "disabled": keys.values().filter(|k| k.disabled).count() },
        "totalUsedTokens": total_used,
        "usageRecords": state.usage.read().await.len(),
    })))
}

fn api_error_db(e: String) -> (StatusCode, Json<Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({ "ok": false, "error": e })),
    )
}
