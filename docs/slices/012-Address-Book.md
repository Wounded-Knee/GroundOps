# Slice 012 — Address Book

## Status

**Previous slice:** 011 — Automatic Availability

**Derived from:** a chosen place on a sortie, as slice 003 defines, and Where to? search, as slice 002 defines.

**Purpose:** A driver can keep their own places, mark favorites, open guidance or a sortie from one, and pick a saved place or a typed coordinate without waiting on place search.

This document is the implementation boundary. A shared book, a company directory of places, and writing the phone's contacts stay outside. Phone postal addresses are read on the device. Groundops stores only the star.

---

# 1. User capability

After this slice, a signed-in driver can:

1. Open **Addresses** from the bottom menu, after Navigation. The book icon is filled while that screen is showing.
2. Add a place and edit it later. The record holds a location, an optional location nickname, and an optional location name. The location is a chosen place: address text plus coordinates. A nickname is the driver's private name, such as Hangar. A location name is the place's own name, such as Denny's, a plus code, or a coordinate pair.
3. Star a saved place. Favorites sort first. The star is Groundops only.
4. Delete a saved place.
5. On iOS or Android, tap **Guide** on a saved place or a phone address and get turn-by-turn search guidance to that coordinate. That guidance is not a sortie and does not run the meter. Web does not offer Guide.
6. Tap **Sortie** and get the compose dialog with that place as the only stop, wait 0, and passenger off.
7. Tap **Save address** on a chosen sortie stop. That stores the suggestion's name as the location name, leaves the nickname empty, and skips a place already saved at the same coordinates.
8. See matching saved places, and phone addresses when contacts permission is already granted, ahead of remote suggestions in Where to? and in a sortie stop field. The picker does not ask for contacts permission.
9. Type or paste a coordinate or a plus code and use it immediately, including when place search fails.

Opening Addresses asks to read the phone's contacts. Web has no phone section. A denial leaves the book usable and explains how to try again. Geocoding a phone address happens when the driver guides, starts a sortie, or picks that row, and the result stays in memory for the session. The list itself is not geocoded.

Sign-out and a rejected session clear the in-memory book. The next sign-in reads it again.

---

# 2. Actors

One actor: a signed-in driver. Reading or writing the book creates the driver, company, and relationship when they do not exist yet, the same way the calendar does.

One driver cannot read, change, star, or delete another driver's rows. Deleting the user removes that driver's entries and phone stars. Those rows are not "in use."

---

# 3. Domain objects

## 3.1 Address book entry

A place saved for one driver:

- `nickname` — optional. Empty is allowed.
- `place_name` — optional. Empty is allowed. The place's own name.
- `label` — the address text. Required and non-blank after trimming.
- `latitude`, `longitude` — required with the label. Latitude is within −90 through 90. Longitude is within −180 through 180.
- `favorite` — default false.

The title is the nickname, otherwise the location name, otherwise the address. The address is the second line. When both names are set, that line is the location name and then the address. When the title and the second line are the same string, the second line is omitted.

Favorites sort first, then by that title, then by id.

Two entries are the same place when both coordinates are within 0.0001 degrees. One-tap save from a sortie refuses the second one. The editor can still save another row at those coordinates.

## 3.2 Phone address star

A star on one postal address in the device contacts app. The row stores `driver_id`, `contact_id`, and `address_id`. It stores no name, street, phone number, or coordinate. Starring does not change the contacts app and does not read that app's own favorite.

The phone row the driver sees is read from the device: contact name and postal address. It is not an address book entry.

## 3.3 A typed place

A coordinate or plus code the driver types is a place suggestion, produced on the device. It is stored only when the driver saves it.

A coordinate suggestion's name and label are the latitude and longitude, each trimmed to six decimal places. A plus-code suggestion's name and label are the full code. Its detail is the coordinate pair.

A full plus code is absolute. Words after it are ignored. A short plus code is completed from the picker's bias, which is the navigation fix when that screen has one, otherwise the device position. A short code with no bias is not a place. A short code followed by a locality is left for place search, because that locality is the reference the code needs.

The device accepts:

- Decimal pairs, including parentheses, brackets, a slash, a trailing altitude, European semicolons (`40,7128; -74,0060`), and a trailing place name. A pair written longitude-first is swapped when the first number cannot be a latitude.
- Hemisphere forms (`40.7128 N, 74.006 W` and `N40.7128 W74.006`) and labeled latitude and longitude in either order.
- Degrees, minutes, and seconds, with symbols, spaces, or compact units, and decimal minutes (`40°26.7717 N`).
- `geo:` URIs, Google, Apple, and OpenStreetMap links, GeoJSON points, and `POINT` text, including an `SRID` prefix. On a Google place link, the pin (`!3d` / `!4d`) is the coordinate.
- Full plus codes in either case, and short plus codes when a bias is known.

A street such as `123 Main St, Springfield` is not parsed on the device. A shortened map link is not expanded on the device.

---

# 4. State transitions

- Create stores the trimmed nickname, place name, and label, with the chosen coordinates. Favorite starts false.
- Edit replaces any of the nickname, place name, and location. A new label is stored only together with both coordinates. Clearing a nickname or a place name stores an empty string. Clearing the label is rejected.
- Star and unstar change `favorite` only.
- Delete removes that driver's row. A missing row is already gone for a phone star, and is not found for an entry.
- Starring a phone address inserts the driver and the two device ids. A repeat star leaves the existing row.
- Unstarring removes that row and leaves the contact in place.
- One-tap save from a sortie creates an entry whose nickname is empty and whose place name is the suggestion name, unless an entry already sits on those coordinates.

No operational event is written. Another signed-in client sees a change on its next read.

