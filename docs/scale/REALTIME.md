# Realtime across instances (BT-472)

Live-stream rooms (`ws/liveHub.ts`) and community chat rooms (`ws/communityHub.ts`) keep their sockets in process memory. With more than one API instance, every broadcast, kick and room close is now also published on a small bus (`lib/realtime/bus.ts`), and each instance delivers what it receives to its own sockets. The hubs' own delivery code is unchanged; each got one publish line per broadcast function and one subscribe line when its WebSocket server attaches.

## Backends

| Backend | Chosen when | Extra connections per instance |
| --- | --- | --- |
| Redis pub/sub | `REDIS_URL` is set | 1 subscriber connection (publishing reuses the cache client) |
| Postgres `LISTEN/NOTIFY` | `DATABASE_URL` set and no Redis (the default in production today) | 1 dedicated `LISTEN` connection; `NOTIFY` uses the app pool, batched up to 100 events per round trip |
| In-process | tests, or `REALTIME_BUS=inprocess` | none (single instance only) |

`REALTIME_BUS=redis|postgres|inprocess` overrides the choice.

- **Payload limit.** Postgres rejects `NOTIFY` payloads of 8000 bytes or more. Larger events are written to `realtime_bus_payloads` (migration 458) and only the row id is notified; rows are swept after 10 minutes.
- **Poolers.** `LISTEN` needs a real session, which transaction-mode poolers (PgBouncer, Neon `-pooler` hosts) do not provide. Set `REALTIME_DATABASE_URL` to the direct (unpooled) connection string. If it is unset and `DATABASE_URL` is a Neon `-pooler` host, the bus drops `-pooler` from the host automatically.
- **Exactly once.** Each message carries the sender's instance id and a message id. An instance ignores its own messages (it already delivered locally) and drops ids it has seen.
- **Best effort, like before.** If the bus is down, each instance still delivers to its own sockets; clients already catch up over HTTP on reconnect (community `after=<seq>`, live comment list). `/api/healthz/ready` reports `checks.realtime` for information only; it never makes an instance unready.

## Presence and counts

- **Live viewer counts** were already cross-instance: every viewer heartbeats a row in `live_viewers`, and the presence job recomputes counts from that table. Each instance runs that job and broadcasts the shared count to its own sockets, so `viewerCount` events are deliberately **not** re-published (that would multiply them by the number of instances).
- **Community "has the chat open"** (used to skip a push to someone reading live) now aggregates across instances through `realtime_presence` (Postgres, heartbeat every 30 s, 90 s TTL) or a Redis hash with TTL when Redis is on. A store error falls back to this instance's view, the old behavior. Tunables: `REALTIME_PRESENCE_HEARTBEAT_MS`, `REALTIME_PRESENCE_TTL_MS`.

## Not covered here

- A DM / messages WebSocket hub is not on `dev` yet (#780 adds `ws/messagesHub.ts`). When it lands it takes the same two lines: `createRoomFanout({ topic: "messages", apply: { ... } })`, `publish` at the top of its broadcast, `start()` in its attach function.
- #726 adds a `skipUserIds` option to `broadcastToRoom` (block filtering). After both merge, pass `opts` through the publish line and the `broadcast` apply function so other instances skip the same viewers.
- Background jobs still run on every instance until the job leader lock (#744) merges. Keep max instances at 1 until then (`DEPLOYMENTS.md`).
