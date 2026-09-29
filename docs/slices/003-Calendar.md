# Slice 003 — Calendar

## Status

**CURRENT SLICE**

**Derived from:** Development Methodology (`docs/02-development-methodology.md`) section 6, the driver calendar in Architectural Specification (`docs/01-architecture..md`) section 9, the driver, company, sortie, driver calendar, and operational event in `docs/03-domain-model.md`, and persistence and the live event path in Technical Architecture (`docs/04-technical-architecture.md`) sections 4 and 7.

**Purpose:** A signed-in person can open a calendar in month, week, or day, author a sortie onto it, revise that sortie, including by dragging it, and still read the last fetched calendar when the server cannot be reached.

This document is the implementation boundary. Responsibility, acceptance, and navigating a sortie stay outside this slice. The calendar is a view of sorties. A sortie stays a sortie. Slice 002's map and guidance stay as they are.

---

# 1. User capability

After this slice, a person who is signed in, as slice 001 defines, can:

1. Open a calendar and switch among month, week, and day.
2. Become a driver by opening that calendar, when they do not already have one.
3. Author a sortie from a dialog: a label, a start and end, an optional passenger name, an optional phone number, an origin, a destination, and any waypoints between those two.
4. Revise that sortie from the same dialog, or by dragging it so the scheduled start and end change.
5. See those sorties again after the app restarts, and on another session for the same user.
6. See the last fetched calendar range when the server cannot be reached.
7. Sign out, so that session can no longer be used, as slice 001 defines. Sign-out clears the local calendar cache.

On iOS and Android the calendar opens from the map. During guidance and arrival it stays unavailable. On web it opens from the signed-in screen.

Search and driving guidance from slice 002 stay as they are.

---

# 2. Actors

One actor: a person who is signed in on the local development client.

Opening the calendar makes that person a driver. This slice creates one company and one driver–company relationship for that driver. The person does not manage the company. They have no role, no duty state, and no availability flag.

---

# 3. Development mode

This slice is demonstrable on the existing local stack:

- `pnpm dev:server`
- `pnpm dev:mobile`

The API uses host PostgreSQL. The client JavaScript is the Expo development server the app already uses.

The calendar runs on web, iOS, and Android. Web is the Expo development server. iOS and Android use the local development build from slice 002, because the map that opens the calendar still uses `expo-maps`. Start and end use `@react-native-community/datetimepicker` on each platform. That picker is a native module, so the development build includes it. This slice adds no EAS build, no store build, and no deployed environment.

The local calendar cache uses `expo-sqlite` on each of those platforms. Place suggestions use the server endpoint from slice 002. No new secret is required. `.env.example` is unchanged.

---

# 4. Calendar

The calendar is the driver's set of authored sorties over time. The server is authoritative for that set. The client displays it and keeps a local copy of the last successful read.

Opening the calendar sends an idempotent request. The server finds the driver for that user, or creates one driver, one company, and one driver–company relationship, in one transaction. A failed request leaves all three uncreated. The company name is the user's display name when the profile has one, otherwise the email, otherwise `Company`. The driver row stores no company id. The relationship is its own row. A later open reuses the same driver, company, and relationship.

A later slice can add another company relationship for the same driver. This slice writes one.

An authored sortie uses that company as its company of record and records the authoring driver. Its type is the platform type `task`. The schema of `task` is a label, a scheduled interval, an optional passenger name, an optional passenger phone, and an ordered series of stops. The label is non-empty after trimming. The start is before the end. Both timestamps are UTC. A phone, when present, is ten digits. The caller does not send a company id or a type. There is no type registry and no second type.

A sortie has at least two stops. Position 0 is the origin. The last position is the destination. Positions between them are waypoints. Each stop is a place suggestion the person chose: a label and a coordinate. Suggestions come from `POST /place-suggestions`, as slice 002 defines. The client does not call Google. A stop has no place id. Text that was typed and not chosen is not a stop.

