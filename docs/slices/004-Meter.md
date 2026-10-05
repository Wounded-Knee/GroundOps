# Slice 004 — Meter

## Status

**Previous slice**

**Derived from:** Development Methodology (`docs/02-development-methodology.md`) section 6, the driver interaction model and cost estimation in Architectural Specification (`docs/01-architecture..md`) sections 8, 11, and 23.2, the cost estimate and sortie in `docs/03-domain-model.md`, the routing and navigation boundaries in Technical Architecture (`docs/04-technical-architecture.md`) section 8, and slices 002 and 003.

**Purpose:** A signed-in driver can open guidance for a sortie they authored, and while that guidance runs see a programmable fare reading application-wide above the bottom bar.

This document is the implementation boundary. The platform object is a **cost estimate** for the sortie being guided. There is no taxi entity, no `TaxiMeter` type, and no company pricing system. The general fare model in the architectural specification stays open. This slice stores one programmable **tariff** on the driver. Company-wide pricing stays out. Responsibility, acceptance, commencement, and completion stay outside this slice. Search guidance from slice 002 stays as it is. Meter wait is fare time while stationary during guidance. Authored dwell on a stop for the calendar schedule is slice 005.

---

# 1. User capability

After this slice, a person who is signed in, as slice 001 defines, and who has a driver and authored sorties, as slice 003 defines, can:

1. On iOS or Android, open a sortie they authored and start guidance for its stops. The map and guidance chrome from slice 002 present that route.
2. While that guidance is in use, see a meter panel about one quarter of the screen height directly above the bottom bar on every signed-in screen. On Navigation the panel overlays the map; on Calendar, Settings, and New Sortie it sits in the column above the bottom bar. The panel shows Estimated (full trip miles, trip duration, and trip fare estimate) on the left, the running fare large in the center, and Actual (miles traveled, wait minutes, and fare so far) on the right with right-aligned text. Below that, a thin bar fills with proximity to the next turn, and a 1em bar fills with proximity to the destination (remaining versus the baseline when the current route was set). Neither bar carries text.
3. Tap that panel to swap its contents for an End Sortie action. Tap the panel again to restore the meter reading. End Sortie ends guidance and clears the meter.
4. On every platform, open Settings, see the driver's tariff — flag drop, dollars per mile, and dollars per wait minute — and save new rates. Those rates program the meter.
5. Sign out, so that session can no longer be used, as slice 001 defines.

Search that authors a destination sortie and starts guidance uses the same meter. Before Start, the map route preview shows the same trip estimate from the tariff snapshot and the route distance. A route that is not a sortie does not show the meter. Web still has no driving guidance, so it has no Guide action and no meter panel. The tariff fields are editable on web.

Starting guidance is not responsibility, acceptance, or completion. Sealing the calendar’s actual departure when Guide starts is slice 005.

---

# 2. Actors

One actor: a person who is signed in on the local development client and who has a driver from slice 003.

This slice does not create a second driver model. Opening Settings ensures a driver the same way the calendar does when the person has none yet.

---

# 3. Development mode

This slice is demonstrable on the existing local stack:

- `pnpm dev:server`
- `pnpm dev:mobile`

The API uses host PostgreSQL. The client JavaScript is the Expo development server the app already uses.

Guide and the meter panel run on iOS and Android in the local development build from slice 002. Tariff editing on Settings runs on web, iOS, and Android. This slice adds no EAS build, no store build, and no deployed environment. Place suggestions, driving routes, and schedule drive times continue to use the Google keys slice 002 already requires. `.env.example` is unchanged.

---

# 4. Guidance for the sortie

The calendar summary gains a Guide action on iOS and Android. Guide needs a location fix. It asks the server for one driving route from that fix through the sortie's stops in order, then opens Navigation and starts guidance. There is no preview step.

