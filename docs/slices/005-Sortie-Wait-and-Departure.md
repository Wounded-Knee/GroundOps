# Slice 005 — Sortie Wait and Departure

## Status

**CURRENT SLICE**

**Previous slice:** 004 — Meter

**Derived from:** Development Methodology (`docs/02-development-methodology.md`) section 6, sorties and schedule adherence in Architectural Specification (`docs/01-architecture..md`) sections 4, 9, 10, and 14, the sortie and driver calendar in `docs/03-domain-model.md`, and slices 002, 003, and 004.

**Purpose:** A signed-in driver can set wait time on each stop of an authored sortie so the cached schedule includes dwell; starting Guide seals the actual departure on that sortie; between sorties, Navigation shows a countdown to the next departure and alerts at five, one, and zero minutes when the app is not in focus.

This document is the implementation boundary. Schedule wait on a stop is not the meter’s fare wait from slice 004. Responsibility, acceptance, and completion stay outside this slice. GPS-inferred arrival and departure stay outside. Wait ceilings and schedule conflict warnings stay outside.

---

# 1. User capability

After this slice, a person who is signed in, as slice 001 defines, and who has a driver and authored sorties, as slice 003 defines, can:

1. When authoring or revising a sortie, set a wait in whole minutes on each stop in the ordered list. The default is zero. The server includes those waits in the cached scheduled end and in the departure time used for the onward drive.
2. On iOS or Android, tap Guide (or start guidance from Where to?) and have the server record the actual departure as now. The calendar draws that sortie from the actual departure when present, otherwise from the estimated scheduled start. The estimated scheduled start remains stored.
3. On iOS or Android, while Navigation is in browse (not preview, guidance, or arrival), see a countdown to the next future departure among their authored sorties that have not yet commenced, with the label of the first stop of that approach. When there is no such departure, the countdown is hidden.
4. When the app is not in focus, receive local alerts at five minutes, one minute, and zero minutes before that next departure. When the app is in focus, those alerts do not fire.
5. Sign out, so that session can no longer be used, as slice 001 defines.

Web still has no Guide and no departure countdown or alerts. Wait editing on the sortie dialog works on every platform.

---

# 2. Actors

One actor: a person who is signed in on the local development client and who has a driver from slice 003.

---

# 3. Development mode

This slice is demonstrable on the existing local stack:

- `pnpm dev:server`
- `pnpm dev:mobile`

The API uses host PostgreSQL. The client JavaScript is the Expo development server the app already uses.

Guide, commence, the countdown, and local departure alerts run on iOS and Android in the local development build from slice 002. This slice adds `expo-notifications` to that client. Wait editing on the sortie dialog runs on web, iOS, and Android. This slice adds no EAS build, no store build, and no deployed environment. Drive times continue to use the Google keys slice 002 already requires. `.env.example` is unchanged.

---

# 4. Authoring situations

A sortie may be planned in advance (authored arrival) or created and commenced immediately (no arrival / Leave now).

- **At passenger pickup.** The first stop is the present location (seeded from GPS when authoring). The passenger flag on that stop is on, so when guidance starts the meter accrues immediately.
- **From a distance.** The first stop is the first approach address in the definition. The passenger flag on that stop is off, so the meter does not accrue on the first leg. Later stops may have passenger on.

The author dialog uses ordered stop fieldsets: passenger toggle, address, and wait. A `+` control adds stops. Create seeds the first address from the device GPS when available.

---

# 5. Wait on stops

Each stop carries `waitMinutes`: a non-negative integer. The author sets it. Zero means no dwell. Several stops may each have a wait so the schedule estimates how long the driver dwells before continuing.

The schedule window still uses the authored or computed arrival as today. Approach is to the first stop. When there are two or more stops, the traffic-aware onward call departs at arrival plus the wait on the first stop and runs through later stops to the last. The cached end is arrival, plus the wait on the first stop, plus the onward drive duration, plus the waits on every later stop on that sortie. When there is no onward drive, the end is arrival plus the wait on the only stop.

Meter wait from slice 004 is fare time while the vehicle is stationary during guidance on a passenger leg. It does not read or write stop `waitMinutes`.

---

# 6. Actual departure

The sortie keeps `scheduledStart` as the estimated leave time from schedule computation. It gains nullable `actualStart`.

When the driver starts Guide for that sortie on iOS or Android, after a successful driving-route response, the client calls `POST /sorties/:id/commence`. The server sets `actualStart` to now, refreshes `scheduledEnd` (an authored arrival stays; a computed arrival is recomputed as an immediate departure from now), appends `sortie.commenced`, and aligns following open sorties. A second commence is idempotent. Location-based schedule recompute skips a sortie that already has `actualStart`. Revising the sortie clears `actualStart` so the window is an estimate again.

Where to? that authors a one-stop passenger immediate sortie and starts guidance calls the same commence after the route succeeds.

Calendar month, week, and day draw each sortie from `actualStart` when present, otherwise `scheduledStart`, through `scheduledEnd`.

Starting guidance still is not responsibility, acceptance, or completion. This slice only seals the departure time used on the calendar and for the next-departure countdown.