Creating a sortie does not make the driver responsible. This slice records no acceptance. The calendar shows the sorties that driver authored. Within a day they are ordered by scheduled start and then by id. Two intervals may overlap. The calendar does not list dispatch shifts, duty shifts, vehicle assignments, or time held for another company.

The visible scope is one of three:

- **Month.** A month grid. Each sortie is a chip on its start day, showing the label. Today is marked.
- **Week.** Seven day columns and an hour grid. Each sortie is a block from its start to its end.
- **Day.** The same hour grid for one date.

Previous, next, and today move the visible period. A scope control switches month, week, and day. Tapping a day in the month grid, or a day heading in the week, opens that day. Tapping a sortie opens the revise dialog. One create action is available in every scope. In week and day, tapping an empty hour opens create with that hour as the start and one hour later as the end.

The author may revise the label, the interval, the passenger fields, and the stops. The sortie remains. This slice has no delete.

Dragging a sortie revises that same sortie's scheduled start and end. It does not create a second record. On drop, the client sends the new interval together with the sortie's existing label, passenger fields, and stops. The server writes those timestamps and appends `sortie.revised` in the same transaction. The client then reads the calendar again.

- On week and day, dragging the block moves it. Start and end shift by the same amount, so the duration stays. Dragging the start edge changes the start. Dragging the end edge changes the end. Times snap to 15 minutes.
- On month, dragging a chip to another day shifts both timestamps by whole days and keeps the clock times. Changing the duration stays on the week and day grids.

A failed revise, including an end that is not after the start, leaves the sortie and the cache unchanged. The block returns to the times from the last successful read. The screen says the sortie was not saved. When the server cannot be reached, drag is refused.

In the same transaction as the sortie write, the server appends one operational event. Authoring appends `sortie.created`. Revising, including a drag, appends `sortie.revised`. The event stores the sortie id, the label, the interval, the passenger name, the phone, and the ordered stops after the write. Current state stays on the sortie row and its stop rows. A rejected author or revise writes no sortie change and no event. The client does not rebuild the calendar from events.

The client reads the calendar over HTTP for the range on screen. Month, week, and day each request the range they show. A successful read replaces the local cache for the signed-in user: the stored user id, the range, and the sorties, including passenger fields and stops. The cache is `expo-sqlite` on the device. It is the last successful read, not a second source of truth. Sign-out deletes it. When the stored user id is not the signed-in user, the client deletes the cache before reading.

A failed author or revise leaves the cache unchanged. After a successful author or revise, the client reads the calendar again, and that read replaces the cache. When that follow-up read fails, the server has the change, the cache stays as it was, and the screen says the calendar could not be refreshed.

The month, week, and day grids are drawn immediately. Sorties appear when the cache or the server read returns. When the server cannot be reached, the person can still switch month, week, and day, and can move with previous, next, and today. Tapping a day still opens that day. The grid shows cached sorties that fall on the visible days. A period that was never fetched is empty. Author, revise, and drag are refused. When no range has ever been fetched, the grid is still shown and the screen says the calendar could not be loaded.

This slice does not publish on NATS. Another session sees a change on its next calendar read.

---

# 5. Domain objects

## 5.1 Driver

A **driver** is the user in an operational capacity, as `docs/03-domain-model.md` defines. This slice stores the driver id and the user id. One user has one driver.

A driver created here has no duty and no availability.

## 5.2 Company

A **company** is the company of record for sorties this driver authors. This slice creates one company when it creates the driver.

The person has no company screen. The name is assigned as section 4 says.

## 5.3 Driver–company relationship

A **driver–company relationship** is the operational link between that driver and that company. This slice writes one relationship. The driver row does not store a company id.

## 5.4 Sortie

A **sortie** is the operational task from the domain model. This slice stores its id, company of record, authoring driver, type `task`, label, scheduled start, scheduled end, passenger name, and passenger phone.

