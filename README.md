# url-shortener

A URL shortener API built as a hands-on exploration of the distributed-systems concerns behind a
"simple" system-design interview question (see [`learnings.md`](./learnings.md) for the write-up
that motivated the design choices below): caching under load and write-behind analytics.

## Tech stack

- **Runtime:** Node.js + TypeScript, served with Express
- **Database:** PostgreSQL via Prisma (with the `pg` driver adapter)
- **Cache / queue:** Redis (`ioredis`)
- **Auth:** JWT (`jsonwebtoken`), passwords hashed with `bcryptjs`

## How it fits together

### HTTP server

`src/server.ts` creates an `http.Server` and hands it to Express (`src/app.ts`). Every server
process also runs a background worker loop (`startWorker`) that drains a Redis-backed queue and
writes click analytics to Postgres — see "Click tracking" below.

`src/app.ts` wires up the middleware chain: CORS, request logging, JSON body parsing, cookies,
then JWT auth (`authenticateJwtToken`), followed by the route modules:

- `/users` → login, register, search (`src/routes/users.ts`)
- `/urls` → create a short URL (`src/routes/urls.ts`)
- `/:shortCode` → redirect (`src/routes/urls/redirect.ts`) — must be mounted last since it's a
  catch-all

### Auth

`src/middleware/auth.ts` verifies a `Bearer` JWT on every request except an explicit allowlist
(`PUBLIC_ROUTES`): login, register, and `GET /:shortCode` (the redirect itself is public — anyone
can follow a short link). On success the decoded token is attached to `req.jwtToken`.

### Creating and resolving short URLs

- **Create** (`POST /urls/create`, `src/routes/urls/createUrl.ts`): reserves the next value from
  `Url`'s id sequence (`SELECT nextval(pg_get_serial_sequence(...))`), derives the short code from
  that id (`src/utils/shortCode.ts`), then inserts explicitly with both. Deriving the code from a
  sequence id — instead of the old md5(long_url)-slice(6) scheme, which had only 16^6 (~16.7M)
  possible codes and was guaranteed to start colliding well before 1B urls — makes collisions
  structurally impossible: `encodeId` is a bijection (multiplication by an odd constant mod 2^40,
  invertible since an odd number is always coprime to a power of two) so no two ids ever produce
  the same code, and it doesn't reveal insertion order the way encoding the raw id would.
  `backOff` here only covers transient DB errors, not collision retries.

  **Why this is collision-free:** picture the mod-2^40 space as a clock face with ~1.1 trillion
  positions. `encodeId` takes `(id * MULTIPLIER) % 2^40` — id 1 lands `MULTIPLIER` positions
  around the clock, id 2 lands `2 * MULTIPLIER` positions around (wrapping as needed), and so on.
  Because `MULTIPLIER` is odd and `2^40` is a power of two, they share no common factor
  (`gcd = 1`), which guarantees that stepping by `MULTIPLIER` visits every one of the 2^40
  positions exactly once before any repeat — i.e. the mapping is a true bijection, not just
  "unlikely to collide." The result is base62-encoded and padded to 7 characters (`62^7 > 2^40`
  guarantees 7 chars always suffice).

  **Scaling past 2^40 ids:** if the id space ever needs to grow, bump `BITS` in
  `src/utils/shortCode.ts` (e.g. `50` instead of `40`, giving ~1.1 quadrillion ids — another
  ~1000x headroom over 1B), recompute `CODE_WIDTH` so `62^CODE_WIDTH` still exceeds `2^BITS`
  (`50` bits fits in `9` base62 chars), and let `MULTIPLIER`/`MULTIPLIER_INVERSE` be recomputed
  against the new `MODULUS` (same masked-and-forced-odd derivation, just against a bigger
  modulus). This is backward compatible with zero data migration: `short_url` values are stored
  literally in Postgres and looked up by string in `redirect.ts`, not recomputed from the id on
  every read, so existing codes keep resolving unchanged — only ids created after the change get
  the new (slightly longer) codes.
- **Redirect** (`GET /:shortCode`, `src/routes/urls/redirect.ts`): checks Redis first
  (`short_url` → `{ longUrl, urlId }`, 24h TTL). On a cache miss it falls back to Postgres
  (`findUnique` on the `short_url` unique index), then populates the cache for next time. Every
  successful resolution — cached or not — enqueues a click event rather than writing to Postgres
  inline, so the redirect stays fast. Redis is configured with `maxmemory-policy allkeys-lru` on
  startup (`src/server.ts`) so that once cached keys exceed available memory, the coldest urls get
  evicted first instead of writes failing outright — at 1B+ urls the cache can't hold everything,
  but it doesn't need to: it only needs to hold whatever's currently hot.

