# Slice 014 — Offline Continuity

## Status

**Previous slice:** 013 — Always on Top

**Derived from:** the server-authoritative flow in Architectural Specification (`docs/01-architecture..md`) section 2.4, human assertion and authoritative state in `docs/03-domain-model.md` sections 2.3 and 2.4, the mobile client in Technical Architecture (`docs/04-technical-architecture.md`) sections 2.1 and 3, and the calendar, navigation, meter, live activity, availability, and address book in slices 001 through 012.

**Purpose:** A signed-in driver keeps working when the server cannot be reached. The phone shows the last known reads, applies author, revise, and drag immediately, keeps an active guided trip across an outage and a process restart, and sends those commands when the link returns. The server remains authoritative once it accepts a command.

This document is the implementation boundary. Offline map tiles, a driving route calculated on the device, commencing a sortie while unreachable, and extending a wait while unreachable stay outside. Slice 003’s refusal of author, revise, and drag while unreachable is removed here.

---

# 1. User capability

After this slice, a signed-in driver can:

1. Open the app with a stored session while the server cannot be reached, and land in the signed-in shell on the cached profile. A revoked session still returns to sign-in. The shell retries the profile in the background.
2. Read the last fetched calendar, address book, activity strip, tariff, and availability choice after a restart with no server. A calendar period that was never fetched stays empty, except for a sortie the driver authored or revised on this device and has not yet synced.
3. Author a sortie, revise a sortie, and drag a sortie while the server cannot be reached. The grid, agenda, and summary show that edit at once, on a provisional window. The edit remains after a restart until the server accepts it or rejects it.
4. Pick a stop from the address book, a device contact, a plus code, or a typed coordinate while unreachable. A fresh place suggestion from the routing provider waits for the network.
5. Keep guiding a trip that was already loaded, including after the process is killed, using the device’s GPS. The meter keeps running. Guide stays unavailable on a sortie the server has not yet accepted.
6. See a queued Passenger or Reposition choice from Where to? on the calendar. Start stays unavailable until the server has accepted that sortie and returned a driving route.
7. Have the phone send, when the link returns and in this order: unsent location observations, then pending creates, then pending revises, then the latest meter reading. A calendar read and an activity read follow. A read that fails leaves the pending edits and the last activity snapshot in place.

The driver still cannot calculate a new driving route, commence a sortie, or add a minute of wait while the server cannot be reached. A wait extension the server rejects returns to the previous wait. Completing a sortie, or starting the next leg, that cannot be sent leaves the trip on screen and says so.

---

# 2. Actors

One actor: a signed-in driver, on web, iOS, or Android. A second session for the same user remains a server session. This slice does not merge two devices field by field. The pending body on this device is the command that will be sent, and the server’s existing last-write-wins revise rule applies.

---

# 3. Domain objects

No new domain object. A pending author, revise, or drag is an assertion the client displays with a provisional window. It is not authoritative state and it is not an operational event. `sortie.created` and `sortie.revised` are written when the server accepts the command, as slice 003 defines.

The provisional window is display. The traffic-aware window stored on the sortie is still computed on the server.

A client-generated sortie id is the sortie’s id when the server accepts a create that carries one. A client-generated observation id identifies one fix so a repeat does not store a second observation or recompute a window.

---

# 4. State transitions

- A stored session whose profile cannot be read becomes the signed-in shell on the cached profile, with the live connection closed. A later successful profile read fills the live profile. An unauthorized profile clears the session and the local caches.
- A calendar, address book, activity, tariff, or availability read that fails shows the last stored copy for that user. A successful read replaces that copy.
- Author, revise, or drag while the server cannot be reached stores a pending command and shows the provisional window. A further edit of that same sortie replaces the pending body.
- A pending create that the server accepts becomes the server sortie and drops the pending row. A pending revise that the server accepts is replaced by the server sortie. A rejection restores the pre-image, or drops the create, and the screen says the sortie was not saved, or that location is required.
- An active guided trip stored on the device is restored after a process restart and keeps following GPS. Ending guidance clears that stored trip.
- An unsent location observation and the latest unsent meter reading are sent when the link returns. A repeat of an observation the server already stored is ignored.

No operational event is written on the device.

---

# 5. Interfaces

The signed-in shell is what opens when a stored token cannot reach `GET /me`. The fault icon from the network probe stays. There is no full-screen block for that outage. Retry of the profile is automatic.

Calendar author, revise, and drag stay available when the calendar could not be refreshed. The banner still says the calendar could not be refreshed, or could not be loaded when nothing is cached. A dragged block stays on the dropped time while the command is pending, and returns to the last accepted time when the server rejects it. Guide on a pending sortie does nothing useful: the control stays disabled until the server sortie exists.

The provisional window is drawn with the same blocks and chips as a server window. When the server response arrives, that block updates in place.