The passenger name and phone are fields of this sortie type. They are not a passenger entity.

The calendar shows these sorties. The sortie is not a row in an appointment table.

A sortie created here has no responsible driver, no route, and no offer. Its stops are section 5.7.

## 5.5 Calendar

The **calendar** is that driver's authored sorties over a time range, drawn as month, week, or day. It is a query. This slice does not store a separate calendar entry for each sortie.

## 5.6 Operational event

An **operational event** is one immutable history row. This slice writes `sortie.created` and `sortie.revised`. The event is the record of the change, including the passenger fields and the ordered stops. The calendar is read from the sortie rows.

Creating a driver is current identity state. This slice writes no operational event for it.

## 5.7 Stop

A **stop** is one chosen place on a sortie, in order. It stores the suggestion label and coordinate. Position 0 is the origin. The last position is the destination. Any positions between them are waypoints.

A stop is not a driving route and not a place id.

---

# 6. State transitions

| From | To | What happens |
| --- | --- | --- |
| Signed in | Calendar | The person opens the calendar. The client ensures the driver, then reads the sorties in the visible range. |
| No driver | Driver | The first successful calendar open creates the driver, the company, and the relationship. A later open reuses them. |
| Month, week, or day | Another scope or period | The client reads the sorties for the range now on screen. |
| No sortie | Sortie authored | The server accepts the dialog, writes the sortie, its stops, and a `sortie.created` event, and the client reads the calendar again. |
| Sortie authored | Sortie revised | The server updates the sortie and replaces its stops, appends `sortie.revised`, and the client reads the calendar again. A drag sends the new interval and the existing label, passenger fields, and stops. |
| Calendar reachable | Cached calendar | The server cannot be reached. The person can still change scope and period. The screen shows cached sorties that fall on the visible days and says the calendar could not be refreshed. Author, revise, and drag are refused. |
| Signed in | Signed out | The server revokes the session presented by the client, as slice 001 defines. The client deletes the calendar cache. |

No duty, availability, responsibility, or guidance state changes.

A rejected session creates no driver and no sortie. An empty label, an end that is not after the start, fewer than two chosen stops, a stop with no coordinate, or a phone number that is not ten digits creates no sortie and no event. A revise for a missing sortie, or for a sortie another driver authored, changes nothing. A failed drag returns the block to the times from the last successful read.

---

# 7. Interfaces

**Month.** A month grid. A chip on the start day shows the label. Today is marked. Previous, next, and today move the month. Tapping a day opens that day. Dragging a chip onto another day shifts the sortie by whole days and keeps the clock times.

**Week.** Seven day columns and an hour grid. A block runs from the sortie's start to its end. Previous, next, and today move the week. Tapping a day heading opens that day.

**Day.** One date and the same hour grid. Previous, next, and today move the day.

**Scope.** Month, week, and day. Switching scope reads the range that scope shows.

**Create.** One action in every scope opens the dialog. In week and day, tapping an empty hour opens the dialog with that hour as the start and one hour later as the end.

**Dialog.** Used to author and to revise. Revise opens it filled from the sortie. The fields are a label, a start date, a start time, an end date, an end time, a passenger name, a passenger phone, and the stops. Start and end use `@react-native-community/datetimepicker`. The phone field uses a numeric keyboard: `phone-pad` on iOS and Android, and `tel` on web. As the person types, the field shows US format `(555) 123-4567`. The dialog starts with two stop rows, origin and destination. The person can insert waypoints between them and can remove a waypoint. Origin and destination stay. Each stop row requests place suggestions as the query changes. Choosing a suggestion sets that stop's label and coordinate. One action: save.

**Move and resize.** On week and day, dragging the block moves the sortie and keeps the duration. Dragging the start edge changes the start. Dragging the end edge changes the end. Dropped times snap to 15 minutes. On month, dragging a chip to another day changes the dates and keeps the clock times.

