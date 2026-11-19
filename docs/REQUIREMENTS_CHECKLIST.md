# Requirements checklist

Each line of the original AEZ Stock Exchange specification and the final review, with where it is implemented and the test that proves it. Test files are in `apps/server/test/` (Vitest, real PostgreSQL) and `apps/web/e2e/` (Playwright against the production build).

Status: ✅ done and tested · ⚠️ done with a stated limitation · ⛔ blocked on input not available in this repository.

## Stock universe and reference data

| Requirement | Status | Evidence |
| --- | --- | --- |
| 45 securities with the exact names and tickers | ✅ | `packages/shared/src/universe.ts`; `verification.test.ts` item 18 compares the database to an independent copy of the spec table |
| Metadata: ticker, name, reference price, last price, status, description, news/background, image URL, original rank, historical notes | ✅ | `securities` and `security_history_notes` tables; `GET /api/securities/:ticker` |
| Original starting prices and restrictions not invented | ✅ | Seed leaves price and status NULL; `halts.test.ts` "freshly seeded securities are non-tradable" |
| Import template and validation procedure | ✅ | `data/import/original-dataset.template.csv`, `docs/DATA_IMPORT.md`, `import.test.ts` |
| Original prices and restrictions supplied | ⛔ | Not provided. All 45 remain non-tradable until imported; admins may apply clearly labeled SIMULATED prices for a demo |
| Unknown status is non-tradable; trading only after verification | ✅ | `engine/tradability.ts`; verification item 19 |
| Historical notes are annotations, not trades | ✅ | Seeded as notes only; no trades or price changes |

## Accounts

| Requirement | Status | Evidence |
| --- | --- | --- |
| Register, log in, log out | ✅ | `routes/auth.ts`; `http.test.ts` auth suite; e2e `01-two-traders` |
| Exactly $10,000 on creation | ✅ | `INITIAL_GRANT` ledger entry; production refuses any other value; `http.test.ts`, e2e |
| View cash, reserved, available, holdings, open orders, value, P&L, history, rank | ✅ | `GET /api/portfolio`, `/account/*`; Dashboard and Portfolio pages |
| Return later with the same state | ✅ | `http.test.ts` "state persists across logins"; e2e logout/login step; production restart rehearsal |
| USER and ADMIN roles | ✅ | `requireAdmin`; `http.test.ts` "admin endpoints require ADMIN role"; UI "Admins only" screen |
| Nobody can change wallet balances directly | ✅ | No balance-setting endpoint; only the engine and the protected reset write `cash_accounts` |
| Rate limiting, secure sessions, authorization, safe errors; hashes and secrets never exposed | ✅ | `http/app.ts`, `services/sessions.ts`; `http.test.ts` register test checks no hash leaks |
| No real money, deposits, withdrawals or prizes | ✅ | No such endpoints; disclaimers in the UI |

## Matching engine

| Requirement | Status | Evidence |
| --- | --- | --- |
| Market buy/sell, limit buy/sell, cancel | ✅ | `engine/matching.ts`; `matching.test.ts` |
| Price-time priority; execute at resting price; match only when bid ≥ ask | ✅ | Verification items 2 and 6; property test against a reference model (5 seeds × 250 operations) |
| Partial fills, multiple counterparties | ✅ | Items 4 and 5; e2e partial-fill test |
| Integer cents, integer shares, positive prices | ✅ | `BIGINT` columns plus CHECKs; Zod schemas |
| Monotonic acceptance sequence | ✅ | `order_acceptance_seq`; `recovery.test.ts` checks it across restarts |
| Self-trade prevention without queue jumping | ✅ | Item 11; `safety.test.ts` |

## Funds and inventory safety

| Requirement | Status | Evidence |
| --- | --- | --- |
| Reserved cash and shares; available = owned − reserved | ✅ | Items 8, 9 and 12 |
| No oversubscription across multiple orders | ✅ | `safety.test.ts`; item 10 (concurrent) |
| Release unused reserve on price improvement | ✅ | `safety.test.ts` "releases unused reserve" |
| Market orders only against existing liquidity; remainder cancelled; never rest | ✅ | Item 7; database CHECK |
| Market buys require a budget | ✅ | `matching.test.ts` "never spends more than maxSpendCents" |

## Concurrency and atomicity

| Requirement | Status | Evidence |
| --- | --- | --- |
| Transactions with per-symbol and per-account locks in a documented, deterministic order | ✅ | `docs/ARCHITECTURE.md` §8; `concurrency.test.ts` |
| Atomic execution of every effect | ✅ | Item 14; `rollback.test.ts` |
| Idempotency keys; no duplicate executions | ✅ | Item 13; `concurrency.test.ts` idempotency suite; e2e missing-key check |
| Safe with simultaneous users and multiple instances | ✅ | `concurrency.test.ts` (competing accounts, randomized concurrent trading) |
| Recovery from durable state; no in-memory source of truth | ✅ | Item 17; `recovery.test.ts`; production restart rehearsal |
| Events published only after commit (outbox) | ✅ | `recovery.test.ts` "rolled-back transactions never produce outbox events" |

