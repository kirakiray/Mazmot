import httpServer from 'http-server';

const PORTS = [30031, 30032, 30033, 30034, 30035, 30036, 30037, 30038, 30039, 30040];
const servers = [];

for (const port of PORTS) {
  const server = httpServer.createServer({
    root: './',
    cache: -1,
    cors: true,
  });
  server.listen(port);
  servers.push(server);
  console.log(`Static server started on http://localhost:${port}`);
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nShutting down static servers...');
  let remaining = servers.length;
  if (remaining === 0) process.exit(0);
  for (const server of servers) {
    server.close(() => {
      remaining -= 1;
      if (remaining === 0) process.exit(0);
    });
  }
  // Force exit after 3s if server.close() hangs (e.g. keep-alive connections)
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
