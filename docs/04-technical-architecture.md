# Technical Architecture

## Status

**Derived from:** Architectural Specification v0.1 (`docs/01-architecture..md`), section 38 and section 42.

**Purpose:** Lock the stack, the monorepo shape, persistence, identity, and the live event path. This is the technical architecture document named in section 42. It does not scaffold the repository and it does not define a slice.

Where this document resolves an item that section 38 left open, this document is the decision. Telephony, transcription, AI extraction, the fare model, the company-rules mechanism, and facility-protocol authoring stay unresolved, as in the architectural specification and `docs/03-domain-model.md`.

Implementation waits for a user-facing slice. The decisions below are the boundaries that slice must keep.

---

# 1. Monorepo

The repository is a **pnpm workspace**.

| Path | Responsibility |
| --- | --- |
| `apps/mobile` | Expo, React Native, TypeScript client |
| `apps/server` | Node server: HTTP, event publishing, WebSocket gateway |
| `packages/contracts` | Command and event types shared by the mobile app and the server |

Domain rules live in the server. `packages/contracts` carries the wire types both sides already share. It does not become a second domain model.

TypeScript runs in strict mode.

These directories are the required shape. The scaffold creates them. Product behavior arrives with a user-facing slice.

---

# 2. Runtime

## 2.1 Mobile

The client is **Expo + React Native + TypeScript**, as the architectural specification requires.

The client displays server state, sends commands, reports observations, and receives live updates. It does not establish authoritative operational state.

## 2.2 Server

The server is **TypeScript on Node LTS**.

**Fastify** serves HTTP. **`@fastify/websocket`** serves client connections. **Zod** validates input at the boundary.

Domain rules are plain TypeScript modules. The HTTP framework does not own them. There is no general-purpose rules engine.

---

# 3. API

Commands, queries, and observations are **HTTP JSON**.

A location observation is one of those HTTP writes. The schedule computation that turns an arrival and that position into a cached sortie window also runs on the server, in the request that needs it. The routing call is provider-replaceable. Its result is stored on the sortie row, including the address of the place the start drive used. A location fix is published on the bus addressed to that user. The gateway delivers it only to that user's sessions.

The server commits authoritative state, then publishes the resulting domain event. Connected clients hear that event through the server's WebSocket gateway.

Clients do not connect to the event bus.

---

# 4. Persistence

**PostgreSQL** is the system of record.

Current state is stored in relational tables. History is an append-only event table in the same database. The state change and the history row commit in the same transaction.

There is no separate event store and no time-series database. PostGIS is not part of the current stack. It remains a later option if a slice needs geospatial queries the core types cannot express.

**Drizzle** owns schema, SQL, and migrations.

Primary keys are server-generated UUIDs. Timestamps are `timestamptz` in UTC.

---

# 5. Tenancy

`company` is the tenant boundary. Tenant-owned rows store the company id. The server checks that boundary on every command and query, using the caller's identity, company relationship, role capability, and operational relationship.

Each company does not receive its own database. Row-level security is not adopted. It remains a later option.

---

# 6. Identity and authorization

The platform owns **User**. No hosted authentication product replaces that identity.

The server issues **opaque session tokens** and stores them hashed in PostgreSQL. The device keeps the token in secure storage. Logout revokes the session. Sessions are not JWTs.

The credential used to obtain a session — password, magic link, or another channel — is chosen by the first slice that includes sign-in. SMS is not that channel. Telephony is still an open adapter.

Authorization is an explicit check in the operation that needs it. There is no policy engine.

---

# 7. Event bus and broadcast

The live path is:

**Commit in PostgreSQL → publish on NATS → WebSocket gateway broadcasts to authorized clients.**

NATS is used as **core pub/sub**. It is part of the stack from the start, so every API instance can publish and every gateway instance can subscribe.

The WebSocket gateway lives in `apps/server`. It subscribes to the bus and sends each event only to connected clients authorized to receive it. The socket authenticates with the same session token as HTTP.

NATS is live fanout. It is not history and it is not replay. The append-only event table is the durable record. A client that reconnects reads current state over HTTP.

JetStream, Kafka, and Redis are not part of the stack.

---

# 8. Work that waits for a slice

**Background work.** The first implementation runs in-process. A job queue is added only when in-process work is insufficient.

**Routing.** Routing calls go through a server-side provider interface. The first provider is Google. Domain types do not use Google representations. The on-device map toolkit is `expo-maps`, chosen in the navigation slice (`docs/slices/002-Navigation.md`): Google Maps on Android and Apple Maps on iOS. The client draws driving guidance over that map and does not call the routing provider itself. The web account overview uses the Maps JavaScript API for tiles, stop markers, the stored route, and the vehicle marker. That view stays north-up and untilted. It does not call Places or Routes.

**Deployment.** When a slice requires a deployed environment, the shape is one API service, managed PostgreSQL, NATS, and HTTPS. The cloud vendor is not chosen here. Kubernetes and Terraform are not part of this decision.

---

# 9. Local infrastructure

When development starts, the API uses the host PostgreSQL service. It connects through the local socket to a database named `groundops`, as the OS user who owns that database. Docker Compose runs NATS. The API runs on the host.

Secrets stay out of git. Logs are JSON on stdout.

---

# 10. Still unresolved

These stay open, and this document does not choose them:

- Telephony provider
- Speech transcription provider
- AI extraction provider or model
- Fare and cost calculation model
- Company-specific rules mechanism
- Facility protocol authoring model
- Effective retention precedence between platform and company policy

PostGIS and PostgreSQL row-level security are named only as later options.
