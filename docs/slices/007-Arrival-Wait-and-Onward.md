# Slice 007 — Arrival Wait and Onward Destination

## Status

**CURRENT SLICE**

**Previous slice:** 006 — Sortie Actuals and Completion

**Derived from:** Development Methodology (`docs/02-development-methodology.md`) section 6, schedule adherence and driver interaction in Architectural Specification (`docs/01-architecture..md`) sections 8, 11, and 12, the sortie and driver calendar in `docs/03-domain-model.md`, and slices 004–006.

**Purpose:** While guiding a commenced sortie, arrival at the current stop (GPS or manual Arrived) starts an authored-wait countdown on the meter; +1 Minute extends that wait and the schedule; countdown expiry auto-extends the same way rather than advancing; the next leg starts only on GPS leave or Commence. At the final stop the meter pauses with a flashing fare and Onward Destination opens revise with a new stop focused.

This document is the implementation boundary. Wait ceilings, schedule conflict warnings, auto-complete from GPS, and persisted meter fare totals stay outside.

---

# 1. User capability

After this slice, a person who is signed in, as slice 001 defines, and who has a driver and authored sorties, as slices 003–006 define, can:

1. On iOS or Android, while guiding a sortie, have arrival at the current stop detected within about 40 meters (same geofence as guidance), or tap **Arrived** on the meter actions side when GPS failed.
2. On arrival, see a countdown from that stop’s authored `waitMinutes`. Tap **+1 Minute** to add one minute to the live countdown and to that stop’s `waitMinutes`, recomputing the calendar schedule. When the countdown reaches zero, the same +1 Minute action runs automatically; guidance does not auto-continue.
3. Start the next leg only by leaving the stop geofence (GPS progress) or tapping **Commence** on the meter.
4. At the final stop, see the meter pause with a flashing fare and an **Onward Destination** control that opens the revise dialog with a new blank stop fieldset added and focused.
5. After saving an onward stop, keep the meter paused until GPS leave or **Commence** starts guidance toward that stop.
6. Sign out, so that session can no longer be used, as slice 001 defines.

Web still has no Guide or meter. Wait editing on the sortie dialog remains as earlier slices define.

---

# 2. Actors

One actor: a person who is signed in on the local development client and who has a driver from slice 003.

---

# 3. Development mode

This slice is demonstrable on the existing local stack:

- `pnpm dev:server`
- `pnpm dev:mobile`

Guide, arrival dwell, meter actions, and Onward Destination run on iOS and Android in the local development build. This slice adds no EAS build, no store build, and no deployed environment.

---

# 4. Arrival and dwell

A stop is reached when the device is within 40 meters of it, or when the driver taps Arrived. Reaching a stop no longer auto-requests the next driving route.

On arrival the client enters dwell at that stop position, asserts arrival on the server when that stop has no `actualArrivedAt`, and starts `waitEndsAt` from now plus authored `waitMinutes`. When authored wait is zero, the first dwell tick immediately runs +1 Minute so a live minute is always present unless the driver leaves first.

While dwelling, whenever now is at or past `waitEndsAt`, the client runs the same extend-wait path as +1 Minute. Concurrent extend requests are debounced while one is in flight.

Meter fare-wait while stationary (slice 004) remains distinct from stop `waitMinutes`. At the final stop the meter is paused (no mile or fare-wait accrual) and the displayed fare flashes.

---

# 5. Next leg

At an intermediate stop after arrival, and after Onward Destination has added a later stop (`pendingNextLeg`):

- **GPS progress:** a fix outside the arrival geofence requests a driving route for the next stop position and resumes guiding with the meter unpaused per the passenger flag.
- **Commence:** the same route start without waiting to leave the geofence.

Server departure inference from slice 006 continues via location observations.

End Sortie still completes the sortie as slice 006 defines. GPS alone never completes.

---

# 6. Onward Destination

Onward Destination opens the revise dialog for the active sortie with a trailing blank stop and that address field focused. Saving uses the existing revise write. While the sortie is in progress (`actualStart` set, `actualEnd` null), revise preserves `actualStart` and actual timestamps on unchanged prefix stops; new trailing stops have null actuals. Revising when the sortie is not in progress still clears all actual timestamps as slice 006 defines.

