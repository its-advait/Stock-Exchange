import { loadConfig } from './config.js';
import { createServer } from './server.js';

const cfg = loadConfig();
const server = await createServer(cfg);
await server.relay.start();
await server.app.listen({ host: cfg.HOST, port: cfg.PORT });

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