---

# 5. Interfaces

## 5.1 Addresses

The screen lists saved places, then phone addresses when the device can show them.

**Add address** and **Edit** open one overlay, the same absolute backdrop and card as the sortie dialog. The fields, in order, are Location/address, Location nickname, and Location name. Save is enabled once a place is chosen. Cancel dismisses the overlay. Edit opens with the current place already chosen. Choosing a place fills the location name until that field has been typed. A saved location name counts as typed, so a later pick does not replace it. The nickname is left as typed.

Each saved row offers Favorite, Guide on iOS and Android, Edit, Sortie, and Delete. Each phone row offers Favorite, Guide on iOS and Android, and Sortie. A phone row has no Edit and no Delete.

Opening the screen requests contacts permission immediately, in parallel with loading the book. The request is not delayed for that load and is not skipped when the load is rejected. The installed Android client declares `READ_CONTACTS` and `WRITE_CONTACTS`. Without those declarations the permission dialog cannot appear. iOS uses the contacts usage string. Web treats contacts as unavailable and omits the phone section.

Denied permission shows that Groundops cannot read addresses from the contacts, with **Try again**. The saved book still works.

A failure to load, save, route, or locate a phone address is said on the screen. A rejected session follows the existing sign-out path.

## 5.2 Where to? and sortie stops

`AddressPicker` shows, while the driver types:

1. A place parsed on the device, when the text is a coordinate, plus code, map link, `geo:` URI, GeoJSON point, or `POINT`.
2. Up to five saved places, favorites first, whose nickname, location name, or address contains the text, ignoring case.
3. Up to five phone addresses, starred first, on the same rule, only when contacts permission is already granted.
4. Remote suggestions, except a remote place on the same coordinates as a saved entry.

The suggestion title is the display title from section 3.1. Choosing it fills the field with the address and uses the saved coordinates. Return accepts a place parsed on the device.

If remote search fails and a parsed place or a local match exists, the failure is not announced. Phone selection geocodes that one address, then selects it. A geocode failure is announced.

## 5.3 Guide and a sortie from the book

Guide reads the current GPS fix, requests the driving route from slice 002, and switches to Navigation in search guidance. No location, or a failed route, stays on the book. Web hides Guide.

Sortie opens the compose dialog from slice 003 with one stop. A phone row is geocoded first. A failure stays on the book and does not open the dialog.

---

# 6. Backend

Commands are HTTP JSON. Zod validates input at the boundary. Domain checks live in `apps/server`. Shared wire types live in `packages/contracts`.

| Operation | Request | Result |
| --- | --- | --- |
| Read the book | `GET /address-book` | `{ entries, phoneStars }` |
| Create an entry | `POST /address-book` with nickname, place name, label, latitude, longitude | The entry. Nickname and place name default to empty |
| Edit an entry | `PATCH /address-book/:id` with any of those fields and `favorite` | The entry |
| Delete an entry | `DELETE /address-book/:id` | Removed |
| Star a phone address | `POST /address-book/phone-stars` with `contactId` and `addressId` | Stored |
| Remove that star | `DELETE /address-book/phone-stars` with the same body | Removed |

The phone-star routes are registered before `/:id`.

A missing or revoked session is 401. An invalid body, a blank label, a coordinate out of range, an empty patch, or a label sent without both coordinates is 400. An entry id that is not that driver's is 404. A repeated phone star, and removing a star that is already gone, still succeed.

Lists are favorites first, then by the display title, then by id.

Place suggestions remain `POST /place-suggestions` from slice 002. The typed-place parse does not call that route.

---

# 7. Persistence

Drizzle owns the schema and the migrations.

`address_book_entry`: id, driver id, nickname, place name, label, latitude, longitude, favorite, created time. The driver id is indexed.

`address_book_phone_star`: driver id, contact id, address id. Those three columns are the primary key.

Primary keys on entries are server-generated UUIDs. Timestamps are `timestamptz` in UTC. Deleting a user deletes both tables for that driver before the driver row.

---

# 8. Realtime

The book does not publish or subscribe. A second signed-in client for the same driver sees a write on its next read.

---

# 9. Acceptance criteria

The slice works when all of the following are true:

1. A driver can create a place with a nickname, edit the nickname, star it, and delete it. Favorites list first. A blank label is rejected. An empty nickname is kept. A place name is stored trimmed.
2. A patch that sends a label without both coordinates is rejected. A patch that sends the label with both coordinates moves the place. An empty patch is rejected. Starring still patches favorite alone.
3. Another driver cannot list, rename, or delete the first driver's entry, and cannot see the first driver's phone stars.
4. A phone star stores only the driver and the two device ids. Repeating it does not add a row. The other driver cannot remove it. Removing it twice succeeds, and a blank id is rejected.
5. Saved-place search matches a nickname, a place name, and a street, ignoring case. Favorites come first, then other saved places, then starred phone addresses. Each source is capped at five. A remote place on a saved coordinate is dropped. The suggestion title is the nickname when one is set.
6. A decimal pair, a sexagesimal angle, a `geo:` URI, a map link, GeoJSON, WKT, a full plus code, and a short plus code with a bias become a place. A street, an empty string, and a short plus code with no bias do not.
7. The Addresses screen can add a place and edit the location, the nickname, and the location name. The list shows the nickname first. A sortie stop search shows that nickname first.
8. A missing token receives 401.

---

# 10. Remains unimplemented

- A book shared across drivers or companies
- Uploading phone contact fields, or writing the contacts app
- Editing or deleting a phone row
- Expanding a shortened map link on the device
- What3words, MGRS, UTM, and geohash
- An operational event for a saved place
- Live updates of the book
