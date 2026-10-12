# Slice 011 — Automatic Availability

## Status

**Previous slice:** 010 — Availability

**Derived from:** Driver availability in `docs/03-domain-model.md` and `docs/01-architecture..md` section 15.

**Purpose:** The platform sets the driver's availability choice from the sortie schedule, the latest GPS fix, and settings the driver saves. The yellow bar still shows that choice.

This document is the implementation boundary. Duty, offers, assignment, a list of who is available, and a background task that checks in while the app is suspended stay outside. Slice 010 still owns the check-in lease.

---

# 1. User capability

After this slice, a signed-in driver can:

1. Save an availability threshold in whole minutes, from 0 through 120. The default is 15.
2. Turn **Automatically Set Unavailable** and **Automatically Set Available** on or off. Both default on.
3. On iOS or Android, create or edit an availability geofence. The editor opens on the device GPS when the ring is empty. Tap adds a vertex. Drag moves one. Clear removes the ring. A saved ring has at least three vertices, or it is empty. One or two vertices are not kept. The settings screen shows the vertex count when a ring is present. Web shows that count and does not edit the map. A web save sends the ring it loaded, so a fence drawn on a phone is not wiped.
4. Have the platform set the choice without another tap. A tap still changes the choice immediately. The next evaluation overwrites that tap when the active flag disagrees.

The temporary geofence preview is gone.

---

# 2. Actors

One actor: a signed-in driver. Reading or saving these settings creates the driver, company, and relationship when they do not exist yet, the same way availability does.

---

# 3. Domain objects

## 3.1 Availability settings

Stored on the driver:

- `availability_threshold_minutes` — whole minutes, default 15, allowed 0 through 120.
- `auto_set_unavailable` — default true. When a forcing case holds, the platform sets the choice unavailable.
- `auto_set_available` — default true. When no forcing case holds, the platform sets the choice available.
- `availability_geofence` — a coordinate ring, default empty. Empty means there is no fence.

Turning a flag off stops only that direction. The other flag still applies.

## 3.2 Forcing case

Any one of these forces unavailable:

- **In progress.** This driver's sortie has `actualStart` set and `actualEnd` null.
- **Soon.** An uncommenced sortie has `scheduledStart` at or after now and strictly less than the threshold. An overdue uncommenced sortie does not match. A start at exactly the threshold does not match. A threshold of 0 never matches this case.
- **Outside the geofence.** The latest location observation, by observed time and then by id, lies outside a saved ring of at least three vertices. A point on the boundary counts as inside. Reported accuracy does not widen the ring. No fix, or no ring, does not match.

## 3.3 The choice

`available` stays the boolean from slice 010. This slice writes it through the same command. The same choice writes no event and publishes nothing. A missed check-in still does not clear it. Setting the choice true still stamps the check-in time. Setting it false still clears that time.

---

# 4. State transitions

Evaluation runs for one driver after a successful settings save, a stored location observation, and a successful sortie create, revise, commence, complete, or wait extension. It also runs for every driver who has either flag on, on the same one-minute interval as the check-in lapse. Importing the module does not start that interval.

- Forcing case, and automatically set unavailable is on: the choice becomes false.
- Forcing case, and that flag is off: the choice stays as it is. The available flag is not applied.
- No forcing case, and automatically set available is on: the choice becomes true.
- No forcing case, and that flag is off: the choice stays as it is.
- The resulting choice equals the stored choice: no write and no publish.

A new driver, and an existing driver once these columns exist, starts from the defaults. The next evaluation sets them available when nothing forces unavailable.

A tap is not evaluated inside the availability write. The next trigger above applies the rule.

---

# 5. Interfaces

Settings gains an Availability section:

- A slider labeled "Availability threshold in minutes", 0–120.
- On/off controls labeled **Automatically Set Unavailable** and **Automatically Set Available**. Both show on until the saved settings load.
- **Availability geofence**, with **Create geofence** when none is saved and **Edit geofence** when one is. That control is omitted on web.
- **Save availability**, which writes the threshold, both flags, and the ring together.

The bar in `AppWideStatus` does not decide the rule. It still applies `availability.updated`.

---

# 6. Backend

Commands are HTTP JSON. Zod validates input at the boundary. Domain checks live in `apps/server`. Shared wire types live in `packages/contracts`.

| Operation | Request | Result |
| --- | --- | --- |
| Read settings | `GET /availability/settings` | `{ thresholdMinutes, autoSetUnavailable, autoSetAvailable, geofence }` |
| Save settings | `PUT /availability/settings` with that shape | The same shape, after one evaluation |

`GET` creates the driver when needed and does not change the choice. `PUT` stores the settings, then evaluates. An empty ring clears the fence.

A missing or revoked session is 401. A non-integer threshold, a value outside 0–120, or a ring of one or two points is 400.

The decision is a pure function. The reconciler calls `setAvailability` and does not call itself again. The one-minute starter imports the lapse sweep and the reconciler from outside the availability module, because that module already imports the calendar.

---

# 7. Persistence

Drizzle owns the schema and the migration. This slice adds the four columns in section 3.1 on **driver**. The ring is jsonb. Primary keys and timestamps stay as in slice 010.

A user delete removes the columns with the driver.

---

# 8. Realtime

An evaluation that changes the choice publishes `availability.updated` the same way a tap does. An evaluation that leaves the choice unchanged publishes nothing. The envelope is unchanged from slice 010.

---

# 9. Acceptance criteria

The slice works when all of the following are true:

1. A new driver's settings are both flags on, threshold 15, and an empty geofence. The choice stays unavailable until an evaluation. That evaluation sets the choice available when nothing forces unavailable, and a second pass writes no event.
2. A missing session is rejected. A bad body is rejected, including a one- or two-point ring and a threshold outside 0–120. A saved ring is returned on the next read. One driver does not receive another's ring.
3. With the defaults, a commenced sortie sets the choice unavailable, and ending that sortie sets it available. A start 14 minutes out does the same at a threshold of 15. A start at exactly 15 minutes, and a start already in the past, do not. Repeating an evaluation that does not change the choice writes no event.
4. A fix outside the saved ring sets the choice unavailable. A fix inside it, including on the boundary, does not. No fix, or an empty ring, does not. Turning a flag off skips that direction.
5. The settings screen offers the threshold, both flags, and the geofence control. Web does not offer Create or Edit.

---

# 10. Remains unimplemented

- Duty, and who controls it
- Offers, assignment, and candidate selection
- A list of drivers who are available
- A background task that checks in while the app is suspended
- Widening the availability geofence by GPS accuracy
