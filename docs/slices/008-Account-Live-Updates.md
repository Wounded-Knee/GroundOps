# Slice 008 — Account Live Updates

## Status

**Previous slice:** 006 — Sortie Actuals and Completion

**Derived from:** Technical Architecture (`docs/04-technical-architecture.md`) sections 3, 7, and 8, and slices 001–006.

**Purpose:** Every signed-in device on one user account hears calendar changes, sortie progress, and the vehicle's latest fix as they are committed. A web session opened while the phone is navigating shows that drive on a flat map: the whole sortie route, every stop, the vehicle, and the fare.

This document is the implementation boundary. Company-wide dispatch, replay from NATS, and driving guidance on web stay outside.

---

# 1. User capability

After this slice, a person who is signed in can:

1. Change the calendar, commence, progress, or complete a sortie on one device and see that change on every other signed-in device for the same user without waiting for the next manual read.
2. See the phone's latest accepted location on those devices when the server accepts a fix.
3. Open the web app while the phone is navigating and see the in-progress sortie, the fare snapshot from the phone, and the vehicle on a north-up map framed to the whole route and every stop.

Another user's devices receive none of this.

---

# 2. Realtime

The server commits in PostgreSQL, then publishes on NATS. The gateway sends an envelope only to open sockets whose session belongs to that user. A missing, unknown, or revoked session is not kept.

Envelopes are `sortie.updated`, `location.updated`, `meter.updated`, and `meter.cleared`. Each carries `userId` and `recordedAt`. NATS is not replay. On connect, the client reads `GET /activity` and ignores envelopes at or before that snapshot's `asOf`. A dropped socket reconnects with backoff while the session is still valid.

Location sampling is unchanged. A fix is published when it is stored.

---

# 3. Meter snapshot

The navigating phone is the source of the fare. It replaces one `driver_meter_reading` row about once a second, and immediately when guidance starts, the stop list changes, or guidance ends. `overviewPath` is the driving path through every stop, sent when guidance starts at the first stop and when the stops change. A later phone reroute that drops completed stops does not replace it.

`POST /sorties/:id/complete` and `DELETE /meter-reading` remove the row and publish `meter.cleared`. The server does not recompute the fare.

---

# 4. Web map

Web Navigation is an overview, not the phone's guidance camera. It uses the Maps JavaScript API when `GOOGLE_MAPS_WEB_API_KEY` is set. The key is browser-restricted and is not the server routing key. The page does not call Places or Routes.

The camera is north-up with tilt fixed at zero. It fits once to the overview path, every stop, and the vehicle when that route is shown or the path or stops change. Later fixes move the vehicle marker only. Without the key, the same sortie, fare, and location text still show.

---

# 5. Acceptance criteria

1. A calendar or sortie write publishes `sortie.updated` for that user after commit. A rejected write publishes nothing.
2. An accepted location observation publishes `location.updated` for that user. A socket for a different user does not receive it.
3. A revoked or missing session does not keep a socket.
4. Signing in on the web during a drive shows the latest fix, the in-progress sortie, and the phone's fare. The map, when keyed, frames the full route and every stop, and a later fix does not move the camera.
5. A reconnect loads `GET /activity` and does not apply an older buffered envelope over that snapshot.
