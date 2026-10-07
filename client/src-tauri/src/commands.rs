// Mazmot Desktop Runtime — WebView → Rust 命令层
//
// 全部是 Mazmot 自己的应用命令（非插件命令），只要 WebView 的来源被
// capabilities 放行即可调用。被 shim.js 以 window.open / 标题同步等形式触发。

use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::json;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use crate::{handle_navigation, HostsInfo, SHIM_JS};

static WINDOW_SEQ: AtomicU64 = AtomicU64::new(0);

#[tauri::command(rename_all = "camelCase")]
pub fn runtime_open_window(
    app: AppHandle,
    url: String,
    name: String,
    width: Option<f64>,
    height: Option<f64>,
    x: Option<f64>,
    y: Option<f64>,
    resizable: Option<bool>,
    opener: String,
) -> Result<String, String> {
    let seq = WINDOW_SEQ.fetch_add(1, Ordering::Relaxed);
    let safe: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
        .collect();
    let label = format!("mazmot-{}-{}", safe.trim_matches('-'), seq);

    let parsed: tauri::Url = url
        .parse()
        .map_err(|e| format!("无效 URL {}: {}", url, e))?;
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title("Mazmot")
        .inner_size(1180.0, 820.0)
        .min_inner_size(420.0, 320.0)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .initialization_script(SHIM_JS);
    if let (Some(w), Some(h)) = (width, height) {
        builder = builder.inner_size(w, h);
    }
    if let (Some(x), Some(y)) = (x, y) {
        builder = builder.position(x, y);
    }
    if let Some(r) = resizable {
        builder = builder.resizable(r);
    }
    let nav_app = app.clone();
    builder = builder.on_navigation(move |u| handle_navigation(&nav_app, u));

    let window = builder.build().map_err(|e| e.to_string())?;

    // 原生窗口被用户直接关掉时，回调 opener 页面的 shim，让假窗口 closed 置真
    let opener_label = opener.clone();
    let notify_name = name.clone();
    let notify_app = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            if let Some(opener_window) = notify_app.get_webview_window(&opener_label) {
                let js = format!(
                    "window.__mazmotRuntime && window.__mazmotRuntime._notifyClosed({});",
                    serde_json::to_string(&notify_name).unwrap_or_else(|_| "\"\"".into())
                );
                let _ = opener_window.eval(js);
            }
        }
    });

    eprintln!(
        "[mazmot-runtime] 打开窗口 {}（{} ← {}）",
        label, url, opener
    );
    Ok(label)
}

#[tauri::command(rename_all = "camelCase")]
pub fn runtime_navigate_window(app: AppHandle, label: String, url: String) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("窗口不存在：{}", label))?;
    let parsed: tauri::Url = url
        .parse()
        .map_err(|e| format!("无效 URL {}: {}", url, e))?;
    window.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn runtime_focus_window(app: AppHandle, label: String) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("窗口不存在：{}", label))?;
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn runtime_close_window(app: AppHandle, label: String) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("窗口不存在：{}", label))?;
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn runtime_set_window_title(window: WebviewWindow, title: String) {
    let _ = window.set_title(&title);
}

#[tauri::command]
pub fn runtime_open_external(app: AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn runtime_probe(info: tauri::State<HostsInfo>) -> serde_json::Value {
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        // macOS 为 Overlay 自绘顶栏（shim 据此注入顶栏与内容下移），其余平台原生标题栏
        "titlebar": if cfg!(target_os = "macos") { "overlay" } else { "native" },
        "mainPort": info.main_port,
        "bridgePort": info.bridge_port,
    })
}

#[tauri::command]
pub fn runtime_log(message: String) {
    eprintln!("[mazmot-runtime][web] {}", message);
}
