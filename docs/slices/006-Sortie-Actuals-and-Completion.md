# Slice 006 — Sortie Actuals and Completion

## Status

**Previous slice**

**Next slice:** 007 — Arrival Wait and Onward Destination

**Previous slice:** 005 — Sortie Wait and Departure

**Derived from:** Development Methodology (`docs/02-development-methodology.md`) section 6, schedule adherence and driver interaction in Architectural Specification (`docs/01-architecture..md`) sections 8, 9, and 14, the sortie and driver calendar in `docs/03-domain-model.md`, and slices 003–005.

**Purpose:** While a commenced sortie is in progress, the server infers actual arrival and departure at each stop from GPS observations and associates those fixes with the sortie; the driver explicitly completes the sortie (End Sortie), which seals `actualEnd`. The calendar draws each sortie from coalesced start through coalesced end (`actual` when present, otherwise scheduled).

This document is the implementation boundary. Responsibility and acceptance stay outside. Auto-complete from GPS stays outside. Meter fare totals are not persisted. Causal attribution analytics stay outside.

---

# 1. User capability

After this slice, a person who is signed in, as slice 001 defines, and who has a driver and authored sorties, as slices 003–005 define, can:

1. Commence a sortie as slice 005 defines, then drive while the device reports denser location observations associated with that sortie.
2. Have the server infer when the vehicle arrives at and leaves each stop (approximate times from GPS geofences). Authored `waitMinutes` remain schedule estimates; actual dwell is derived from inferred arrive and depart when both exist.
3. Tap End Sortie on iOS or Android and have the server seal `actualEnd` as now. Completion is never automatic from GPS.
4. See the calendar draw past and in-progress sorties using coalesced start and end. Future sorties without actuals still show the scheduled window.
5. Revise a sortie and clear all actual timestamps so the window is an estimate again.
6. Sign out, so that session can no longer be used, as slice 001 defines.

Web still has no Guide or End Sortie. Calendar coalesce of end times applies on every platform that reads the calendar.

---

# 2. Actors

One actor: a person who is signed in on the local development client and who has a driver from slice 003.

---

# 3. Development mode

This slice is demonstrable on the existing local stack:

- `pnpm dev:server`
- `pnpm dev:mobile`

The API uses host PostgreSQL. Guide, commence, denser GPS while in progress, and End Sortie → complete run on iOS and Android in the local development build. This slice adds no EAS build, no store build, and no deployed environment.

---

# 4. Scheduled vs actual

The sortie keeps scheduled fields as estimates: `arrivalAt`, `scheduledStart`, `scheduledEnd`, and stop `waitMinutes`.

Actuals:

| Fact | Source | Field |
| --- | --- | --- |
| Actual departure (commence) | Explicit Guide / Where to? start | `sortie.actualStart` (slice 005) |
| Actual arrival at a stop | GPS inference | `sortie_stop.actualArrivedAt` |
| Actual departure from a stop | GPS inference (or finalize on complete) | `sortie_stop.actualDepartedAt` |
| Actual end | Explicit End Sortie | `sortie.actualEnd` |

The platform does not claim an exact passenger-entry time. Inferred stop times are recorded as inferences (`sortie.stop_arrival_inferred`, `sortie.stop_departure_inferred`). Completion is an assertion (`sortie.completed`).

Calendar month, week, and day draw each sortie from `actualStart` when present, otherwise `scheduledStart`, through `actualEnd` when present, otherwise `scheduledEnd`.

---

# 5. GPS inference

After commence and before complete, location observations for that driver may be associated with the in-progress sortie (`location_observation.sortie_id`).

On each recorded observation, if the driver has exactly one in-progress sortie (`actualStart` set, `actualEnd` null):

1. The observation is stored with that `sortieId` (client may send it; server resolves when omitted).
2. Stops are considered in order. For the first stop still needing progress:
   - If it has no `actualArrivedAt` and the fix is inside a geofence of about 40 m (widened by reported accuracy), seal arrival at `observedAt` and append `sortie.stop_arrival_inferred`.
   - Else if it has arrival but no `actualDepartedAt` and the fix is outside the leave threshold, seal departure and append `sortie.stop_departure_inferred`.