After a successful onward save during guidance, the client updates stops, sets `pendingNextLeg`, keeps the meter paused, and does not start routing until GPS leave or Commence.

---

# 7. Domain objects

## 7.1 Stop wait extension

**Extend wait** is a driver assertion that adds one minute to a stop’s authored `waitMinutes` and refreshes the cached schedule end.

## 7.2 Asserted arrival

**Assert arrive** is a driver assertion that seals `actualArrivedAt` on a stop when GPS inference has not. It is idempotent when arrival is already sealed.

## 7.3 Dwell and pending next leg

**Dwell** and **pending next leg** are client inferences while guidance is active. They are not persisted as separate entities.

---

# 8. State transitions

| From | To | What happens |
| --- | --- | --- |
| Guiding | At stop (dwell) | GPS or Arrived; optional assert-arrive; wait countdown starts |
| Dwell | Dwell | Countdown zero or +1 Minute → extend-wait |
| Dwell (intermediate) | Guiding | GPS leave or Commence → next-stop route |
| Dwell (final) | Final paused | Meter paused, fare flashes, Onward Destination |
| Final paused | Onward paused | Revise adds stop; meter stays paused |
| Onward paused | Guiding | GPS leave or Commence → new stop route |
| Guiding / dwell / paused | Browse | End Sortie → complete |

---

# 9. Interfaces

**Meter actions (obverse).** While guiding and not yet dwelling: Arrived and End Sortie.

**Meter face.** While dwelling: countdown and +1 Minute; Commence when a later stop exists. At final paused: flashing fare and Onward Destination (countdown/+1 still apply). When pending next leg: Commence and End Sortie.

**Sortie dialog.** Onward Destination opens revise with an appended blank stop focused.

---

# 10. Backend

| Operation | Request | Result |
| --- | --- | --- |
| Assert arrive | `POST /sorties/:id/stops/:position/arrive` | Sortie with that stop’s `actualArrivedAt` sealed. Idempotent if already set |
| Extend wait | `POST /sorties/:id/stops/:position/extend-wait` | Sortie with `waitMinutes` incremented and schedule recomputed |
| Revise (in progress) | Existing `PATCH /sorties/:id` | Preserves `actualStart` and prefix stop actuals when `actualEnd` is null |

Authorization matches slice 003: only the authoring driver.

---

# 11. Persistence

No new tables. Stop `wait_minutes` and actual timestamps remain on `sortie_stop`. Schedule fields remain on `sortie`.

Operational events may record asserted arrival when distinct from inference; extend-wait refreshes schedule without requiring a new event type beyond existing revise/schedule patterns if the implementation appends none.

---

# 12. Realtime

This slice publishes no domain events on the bus. A second session sees wait and actual changes on its next calendar read.

---

# 13. Acceptance criteria

1. GPS or Arrived enters dwell; intermediate stops do not auto-advance the route on enter, including when `waitMinutes` is 0.
2. +1 Minute and countdown-zero both increment `waitMinutes` and recompute the schedule; neither starts the next leg.
3. Intermediate next leg starts only on GPS leave or Commence.
4. Final arrival pauses the meter, flashes the fare, and shows Onward Destination.
5. Onward revise opens with a new blank stop focused; after save the meter stays paused until GPS leave or Commence.
6. In-progress revise preserves `actualStart` and unchanged prefix stop actuals; revise when not in progress clears actuals.
7. Assert arrive is idempotent; End Sortie still completes as slice 006.
8. The flow runs with `pnpm dev:server` and `pnpm dev:mobile` on web (dialog/calendar), and with the local development build on iOS and Android (guidance and meter).

---

# 14. Remains unimplemented

- Wait ceilings and usable schedule margin UX
- Schedule conflict warnings
- Responsibility and acceptance
- Auto-complete from GPS
- Persisted meter fare totals
- Causal attribution / adherence analytics UI
- Server push “please complete” notifications
