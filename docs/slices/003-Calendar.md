# Slice 003 — Calendar

## Status

**Previous slice**

**Derived from:** Development Methodology (`docs/02-development-methodology.md`) section 6, the driver calendar in Architectural Specification (`docs/01-architecture..md`) section 9, the driver, company, sortie, driver calendar, and operational event in `docs/03-domain-model.md`, and persistence and the live event path in Technical Architecture (`docs/04-technical-architecture.md`) sections 4 and 7.

**Purpose:** A signed-in person can open a calendar in month, week, or day, author a sortie onto it, revise that sortie, including by dragging it, and still read the last fetched calendar when the server cannot be reached.

This document is the implementation boundary. Responsibility, acceptance, and navigating a sortie stay outside this slice. Opening guidance for a sortie is slice 004. The calendar is a view of sorties. A sortie stays a sortie. Slice 002's map and guidance stay as they are.

---

# 1. User capability

After this slice, a person who is signed in, as slice 001 defines, can:

1. Open a calendar in day view and switch among month, week, and day.
2. Become a driver by opening that calendar, when they do not already have one.
3. Author a sortie from a dialog: an optional label, an optional arrival date and arrival time, an optional passenger name, an optional phone number, and at least one chosen place. The author marks that place as a pickup or a destination, and may add the other. Waypoints are allowed only between both. When an arrival is set, it is when the driver is to arrive at the pickup, or at the destination when the sortie has no pickup. When no arrival is set, the server assumes immediate departure and computes the arrival. The server computes the scheduled start and end from traffic-aware drive time and caches them.
4. See a summary of a sortie by tapping it, and revise that sortie from the summary, or by dragging it so the arrival changes. The server recomputes the cached start and end.
5. See those sorties again after the app restarts, and on another session for the same user.
6. See the last fetched calendar range when the server cannot be reached.
7. Sign out, so that session can no longer be used, as slice 001 defines. Sign-out clears the local calendar cache.

On every platform the calendar opens from the bottom bar in **day** view. While Calendar is already open, another tap on that Calendar control rotates the scope day → week → month → day. The calendar stays available during guidance and arrival. Authoring is also available from the New Sortie control on that bar. On iOS and Android, choosing a place in the navigation Where to? field authors a destination-only immediate sortie for the signed-in driver before the map previews a route or starts guidance. That choice does not open this dialog.

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

The calendar runs on web, iOS, and Android. Web is the Expo development server. iOS and Android use the local development build from slice 002, because the map that opens the calendar still uses `expo-maps`. Arrival date and time use `@react-native-community/datetimepicker` on each platform. That picker is a native module, so the development build includes it. This slice adds no EAS build, no store build, and no deployed environment.

The local calendar cache uses `expo-sqlite` on each of those platforms. Place suggestions use the server endpoint from slice 002. The signed-in app reports GPS fixes to the server while open and, on iOS and Android, while backgrounded. Drive time for a sortie window uses the Google routing key slice 002 already requires. `.env.example` is unchanged.

---

# 4. Calendar

The calendar is the driver's set of authored sorties over time. The server is authoritative for that set. The client displays it and keeps a local copy of the last successful read.

Opening the calendar sends an idempotent request. The server finds the driver for that user, or creates one driver, one company, and one driver–company relationship, in one transaction. A failed request leaves all three uncreated. The company name is the user's display name when the profile has one, otherwise the email, otherwise `Company`. The driver row stores no company id. The relationship is its own row. A later open reuses the same driver, company, and relationship.

A later slice can add another company relationship for the same driver. This slice writes one.

An authored sortie uses that company as its company of record and records the authoring driver. Its type is the platform type `task`. The schema of `task` is an optional label, an optional arrival, a flag for whether that arrival was authored, a cached scheduled start, a cached scheduled end, the departure address used for that start, an optional passenger name, an optional passenger phone, and an ordered series of stops. The label may be empty after trimming. When the caller omits the arrival, the server computes it. The server computes the start and the end and stores them. The stored arrival, start, and end are UTC. A phone, when present, is ten digits. The caller does not send a company id or a type. There is no type registry and no second type.

