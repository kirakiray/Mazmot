fn main() {
    // 应用命令通过 AppManifest 自动生成 ACL 权限（allow-$command）。
    // 站点运行在远端源（http://localhost:30031 等，非 tauri:// 本地源），
    // Tauri 对远端源的应用命令强制 ACL 校验，capability 里必须显式
    // 引用对应的 allow-* 权限（见 capabilities/main.json）。
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "runtime_open_window",
            "runtime_navigate_window",
            "runtime_focus_window",
            "runtime_close_window",
            "runtime_set_window_title",
            "runtime_open_external",
            "runtime_probe",
            "runtime_log",
        ])),
    )
    .expect("failed to run tauri-build");
}
