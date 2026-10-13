# Slice 011 — Automatic Availability

## Status

**Previous slice:** 010 — Availability

**Derived from:** Driver availability in `docs/03-domain-model.md` and `docs/01-architecture..md` section 15.

**Purpose:** The platform sets the driver's availability choice when a sortie is inside the lead time before it is scheduled to commence, when the driver starts guidance from the calendar, when a sortie is commenced, and when a sortie concludes. The yellow bar still shows that choice.

This document is the implementation boundary. Duty, offers, assignment, a list of who is available, and a background task that checks in while the app is suspended stay outside. Slice 010 still owns the check-in lease.

---

# 1. User capability

After this slice, a signed-in driver can:

1. Save an availability threshold in whole minutes, from 0 through 120. The default is 15.
2. Turn **Automatically Set Unavailable** and **Automatically Set Available** on or off. Both default on.
3. On iOS or Android, create or edit an availability geofence. The editor opens on the device GPS when the ring is empty. Tap adds a vertex. Drag moves one. Clear removes the ring. A saved ring has at least three vertices, or it is empty. One or two vertices are not kept. The settings screen shows the vertex count when a ring is present. Web shows that count and does not edit the map. A web save sends the ring it loaded, so a fence drawn on a phone is not wiped.
4. Have the platform set the choice at the events in section 4, without another tap. A tap still changes the choice immediately. A later one of those events overwrites that tap when its flag is on.

The temporary geofence preview is gone.

---

# 2. Actors

One actor: a signed-in driver. Reading or saving these settings creates the driver, company, and relationship when they do not exist yet, the same way availability does.

---

# 3. Domain objects

## 3.1 Availability settings

Stored on the driver:

- `availability_threshold_minutes` — whole minutes, default 15, allowed 0 through 120.
- `auto_set_unavailable` — default true. The lead before commencement, and starting guidance from the calendar, set the choice unavailable.
- `auto_set_available` — default true. Commencing or concluding a sortie sets the choice available.
- `availability_geofence` — a coordinate ring, default empty. Empty means there is no fence. The ring is stored with the other settings. It does not change the choice.

Turning a flag off stops only that direction. The other flag still applies.

## 3.2 Lead

An uncommenced sortie is inside the lead when `scheduledStart` is at or after now and strictly less than the threshold. An overdue uncommenced sortie is not. A start at exactly the threshold is not. A threshold of 0 never opens the lead. A sortie already in progress is not this event.

## 3.3 The choice

`available` stays the boolean from slice 010. This slice writes it through the same command. The same choice writes no event and publishes nothing. A missed check-in still does not clear it. Setting the choice true still stamps the check-in time. Setting it false still clears that time.

---

# 4. State transitions

Automatic changes happen on only four events.

**Lead.** An uncommenced sortie is inside the lead. This is checked when a sortie is created, revised, or has its wait extended, and on the same one-minute interval as the check-in lapse for every driver whose unavailable flag is on. Importing the module does not start that interval. When the flag is on, the choice becomes false. The lead does not set the choice available, including after the window passes or a start becomes overdue.

**Guidance.** The driver selects a sortie on the calendar and taps Guide. When Automatically Set Unavailable is on, the choice becomes false. When that flag is off, Guide uses the commencement check.

**Commencement.** A sortie is commenced other than by that Guide tap. **Conclusion.** A sortie is completed. Both run the same check. When the available flag is on and no uncommenced sortie is inside the lead, the choice becomes true. When another sortie is already inside the lead and the unavailable flag is on, the choice becomes false instead.

A sortie that is merely in progress does not change the choice. Saving settings does not. A GPS fix does not.

The same choice writes no event and publishes nothing. A new driver stays unavailable until a commencement, a conclusion, or calendar guidance, unless a lead sets them unavailable first.

A tap is not one of these events. The next lead, guidance, commencement, or conclusion still applies.

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
| Save settings | `PUT /availability/settings` with that shape | The same shape |

`GET` creates the driver when needed and does not change the choice. `PUT` stores the settings and does not change the choice. An empty ring clears the fence.

A missing or revoked session is 401. A non-integer threshold, a value outside 0–120, or a ring of one or two points is 400.

The decision is a pure function. It calls `setAvailability` and does not call itself again. The one-minute starter imports the lapse sweep and the lead check from outside the availability module, because that module already imports the calendar.

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

1. A new driver's settings are both flags on, threshold 15, and an empty geofence. The choice stays unavailable through a lead check when no sortie is inside the lead. A conclusion sets the choice available, and a second conclusion writes no event.
2. A missing session is rejected. A bad body is rejected, including a one- or two-point ring and a threshold outside 0–120. A saved ring is returned on the next read. One driver does not receive another's ring.
3. A sortie already in progress does not change the choice by itself. Commencing one, or completing one, sets the choice available when that flag is on. A start 14 minutes out sets the choice unavailable. A start at exactly 15 minutes, and a start already in the past, do not, and neither one sets the choice available. Repeating an event that does not change the choice writes no event.
4. A GPS fix, inside or outside the saved ring, does not change the choice. Turning a flag off skips that direction. Starting guidance from the calendar sets the choice unavailable when Automatically Set Unavailable is on, and writes no further event when the choice is already unavailable. When that flag is off, the same Guide tap uses the commencement check.
5. The settings screen offers the threshold, both flags, and the geofence control. Web does not offer Create or Edit.

---

# 10. Remains unimplemented

- Duty, and who controls it
- Offers, assignment, and candidate selection
- A list of drivers who are available
- A background task that checks in while the app is suspended
- Using the availability geofence to change the choice