The first place to reach is the pickup when the sortie has one, otherwise the destination. An onward drive exists only from a pickup through any waypoints to a destination. When the caller sets an arrival, the start is that arrival minus the traffic-aware drive to the first place. That drive starts at the last place of the previous sortie when this arrival is later than another sortie on the driver's calendar. Otherwise it starts at the driver's latest location observation. The end is the arrival when nothing follows that place, otherwise the arrival plus the onward drive, departing at the arrival. The server asks for the approach drive at the arrival, then again at arrival minus that duration, and keeps the second duration. When the caller omits the arrival, the driver departs now from the latest location observation, not from a previous sortie. The arrival is now plus the drive to the first place, asked at the current time. The end is that arrival, or that arrival plus the onward drive when a destination follows a pickup. The start is now. A departure the routing provider will not accept in the past is asked as the current time. The stored start may still fall before the current time. The address of the starting place is stored with the cached window. When the start is a previous place, it is that stop's label. When the start is the driver's position, it is the reverse-geocoded address of that observation. Both durations include projected traffic. The result is cached on the sortie, together with the coordinate and address used for that computation. A calendar read does not call the routing provider.

An authored arrival uses the previous sortie's last place when this arrival is later than another of that driver's sorties, and otherwise the latest stored observation. An omitted arrival uses only that observation. If the observation is required and the driver has none, the write is rejected and the screen says location is required. If the routing call fails, the write is rejected and the sortie is left unchanged. Saving a sortie also refreshes any still-open sortie whose approach start changed because of that write. A later observation recomputes a still-open sortie that starts from the driver's position when the new fix is at least five miles from the coordinate of the last successful computation, or when that coordinate is missing. It does not recompute a sortie that starts from a previous place. An authored arrival stays put and the window is refreshed around it. An arrival the server computed is computed again as an immediate departure from the new fix. A sortie whose cached end is already past is left unchanged. A failed recompute leaves the cached window and the coordinate unchanged and is not retried for five minutes. That recompute appends `sortie.schedule_computed`. It is not a revise.

While the person is signed in, the client reports location observations in the foreground and in the background on iOS and Android. It sends a fix when the device has moved at least 100 meters from the last accepted report, or five minutes have passed, and it drops a fix whose accuracy is worse than 100 meters. Off-duty suppression is not applied, because this slice has no duty. An observation is not broadcast, and no other driver can read it. Web reports only while the tab is open.

A sortie has at least one stop, and that stop is a pickup or a destination. It may have both. Position order is the pickup when present, then any waypoints, then the destination when present. Waypoints require both a pickup and a destination. Each stop is a place suggestion the person chose: a role, a label, and a coordinate. Suggestions come from `POST /place-suggestions`, as slice 002 defines. The client does not call Google. A stop has no place id. Text that was typed and not chosen is not a stop. When the label is empty, the calendar shows the pickup address, or the destination address when there is no pickup.

Creating a sortie does not make the driver responsible. This slice records no acceptance. The calendar shows the sorties that driver authored. Within a day they are ordered by scheduled start and then by id. Two intervals may overlap. The calendar does not list dispatch shifts, duty shifts, vehicle assignments, or time held for another company.

The visible scope is one of three. Opening the calendar starts in **day**.

- **Month.** A month grid. Each sortie is a chip on the day of its cached start, showing the label. Today is marked.
- **Week.** Seven day columns and an hour grid. Each sortie is a block from its cached start to its cached end. The hour grid jumps so the now-line is vertically centered when week is shown.
- **Day.** The same hour grid for one date. The hour grid jumps so the now-line is vertically centered when day is shown.

Previous, next, and today move the visible period. A scope control switches month, week, and day. While Calendar is open, another bottom-bar Calendar tap rotates day → week → month → day. Tapping a day in the month grid, or a day heading in the week, opens that day. Tapping a sortie opens a summary of that sortie. One create action is available in every scope. It opens the dialog with no arrival, so a save is an immediate departure. In week and day, tapping an empty hour opens create with that hour as the arrival.