The route reuses slice 002's driving-route result and the existing guidance screen. A later slice that navigates a sortie was already expected to reuse that screen and that route result. The server already sends intermediate stops when it computes drive duration for a sortie window. This slice uses that capability for geometry too. `POST /driving-routes` stays origin-plus-destination for search guidance.

A new `POST /sorties/:id/driving-route` takes the session token, an origin coordinate, and the position of the first stop still ahead. The server loads a sortie that driver authored, uses the stored stops from that position through the last stop, and returns one driving route. A missing sortie, or a sortie another driver authored, is rejected. The position must be a stop index on that sortie. Otherwise the request is rejected.

A stop is reached when the device is within 40 meters of it, the same arrival distance as slice 002. Reached stops drop out of the remaining route. Reroute calls the same endpoint with the first stop still ahead. Arrival, speech, step advance, and the off-route rule stay as slice 002 defines them. The trip arrives only at the final stop. Reaching a pickup or a waypoint does not end guidance and does not stop the meter.

Leaving Navigation for Calendar, Settings, or New Sortie does not end guidance. The map stays mounted under those screens, as the signed-in shell already does. Ending guidance, or signing out, clears the route and stops the meter.

---

# 5. Domain objects

## 5.1 Tariff

A **tariff** is the driver's programmable rate card for the meter: flag drop, dollars per mile, and dollars per wait minute.

It is not company configuration and not a pricing engine. One driver has one tariff. The general platform fare model remains an open decision.

## 5.2 Cost estimate

A **cost estimate** is the amount shown for the guided sortie, as `docs/03-domain-model.md` defines. This slice computes it from the tariff snapshot and the meter reading. It is a displayed inference. It is not stored on the sortie and is not a routing provider's native fare object.

## 5.3 Meter reading

A **meter reading** is the live display while sortie guidance is in use: miles traveled, wait time, the charges from the tariff snapshot, miles remaining, the cumulative total, and the trip estimate.

It is not an operational entity and is not persisted.

## 5.4 Sortie driving route

A **sortie driving route** is one driving route, as slice 002 defines, from the device to the remaining stops of an authored sortie. The stops come from the sortie. The path, steps, distance, and duration are the same kind of result search guidance already uses.

---

# 6. State transitions

| From | To | What happens |
| --- | --- | --- |
| Sortie summary | Guiding a sortie | The person taps Guide with a location fix. The server returns a driving route through the remaining stops. Navigation opens in guidance. The meter starts with a tariff snapshot. |
| Guiding a sortie | Guiding a sortie | A stop short of the destination is reached and drops out, the current step advances, or a reroute replaces the route with the same first stop still ahead. The meter keeps its snapshot and its miles and wait. |
| Guiding a sortie | Arrived | The device is within 40 meters of the final stop. The meter keeps running until the person ends guidance. |
| Guiding or arrived | Map | The person ends guidance. The route leaves the map. The meter panel disappears. |
| No tariff saved | Tariff saved | The person saves valid rates on Settings. The server replaces that driver's tariff. |
| Signed in | Signed out | The server revokes the session, as slice 001 defines. Guidance and the meter end. |

No duty, availability, responsibility, commencement, or completion state changes.

A missing location fix, a rejected route, or a route the provider will not compute does not start guidance and does not start the meter. An empty or invalid tariff field refuses the save and leaves the previous tariff unchanged.

---

# 7. Interfaces

**Summary.** On iOS and Android, the calendar summary of a sortie the person authored shows Guide beside Revise. Guide starts guidance as section 4 says. On web, Guide is not shown.

**Guiding a sortie.** The maneuver card from slice 002 remains. End guidance is on the meter panel (End Sortie). The bottom guidance bar with remaining time, distance, arrival, End, and Mute is not shown while the meter is in use. The meter panel appears above the bottom bar, overlaying the map on Navigation.

