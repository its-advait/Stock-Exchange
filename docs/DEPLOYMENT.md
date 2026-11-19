# Deploying AEZ Stock Exchange (Railway + PostgreSQL)

One Railway service runs the Docker image from this repository. It serves the API, Socket.IO and the built web app from the same HTTPS origin. A Railway PostgreSQL service holds all state.

## 1. Environment variables

Set these on the **app service**. Never commit real values; `.env` files are git-ignored.

| Variable | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | yes | `${{Postgres.DATABASE_URL}}` (Railway reference to the Postgres service; private network) |
| `NODE_ENV` | set by the image | `production` |
| `PORT` | set by Railway | Railway injects it; the image defaults to 8080 |
| `WEB_ORIGINS` | yes, unless a Railway domain exists | The public origin, e.g. `https://aez-stock-exchange.up.railway.app`. If unset, it defaults to `https://$RAILWAY_PUBLIC_DOMAIN`. Must be `https://` in production. Comma-separate several. |
| `TRUST_PROXY` | set by the image | `true` (Railway's proxy supplies client IPs for rate limiting) |
| `ADMIN_USERNAME` | first deploy | Bootstrap admin username (3–32 letters, digits, underscore) |
| `ADMIN_PASSWORD` | first deploy | A long random password (≥ 10 chars). Generate it, store it in a password manager, and **remove both variables after the first successful deploy**: the seed only creates the admin if it doesn't exist. |
| `COOKIE_SECURE` | no | Defaults to `true` in production; the server refuses to start if it is `false`. |
| `LOG_LEVEL` | no | `info` (default) |
| `DATABASE_POOL_MAX` | no | `20` (default). Keep the total across replicas below the Postgres connection limit. |
| `SESSION_TTL_HOURS`, `SESSION_IDLE_HOURS` | no | 720 and 168 by default |
| `MARKET_MAKER_STARTING_CASH_CENTS` | no | 25000000 ($250,000) by default. Takes effect only when the market-maker account is first created. |
| `SOCKET_IO_PG_ADAPTER` | only for more than one replica | `true` |
| `STARTING_CASH_CENTS` | no | Must stay `1000000`; production refuses any other value. |

## 2. First deployment

1. Push this repository to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**, and pick the repository. Railway reads `railway.json` and builds the `Dockerfile`.
3. **+ New → Database → PostgreSQL** in the same project. Railway Postgres stores its data on a persistent volume.
4. On the app service, set `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
5. **Settings → Networking → Generate Domain.** This sets `RAILWAY_PUBLIC_DOMAIN`, which becomes the default `WEB_ORIGINS`. If you use a custom domain, set `WEB_ORIGINS` to it explicitly.
6. Deploy. Every deploy then runs:
   * **pre-deploy:** `node apps/server/dist/scripts/seed.js`, which applies pending migrations and the idempotent seed (45 securities, notes, parody news, market-maker account, bootstrap admin if missing). It never deletes or resets anything; a second run inserts nothing.
   * **start:** `node apps/server/dist/index.js`.
   * **health check:** `GET /ready` (it queries the database). `GET /health` is a liveness probe that doesn't touch the database.
7. Open the domain, sign in as the admin, then remove `ADMIN_PASSWORD` (and `ADMIN_USERNAME`) from the variables.

## 3. Making securities tradable (safe production initialization)

After seeding, all 45 securities are **non-tradable**. Their original starting prices and statuses have not been supplied and are never invented.

* **Preferred:** import the original dataset. Fill in `data/import/original-dataset.template.csv` as described in `docs/DATA_IMPORT.md`, then run it with the Railway CLI (`railway run` uses the service's variables):

  ```bash
  railway run node apps/server/dist/scripts/import-securities.js --file data/import/original-dataset.csv --require-complete
  ```

  That is a dry run that only reports mismatches. To write, add `--apply --verified-by "<name>" --source "<document reference>"`.

* **Demonstration only:** an admin can set a reference price for a security from **Admin → Securities → Manage**, with the exact acknowledgement phrase. It is labeled **SIMULATED** everywhere and can never override a verified value.

Then open liquidity per security: **Admin → Market maker**, configure inventory and quote levels, and press **Open liquidity**. This issues shares into the immutable issuance ledger and places real quotes through the engine.

Never run the simulation reset as part of a deployment. It requires a halted market, the admin's password and a typed confirmation phrase, and it wipes all trading history.

## 4. Migrations

* Migrations live in `apps/server/drizzle/` and are applied in order by the pre-deploy step, using Drizzle's migration journal (`drizzle.__drizzle_migrations`).
* To add one: change `apps/server/src/db/schema.ts`, run `npm run db:generate -w @aez/server`, review the SQL, commit it, then deploy.
* Write migrations so they are additive and backward-compatible (add columns as nullable or with defaults; backfill; tighten in a later release). The previous release keeps serving while the new one boots.
* If a migration fails, the pre-deploy step fails and Railway keeps the previous deployment running. The migration runs in a transaction, so nothing partial is left behind.

## 5. Logging and error monitoring

* The server logs structured JSON (pino) to stdout; Railway collects it under **Deployments → Logs**. Cookies and authorization headers are redacted.
* Every unhandled request error is logged with level `error` and message `unhandled error`, with the stack. Unhandled promise rejections log `unhandledRejection`; an uncaught exception logs `uncaughtException` at level `fatal` and exits, so Railway restarts the process (`restartPolicyType: ON_FAILURE`).
* Useful searches in Railway logs: `level:50` (errors), `level:60` (fatal), `"unhandled error"`, `"outbox"` (relay warnings).
* Ledger integrity: **Admin → Overview → Run check**, or `railway run node apps/server/dist/scripts/integrity.js`. Any violation is a bug; investigate before trading continues (halt the market from the admin overview).
* To add an external error tracker later, forward the JSON logs (Railway log drains) rather than adding an SDK.

## 6. Backup and recovery

* **Railway backups:** on the Postgres service, open **Backups** and enable scheduled backups (daily is reasonable for a demo). Restoring creates the volume from a snapshot.
* **Logical backup** (portable, also before risky changes):

  ```bash
  pg_dump --format=custom --no-owner "$DATABASE_PUBLIC_URL" > aez-$(date +%Y%m%d-%H%M).dump
  ```

  Use the Postgres service's public URL from Railway's **Connect** tab. Store dumps somewhere private: they contain password hashes.
* **Restore** into an empty database:

  ```bash
  pg_restore --no-owner --dbname "$TARGET_DATABASE_URL" aez-YYYYMMDD-HHMM.dump
  ```

  Then point `DATABASE_URL` at it, redeploy, and run the integrity check.
* **Process crashes need no recovery steps.** Every order, reservation and trade is committed atomically. On restart, matching resumes from the durable book and undelivered real-time events are sent by the outbox relay.

## 7. Scaling notes

The default is one replica. Before running more:

* set `SOCKET_IO_PG_ADAPTER=true` so every replica receives every real-time event;
* note that rate-limit counters are per replica;
* keep `DATABASE_POOL_MAX × replicas` below the Postgres connection limit.

Matching correctness does not depend on the replica count: every guarantee is a Postgres lock or constraint.

## 8. Verifying a deployment

```bash
curl -fsS https://YOUR-DOMAIN/ready
```

The browser suite can also target a deployment. It registers new test accounts and, unless `E2E_ALLOW_FIXTURE=1` is set, never changes prices or liquidity there. Its assertions assume the fixture's book (10 shares offered at the best ask and nothing between that ask and $42), so use it against a deployment only when a security is set up that way; choose it with `E2E_TICKER`:

```bash
E2E_BASE_URL=https://YOUR-DOMAIN E2E_TICKER=SHVM npm run test:e2e
```
