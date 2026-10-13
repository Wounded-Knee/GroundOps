# Slice 010 — Availability

## Status

**Previous slice:** 009 — Platform Directory

**Derived from:** Driver availability in `docs/03-domain-model.md` and `docs/01-architecture..md` section 15.

**Purpose:** A driver can set whether they are willing to receive dispatch work. The signed-in client keeps that choice reachable. The platform treats a driver as unavailable when no client has checked in for more than five minutes.

This document is the implementation boundary. Duty, offers, assignment, a list of who is available, and a background task that pings while the app is suspended stay outside.

---

# 1. User capability

After this slice, a signed-in driver can:

1. Tap a yellow bar on every signed-in screen to become available or not. That tap is the driver's choice. The default is not available. The driver does not tap again to remain available.
2. Stay treated as available while this app checks in. The client sends a check-in immediately and then every three minutes while the choice is available. After more than five minutes without a check-in, the platform treats the driver as unavailable. The stored choice stays available. The next check-in treats them as available again.
3. See that bar update on a second signed-in device for the same driver. That device can send the check-in.

No screen lists other drivers.

---

# 2. Actors

One actor: a signed-in driver. Opening availability creates the driver, company, and relationship when they do not exist yet, the same way the calendar does.

---

# 3. Domain objects

## 3.1 Availability

`available` is the driver's choice. In this slice it changes only when the driver taps. Slice 011 also writes it from the driver's availability settings. A missed check-in does not clear it.

`availability_checked_at` is the last time a client checked in while that choice was available. It is null when the driver is not available.

The platform treats the driver as available now only when `available` is true and the check-in is at most five minutes old. At exactly five minutes they are still treated as available. The check-in time stays so the lapse remains visible.

## 3.2 Availability event

An append-only row records a change of the choice, the first observation of a lapse, or a check-in that restores reachability after a lapse. `available` on the row is the choice. `current` is whether the platform treats them as available. A check-in that only moves the timestamp writes no row.

---

# 4. State transitions

- Not available, then the driver sets available: the choice is true, the check-in time is now, and `current` is true.
- Available, then the driver sets not available: the choice is false, the check-in time is cleared, and `current` is false.
- The same choice again: no write and no publish.
- A check-in while the choice is false: no write.
- A check-in while the choice is true and the driver is already current: the timestamp moves, with no event and no publish.
- More than five minutes after the check-in: one event with the choice still true and `current` false, and one publish. A later pass does not write that lapse again.
- A check-in after that lapse: the timestamp moves, one event records both true, and one publish restores `current`.

---

# 5. Interfaces

`AppWideStatus` is on every signed-in screen. It does not own the data it shows.

On Navigation, while the map is the visible surface, it overlays the bottom of the map. On Calendar, Settings, Directory, and while the sortie dialog covers the map, it sits in the column directly above the bottom menu.

From top to bottom: the meter, only while a meter reading exists; the turn progress bar and the trip progress bar, in that same case; then `AvailabilityStatus`, always. The turn bar stays the thinner one. The trip bar stays the taller one. Meter actions stay on the meter.

`AvailabilityStatus` is a full-width bar. When `current` is false the label is "Not available", yellow `#F5C400` on black. When `current` is true the label is "Available", black on yellow `#F5C400`.

A tap sends the opposite choice. Further taps wait until that request settles. The color follows `current`. A failed save leaves the previous color and shows the failure on the bar. A rejected session follows the existing sign-out path.

While the choice is available, the signed-in shell checks in immediately and every three minutes, including when `current` is false. Sign-out, a rejected session, and a tap that clears the choice stop that timer. A suspended client that cannot run the timer is treated as unavailable after five minutes, and checks in again when it can reach the server.

There is no new bottom-bar destination.

---

# 6. Backend

Commands are HTTP JSON. Zod validates input at the boundary. Domain checks live in `apps/server`. Shared wire types live in `packages/contracts`.

| Operation | Request | Result |
| --- | --- | --- |
| Read availability | `GET /availability` | `{ asOf, available, current }` for the caller |
| Set availability | `PUT /availability` with `{ available }` | The same shape |
| Check in | `POST /availability/check-in` | The same shape |

`GET` creates the driver when needed and records a lapse when the check-in is stale. `PUT` sets only the caller's choice. True sets the check-in time to now. False clears it. `POST` refreshes the check-in time when the choice is already true, including after a lapse. It does not set the choice to true.

A missing or revoked session is 401. An invalid body is 400.

`recordAvailabilityLapse(now)` runs at the start of these operations and from a one-minute interval started with the server. It does not change `available`. Tests pass `now`. The interval is not started by importing the module. A stale check-in is recorded once.

---

# 7. Persistence

Drizzle owns the schema and the migration. This slice adds `available` and `availability_checked_at` on **driver**, and **driver availability event**: id, driver id, available, current, recorded time.

Primary keys are server-generated UUIDs. Timestamps are `timestamptz` in UTC.

A user delete removes these event rows with the driver. A toggle does not make the user in use.

---

# 8. Realtime

`availability.updated` carries `userId`, `recordedAt`, `available`, and `current`. The gateway delivers it only to that user's open sockets. A routine check-in publishes nothing. A lapse, a restoring check-in, and a tap that changes the choice publish after commit.

The client does not apply this envelope to account activity. The signed-in shell hands it to the bar. The bar applies it only when `recordedAt` is after the last read's `asOf`. Catch-up after a dropped socket is `GET /availability` again.

---

# 9. Acceptance criteria

The slice works when all of the following are true:

1. A new driver is not available. After they set available, a read returns that choice and `current` true.
2. Setting the same choice writes no event and publishes nothing. A check-in while already current refreshes the timestamp only. A check-in when the choice is false changes nothing.
3. A check-in older than five minutes yields `current` false once, leaves the choice available, and publishes once. A later check-in sets `current` true without a new tap. A check-in at exactly five minutes stays current.
4. A missing or invalid session is rejected. A bad body is rejected. One driver cannot set another's choice. A second session does not receive the other driver's flag.
5. The envelope reaches only sockets for that user. Account activity does not advance because of it.
6. The yellow bar overlays the map and sits above the bottom menu on Calendar and Settings. It dims and brightens with `current`.
7. Deleting a user who only toggled availability removes that driver.

---

# 10. Remains unimplemented

- Duty, and who controls it
- Offers, assignment, and candidate selection
- A list of drivers who are available
- A background task that checks in while the app is suspended