**Meter panel.** While sortie guidance is in use, a panel about one quarter of the screen height sits directly above the bottom bar on Navigation, Calendar, Settings, and New Sortie. On Navigation the panel overlays the map so the map stays full-bleed under it; on Calendar, Settings, and New Sortie the panel reserves space in the column above the bottom bar. The content band has three columns: Estimated (heading, then Miles, Time, and Fare as smaller rows — full trip miles as traveled plus remaining, the active route's trip duration, and the trip fare estimate), a centered bold running fare sized to the content height, and Actual (heading, then Miles, Time, and Fare — miles traveled to one decimal, wait as whole minutes, and the cumulative total), with Actual text right-aligned. Below the content band, a bar about 0.5em high fills with proximity to the end of the current guidance step (remaining distance to that step's end versus the step's distance). Under that, a bar about 1em high fills with proximity along the active route: empty when remaining equals the baseline snapshotted when that route was set (start or successful reroute), full when remaining is 0. If remaining grows above the baseline before a reroute, fill stays empty. Neither progress bar shows text. Tapping the panel swaps all of its contents for End Sortie; tapping again restores the meter reading. End Sortie ends guidance.

**Settings.** On every platform, Settings shows the three tariff fields — flag drop, dollars per mile, and dollars per wait minute — above Sign out. Opening Settings ensures a driver, then reads that driver's tariff. The fields are editable money amounts. One action: save. Sign out stays below the tariff.

The person sees a failure in these cases:

- Guide is tapped without a location fix. The summary stays open and the screen says that location is required. Guidance does not start.
- The sortie route request fails, or the network is unreachable. The summary stays open and the screen says that the route failed. Guidance does not start.
- The tariff cannot be read when guidance starts. Guidance still runs. The panel still shows miles and wait. The fare reads that it could not be calculated.
- Settings cannot ensure a driver or read the tariff. The screen says the tariff could not be loaded. The fields are not editable until a later successful read.
- An empty or invalid tariff field is saved. The screen says the tariff was not saved. The previous tariff stays.
- A tariff save fails because the network or server is unreachable. The screen says the tariff was not saved. The previous tariff stays.
- Sign-out fails because the network or server is unreachable. The person stays signed in and the screen says that sign-out failed, as slice 001 defines.

---

# 8. Backend

Commands and queries are HTTP JSON. Zod validates input at the boundary. Domain checks live in `apps/server`. Shared wire types live in `packages/contracts`. Place suggestions and search driving routes remain as slice 002 defines them. Calendar operations remain as slice 003 defines them.

| Operation | Request | Result |
| --- | --- | --- |
| Ensure driver | `POST /drivers/current` with the session token | The driver for that user, as slice 003 defines. Settings uses this when the user has no driver yet |
| Read tariff | `GET /fare-rates` with the session token | The driver's tariff. Creates the default row when none exists. Rejection when the user has no driver |
| Replace tariff | `PUT /fare-rates` with the session token and the three amounts | The saved tariff. Rejection when the user has no driver, or a field is missing, negative, or not money to the cent |
| Compute a sortie driving route | `POST /sorties/:id/driving-route` with the session token, an origin coordinate, and the position of the first stop still ahead | One driving route through the stored stops from that position through the last stop. Rejection when the sortie is missing, another driver authored it, the position is not a stop on that sortie, no driving route exists, or the provider call fails |

A tariff amount in the request and response is US dollars to the cent. The wire form may be a number of dollars with at most two decimal places, or integer cents; the contracts package picks one and both ends use it. Stored values are integer cents.

The authorization rules in this slice: a session may ensure its own driver, read and replace that driver's tariff, and request a driving route for a sortie that driver authored. A missing, unknown, or revoked token is rejected. There is no company check beyond the company of record already on the sortie. There is no second credential and no policy engine.

---

# 9. Persistence

Drizzle owns the schema and the migration. One new table:

**driver tariff** — driver id, flag cents, per-mile cents, per-wait-minute cents. Unique on driver id. Money is integer cents. Defaults when the row is first created: flag 300, per mile 250, per wait minute 40.

Primary keys follow the existing pattern. The driver id references the driver from slice 003.

No meter-reading table. No cost column on the sortie. No operational event for a tariff change, for starting guidance, or for the live reading. The reading is not rebuilt from history.

---

# 10. Realtime

The client still opens the authenticated socket from slice 001 after sign-in, and closes it on sign-out. This slice publishes no domain events on the bus, so an authenticated socket still receives no operational traffic from these operations.

Guidance, the meter, and tariff reads and writes are HTTP or local. A second open session for the same user sees a tariff change when it reads Settings again.

---

# 11. Acceptance criteria

The slice works when all of the following are true on the local stack:

1. On iOS or Android, a signed-in driver can open a sortie they authored and tap Guide. With a location fix, Navigation opens in guidance for a route from that fix through the sortie's stops.
2. Reaching a stop short of the destination continues guidance toward the remaining stops. Within 40 meters of the final stop, the screen shows arrival.
3. While sortie guidance is in use, a meter panel about one quarter of the screen height appears directly above the bottom bar on Navigation, Calendar, Settings, and New Sortie — overlaying the map on Navigation and reserving column space on the other screens — showing Estimated (full trip miles, trip duration, trip fare estimate), a large centered running fare, and Actual (miles traveled, wait minutes, fare so far, right-aligned), with a thin next-turn progress bar and a 1em destination progress bar (remaining versus the route baseline) and no text on either bar.
4. Tapping the panel swaps its contents for End Sortie; tapping again restores the meter. End Sortie ends guidance and removes the panel.
5. Ending guidance clears the route and removes the panel. Sign-out does the same.
6. Starting guidance for a destination authored from search shows the meter. A route that is not a sortie does not.
7. On every platform, Settings shows flag drop, dollars per mile, and dollars per wait minute. Saving valid rates persists them. Reloading Settings, and opening Settings on a second session for the same user, shows the saved rates. Defaults are $3.00, $2.50, and $0.40 when none were saved.
8. An empty or invalid tariff field does not save. Zero is allowed. Amounts are non-negative and at most two decimal places.
9. A meter started under one tariff keeps that snapshot when Settings later saves different rates. The next Guide uses the new rates.
10. Miles traveled and miles remaining are road distance along the active route polyline (GPS projected onto the path). Miles increase only with forward progress along that path; off-route displacement does not add miles until a reroute. Wait accumulates while the GPS position is stationary (displacement at or below 5 meters, or below 2 m/s from successive fixes). The one-second wait ticker keeps wait advancing at least once per second while stopped — including when GPS is silent before a second fix, or after enough silence following movement that the vehicle must have stopped — and does not bill ordinary driving GPS gaps as wait. Device-reported speed is not used. A fix worse than 50 meters accuracy does not change the reading. Miles traveled do not reset on reroute. After a successful reroute or next-stop route, remaining and the progress baseline come from the replacement route so the progress bar is proximity: 1 − remaining / baseline.
11. Guide without a location fix, or with a failed route, does not start guidance and does not show the panel.
12. A missing, unknown, or revoked session is rejected on every endpoint in section 8. A session cannot request a route for another driver's sortie, and cannot read or replace another driver's tariff.
13. On web, Settings still edits the tariff. Guide is not shown. The meter panel does not appear.
14. Nothing about the live meter reading is in PostgreSQL after guidance ends. The driver tariff row remains.
15. The flow runs with `pnpm dev:server` and `pnpm dev:mobile` on web, and with the local development build on iOS and Android. No EAS build and no store build are required.

---

# 12. Remains unimplemented

- Responsibility and acceptance
- Offers, assignment, commencement, and completion
- Cancellation
- Duty, availability, dispatch shifts, duty shifts, and vehicle assignment
- Company-wide pricing, and the unresolved platform fare model beyond this driver's tariff
- Storing the meter reading or a cost on the sortie
- Operational events for tariff changes, guidance, or the reading
- A meter on a route that is not a sortie
- Guiding a single stop on its own, separate from the full sortie
- Background location, and stopping GPS reports while off duty
- Roles
