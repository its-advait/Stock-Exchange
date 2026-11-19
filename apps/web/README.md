# @aez/web (not built yet)

This folder will hold the frontend. Integration contract: [../../docs/API.md](../../docs/API.md).

* Import shared types, Zod schemas, and money helpers from `@aez/shared`. Add it as a workspace dependency.
* Call the API with `credentials: 'include'`. Make sure this app's origin is listed in the server's `WEB_ORIGINS`.
* Never compute money with floats. Use integer cents along with `formatCents` and `parseDollarsToCents`.
