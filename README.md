# AEZ Stock Exchange

AEZ Stock Exchange is a multiplayer fictional stock exchange for the Alpha Epsilon Zeta brotherhood at UC Berkeley. It lists 45 securities, each representing a brother.

Every user starts with $10,000 of virtual cash. Trades go through a real price-time-priority limit order book backed by PostgreSQL, and prices move only when trades execute. There is no real money involved and there are no prizes.

* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): matching engine, lock order, accounting invariants, outbox, and security
* [docs/API.md](docs/API.md): REST and Socket.IO reference for frontend work
* [docs/DATA_IMPORT.md](docs/DATA_IMPORT.md): how to import and verify the original prices and statuses

## Stack

* TypeScript and Node.js
* Fastify 5
* PostgreSQL, with Drizzle ORM and migrations, plus raw parameterized SQL in the engine
* Socket.IO with a transactional outbox
* argon2id password hashing and HttpOnly cookie sessions
* Zod validation
* Vitest

## Local setup

You need Node 20.11 or newer. You don't need Docker or a system Postgres: `npm run db:local` runs PostgreSQL 17 from the `embedded-postgres` npm package.

1. Install dependencies and create your `.env`:

   ```bash
   npm install
   ```

   ```bash
   cp .env.example .env
   ```

   In `.env`, set `ADMIN_USERNAME` and `ADMIN_PASSWORD` (at least 10 characters) to bootstrap an admin.

2. Start the database. It runs in the foreground and keeps its data in `./.local/pgdata`, so leave this terminal open:

   ```bash
   npm run db:local
   ```

3. In another terminal, apply migrations and seed. Seeding is idempotent and creates:
   * the 45 securities, all non-tradable at this point
   * the historical notes
   * the market maker
   * the admin account

   ```bash
   npm run db:seed
   ```

4. Make securities tradable using either A or B.

   **A. Real data.** Import the original dataset (see [docs/DATA_IMPORT.md](docs/DATA_IMPORT.md)):

   ```bash
   npm run db:import -- --file data/import/original-dataset.csv --require-complete
   ```

   **B. Development only.** Apply a price you choose to every security. It is labeled `SIMULATED` everywhere in the API:

   ```bash
   npm run db:simulate -w @aez/server -- --price-cents 1000 --confirm-simulated
   ```

5. Start the API with hot reload on `http://localhost:4000`:

   ```bash
   npm run dev
   ```

6. Open liquidity with the admin API. Log in as the admin, then call:
   * `PUT /api/admin/market-maker/:ticker`
   * `POST /api/admin/market-maker/:ticker/open`

   See [docs/API.md](docs/API.md).

You can use any PostgreSQL 14 or newer instead of step 2. Set `DATABASE_URL` and skip `db:local`.

## Tests

```bash
npm test
```

Tests start a throwaway embedded Postgres. To use an existing database, set `TEST_DATABASE_URL`, but note that the tests drop and recreate its `public` schema.

The suite covers:

* price-time priority
* partial and multiple fills
* empty books
* market orders with insufficient liquidity, and market buy budgets
* insufficient cash and shares, and oversubscription
* reserve release
* cancel after partial fill
* self-trade prevention
* idempotency, including concurrent duplicates
* simultaneous orders from one account
* contention for a single resting order
* randomized concurrent conservation of cash and shares
* rollback
* append-only and immutability triggers
* halts and listing restrictions
* restart recovery and outbox redelivery
* HTTP auth, authorization, and CSRF
* the admin flow, including protected reset
* Socket.IO authorization

Other checks:

```bash
npm run typecheck
```

```bash
npm run db:integrity -w @aez/server
```

## Deploying

1. Provision PostgreSQL and set the environment:
   * `DATABASE_URL`
   * `NODE_ENV=production`
   * `WEB_ORIGINS=https://your-frontend`
   * `TRUST_PROXY=true` if you are behind a proxy

   `COOKIE_SECURE` defaults to true in production. If the frontend and API are on different sites, serve them under one site, for example `app.example.com` and `api.example.com`. The cookie is `SameSite=Lax`.
2. Build:

   ```bash
   npm ci
   ```

   ```bash
   npm run build
   ```

3. Seed once:

   ```bash
   npm run db:seed
   ```

4. Start the server:

   ```bash
   npm run start -w @aez/server
   ```

   It serves `/health` and `/ready`.

To run more than one instance, set `SOCKET_IO_PG_ADAPTER=true`. Matching is already safe across instances.
