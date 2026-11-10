// Mazmot Desktop Runtime — 内置静态文件服务器
//
// 把仓库根目录（或打包后的 bundle resources）当作静态站点伺服给 WebView。
// 不用 Tauri 自带 asset 协议（tauri:// 自定义 scheme 下 Service Worker 无法
// 注册，NoneOS Core 依赖 SW），而是监听本机回环端口的真实 HTTP 服务。
//
// 端口沿用仓库的本地开发约定（scripts/static.js）：
//   30031 = 主站 origin（主窗口）
//   30032 = 隔离域 origin（conjure bridge，站点常量 BRIDGE_ORIGIN 硬编码）
// 这样站点代码里所有 `hostname ∈ LOCAL_HOSTS` 的分支行为与本地开发一致，
// client 不打任何站点补丁。

use std::fs;
use std::io::Read;
use std::net::{SocketAddr, TcpListener};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use percent_encoding::percent_decode_str;
use tiny_http::{Header, Method, Response, Server};

/// 回环主机名白名单（Host 头校验，防 DNS rebinding）
const LOOPBACK_HOSTS: &[&str] = &["localhost", "127.0.0.1", "[::1]"];

/// 主站端口候选，第一个绑定成功者生效。30032 保留给 bridge，不进候选。
pub const MAIN_PORTS: &[u16] = &[30031, 30033, 30034, 30035, 30036];
/// bridge（隔离域）固定端口，绑定失败只降级 conjure 预览，不影响主站。
pub const BRIDGE_PORT: u16 = 30032;

pub struct BoundServer {
    pub port: u16,
}

/// 在指定端口伺服 `root` 目录（IPv4 必须绑定成功，IPv6 尽力而为）。
/// 返回 None 表示端口不可用（被其它进程占用等）。
pub fn spawn(root: Arc<PathBuf>, port: u16) -> Option<BoundServer> {
    // 先绑 IPv4，以实际端口（port=0 时由系统分配）再补 IPv6，保证双栈同端口
    let v4 = match TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))) {
        Ok(l) => l,
        Err(err) => {
            eprintln!("[mazmot-runtime] 端口 {} 绑定失败：{}", port, err);
            return None;
        }
    };
    let actual_port = match v4.local_addr() {
        Ok(a) => a.port(),
        Err(err) => {
            eprintln!("[mazmot-runtime] 获取绑定端口失败：{}", err);
            return None;
        }
    };

    let mut servers: Vec<Server> = Vec::new();
    match Server::from_listener(v4, None) {
        Ok(s) => servers.push(s),
        Err(err) => {
            eprintln!("[mazmot-runtime] 初始化服务器失败：{}", err);
            return None;
        }
    }
    if let Ok(v6) = TcpListener::bind(SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 1], actual_port))) {
        if let Ok(s) = Server::from_listener(v6, None) {
            servers.push(s);
        }
    }

    for server in servers {
        let addr = server.server_addr();
        eprintln!(
            "[mazmot-runtime] 静态服务器已启动：http://{}（站点根 {:?}）",
            addr, root
        );
        let server = Arc::new(server);
        for i in 0..2 {
            let server = Arc::clone(&server);
            let root = Arc::clone(&root);
            std::thread::Builder::new()
                .name(format!("mazmot-static-{}-w{}", actual_port, i))
                .spawn(move || loop {
                    match server.recv() {
                        Ok(req) => handle_request(req, &root),
                        Err(_) => break,
                    }
                })
                .ok();
        }
    }

    Some(BoundServer { port: actual_port })
}

/// Host 头匹配：`localhost` / `localhost:30031` / `127.0.0.1:30031` / `[::1]:30031`
fn host_matches(value: &str) -> bool {
    LOOPBACK_HOSTS.iter().any(|allowed| {
        value.eq_ignore_ascii_case(allowed)
            || match value.rsplit_once(':') {
                // IPv6 主机自带方括号，rsplit 不产生歧义
                Some((host, port)) => {
                    host.eq_ignore_ascii_case(allowed)
                        && !port.is_empty()
                        && port.chars().all(|c| c.is_ascii_digit())
                }
                None => false,
            }
    })
}