The author may revise the label, the arrival, the passenger fields, and the stops. The sortie remains. This slice has no delete. The summary shows the label, or the address when the label is empty, the arrival, the cached start, the address the start was driven from, the cached end, the passenger name, the phone, and the stops in order. Revise on the summary opens the dialog. A sortie whose arrival was computed opens with no arrival. A sortie whose arrival was authored opens with that arrival. Close dismisses the summary.

Dragging a sortie revises that same sortie's arrival and marks the arrival authored. It does not create a second record, and it does not set the duration. On drop, the client sends the new arrival together with the sortie's existing label, passenger fields, and stops. The server recomputes the cached start and end and appends `sortie.revised` in the same transaction. The client then reads the calendar again. There is no resize handle.

- On week and day, dragging the block moves the arrival by the same day and minute delta. Times snap to 15 minutes.
- On month, dragging a chip to another day shifts the arrival by whole days and keeps the clock time. The day delta is measured from the cached start day.

A failed revise leaves the sortie and the cache unchanged. The block returns to the times from the last successful read. The screen says the sortie was not saved, or that location is required when the driver has no stored fix. When the server cannot be reached, drag is refused. When the app returns to the foreground, the open calendar reads again, so a window recomputed from a later fix can appear.

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

A **sortie** is the operational task from the domain model. This slice stores its id, company of record, authoring driver, type `task`, label, arrival, whether that arrival was authored, cached scheduled start, cached scheduled end, the coordinate and address of the last successful schedule computation, passenger name, and passenger phone.

The passenger name and phone are fields of this sortie type. They are not a passenger entity.

The calendar shows these sorties. The sortie is not a row in an appointment table.

A sortie created here has no responsible driver, no route, and no offer. Its stops are section 5.7.

## 5.5 Calendar

The **calendar** is that driver's authored sorties over a time range, drawn as month, week, or day. It is a query. This slice does not store a separate calendar entry for each sortie.

## 5.6 Operational event

An **operational event** is one immutable history row. This slice writes `sortie.created` and `sortie.revised`. The event is the record of the change, including the passenger fields and the ordered stops. The calendar is read from the sortie rows.

Creating a driver is current identity state. This slice writes no operational event for it.

## 5.7 Stop

A **stop** is one chosen place on a sortie, in order. It stores a role, the suggestion label, and a coordinate. The role is pickup, waypoint, or destination. A pickup, when present, is first. A destination, when present, is last. Waypoints lie between them and require both.

A stop is not a driving route and not a place id. Authored wait minutes on a stop, and sealing actual departure when Guide starts, are slice 005.

---

# 6. State transitions

| From | To | What happens |
| --- | --- | --- |
| Signed in | Calendar | The person opens the calendar. The client ensures the driver, then reads the sorties in the visible range. |
| No driver | Driver | The first successful calendar open creates the driver, the company, and the relationship. A later open reuses them. |
| Month, week, or day | Another scope or period | The client reads the sorties for the range now on screen. |
| No sortie | Sortie authored | The server accepts the dialog, writes the sortie, its stops, and a `sortie.created` event, and the client reads the calendar again. |
| Sortie authored | Sortie revised | The server updates the sortie and replaces its stops, recomputes the cached window, appends `sortie.revised`, and the client reads the calendar again. A drag sends the new arrival and the existing label, passenger fields, and stops. |
| Sortie with a cached window | Window recomputed | A new location observation is at least five miles from the computation coordinate, the cached end is still in the future, and the approach still starts from the driver's position. A following sortie is recomputed when the previous destination it starts from changes. The server replaces the cached start and end and appends `sortie.schedule_computed`. |
| Calendar reachable | Cached calendar | The server cannot be reached. The person can still change scope and period. The screen shows cached sorties that fall on the visible days and says the calendar could not be refreshed. Author, revise, and drag are refused. |
| Signed in | Signed out | The server revokes the session presented by the client, as slice 001 defines. The client deletes the calendar cache. |

No duty, availability, responsibility, or guidance state changes.

