import httpServer from "http-server";

const commonOptions = {
  cache: -1,
  cors: true,
};

const servers = [];

function startServer(root, port, label) {
  const server = httpServer.createServer({
    ...commonOptions,
    root,
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(
      `\x1b[32m[${label}]\x1b[0m Server running at http://localhost:${port}/ (Root: ${root})`,
    );
  });

  server.server.on("error", (err) => {
    console.error(
      `\x1b[31m[${label}]\x1b[0m Error starting server on port ${port}:`,
      err.message,
    );
  });

  servers.push({ server, label, port });
}

// 启动主服务器
startServer("./", 30031, "Main");

// 优雅退出处理
const handleExit = () => {
  console.log("\n\x1b[33m[System]\x1b[0m Stopping all servers...");
  servers.forEach(({ server, label, port }) => {
    server.close();
    console.log(`\x1b[33m[${label}]\x1b[0m Server on port ${port} closed.`);
  });
  process.exit(0);
};

process.on("SIGINT", handleExit);
process.on("SIGTERM", handleExit);
