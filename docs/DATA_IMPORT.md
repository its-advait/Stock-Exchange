# Original securities dataset: template and validation procedure

The starting reference prices and listing statuses of the 45 securities are **not** in this repository. Until a security has a verified price and status, it is not tradable. That includes unknown status, which is treated as non-tradable.

## Template

The template is `data/import/original-dataset.template.csv`. It contains all 45 canonical tickers, names, and ranks, with every other field blank.

| Column | Required | Format |
| --- | --- | --- |
| `ticker` | yes | One of the 45 canonical tickers, exactly |
| `name` | yes | Must exactly match the canonical name |
| `original_rank` | yes | Must match the canonical rank (1–45) |
| `reference_price` | yes* | Dollars with up to 2 decimals, for example `12.50`. Must be > 0. Parsed as a string into integer cents; no floats |
| `status` | yes* | `ACTIVE`, `HALTED`, `SUSPENDED`, or `UNLISTED` |
| `trading_restriction` | no | Free text from the original document |
| `description`, `news`, `background` | no | Fictional text |
| `image_url` | no | Must be `https://…` |

\* A blank value is a warning, and that security stays non-tradable. With `--require-complete`, a blank value is an error.

## Procedure

1. Copy the template and fill it in **only** from the original document. Do not estimate or invent values.
2. Run a dry run. It writes nothing.

   ```bash
   npm run db:import -- --file data/import/original-dataset.csv --require-complete
   ```

   The dry run checks four things:
   * The header has the expected columns.
   * There are exactly 45 rows, with no duplicate tickers.
   * Each ticker's name and rank match the canonical list exactly.
   * Every price and status is valid.

   It prints `missing=[…] unexpected=[…] duplicates=[…]`, comparing the file against the canonical 45, and reports how many securities would become tradable.
3. Have a second person review the dry-run output against the document.
4. Apply the file:

   ```bash
   npm run db:import -- --file data/import/original-dataset.csv --require-complete --apply --verified-by "Full Name" --source "AEZ exchange doc v1, 2026-11-20"
   ```

   The apply step runs in a single transaction and does the following:
   * Every imported value is marked `VERIFIED_IMPORT`.
   * The file's SHA-256, the verifier, and the source are recorded on each security and in `audit_logs`.
   * Verified values replace any earlier `SIMULATED` values.
   * The import refuses to change the reference price of a security that has already traded. Reset the simulation first.
5. Check the result with `GET /api/securities`. Each security's `tradable` and `tradingBlockReason` should match the document.

## Historical notes

The historical annotations are seeded into `security_history_notes`:

| Ticker | Change | Note |
| --- | --- | --- |
| SUVN | +2% | |
| SHVM | +0.5% | |
| GANDH | +3.5% | |
| STHAN | +3.5% | |
| BABU | −9.5% | |
| RKP | +2.5% | No note |
| MUNCH | −5% | |
| SNIG | +6.5% | |

Changes are stored in basis points. These are display-only assignment annotations: they never create trades, change prices, or substitute for verified reference prices.