A rejected session creates no driver and no sortie. No chosen pickup or destination, a waypoint without both ends, a stop with no coordinate, a phone number that is not ten digits, a missing location observation, or a failed routing call creates no sortie and no event. A revise for a missing sortie, or for a sortie another driver authored, changes nothing. A failed drag returns the block to the times from the last successful read.

---

# 7. Interfaces

**Month.** A month grid. A chip on the cached start day shows the label. Today is marked. Previous, next, and today move the month. Tapping a day opens that day. Dragging a chip onto another day shifts the arrival by whole days and keeps the clock time.

**Week.** Seven day columns and an hour grid. A block runs from the sortie's cached start to its cached end. Previous, next, and today move the week. Tapping a day heading opens that day. When week is activated, the hour grid jumps (no animation) so the now-line sits at the vertical center of the scroll viewport.

**Day.** One date and the same hour grid. Previous, next, and today move the day. When day is activated, the hour grid jumps so the now-line sits at the vertical center of the scroll viewport.

**Scope.** Month, week, and day. Switching scope reads the range that scope shows. Opening the calendar starts in day. The in-calendar scope control switches among the three. While Calendar is the active bottom-bar destination, another Calendar tap rotates day → week → month → day.

**Create.** One action in every scope opens the dialog with no arrival. In week and day, tapping an empty hour opens the dialog with that hour as the arrival. The New Sortie control on the bottom bar opens the same dialog over the current screen, with no arrival, and ensures a driver before save.

**Summary.** Tapping a sortie opens it. The summary shows the label, or the address when the label is empty, the arrival, the cached start, the address the start was driven from, the cached end, the passenger name, the phone, and each stop in order. Revise opens the dialog. Close dismisses the summary.

**Dialog.** Used to author and to revise. Revise opens it filled from the sortie. The fields are a label, an arrival date, an arrival time, a passenger name, a passenger phone, a pickup, and a destination. Arrival date and arrival time share one row when an arrival is set, and each takes half of that row. They use `@react-native-community/datetimepicker`. The author can clear the arrival, which shows Leave now and sends no arrival. The phone field uses a numeric keyboard: `phone-pad` on iOS and Android, and `tel` on web. As the person types, the field shows US format `(555) 123-4567`. Pickup and destination each stay on the form and can be cleared. Save requires at least one of them chosen. The person can insert waypoints once both are chosen, and can remove a waypoint. Each stop row requests place suggestions as the query changes. Choosing a suggestion sets that stop's label and coordinate. One action: save.

**Where to?** On iOS and Android, choosing a suggestion in the navigation search authors a sortie before route preview. The body is an empty label, no arrival, no passenger fields, and one destination stop for that suggestion. The client ensures the signed-in user is a driver and reports the current fix first. Preview and guidance follow only after that write succeeds. A failure stays on the map and does not start guidance. Dismissing the preview leaves the sortie. Choosing another place authors another sortie.

**Move.** On week and day, dragging the block shifts the arrival. Dropped times snap to 15 minutes. The duration is not edited. On month, dragging a chip to another day shifts the arrival by whole days and keeps the clock time.

When the server cannot be reached and a range is cached, month, week, day, previous, next, and today stay available. Tapping a day still opens that day. The grid shows cached sorties that fall on the visible days and says the calendar could not be refreshed. Author, revise, and drag are unavailable. A period that was never fetched is empty.

On every platform a persistent bottom bar opens Navigation, New Sortie, Settings, and Calendar. Opening Calendar shows day view. Another Calendar tap while Calendar is already open rotates day → week → month → day. Leaving the calendar returns to Navigation. Sign out is on Settings. The calendar has no sign-out action.

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
| Read calendar | `GET /calendar` with the session token, `from`, and `to` | The sorties that driver authored whose cached interval overlaps the range, ordered by scheduled start and then by id. Each sortie includes the arrival, the cached start and end, the departure address used for that start, the passenger fields, and its stops in position order. The user must already have a driver |
| Author sortie | `POST /sorties` with the session token, a label, an optional arrival, an optional passenger name, an optional phone, and at least one pickup or destination | The sortie, with its resolved arrival, whether that arrival was authored, and its cached start and end, together with a `sortie.created` event. Rejection when the user has no driver, neither a pickup nor a destination is present, a waypoint lacks both ends, a stop has no coordinate, the phone is present and is not ten digits, the driver has no location observation, or the routing call fails |
| Revise sortie | `PATCH /sorties/:id` with the session token and the same fields | The sortie, together with a `sortie.revised` event. Rejection when the sortie is missing, another driver authored it, or the body fails the same checks as author. A routing failure leaves the previous window |
| Report location | `POST /location-observations` with the session token, an observed time, a latitude, a longitude, and an accuracy | Stores the fix for that driver and recomputes a still-open sortie that starts from the driver's position when the fix is at least five miles from its last computation coordinate. Rejection when the user has no driver or the body is not a fix |