fn handle_request(req: tiny_http::Request, root: &Path) {
    // DNS rebinding 防护：Host 必须是回环主机名（带或不带端口均可）
    let host_ok = req.headers().iter().any(|h| {
        if !h.field.equiv("Host") {
            return false;
        }
        host_matches(h.value.as_str().trim())
    });
    if !host_ok {
        respond_simple(req, 403, "text/plain; charset=utf-8", b"forbidden host");
        return;
    }

    let method = req.method().clone();
    if !matches!(method, Method::Get | Method::Head) {
        respond_simple(req, 405, "text/plain; charset=utf-8", b"method not allowed");
        return;
    }

    let url = req.url().to_string();
    let (raw_path, query) = match url.split_once('?') {
        Some((p, q)) => (p, Some(q.to_string())),
        None => (url.as_str(), None),
    };

    match resolve_path(root, raw_path) {
        Resolved::File(path) => serve_file(req, &path, &method),
        Resolved::Dir(path) => {
            // 目录 URL 规范化：缺尾斜杠时 308（页面内相对路径依赖目录形态）
            if raw_path.ends_with('/') {
                serve_file(req, &path, &method);
            } else {
                let mut target = format!("{}/", raw_path.trim_end_matches('/'));
                if let Some(q) = query {
                    target.push('?');
                    target.push_str(&q);
                }
                redirect(req, &target);
            }
        }
        Resolved::NotFound => {
            // 镜像 Cloudflare Pages 行为：存在顶层 404.html 时按 404 状态返回它。
            // 禁止 SPA 式回退 200（会掩盖资源缺失，见仓库踩坑记录）。
            let body = fs::read(root.join("404.html")).unwrap_or_else(|_| b"404".to_vec());
            respond_with(req, 404, "text/html; charset=utf-8", &body);
        }
    }
}

enum Resolved {
    File(PathBuf),
    Dir(PathBuf),
    NotFound,
}

/// 路径解析：解码 + 防目录穿越 + 目录取 index.html
fn resolve_path(root: &Path, raw_path: &str) -> Resolved {
    let decoded = match percent_decode_str(raw_path).decode_utf8() {
        Ok(s) => s.into_owned(),
        Err(_) => return Resolved::NotFound,
    };
    let rel = decoded.trim_start_matches('/');
    if rel.split(['/', '\\']).any(|seg| seg == "..") {
        return Resolved::NotFound;
    }
    if rel.is_empty() {
        return match read_index(root) {
            Some(p) => Resolved::Dir(p),
            None => Resolved::NotFound,
        };
    }
    let full = root.join(&rel);
    // 软链/规范路径必须仍在站点根下
    let (Ok(canonical), Ok(root_canonical)) = (full.canonicalize(), root.canonicalize()) else {
        return Resolved::NotFound;
    };
    if !canonical.starts_with(&root_canonical) {
        return Resolved::NotFound;
    }
    if canonical.is_dir() {
        match read_index(&canonical) {
            Some(p) => Resolved::Dir(p),
            None => Resolved::NotFound,
        }
    } else if canonical.is_file() {
        Resolved::File(canonical)
    } else {
        Resolved::NotFound
    }
}

fn read_index(dir: &Path) -> Option<PathBuf> {
    let index = dir.join("index.html");
    index.is_file().then_some(index)
}

