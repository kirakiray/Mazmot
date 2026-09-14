#!/usr/bin/env bash
# 启动本地 noneos handshake 信令服务器（供 sibyl-test 浏览器测试用）。
# 二进制来源与更新方法见 test-bin/README.md。跨步骤存活：nohup 脱离
# 当前 shell，测试步骤（ofajs/sibyl-test action）在任务内继续访问 8081。
# 探活统一用 nc（macOS 无 GNU timeout，/dev/tcp 方案不可移植）。
set -euo pipefail

PORT=8081
BIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)/test-bin"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  BIN="$BIN_DIR/noneos-handshake-macos-arm64" ;;
  Linux-x86_64)  BIN="$BIN_DIR/noneos-handshake-linux-x86_64" ;;
  *) echo "不支持的运行器平台: $(uname -s)-$(uname -m)"; exit 1 ;;
esac

probe() { nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; }

# host 必须显式指定：默认空串在 macOS 上 getaddrinfo 解析失败
#（Linux glibc 会把空主机名当作任意地址，macOS 不会）
printf 'host = "127.0.0.1"\nport = %d\nredb_path = "/tmp/noneos-handshake-test.redb"\n' "$PORT" > /tmp/handshake-test.toml

if probe; then
  echo "端口 $PORT 已被占用，假定已有信令服务器在运行，跳过启动"
  exit 0
fi

nohup "$BIN" --config /tmp/handshake-test.toml > /tmp/handshake-test.log 2>&1 &
SERVER_PID=$!

# 最多等 15s 完成监听；失败时带日志退出，避免测试挂起在公网中继上
for _ in $(seq 1 30); do
  if probe; then
    echo "本地信令服务器已就绪: ws://127.0.0.1:$PORT (pid $SERVER_PID)"
    exit 0
  fi
  sleep 0.5
done

echo "本地信令服务器启动失败"
cat /tmp/handshake-test.log
exit 1
