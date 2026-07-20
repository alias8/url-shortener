# url-shortener

A URL shortener API built as a hands-on exploration of the distributed-systems concerns behind a
"simple" system-design interview question (see [`learnings.md`](./learnings.md) for the write-up
that motivated the design choices below): caching under load, write-behind analytics, and
real-time delivery over WebSockets.

## Tech stack

- **Runtime:** Node.js + TypeScript, served with Express
- **Database:** PostgreSQL via Prisma (with the `pg` driver adapter)
- **Cache / queue / pub-sub:** Redis (`ioredis`)
- **Real-time:** `ws` WebSocket server sharing the HTTP server
- **Auth:** JWT (`jsonwebtoken`), passwords hashed with `bcryptjs`

## How it fits together

### HTTP + WebSocket server

`src/server.ts` creates a single `http.Server`, hands it to Express (`src/app.ts`) for HTTP
traffic, and attaches a `ws` `Server` to the same server for WebSocket upgrades
(`WebsocketConnectionManager`). Every server process also runs a background worker loop
(`startWorker`) that drains a Redis-backed queue and writes click analytics to Postgres — see
"Click tracking" below.

`src/app.ts` wires up the middleware chain: CORS, request logging, JSON body parsing, cookies,
then JWT auth (`authenticateJwtToken`), followed by the route modules:

- `/users` → login, register, search (`src/routes/users.ts`)
- `/urls` → create a short URL (`src/routes/urls.ts`)
- `/:shortCode` → redirect (`src/routes/urls/redirect.ts`) — must be mounted last since it's a
  catch-all

### Auth

`src/middleware/auth.ts` verifies a `Bearer` JWT on every request except an explicit allowlist
(`PUBLIC_ROUTES`): login, register, and `GET /:shortCode` (the redirect itself is public — anyone
can follow a short link). On success the decoded token is attached to `req.jwtToken`. The same
module verifies the JWT passed as a `?token=` query param on WebSocket upgrade requests
(`ws://localhost:3000?token=<jwt>`), mapping each socket to a `userId` in
`userIdToWsConnectionMap`.

### Creating and resolving short URLs

- **Create** (`POST /urls/create`, `src/routes/urls/createUrl.ts`): hashes the long URL with MD5,
  takes the first 6 hex characters as the short code, and recurses (appending an attempt counter)
  if that code is already taken. The insert is wrapped in `backOff` for a couple of retries before
  giving up.
- **Redirect** (`GET /:shortCode`, `src/routes/urls/redirect.ts`): checks Redis first
  (`short_url` → `{ longUrl, urlId }`, 24h TTL). On a cache miss it falls back to Postgres, then
  populates the cache for next time. Every successful resolution — cached or not — enqueues a
  click event rather than writing to Postgres inline, so the redirect stays fast.

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

### WebSocket ↔ Redis pub-sub wiring

`src/WiringManager.ts` provides two generic pipelines for real-time features:

- **WS → Redis → WS**: a client sends a WebSocket message, which gets published to a Redis channel
  and forwarded to another client's socket (useful once there's more than one server instance,
  since WebSocket connections are per-process — `userIdToWsConnectionMap` isn't shared).
- **HTTP route → Redis → WS**: an HTTP handler publishes to Redis, and connected WebSocket clients
  subscribed to that channel get pushed the update.

`src/websocketAndRedisEventWiring.ts` is where concrete features register themselves with the
`WiringManager`; it currently only contains commented-out examples — no real-time features are
wired up yet.

### Data model (`prisma/schema.prisma`)

- `User` — `user_id`, `username` (unique), `password_hash`
- `Url` — `short_url` (unique), `long_url`, owned by a `User`
- `Click` — one row per redirect, linked to a `Url`, with `ip_address`, `user_agent`, `referrer`,
  `time_stamp`

## Project structure

```
src/
  app.ts                    Express app + middleware/route wiring
  server.ts                 HTTP server, WS server, Redis connection, click-queue worker
  WiringManager.ts           Generic WS<->Redis pipeline helpers
  websocketAndRedisEventWiring.ts   Where real-time features get registered
  WebsocketConnectionManager.ts    Handles WS upgrade, auth, connection map
  middleware/auth.ts        JWT auth (HTTP + WS)
  routes/
    users.ts, urls.ts       Route mounting
    user/{login,register,search}.ts
    urls/{createUrl,redirect}.ts
  services/messageService/  WS message handler registry + Redis subscriber
  utils/
    redis.ts                 publishToRedis helper
    redisClickQueue.ts        Click queue (push/reserve/ack/requeue)
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

Start one or more app servers — each runs the full HTTP/WS API plus its own click-queue worker,
simulating multiple server instances behind a load balancer sharing one Postgres/Redis:

```bash
# Terminal 1
npm run port3000

# Terminal 2
npm run port3001
```

## Scripts

| Script              | Description                                              |
| -------------------- | --------------------------------------------------------- |
| `npm start`           | Run the server on the default port                        |
| `npm run port3000`    | Run the server on port 3000                                |
| `npm run port3001`    | Run the server on port 3001                                |
| `npm run build`       | Type-check / compile with `tsc`                            |
| `npm run lint`        | ESLint over `src/`                                          |
| `npm run format`      | Prettier `--write` over `src/`                               |
| `npm run seed`        | Seed the database with test users                            |
| `npm run reset-db`    | `prisma migrate reset --force` then reseed                   |

## Changing the database schema

1. Edit `prisma/schema.prisma`.
2. `npx prisma migrate dev --name <your-migration-name>`
3. `npx prisma generate` (regenerates the TS client into `src/generated/prisma`)
4. `npm run reset-db` if you want a clean, reseeded database.