When the server cannot be reached and a range is cached, month, week, day, previous, next, and today stay available. Tapping a day still opens that day. The grid shows cached sorties that fall on the visible days and says the calendar could not be refreshed. Author, revise, and drag are unavailable. A period that was never fetched is empty.

On iOS and Android the map remains the screen after sign-in. The map has one action to open the calendar. That action is hidden during guidance and arrival. Leaving the calendar returns to the map.

On web, the signed-in screen from slice 001 has one action to open the calendar. Leaving the calendar returns to that screen. Identity, whether the live connection is authenticated, and sign out stay on that screen.

Sign out stays on the map on iOS and Android, and on the signed-in screen on web. The calendar has no sign-out action.

The person sees a failure in these cases:

- The calendar request fails and no range is cached. The grid is shown and the screen says the calendar could not be loaded.
- The calendar request fails and a range is cached. The screen shows that range and says the calendar could not be refreshed.
- Author, revise, or drag is rejected, or the network is unreachable. The screen says the sortie was not saved. The calendar and the cache stay as they were. A dragged block returns to the times from the last successful read.
- A follow-up read after a successful author or revise fails. The screen says the calendar could not be refreshed. The cache stays as it was.
- The server rejects the session. The app clears the stored token and the calendar cache and returns to sign-in, as slice 001 defines.
- Sign-out fails because the network or server is unreachable. The person stays signed in and the screen says that sign-out failed, as slice 001 defines. The cache stays.

---

# 8. Backend

Commands and queries are HTTP JSON. Zod validates input at the boundary. Domain checks live in `apps/server`. Shared wire types live in `packages/contracts`.

| Operation | Request | Result |
| --- | --- | --- |
| Ensure driver | `POST /drivers/current` with the session token | The driver for that user. Creates the driver, the company, and the relationship when the user has no driver |
| Read calendar | `GET /calendar` with the session token, `from`, and `to` | The sorties that driver authored whose interval overlaps the range, ordered by scheduled start and then by id. Each sortie includes the passenger fields and its stops in position order. The user must already have a driver |
| Author sortie | `POST /sorties` with the session token, a label, a start, an end, an optional passenger name, an optional phone, and at least two stops | The sortie, together with a `sortie.created` event. Rejection when the user has no driver, the label is empty, the end is not after the start, fewer than two stops are present, a stop has no coordinate, or the phone is present and is not ten digits |
| Revise sortie | `PATCH /sorties/:id` with the session token and the same fields | The sortie, together with a `sortie.revised` event. Rejection when the sortie is missing, another driver authored it, or the body fails the same checks as author |

A stop in the request is a label, a latitude, and a longitude. The client sends a stop only after the person chooses a place suggestion. Place suggestions remain `POST /place-suggestions` from slice 002.

An interval overlaps the range when its start is before `to` and its end is after `from`. `from` must be before `to`. Otherwise the read is rejected and no cache update follows from that response.

The authorization rules in this slice: a session may ensure its own driver, read that driver's calendar, author a sortie for that driver, and revise a sortie that driver authored. A missing, unknown, or revoked token is rejected. The caller does not choose the company of record. There is no second credential and no policy engine.

---

# 9. Persistence

Drizzle owns the schema and the migration. Six tables:

**driver** — id, user id, created time. Unique on user id.

**company** — id, name, created time.

**driver company** — id, driver id, company id. Unique on driver id plus company id.

**sortie** — id, company id, author driver id, type, label, scheduled start, scheduled end, passenger name, passenger phone, created time. Rows written here use type `task`. The phone column stores ten digits, or is empty when the person left the phone blank. There is no responsible-driver column.

**sortie stop** — id, sortie id, position, label, latitude, longitude. Unique on sortie id plus position. Position 0 is the origin. The greatest position is the destination. A revise deletes that sortie's stop rows and inserts the new order in the same transaction.