## Price formation and liquidity

| Requirement | Status | Evidence |
| --- | --- | --- |
| Last price changes only after a real execution | ✅ | Item 16 |
| Never-traded securities show a labeled reference price | ✅ | `displayPriceKind`; UI badges |
| No fabricated chart data | ✅ | Charts read `price_history` (one row per execution). The optional simulated opening history is made of real executions between simulation-desk accounts, not inserted chart points: `docs/SIMULATED_HISTORY.md`, `history.test.ts` |
| Market maker with documented cash, inventory, explicit quotes, real accounting | ✅ | Item 20; `services/marketMaker.ts` |
| Immutable issuance ledger; share supply conserved | ✅ | Triggers; integrity check; item 20 |

## Database, API, real-time

| Requirement | Status | Evidence |
| --- | --- | --- |
| All required tables with constraints and indexes | ✅ | `drizzle/0000–0002`; `docs/ARCHITECTURE.md` §3 |
| Typed REST endpoints | ✅ | `docs/API.md`; `packages/shared/src/types.ts` |
| Socket.IO rooms per ticker; authorization for account events | ✅ | `realtime/socket.ts`; `http.test.ts` socket test; e2e live-update assertions in two sessions |

## Admin

| Requirement | Status | Evidence |
| --- | --- | --- |
| Halt/resume market and securities | ✅ | Item 15; Admin overview and securities tabs |
| Create and manage users | ✅ | Admin → Users (create, role, disable/enable) |
| Inspect trades and ledgers | ✅ | Admin → Executions, Audit |
| Configure opening liquidity | ✅ | Admin → Market maker |
| Strongly protected reset | ✅ | `http.test.ts` "protected reset" |
| Restrictions cannot be bypassed without a documented authorized action | ✅ | Item 19; `halts.test.ts` |

## Frontend

| Requirement | Status | Evidence |
| --- | --- | --- |
| All pages wired to the real API; no decorative buttons | ✅ | Audit of every button; e2e covers register, trade, cancel, reject, partial fill, logout/login, leaderboard, portfolio |
| Server-confirmed results only | ✅ | Toasts read the exchange's response (`confirmed by the exchange`) |
| Mobile | ✅ | e2e `mobile.spec.ts` (no horizontal overflow on six pages, trade from a phone) |
| Leaderboards exclude operators | ✅ | Admin and market-maker accounts are not ranked |

## Security review (final phase)

| Item | Status | Notes |
| --- | --- | --- |
| Password hashing | ✅ | argon2id m=19 MiB t=2; dummy-hash timing for unknown users |
| Session storage and cookies | ✅ | SHA-256 of token stored; HttpOnly, SameSite=Lax, Secure in production (enforced at startup) |
| CSRF | ✅ | Origin allow-list; **new:** rejects `Sec-Fetch-Site: cross-site` without an Origin; JSON-only bodies |
| Authentication and role enforcement | ✅ | 401/403 tested over HTTP and in the UI |
| Input validation | ✅ | Zod on every body, query and parameter |
| SQL injection | ✅ | Parameterized queries; interpolated fragments are code constants only |
| XSS | ✅ | No raw-HTML sinks; **new:** strict CSP with a hash for the one inline script |
| Rate limiting | ⚠️ | In-memory per instance (fine for one replica) |
| Idempotency | ✅ | Required header; replay and conflict tested |
| Admin reset protection | ✅ | Password + phrase + active halt; rate limited; audited |
| Race conditions | ✅ | Lock order; concurrent tests |
| Secrets management | ✅ | Environment only; `.env*` ignored; bootstrap admin variables removed after first deploy |
| Cross-origin restrictions | ✅ | **New:** production requires https origins; defaults to the Railway domain |
| No balance adjustments via public APIs | ✅ | Confirmed by code search: only the engine and the protected reset write balances |

## Deployment

| Item | Status | Notes |
| --- | --- | --- |
| Production configuration | ✅ | `Dockerfile` (container start runs migrations + idempotent seed under an advisory lock, then the server), `railway.json` (`/ready` health check, which returns 503 until the schema exists) |
| Environment variable docs, migrations, seed/import, health, logging, backup, safe initialization | ✅ | `docs/DEPLOYMENT.md` |
| Rehearsed locally in production mode | ✅ | Compiled build, `NODE_ENV=production`, secure cookies, CSP; seed run twice (second run changes nothing); full e2e suite passed; restart preserved identical state; integrity check clean |
| Deployed to Railway with a public HTTPS URL | ⛔ | Needs the GitHub repository and Railway access (see the final report) |