### Click tracking (write-behind queue)

Redirect requests never write to Postgres directly. Instead `sendClickToRedisQueue` pushes the
click onto a Redis list (`clicks_queue`). The background worker in `src/server.ts`:

1. Atomically moves an item from `clicks_queue` to a `clicks_processing` list
   (`BRPOPLPUSH`, `getNextClick`) — this is the "reserve" step.
2. Writes it to Postgres via Prisma (retried with `backOff`).
3. Only removes it from `clicks_processing` (`acknowledgeClick`) after the write succeeds.
4. On startup, `requeueStalledClicks` moves anything still sitting in `clicks_processing` back
   onto `clicks_queue`, recovering work that was in flight when a previous process crashed.

This ensures a click is never lost between "popped from Redis" and "durably saved" — see the code
comment in `src/utils/redisClickQueue.ts` for the reasoning (`src/utils/redisClickQueue.ts`,
`src/server.ts`).

### Data model (`prisma/schema.prisma`)

- `User` — `user_id` (uuid), `username` (unique), `password_hash`
- `Url` — `id` (bigint, autoincrement — see above), `short_url` (unique), `long_url`, owned by a
  `User`. Bigint instead of uuid also keeps the primary-key index insert-ordered rather than
  randomly scattered, which matters once the table has ~1B rows (a random uuid v4 PK causes
  constant index page splits at that scale).
- `Click` — one row per redirect, linked to a `Url` via `url_id`, with `ip_address`, `user_agent`,
  `referrer`, `time_stamp`. This is the fastest-growing table (a multiple of the url count), so
  it's a Postgres table **range-partitioned by `time_stamp`** (monthly) rather than one flat table
  — see the `bigint_ids_and_click_partitioning` migration. A `Click_default` partition catches any
  row that doesn't fall in an existing month so inserts never fail; `create_click_partition_for_month(date)`
  (a SQL function created by that migration) should be called from a scheduled job a few days
  ahead of each month to pre-create the next partition. Partitioning means old months can be
  detached and archived/dropped in O(1) instead of deleted row-by-row.

## Project structure

```
src/
  app.ts                    Express app + middleware/route wiring
  server.ts                 HTTP server, Redis connection, click-queue worker
  middleware/auth.ts        JWT auth
  routes/
    users.ts, urls.ts       Route mounting
    user/{login,register,search}.ts
    urls/{createUrl,redirect}.ts
  utils/
    redis.ts                 publishToRedis helper
    redisClickQueue.ts        Click queue (push/reserve/ack/requeue)
    shortCode.ts              Bijective id <-> short_url encoding (base62 + mod-2^40 mix)
    db/{url,user}.ts          Prisma query helpers
  db/{prisma,pool}.ts        Prisma client / pg Pool setup
prisma/
  schema.prisma              Models
  migrations/                 Generated migrations
```

## Running locally

Prerequisites — PostgreSQL and Redis running locally, and a `.env` with:

```
DATABASE_URL=postgresql://user:password@localhost:5432/url_shortener
JWT_SECRET=some-dev-secret
```

```bash
redis-cli ping   # should return PONG
pg_isready       # should return "accepting connections"
```

Install dependencies, generate the Prisma client, and set up the database:

```bash
npm install
npx prisma generate
npm run reset-db   # runs migrations and seeds a few test users
```

Start one or more app servers — each runs the full HTTP API plus its own click-queue worker,
simulating multiple server instances behind a load balancer sharing one Postgres/Redis:

```bash
# Terminal 1
npm run port3000

# Terminal 2
npm run port3001
```

## Scripts

| Script | Description |
| --- | --- |
| `npm start` | Run the server on the default port |
| `npm run port3000` | Run the server on port 3000 |
| `npm run port3001` | Run the server on port 3001 |
| `npm run build` | Type-check / compile with `tsc` |
| `npm run lint` | ESLint over `src/` |
| `npm run format` | Prettier `--write` over `src/` |
| `npm run seed` | Seed the database with test users |
| `npm run reset-db` | `prisma migrate reset --force` then reseed |

## Changing the database schema

1. Edit `prisma/schema.prisma`.
2. `npx prisma migrate dev --name <your-migration-name>`
3. `npx prisma generate` (regenerates the TS client into `src/generated/prisma`)
4. `npm run reset-db` if you want a clean, reseeded database.
