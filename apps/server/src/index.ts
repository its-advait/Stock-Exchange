import { assertServable, loadConfig } from './config.js';
import { createServer } from './server.js';

const cfg = loadConfig();
assertServable(cfg);
const server = await createServer(cfg);
await server.relay.start();
await server.app.listen({ host: cfg.HOST, port: cfg.PORT });

server.app.log.info(
  { env: cfg.NODE_ENV, origins: cfg.WEB_ORIGINS, cookieSecure: cfg.COOKIE_SECURE, trustProxy: cfg.TRUST_PROXY },
  'AEZ Stock Exchange started',
);

// Error monitoring: everything unexpected is logged as structured JSON (Railway captures stdout).
process.on('unhandledRejection', (err) => server.app.log.error({ err }, 'unhandledRejection'));
process.on('uncaughtException', (err) => {
  server.app.log.fatal({ err }, 'uncaughtException; exiting');
  process.exit(1);
});

let closing = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (closing) return;
    closing = true;
    server.app.log.info(`${sig} received, shutting down`);
    server
      .close()
      .then(() => process.exit(0))
      .catch((e) => {
        console.error(e);
        process.exit(1);
      });
  });
}
