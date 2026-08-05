import http from "node:http";

export const createHealthServer = ({ port, getHealth }) => {
  if (!port) return null;
  const server = http.createServer((request, response) => {
    const health = getHealth();
    if (request.url === "/health") {
      const healthy = !health.lastError && Boolean(health.lastSuccessAt);
      response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: healthy ? "ok" : "degraded", ...health }));
      return;
    }
    if (request.url === "/metrics") {
      const lines = [
        `fiscal_reader_running ${health.running ? 1 : 0}`,
        `fiscal_reader_processed_total ${health.processed}`,
        `fiscal_reader_telegram_pending ${health.stats.pendingTelegram}`,
        ...Object.entries(health.stats.emails).map(([status, count]) =>
          `fiscal_reader_emails_total{status="${status.replace(/[^A-Z_]/gi, "")}"} ${count}`),
      ];
      response.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
      response.end(`${lines.join("\n")}\n`);
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(port, "0.0.0.0");
  return server;
};