---

# 7. Next-departure countdown

While Navigation is in browse and the person is signed in, the client loads upcoming authored sorties and picks the earliest sortie whose coalesced start (`actualStart` or else `scheduledStart`) is still in the future and that has no `actualStart`. The countdown shows remaining time until that departure and a short “Depart for {label}” line using the first stop’s label. The countdown ticks while browse is visible. It refreshes when the app returns to the foreground, after author, revise, or commence, and on a modest poll while browse is open.

When the app leaves the active state, the client schedules local notifications for five, one, and zero minutes before that departure for any of those marks still in the future. When the app becomes active again, those notifications are cancelled so a focused session does not receive the banners. Permission is requested when a future departure exists; if denied, the countdown still works and alerts do not. Alerts are device-local. The server does not push them.

Web does not show the countdown and does not schedule alerts.

---

# 8. Domain objects

## 8.1 Stop wait

**Wait minutes** on a stop is the authored dwell at that place for schedule calculation. It is not meter wait and not a wait ceiling.

## 8.2 Actual start

**Actual start** is the sealed departure instant when guidance commenced. Until then the calendar uses the estimated scheduled start. The estimate remains on the row.

## 8.3 Next departure

A **next departure** is a client inference: the earliest future uncommenced coalesced start among the driver’s authored sorties. It is not a persisted entity.

---

# 9. State transitions

| From | To | What happens |
| --- | --- | --- |
| Author or revise | Estimate on calendar | Stops may include wait minutes. The server recomputes the cached window including waits. Revise clears `actualStart`. |
| Sortie summary / Where to? | Guiding a sortie | Route succeeds, commence seals `actualStart`, guidance and meter start as slice 004. |
| Browse with a future departure | Browse countdown | Navigation shows remaining time until that departure. |
| App active with a future departure | App not in focus | Local alerts are scheduled for remaining T−5, T−1, and T−0 marks. |
| App not in focus | App active | Those scheduled alerts are cancelled. |
| Commenced | Estimate again | A revise clears `actualStart` and recomputes the window. |

---

# 10. Interfaces

**Sortie dialog.** Ordered stop fieldsets: passenger toggle, address, and wait minutes (default zero). Invalid (negative or non-integer) waits refuse the save. Create seeds the first stop from GPS when available.

**Summary.** Shows each stop with wait and whether the meter applies. Start row uses coalesced start.

**Guide / Where to?** After a successful route, commence runs before guidance. A failed commence leaves the summary (or browse) with a message and does not start guidance.

**Navigation browse.** Countdown chrome when a next departure exists. Hidden while preview, guidance, or arrival, and when none exists.

The person sees a failure in these cases:

- Commence fails after a good route. Guidance does not start. The screen says the departure could not be recorded.
- Notification permission is denied. Countdown still shows. Alerts do not fire.

---

# 11. Backend

| Operation | Request | Result |
| --- | --- | --- |
| Author / revise sortie | Existing write body; each stop includes `waitMinutes` and `passenger` | Sortie with waits, passenger flags, and coalesced fields. Rejection when wait is missing, negative, or not an integer, or passenger is missing |
| Commence sortie | `POST /sorties/:id/commence` with the session token | The sortie with `actualStart` set. Rejection when missing or not authored by this driver |
| Read calendar | Existing range query | Sorties include `waitMinutes` and `passenger` on stops and `actualStart` |

Authorization matches slice 003: a session may commence only a sortie that driver authored.

---

# 12. Persistence

Drizzle owns the schema and the migration.

- **sortie_stop** gains `wait_minutes` integer not null default 0, and later `passenger` boolean not null (roles removed).
- **sortie** gains `actual_start` timestamptz null.

Operational event `sortie.commenced` is appended on commence. Current state stays on the sortie row.

---

# 13. Realtime

This slice publishes no domain events on the bus. A second session sees commence and wait changes on its next calendar read.

---

# 14. Acceptance criteria

1. Authoring a sortie with wait minutes on stops extends the cached end by those waits and uses post-wait departure for the onward drive call.
2. Guide (and Where to? guidance) calls commence; the calendar then shows the actual departure when present.
3. A second commence does not change `actualStart`. Revise clears it.
4. GPS schedule recompute does not overwrite a commenced sortie.
5. On iOS or Android browse Navigation, a future uncommenced departure shows a ticking countdown; none hides it.
6. Leaving focus schedules T−5, T−1, and T−0 local alerts still in the future for that departure; returning to focus cancels them.
7. Web edits wait minutes and passenger flags; no Guide, countdown, or alerts.
8. Meter fare-wait while stationary remains distinct from stop `waitMinutes`; passenger-leg accrual is as slice 004.
9. The flow runs with `pnpm dev:server` and `pnpm dev:mobile` on web, and with the local development build on iOS and Android.

---

# 15. Remains unimplemented

- GPS-inferred actual arrival and departure
- Countdown to end-of-wait mid-sortie or to arrival
- Wait ceilings and usable schedule margin UX
- Schedule conflict warnings
- Responsibility, acceptance, and completion
- Server push notifications