A stop in the request is a role, a label, a latitude, and a longitude. The role is `pickup`, `waypoint`, or `destination`. The client sends a stop only after the person chooses a place suggestion. Place suggestions remain `POST /place-suggestions` from slice 002. An omitted arrival is `null`. A present arrival is the authored time.

A cached interval overlaps the range when its start is before `to` and its end is after `from`. `from` must be before `to`. Otherwise the read is rejected and no cache update follows from that response.

The authorization rules in this slice: a session may ensure its own driver, read that driver's calendar, author a sortie for that driver, and revise a sortie that driver authored. A missing, unknown, or revoked token is rejected. The caller does not choose the company of record. There is no second credential and no policy engine.

---

# 9. Persistence

Drizzle owns the schema and the migration. Seven tables:

**driver** — id, user id, created time. Unique on user id.

**company** — id, name, created time.

**driver company** — id, driver id, company id. Unique on driver id plus company id.

**sortie** — id, company id, author driver id, type, label, arrival, arrival authored, scheduled start, scheduled end, schedule origin latitude, schedule origin longitude, schedule origin label, schedule failed time, passenger name, passenger phone, created time. Rows written here use type `task`. Arrival is the resolved time. Arrival authored is true when the caller sent that time, and false when the server computed it from an immediate departure. Existing rows stay authored. Scheduled start and scheduled end are the cached window. The schedule origin is the coordinate and address of the last successful computation, and is empty until that computation succeeds. The address is the previous place's label when the approach starts there, and the reverse-geocoded observation when it starts from the driver. The label may be empty. The phone column stores ten digits, or is empty when the person left the phone blank. There is no responsible-driver column.

**sortie stop** — id, sortie id, position, role, label, latitude, longitude. Unique on sortie id plus position. The role is pickup, waypoint, or destination. Existing rows use pickup at position 0, destination at the last position, and waypoint in between. A revise deletes that sortie's stop rows and inserts the new order in the same transaction.

**operational event** — id, type, recorded time, sortie id, label, arrival, scheduled start, scheduled end, passenger name, passenger phone, and the ordered stops as each stop's label and coordinate. Append-only. Rows written here use type `sortie.created`, `sortie.revised`, or `sortie.schedule_computed`. The row commits in the same transaction as the sortie write.

**location observation** — id, driver id, observed time, latitude, longitude, accuracy in meters. Indexed by driver and observed time. A track is not stored. There is no read API for another driver.

Primary keys are server-generated UUIDs. Timestamps are `timestamptz` in UTC.

The device cache is not in PostgreSQL. `expo-sqlite` stores the signed-in user id, the range of the last successful read, and the sorties returned for that range, including passenger fields and stops. A later successful read deletes that cached range and writes the new one. Sign-out deletes the cache.

No duty, availability, offer, or assignment table. Location observations are the GPS table above. Driver creation is not an operational event. Stops are not a stored driving route. The cached window is a duration, not a path.

---

# 10. Realtime

The client still opens the authenticated socket from slice 001 after sign-in, and closes it on sign-out. This slice publishes no domain events on the bus, so an authenticated socket still receives no operational traffic.

Author, revise, drag, location reports, and calendar reads are HTTP. Precise location is not published on the bus. A second open session for the same user sees a change when it reads the calendar.

---

# 11. Acceptance criteria

The slice works when all of the following are true on the local stack:

1. A signed-in person can open a calendar. The first open creates one driver, one company, and one driver–company relationship. A later open reuses that driver.
2. A second Google account produces a second driver and a second company. Each driver sees only the sorties they authored.
3. Authoring a sortie shows it on the calendar. Month, week, and day each show that sortie when it falls in the visible range. Switching scope or period reads that range from the server.
4. Reloading the app, and opening the calendar on a second session for the same user, shows that sortie from the server.
5. Revising from the dialog changes what the calendar shows. Each author adds one `sortie.created` event. Each revise, including a drag, adds one `sortie.revised` event. A recompute after a five-mile move adds one `sortie.schedule_computed` event and does not add `sortie.revised`. Restarting the server keeps the sortie and the cached window.
6. When an arrival is set, its date and time share one row, and each takes half of that row. The author can clear that arrival. Those controls are the only times the dialog sends. The calendar block uses the cached start and end. A phone displays as `(555) 123-4567` and is stored as ten digits.
7. A sortie is valid with a chosen pickup, a chosen destination, or both. A waypoint added between both is stored and returned in that order. A query that is not chosen does not become a stop. An empty label is stored, and the calendar shows the address.
8. No pickup or destination, a waypoint without both ends, a phone number that is not ten digits, or a missing location observation creates no sortie and no event. A failed routing call creates no sortie. An omitted arrival is now plus the drive to the one place, and the sortie records that the arrival was not authored.
9. Dragging a sortie on the week or day grid shifts the arrival, snapped to 15 minutes, and the server recomputes the cached start and end. The block cannot be resized. Dragging a chip to another day on the month grid shifts the arrival by whole days and keeps the clock time. A failed drop leaves the previous times.
10. A missing, unknown, or revoked session is rejected on every endpoint in section 8. A session cannot revise another driver's sortie.
11. After a successful read, when the server cannot be reached, the person can switch month, week, and day, move previous, next, and today, and open a day from the month grid or a week day heading. Cached sorties that fall on the visible days stay visible. The device does not apply an author, revise, or drag.
12. When the server cannot be reached and no range is cached, the grid is shown and the screen says the calendar could not be loaded.
13. Sign-out revokes that session and clears the local calendar cache.
14. On every platform the calendar opens from the bottom bar and stays available during guidance and arrival. Choosing a Where to? suggestion on iOS or Android authors a destination-only immediate sortie before route preview or guidance, and does not open the dialog. New Sortie opens the author dialog from any destination. On web, Navigation still shows identity and live-connection state. Sign out is on Settings.
15. The persisted sortie has its own id, type `task`, a company of record, an authoring driver, and its own stop rows. The database has no appointment table.
16. The flow runs with `pnpm dev:server` and `pnpm dev:mobile` on web, and with the local development build on iOS and Android. No EAS build and no store build are required.
17. Tapping a sortie opens a summary of the label, or the address when the label is empty, the arrival, the cached start, the address the start was driven from, the cached end, the passenger fields, and the stops. That address is the same place used to compute the start. Revise on that summary opens the dialog.
18. A fix within five miles of the last computation leaves the cached window. A fix at least five miles away recomputes a sortie that starts from the driver's position and whose cached end is still in the future. An authored arrival stays, and the window is refreshed around it. A computed arrival is computed again from an immediate departure. A later sortie with an authored arrival starts from the previous sortie's last place, and that GPS fix does not recompute it. An ended sortie is left unchanged.

---

# 12. Remains unimplemented

- Responsibility and acceptance
- Offers, assignment, commencement, and completion
- Cancellation
- Duty, availability, dispatch shifts, duty shifts, and vehicle assignment
- Sortie types other than `task`, and a type registry
- Driving-route geometry from these stops, and opening guidance for a single stop. Opening guidance for a full sortie is slice 004
- Off-duty suppression of GPS reports
- All-day sorties, recurrence, reminders, more than one calendar, colors, guests, and search
- Conflict detection, feasibility, and schedule margins
- Another company's occupied time on this calendar
- Live push of calendar changes to a connected session
- Authoring, revising, or dragging while the server cannot be reached
- Company management, renaming the company, and a second company for the same driver
- Roles
