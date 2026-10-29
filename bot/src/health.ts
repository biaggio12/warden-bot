import { createServer, type Server } from 'node:http';

export interface HealthState {
  amqp: boolean;
  /** null = dry-run (no Discord token configured) */
  discord: boolean | null;
}

/** GET /health -> 200 when the bot can receive events and (if configured) talk to Discord. */
export function startHealthServer(port: number, state: () => HealthState): Server {
  const server = createServer((request, response) => {
    if (request.url !== '/health') {
      response.writeHead(404).end();
      return;
    }
    const current = state();
    const healthy = current.amqp && current.discord !== false;
    response.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: healthy ? 'ok' : 'unhealthy', amqp: current.amqp, discord: current.discord ?? 'dry-run' }));
  });
  server.listen(port);
  return server;
}