fn serve_file(req: tiny_http::Request, path: &Path, method: &Method) {
    let Ok(meta) = fs::metadata(path) else {
        respond_simple(req, 404, "text/plain; charset=utf-8", b"404");
        return;
    };
    let etag = etag_of(&meta);
    let ctype = mime_of(path).to_string();
    let total = meta.len();

    // 条件请求：ETag 未变返回 304
    if let Some(inm) = header_value(&req, "If-None-Match") {
        if inm
            .split(',')
            .any(|tag| tag.trim() == etag || tag.trim() == format!("W/{}", etag))
        {
            let resp = Response::empty(304)
                .with_header(text_header(&format!("ETag: {}", etag)))
                .with_header(text_header("Cache-Control: no-cache"));
            let _ = req.respond(resp);
            return;
        }
    }

    // Range：只处理单区间 bytes=a-b（媒体进度条拖动需要 206）
    let range = header_value(&req, "Range").and_then(|r| parse_range(&r, total));

    if method == &Method::Head {
        let resp = Response::from_data(Vec::<u8>::new())
            .with_header(text_header(&format!("Content-Type: {}", ctype)))
            .with_header(text_header(&format!("Content-Length: {}", total)))
            .with_header(text_header("Accept-Ranges: bytes"))
            .with_header(text_header(&format!("ETag: {}", etag)))
            .with_header(text_header("Cache-Control: no-cache"));
        let _ = req.respond(resp);
        return;
    }

    let Ok(mut file) = fs::File::open(path) else {
        respond_simple(req, 500, "text/plain; charset=utf-8", b"read error");
        return;
    };

    let (resp, extra_headers): (Response<std::io::Cursor<Vec<u8>>>, Vec<Header>) = match range {
        Some((start, end)) => {
            use std::io::Seek;
            if file.seek(std::io::SeekFrom::Start(start)).is_err() {
                (Response::from_data(Vec::<u8>::new()).with_status_code(416), vec![])
            } else {
                let mut buf = Vec::with_capacity((end - start + 1) as usize);
                let _ = (&mut file).take(end - start + 1).read_to_end(&mut buf);
                (
                    Response::from_data(buf).with_status_code(206),
                    vec![
                        text_header(&format!(
                            "Content-Range: bytes {}-{}/{}",
                            start, end, total
                        )),
                        text_header("Accept-Ranges: bytes"),
                    ],
                )
            }
        }
        None => {
            let mut buf = Vec::with_capacity(total as usize);
            let _ = file.read_to_end(&mut buf);
            (
                Response::from_data(buf),
                vec![text_header("Accept-Ranges: bytes")],
            )
        }
    };

    let mut resp = resp
        .with_header(text_header(&format!("Content-Type: {}", ctype)))
        .with_header(text_header(&format!("ETag: {}", etag)))
        .with_header(text_header("Cache-Control: no-cache"));
    for h in extra_headers {
        resp = resp.with_header(h);
    }
    resp = resp.with_header(text_header(concat!(
        "X-Mazmot-Runtime: ",
        env!("CARGO_PKG_VERSION")
    )));
    let _ = req.respond(resp);
}

fn redirect(req: tiny_http::Request, location: &str) {
    let resp = Response::empty(308)
        .with_header(text_header(&format!("Location: {}", location)))
        .with_header(text_header("Content-Length: 0"));
    let _ = req.respond(resp);
}

fn respond_simple(req: tiny_http::Request, code: u16, ctype: &str, body: &[u8]) {
    respond_with(req, code, ctype, body);
}

fn respond_with(req: tiny_http::Request, code: u16, ctype: &str, body: &[u8]) {
    let resp = Response::from_data(body.to_vec())
        .with_status_code(code)
        .with_header(text_header(&format!("Content-Type: {}", ctype)))
        .with_header(text_header(concat!(
            "X-Mazmot-Runtime: ",
            env!("CARGO_PKG_VERSION")
        )));
    let _ = req.respond(resp);
}

fn text_header(value: &str) -> Header {
    let (name, val) = value.split_once(':').unwrap_or(("X-Invalid", ""));
    Header::from_bytes(name.as_bytes(), val.trim().as_bytes())
        .unwrap_or_else(|_| Header::from_bytes(&b"X-Invalid"[..], &b""[..]).unwrap())
}

fn header_value(req: &tiny_http::Request, name: &'static str) -> Option<String> {
    req.headers()
        .iter()
        .find(|h| h.field.equiv(name))
        .map(|h| h.value.as_str().to_string())
}

fn etag_of(meta: &fs::Metadata) -> String {
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("\"{:x}-{:x}\"", mtime, meta.len())
}

/// 解析单区间 Range: bytes=a-b（b 可省略）；返回闭区间 (start, end)
fn parse_range(value: &str, total: u64) -> Option<(u64, u64)> {
    let spec = value.trim().strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None; // 多区间不支持，退回 200
    }
    let (a, b) = spec.split_once('-')?;
    if a.is_empty() {
        // bytes=-N：末尾 N 字节
        let n: u64 = b.trim().parse().ok()?;
        if n == 0 || total == 0 {
            return None;
        }
        let start = total.saturating_sub(n);
        return Some((start, total - 1));
    }
    let start: u64 = a.trim().parse().ok()?;
    if start >= total {
        return None;
    }
    let end = if b.trim().is_empty() {
        total - 1
    } else {
        b.trim().parse::<u64>().ok()?.min(total - 1)
    };
    if end < start {
        return None;
    }
    Some((start, end))
}

pub fn mime_of(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("html") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") | Some("webmanifest") => "application/json; charset=utf-8",
        Some("map") => "application/json; charset=utf-8",
        Some("txt") | Some("md") | Some("toml") => "text/plain; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("ico") => "image/x-icon",
        Some("wasm") => "application/wasm",
        Some("xml") => "application/xml; charset=utf-8",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        _ => "application/octet-stream",
    }
}

