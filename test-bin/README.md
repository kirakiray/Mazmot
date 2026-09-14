# test-bin/ — 测试专用二进制

存放随仓库分发的测试基建二进制（大文件，只在 CI 与本地测试中使用，
不参与任何前端部署）。

## noneos-handshake 信令服务器

[noneos-core](https://github.com/kirakiray/noneos-core) `server/handshake`
的官方握手 / 中继服务器（Rust 单二进制，Apache-2.0），按平台各存一份：

| 文件 | 平台 | CI 用途 |
|------|------|---------|
| `noneos-handshake-macos-arm64` | macOS arm64 | test-webkit（macos-latest） |
| `noneos-handshake-linux-x86_64` | Linux x86_64（glibc ≥ 2.30） | test-chrome / test-firefox（ubuntu-latest） |

### 为什么 vendor 进仓库

浏览器测试里的跨用户通信用例（如 `bridge/test/preview-flow.sb.html`）
需要真实的 noneos 信令通道，依赖公网中继（`hand3-*.noneos.com`）既慢又
不确定。本地起服务器后测试完全闭环、毫秒级往返。

历史教训（为什么当初必须本地化排查）：大分片「整窗丢失、delivered:true
但对端从未收到」的确定性故障，最终定位为 noneos-handshake 服务器日志
截断 `&text[..500]` 按字节切片在多字节字符（中文/emoji）上 panic——
连接静默死亡，挂起命令既无响应也无转发（noneos-core ceb3309 已修复；
本目录二进制为修复后重建版）。此前「跨区域中继丢大帧」等诊断均被该
故障掩盖。noneos-core 的 GitHub Release 目前不带二进制资产，CI 在线
构建又需 Rust 工具链，故直接随仓库分发。

客户端无需任何配置即可用上它：localhost 源下 noneos 默认服务器列表
就含 `ws://localhost:8081`，且 `/bridge/proto.js` 的
`ensureServerConnected` 会把双端收敛到排序首位（`ws:` < `wss:`，
本地地址必然排最前）。

### 使用

CI：`.github/workflows/test.yml` 的每个测试任务在跑测试前执行
`.github/scripts/start-handshake.sh`（幂等，端口占用时跳过）。

本地开发（可选，测试没起它时会自动回退公网中继）：

```bash
npm run handshake          # 前台运行，Ctrl+C 停止
```

### 更新方法

在 noneos-core 仓库重新构建后覆盖对应文件：

```bash
cd <noneos-core>/server/handshake
cargo build --release                                          # macOS arm64
cargo zigbuild --release --target x86_64-unknown-linux-gnu     # Linux x86_64
cp target/release/noneos-handshake <Mazmot>/test-bin/noneos-handshake-macos-arm64
cp target/x86_64-unknown-linux-gnu/release/noneos-handshake <Mazmot>/test-bin/noneos-handshake-linux-x86_64
```

注意：服务器默认配置 `host = ""` 在 macOS 上解析失败（glibc 把空主机名
当任意地址，macOS 不会），启动时必须用显式 `host = "127.0.0.1"` 的配置
（脚本与 npm script 均已内置）。