3. Later stops are not considered until earlier stops have both arrival and departure.
4. Reaching the final stop does not set `actualEnd`.

While a sortie is in progress, the client reports denser fixes (about 25 m or 30 s) so dwell can be inferred. Idle reporting remains the coarser calendar sampling.

Derived wait for display: when both arrival and departure exist on a stop, actual wait minutes are the rounded dwell; otherwise the UI shows authored `waitMinutes`. Sortie-level actual arrival in the summary is the first stop’s `actualArrivedAt`.

---

# 6. Completion

When the driver ends a guiding sortie (End Sortie), after a successful complete response the client dismisses guidance and the meter.

`POST /sorties/:id/complete` requires that the driver authored the sortie and that `actualStart` is set. It sets `actualEnd` to now, appends `sortie.completed`, and if the current stop has arrival but no departure, seals departure at now. A second complete is idempotent. GPS alone never completes.

Revising the sortie clears `actualStart`, `actualEnd`, and all stop actual timestamps.

---

# 7. Domain objects

## 7.1 Actual end

**Actual end** is the sealed completion instant. Until then the calendar uses the estimated scheduled end.

## 7.2 Stop actual arrival and departure

**Actual arrived at** and **actual departed at** on a stop are inferred from GPS while the sortie is in progress. They are not authored. They are not passenger entry.

## 7.3 Observation association

A location observation may reference the in-progress sortie so movement during that sortie can be reconstructed.

---

# 8. State transitions

| From | To | What happens |
| --- | --- | --- |
| Commenced, en route | Stop arrived (inferred) | Geofence seals `actualArrivedAt`. |
| Stop arrived | Stop departed (inferred) | Leave geofence seals `actualDepartedAt`. |
| Guiding / arrived | Completed | End Sortie → complete seals `actualEnd`. |
| Any with actuals | Estimate again | Revise clears all actual timestamps. |

---

# 9. Interfaces

**Navigation / meter.** End Sortie calls complete for a sortie before clearing local guidance.

**Calendar.** Blocks use coalesced start and end. Summary shows first-stop actual arrival when present and actual wait when arrive and depart both exist.

**Location reporting.** While a commenced incomplete sortie is active, denser sampling and optional `sortieId` on the observation body.

---

# 10. Backend

| Operation | Request | Result |
| --- | --- | --- |
| Record observation | Existing body; optional `sortieId` | 204; may attach sortie and infer stop actuals |
| Complete sortie | `POST /sorties/:id/complete` | Sortie with `actualEnd` set |
| Read calendar | Existing range query | Sorties include actual end and stop actuals; range uses coalesced end |

Authorization matches slice 003: only the authoring driver.

---

# 11. Persistence

Drizzle owns the schema and the migration.

- **sortie** gains `actual_end` timestamptz null.
- **sortie_stop** gains `actual_arrived_at` and `actual_departed_at` timestamptz null.
- **location_observation** gains nullable `sortie_id` FK.

Operational events: `sortie.stop_arrival_inferred`, `sortie.stop_departure_inferred`, `sortie.completed`. Current state stays on the rows.

---

# 12. Realtime

This slice publishes no domain events on the bus. A second session sees actuals and completion on its next calendar read.

---

# 13. Acceptance criteria

1. After commence, observations inside then outside a stop geofence seal arrival then departure in order; later stops are not skipped ahead.
2. Arrival at the final stop does not set `actualEnd`.
3. End Sortie calls complete; the calendar then uses `actualEnd` when present.
4. A second complete does not change `actualEnd`. Complete finalizes an open stop departure when needed.
5. Revise clears `actualStart`, `actualEnd`, and stop actuals.
6. Calendar range and drawing use coalesced start and coalesced end.
7. Observations during an in-progress sortie store `sortie_id` when resolved.
8. The flow runs with `pnpm dev:server` and `pnpm dev:mobile` on web (calendar coalesce), and with the local development build on iOS and Android (inference and complete).

---

# 14. Remains unimplemented

- Countdown to end-of-wait mid-sortie or to arrival (slice 007)
- Wait ceilings and usable schedule margin UX
- Schedule conflict warnings
- Responsibility and acceptance
- Auto-complete from GPS
- Persisted meter fare totals
- Causal attribution / adherence analytics UI
- Server push “please complete” notifications