// ---------- 单元测试 ----------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::Duration;

    fn fixture() -> PathBuf {
        // 每个测试用独立目录（并行运行互不干扰）
        static SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "mazmot-static-test-{}-{}",
            std::process::id(),
            n
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("apps/run-app")).unwrap();
        fs::write(dir.join("index.html"), "<html>home</html>").unwrap();
        fs::write(dir.join("404.html"), "<html>404</html>").unwrap();
        fs::write(dir.join("apps/run-app/index.html"), "<html>run</html>").unwrap();
        fs::write(dir.join("app.mjs"), "export default 1").unwrap();
        dir
    }

    #[test]
    fn test_resolve_basic() {
        let root = fixture();
        assert!(matches!(resolve_path(&root, "/"), Resolved::Dir(_)));
        assert!(matches!(resolve_path(&root, "/index.html"), Resolved::File(_)));
        assert!(matches!(resolve_path(&root, "/app.mjs"), Resolved::File(_)));
        // 目录且无 index.html → 404
        fs::create_dir_all(root.join("empty-dir")).unwrap();
        assert!(matches!(resolve_path(&root, "/empty-dir"), Resolved::NotFound));
        assert!(matches!(resolve_path(&root, "/apps/run-app/"), Resolved::Dir(_)));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn test_resolve_traversal_blocked() {
        let root = fixture();
        assert!(matches!(
            resolve_path(&root, "/../Cargo.toml"),
            Resolved::NotFound
        ));
        assert!(matches!(
            resolve_path(&root, "/%2e%2e/Cargo.toml"),
            Resolved::NotFound
        ));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn test_mime() {
        assert_eq!(
            mime_of(Path::new("/a/b/page.html")),
            "text/html; charset=utf-8"
        );
        assert_eq!(
            mime_of(Path::new("/x.mjs")),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(mime_of(Path::new("/x.wasm")), "application/wasm");
        assert_eq!(mime_of(Path::new("/x.bin")), "application/octet-stream");
    }

    #[test]
    fn test_parse_range() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=500-", 1000), Some((500, 999)));
        assert_eq!(parse_range("bytes=-200", 1000), Some((800, 999)));
        assert_eq!(parse_range("bytes=2000-", 1000), None);
        assert_eq!(parse_range("bytes=0-1,5-9", 1000), None);
    }

    #[test]
    fn test_spawn_serves_files() {
        let root = Arc::new(fixture());
        let bound = spawn(root.clone(), 0).expect("must bind ephemeral port");
        assert!(bound.port > 0);

        let (status, ctype, body) = http_get(bound.port, "/");
        assert_eq!(status, 200);
        assert!(ctype.starts_with("text/html"));
        assert_eq!(body, "<html>home</html>");

        // 缺尾斜杠的目录 → 308 重定向
        let (status, _, _) = http_get(bound.port, "/apps/run-app");
        assert_eq!(status, 308);

        // 未知路径 → 404 + 404.html 内容（镜像 CF Pages，不做 SPA 回退）
        let (status, ctype, body) = http_get(bound.port, "/no-such-file.js");
        assert_eq!(status, 404);
        assert!(ctype.starts_with("text/html"));
        assert_eq!(body, "<html>404</html>");

        // 伪造 Host → 403（DNS rebinding 防护）
        let (status, _, _) = http_get_with_host(bound.port, "/", "evil.example.com");
        assert_eq!(status, 403);

        let _ = fs::remove_dir_all(&*root);
    }

    fn http_get(port: u16, path: &str) -> (u16, String, String) {
        http_get_with_host(port, path, &format!("localhost:{}", port))
    }

    fn http_get_with_host(port: u16, path: &str, host: &str) -> (u16, String, String) {
        use std::io::Write;
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        write!(
            stream,
            "GET {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
            path, host
        )
        .unwrap();
        let mut buf = String::new();
        let _ = std::io::Read::read_to_string(&mut stream, &mut buf);
        let (head, body) = buf.split_once("\r\n\r\n").unwrap_or((buf.as_str(), ""));
        let status: u16 = head
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let ctype = head
            .lines()
            .find(|l| l.to_ascii_lowercase().starts_with("content-type:"))
            .map(|l| l.split_once(':').unwrap().1.trim().to_string())
            .unwrap_or_default();
        (status, ctype, body.to_string())
    }
}
