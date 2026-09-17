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
use crate::{api_error, AppState};

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

/// 从用户 key 池里挑一个可用 key：先按 provider 过滤，再随机取一个
async fn pick_upstream_key(
    state: &AppState,
    user: &UserRec,
    provider: Provider,
) -> Result<crate::store::ApiKeyRec, (StatusCode, Json<Value>)> {
    let keys = state.apikeys.read().await;
    let mut pool: Vec<crate::store::ApiKeyRec> = user
        .api_key_ids
        .iter()
        .filter_map(|id| keys.get(id))
        .filter(|k| k.provider == provider && !k.disabled)
        .cloned()
        .collect();
    drop(keys);
    if pool.is_empty() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            format!("该用户的 key 池中没有可用的 {provider:?} 上游 key（或模型不在其 key 池覆盖范围）"),
        ));
    }
    use rand::Rng;
    let idx = rand::rng().random_range(0..pool.len());
    Ok(pool.swap_remove(idx))
}

/// 从 OpenAI 风格 usage 对象里取 prompt/completion tokens
fn tokens_of(usage: &Value) -> Option<(i64, i64)> {
    Some((
        usage.get("prompt_tokens")?.as_i64()?,
        usage.get("completion_tokens")?.as_i64()?,
    ))
}

/// 在 SSE 文本里找最后一个带 usage 的 data chunk
fn extract_sse_usage(buffer: &str) -> Option<(i64, i64)> {
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

/// POST /v1/chat/completions
pub(crate) async fn chat_completions(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let user = auth_user(&state, &headers).await?;
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
    let Some(provider) = Provider::of_model(&model) else {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            format!("无法从模型名 {model} 识别上游（支持 glm-* / deepseek-*）"),
        ));
    };
    let upstream_key = pick_upstream_key(&state, &user, provider).await?;

    // 流式请求注入 include_usage，上游末 chunk 才会带 usage 供统计
    let mut upstream_body = payload.clone();
    if is_stream {
        let obj = upstream_body.as_object_mut().unwrap();
        obj.entry("stream_options")
            .or_insert_with(|| serde_json::json!({ "include_usage": true }));
    }

    let url = format!("{}/chat/completions", provider.upstream_base());
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
        let (prompt, completion) = usage.unwrap_or((0, 0));
        state
            .record_usage(UsageRec {
                user_id: user.id.clone(),
                ts: store::now_ms(),
                model: model.clone(),
                prompt_tokens: prompt,
                completion_tokens: completion,
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
        let (prompt, completion) = extract_sse_usage(&buffer).unwrap_or((0, 0));
        relay_state
            .record_usage(UsageRec {
                user_id,
                ts: store::now_ms(),
                model: model2,
                prompt_tokens: prompt,
                completion_tokens: completion,
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

/// GET /v1/models —— 合并用户 key 池内各上游的模型列表
pub(crate) async fn models(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user = auth_user(&state, &headers).await?;
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

    let mut ids: Vec<String> = Vec::new();
    let mut any_ok = false;
    for key in &pool {
        let url = format!("{}/models", key.provider.upstream_base());
        let Ok(resp) = state.http.get(&url).bearer_auth(&key.api_key).send().await else {
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
    if !any_ok {
        return Err(api_error(StatusCode::BAD_GATEWAY, "所有上游模型列表查询失败"));
    }
    Ok(Json(serde_json::json!({
        "object": "list",
        "data": ids.into_iter().map(|id| serde_json::json!({ "id": id, "object": "model" })).collect::<Vec<_>>(),
    })))
}

/// GET /v1/usage —— 该用户自身的配额 / 已用 / 剩余
pub(crate) async fn usage(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user = auth_user(&state, &headers).await?;
    Ok(Json(serde_json::json!({
        "userId": user.id,
        "name": user.name,
        "quotaTokens": user.quota_tokens,
        "usedTokens": user.used_tokens,
        "remainingTokens": user.quota_tokens.map(|q| (q - user.used_tokens).max(0)),
    })))
}
