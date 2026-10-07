// Mazmot Desktop Runtime — Tauri 2 桌面壳
//
// Mazmot（https://mazmot.noneos.com）是一个纯静态网页平台：NoneOS Core 以
// Service Worker 形态提供 /nos/*、/gh/*、虚拟目录 /$xxx/* 等运行时。Tauri 的
// asset 自定义协议下 SW 无法注册，因此本壳内置回环 HTTP 静态服务器
// （见 static_server.rs），沿用仓库本地开发端口约定（30031 主站 / 30032 隔离
// 域），主窗口与应用窗口全部指向真实 http://localhost origin——SW、IndexedDB
// 等 Web 平台能力与浏览器完全一致。
//
// 应用窗口：Mazmot 用 window.open(runUrl, "mazmot-app-<name>") 打开应用，
// shim.js（initialization_script 注入）把 window.open 接管为原生多窗口。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod static_server;

/// 注入每个 WebView 的 window.open 原生多窗口 shim（见 shim.js）
pub const SHIM_JS: &str = include_str!("shim.js");

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

/// 回环主机名（站点 origin 判定，与 shim.js 保持一致）
const INTERNAL_HOSTS: &[&str] = &["localhost", "127.0.0.1", "[::1]"];

pub struct HostsInfo {
    pub main_port: u16,
    pub bridge_port: Option<u16>,
}

fn main() {
    tauri::Builder::default()
        // 单实例：二次启动聚焦已有主窗口，避免端口/数据漂移
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::runtime_open_window,
            commands::runtime_navigate_window,
            commands::runtime_focus_window,
            commands::runtime_close_window,
            commands::runtime_set_window_title,
            commands::runtime_open_external,
            commands::runtime_probe,
            commands::runtime_log,
        ])
        .setup(|app| {
            let root = Arc::new(resolve_web_root(app.handle())?);

            let mut main_port = None;
            for port in static_server::MAIN_PORTS {
                if let Some(bound) = static_server::spawn(root.clone(), *port) {
                    main_port = Some(bound.port);
                    break;
                }
            }
            let main_port = main_port
                .ok_or("无法绑定主站端口（30031/30033-30036 均被占用）")?;
            // 隔离域（conjure bridge 预览）：固定 30032，失败只降级预览功能
            let bridge_port =
                static_server::spawn(root.clone(), static_server::BRIDGE_PORT).map(|b| b.port);
            if bridge_port.is_none() {
                eprintln!(
                    "[mazmot-runtime] 端口 {} 被占用，conjure 隔离预览不可用",
                    static_server::BRIDGE_PORT
                );
            }

            app.manage(HostsInfo {
                main_port,
                bridge_port,
            });

            let origin: tauri::Url = format!("http://localhost:{}/", main_port).parse()?;
            let app_handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(origin))
                .title("Mazmot")
                .inner_size(1200.0, 800.0)
                .min_inner_size(860.0, 600.0)
                .initialization_script(SHIM_JS)
                .on_navigation(move |url| handle_navigation(&app_handle, url))
                .build()?;

            eprintln!(
                "[mazmot-runtime] 主窗口就绪 http://localhost:{}（bridge: {:?}）",
                main_port, bridge_port
            );
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // 关闭主窗口 = 退出整个 runtime（含所有应用窗口）
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { .. },
                ..
            } = event
            {
                if label == "main" {
                    app.exit(0);
                }
            }
        });
}

/// 解析静态站点根目录：
/// - MAZMOT_WEB_ROOT 环境变量优先（指向任意一份站点静态文件）
/// - debug 构建直接用仓库根（站点源码实时生效）
/// - release 构建用 bundle resources（tauri.conf.json 的 resources，
///   位于 src-tauri 之外的资源会被放进 resource_dir/_up_/）
fn resolve_web_root(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(path) = std::env::var("MAZMOT_WEB_ROOT") {
        let path = PathBuf::from(path);
        if path.join("index.html").is_file() {
            return Ok(path);
        }
        return Err(format!("MAZMOT_WEB_ROOT 下没有 index.html：{}", path.display()).into());
    }
    if cfg!(debug_assertions) {
        // CARGO_MANIFEST_DIR = <repo>/client/src-tauri
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        return Ok(repo_root);
    }
    let resource_dir = app.path().resource_dir()?;
    // src-tauri 之外的资源会按相对层级放进 _up_/（ ../../ 开头即两层）
    for depth in 0..=3 {
        let candidate = std::iter::repeat("_up_")
            .take(depth)
            .fold(resource_dir.clone(), |acc, seg| acc.join(seg));
        if candidate.join("index.html").is_file() {
            return Ok(candidate);
        }
    }
    Err(format!(
        "站点资源缺失：{} 下没有 index.html",
        resource_dir.display()
    )
    .into())
}

/// 导航分流：内部站点（回环主机 + runtime 端口段）放行；
/// 其余 http(s) 转系统默认浏览器并拦截页内跳转。
pub fn handle_navigation(app: &tauri::AppHandle, url: &tauri::Url) -> bool {
    match url.scheme() {
        "http" | "https" => {
            let host = url.host_str().unwrap_or("");
            let fallback_port = if url.scheme() == "https" { 443 } else { 80 };
            let port = url.port().unwrap_or(fallback_port);
            let internal = INTERNAL_HOSTS.contains(&host) && (30031..=30036).contains(&port);
            if internal {
                true
            } else {
                let _ = app.opener().open_url(url.to_string(), None::<&str>);
                false
            }
        }
        // about: / blob: / data: / javascript: 等页内协议放行
        _ => true,
    }
}