Where to? still previews a route only when the server can return one. Choosing Passenger or Reposition while the write cannot reach the server queues the sortie. Start stays disabled until the write and the route both succeed.

A failed wait extension puts the wait back. A failed complete, or a failed next leg, leaves the trip in place and says the action was not saved.

---

# 6. Backend

Commands stay HTTP JSON. Two additions make replay safe.

| Operation | Change |
| --- | --- |
| Author sortie `POST /sorties` | The body may include an id. When that id already belongs to this driver and the write fields match, the server returns that sortie and appends no second `sortie.created`. When the id exists and the write fields differ, the server revises it. When the id is new, the server inserts the sortie with that id. |
| Revise sortie `PATCH /sorties/:id` | When the write fields match the stored sortie, the server returns it and appends no second `sortie.revised`. A changed body revises, recomputes the window, and appends one event, as slice 003 defines. |
| Report location `POST /location-observations` | The body may include an id. When that id was already stored for this driver, the server responds success and does not insert again and does not recompute. |

Write fields are the label, the arrival and whether it was authored, the passenger name, the passenger phone, and the ordered stops’ label, coordinate, wait minutes, and passenger flag. The cached window is not a write field.

Unreachable and a failed routing call leave the pending command queued. The client retries with backoff. Validation failure, a missing sortie, and a missing location after the queued fix has been stored reject the command.

Replay order on the client is: ensure the driver, send unsent observations in observed-time order, send pending creates in authored order, send pending revises in authored order, send the latest meter reading, then read activity and the calendar.

---

# 7. Persistence

On the device, one SQLite database holds, per signed-in user:

- The last calendar read, including the range it covers. Sorties from that read are shown when the visible period lies inside that range.
- Pending author and revise commands: the client id or the server id, the latest write body, the provisional sortie, the pre-image for a revise, and the time the command was authored.
- The address book and phone stars, the last activity snapshot, the tariff, and the availability choice.
- The active guidance snapshot: sortie id, driving route, leg index, and meter, while guidance is active.
- Unsent location observations, capped, and the latest unsent meter reading.

The session token and the cached user profile stay in secure storage beside each other. Sign-out deletes the SQLite rows for that user and the cached profile. A cache stored for a different user is deleted before it is shown.

On the server, a location observation may store the client id, unique for that driver.

---

# 8. Realtime

The socket still closes when the server cannot be reached and still reconnects as slice 008 defines. A pending command is not a realtime envelope. After replay, the client reads activity and the calendar. An activity read that fails keeps the stored snapshot. Envelopes that arrive after that snapshot still apply by `recordedAt`, as slice 008 defines.

---

# 9. Acceptance criteria

The slice works when all of the following are true on the local stack:

1. A stored session opens the signed-in shell when `GET /me` cannot be reached, shows the cached profile, and retries. An unauthorized response clears the token and the local caches and returns to sign-in.
2. After a restart with no server, the calendar, address book, activity strip, tariff, and availability choice show the last successful read for that user. A calendar period outside the stored range shows no server sorties. A period that was never fetched says the calendar could not be loaded, and still shows a pending sortie whose provisional window falls on the visible days.
3. Author, revise, and drag while the server cannot be reached update the grid immediately and survive a restart. A drag, or a revise that keeps the stops, shifts the existing window by the arrival delta. A new sortie, or a revise that changes stops, uses a straight-line estimate at a fixed speed plus the authored waits, with the same leave-now and authored-arrival shapes as the server. With no device fix and no previous open place, the edit is not stored and the screen says location is required.
4. When the link returns, observations are sent before sortie commands. Replaying a create with the same client id does not insert a second sortie or a second `sortie.created`. Replaying an identical revise appends no second `sortie.revised`. The server response replaces the provisional window. A follow-up calendar read does not drop a command that is still pending.
5. A rejected create is removed. A rejected revise restores the pre-image. The screen says the sortie was not saved, or that location is required. A dragged block returns to the last accepted time.
6. A routing failure or an unreachable server leaves the command queued. A second offline edit of the same sortie replaces the pending body.
7. Guide is disabled on a sortie the server has not accepted. An already loaded guided trip is restored after the process is killed and keeps following GPS. The latest meter reading and unsent observations are sent when the link returns. A repeated observation id does not recompute a window.
8. A wait extension the server does not accept restores the previous wait. A complete or a next leg that cannot be sent leaves the trip in place and says so.
9. Sign-out clears the local caches for that session. The flow runs with `pnpm dev:server` and `pnpm dev:mobile`.

---

# 10. Remains unimplemented

- Offline map tiles, lane guidance, and a driving route calculated on the device
- Commencing a sortie while the server cannot be reached
- Extending a wait while the server cannot be reached
- Field-by-field merge with another device
- Authoring a stop that only the routing provider can suggest, while that provider cannot be reached