**operational event** — id, type, recorded time, sortie id, label, scheduled start, scheduled end, passenger name, passenger phone, and the ordered stops as each stop's label and coordinate. Append-only. Rows written here use type `sortie.created` or `sortie.revised`. The row commits in the same transaction as the sortie write.

Primary keys are server-generated UUIDs. Timestamps are `timestamptz` in UTC.

The device cache is not in PostgreSQL. `expo-sqlite` stores the signed-in user id, the range of the last successful read, and the sorties returned for that range, including passenger fields and stops. A later successful read deletes that cached range and writes the new one. Sign-out deletes the cache.

No duty, availability, offer, assignment, or location-observation table. Driver creation is not an operational event. Stops are not a driving route.

---

# 10. Realtime

The client still opens the authenticated socket from slice 001 after sign-in, and closes it on sign-out. This slice publishes no domain events on the bus, so an authenticated socket still receives no operational traffic.

Author, revise, drag, and calendar reads are HTTP. A second open session for the same user sees a change when it reads the calendar.

---

# 11. Acceptance criteria

The slice works when all of the following are true on the local stack:

1. A signed-in person can open a calendar. The first open creates one driver, one company, and one driver–company relationship. A later open reuses that driver.
2. A second Google account produces a second driver and a second company. Each driver sees only the sorties they authored.
3. Authoring a sortie shows it on the calendar. Month, week, and day each show that sortie when it falls in the visible range. Switching scope or period reads that range from the server.
4. Reloading the app, and opening the calendar on a second session for the same user, shows that sortie from the server.
5. Revising from the dialog changes what the calendar shows. Each author adds one `sortie.created` event. Each revise, including a drag, adds one `sortie.revised` event. Restarting the server keeps the sortie.
6. The start and end pickers set the stored interval. A phone displays as `(555) 123-4567` and is stored as ten digits.
7. Origin and destination are required chosen places. A waypoint added between them is stored and returned in that order. A query that is not chosen does not become a stop.
8. An empty label, an end that is not after the start, fewer than two chosen stops, or a phone number that is not ten digits creates no sortie and no event.
9. Dragging a sortie on the week or day grid moves or resizes it, and the stored start and end match the drop, snapped to 15 minutes. Dragging a chip to another day on the month grid changes the dates and keeps the clock times. A failed drop leaves the previous times.
10. A missing, unknown, or revoked session is rejected on every endpoint in section 8. A session cannot revise another driver's sortie.
11. After a successful read, when the server cannot be reached, the person can switch month, week, and day, move previous, next, and today, and open a day from the month grid or a week day heading. Cached sorties that fall on the visible days stay visible. The device does not apply an author, revise, or drag.
12. When the server cannot be reached and no range is cached, the grid is shown and the screen says the calendar could not be loaded.
13. Sign-out revokes that session and clears the local calendar cache.
14. On iOS and Android the calendar opens from the map and is unavailable during guidance and arrival. Guidance from slice 002 is unchanged. On web the calendar opens from the signed-in screen, which still shows identity, live-connection state, and sign out.
15. The persisted sortie has its own id, type `task`, a company of record, an authoring driver, and its own stop rows. The database has no appointment table.
16. The flow runs with `pnpm dev:server` and `pnpm dev:mobile` on web, and with the local development build on iOS and Android. No EAS build and no store build are required.

---

# 12. Remains unimplemented

- Responsibility and acceptance
- Offers, assignment, commencement, and completion
- Cancellation
- Duty, availability, dispatch shifts, duty shifts, and vehicle assignment
- Sortie types other than `task`, and a type registry
- A driving route computed from these stops, and opening guidance for a sortie or a stop
- All-day sorties, recurrence, reminders, more than one calendar, colors, guests, and search
- Conflict detection, feasibility, and schedule margins
- Another company's occupied time on this calendar
- Live push of calendar changes to a connected session
- Authoring, revising, or dragging while the server cannot be reached
- Company management, renaming the company, and a second company for the same driver
- Roles
