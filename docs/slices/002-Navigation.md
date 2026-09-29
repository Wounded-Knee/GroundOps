# Slice 002 — Navigation

## Status

**Previous slice**

**Derived from:** Development Methodology (`docs/02-development-methodology.md`) section 6, the routing boundary in Technical Architecture (`docs/04-technical-architecture.md`) section 8, and the routing and location distinctions in Architectural Specification (`docs/01-architecture..md`) sections 8, 11, and 31 and in `docs/03-domain-model.md`.

**Purpose:** A signed-in person can search for a place on the phone and follow full-screen driving guidance to it.

This document is the implementation boundary for the map and for guidance. A second routing provider stays outside this slice. Choosing a Where to? suggestion authors a destination-only immediate sortie as slice 003 defines, before this screen previews a route or starts guidance. Persisted location observations are written by the calendar slice, not by guidance, except that this selection reports the current fix so that sortie can depart immediately. Technical Architecture section 8 leaves the on-device map toolkit to the navigation slice. This slice chooses `expo-maps`.

A later slice that navigates a sortie reuses this screen and this route result. It does not introduce a second navigation model.

---

# 1. User capability

After this slice, a person who is signed in, as slice 001 defines, can on iOS or Android:

1. Search for a destination and see a few labeled results.
2. See one driving route from their current location, drawn on the map, with distance and expected duration.
3. Start full-screen guidance. The map follows them heading-up. The next maneuver is shown. The trip shows remaining time, remaining distance, and arrival time. The phone speaks the maneuver.
4. Leave the route and receive a new route to the same destination.
5. Arrive, or end guidance and return to the map.
6. Sign out, so that session can no longer be used, as slice 001 defines.

The destination is the place they select. Selecting it authors the sortie from slice 003. This slice does not create a company or a vehicle.

On web, the signed-in screen from slice 001 stays as it is. Driving navigation is iOS and Android.

---

# 2. Actors

One actor: a person who is signed in on the local development client.

Selecting a destination ensures the signed-in person is a driver, as slice 003 defines. This slice does not give that person a role.

---

# 3. Development mode

This slice is demonstrable on the existing local stack:

- `pnpm dev:server`
- `pnpm dev:mobile`

The API uses host PostgreSQL. The client JavaScript is the Expo development server the app already uses.

`expo-maps` is not in Expo Go. The map runs in a local development build. Android uses `scripts/android.sh`. iOS uses a local development build of the same app. This slice adds no EAS build, no store build, and no deployed environment.

Web, reached through `pnpm dev:mobile`, stays on the slice 001 signed-in screen.

The server calls Google with one key, `GOOGLE_MAPS_API_KEY`. That key stays on the server. The client does not receive it. Android map tiles use a second key, `GOOGLE_MAPS_ANDROID_API_KEY`, app-restricted, read into the Expo config at `android.config.googleMaps.apiKey`. iOS draws Apple Maps and has no map key. `.env.example` names both variables and contains no real key. Secrets stay out of git.

| Key | Where it is used |
| --- | --- |
| `GOOGLE_MAPS_API_KEY` | Server only. Place suggestions and driving routes |
| `GOOGLE_MAPS_ANDROID_API_KEY` | Android map tiles in the development build |

The Google APIs this slice enables are Places API (New) and Routes API. The Android binary also needs the Maps SDK for Android on the tile key.

---

# 4. Map and routing

The platform owns the **driving route** the client displays. Google computes suggestions and the route. The server maps those results onto platform types and discards the Google payload.

The client draws the map with `expo-maps`: Google Maps on Android, Apple Maps on iOS. Driving guidance is the client's own chrome on top of that map. The client does not call Google for places or routes, and it does not embed the Google Navigation SDK.

The server has one provider module in `apps/server`, and one Google implementation of it. There is no provider registry and no second implementation. The module does two things:

- Suggest places for a text query.
- Compute one traffic-aware driving route between two coordinates.

A place id used to resolve a suggestion stays inside that server request. An encoded polyline is decoded on the server. The client receives coordinates, plain-text instructions, and a maneuver from the set in section 5. A Google maneuver name the provider cannot map becomes `straight`.

The expected duration is the traffic-aware duration when Google supplies one. The response has a single duration. It has no separate traffic-duration field.

The server writes nothing when the provider call fails, and nothing when Google returns no driving route.

---

# 5. Domain objects

These are results of a request. This slice does not store them, and they are not operational entities.

## 5.1 Place suggestion

A **place suggestion** is a label and a coordinate returned for a search query.

It is not a facility, a stop, or a sortie destination.

## 5.2 Driving route

A **driving route** is one path for a vehicle from an origin coordinate to a destination coordinate. It carries distance, expected duration, the path as coordinates, and an ordered series of steps.

It is not a sortie. A sortie's routing, when a later slice has sorties, is this kind of result.

## 5.3 Step

A **step** is one maneuver along the route. It carries a plain-text instruction, a maneuver, distance, duration, and the coordinates of that portion of the path.

The maneuver is one of:

`depart`, `straight`, `turn-left`, `turn-right`, `slight-left`, `slight-right`, `sharp-left`, `sharp-right`, `u-turn`, `roundabout`, `merge`, `fork-left`, `fork-right`, `ramp-left`, `ramp-right`, `arrive`.

## 5.4 Location

The client reads the device location to place the person on the map, to choose the route origin, to advance the current step, and to notice that the person has left the route.

A fix used for the map and for guidance is not, by that use, a **location observation**. This slice does not write location observations. The calendar slice does, from the signed-in app. Off-duty and on-duty GPS rules do not apply here, because this slice has no duty state.

---

# 6. State transitions

The states below are the phone's presentation of a route result. Selecting a suggestion also authors a sortie, as slice 003 defines. No duty or availability state changes.

| From | To | What happens |
| --- | --- | --- |
| Map | Route preview | The person selects a suggestion. The server authors a destination-only immediate sortie for that driver, then returns a driving route from the latest location fix. The map draws it. If the sortie is not created, the map stays and guidance does not start. |
| Route preview | Guiding | The person starts guidance. |
| Guiding | Guiding | The current step advances, or a reroute replaces the route and guidance continues on the new route. |
| Guiding | Arrived | The device is within 40 meters of the destination. |
| Route preview | Map | The person dismisses the preview. The route leaves the map. |
| Guiding | Map | The person ends guidance. The route leaves the map. |
| Arrived | Map | The person ends guidance. The route leaves the map. |
| Signed in on the map | Signed out | The server revokes the session presented by the client, as slice 001 defines. |

While guiding, including after arrival, the screen stays awake. It may sleep again once the person is back on the map. The app stays in portrait.

Guidance uses while-in-use location. This slice does not add background location.

A location fix advances at most the current step, and only when the device is within 30 meters of that step's end. Arrival takes precedence: within 40 meters of the destination, the screen shows arrival even if a step end is also inside its threshold.

The device is off the route when it stays more than 50 meters from the route path for 5 seconds. The client then requests a new driving route from that fix to the same destination. Returning inside 50 meters before 5 seconds have passed cancels that wait. The client does not send a second reroute request while one is in flight. If the reroute request fails, the previous route stays on screen and guidance continues on it.

Remaining distance is the distance from the device to the end of the current step, plus the distance of the later steps. Remaining time is the remaining fraction of the current step's duration, by distance, plus the duration of the later steps. Arrival time is the current time plus that remaining time. Both come from the route response in hand. A reroute replaces them.

---

# 7. Interfaces

On iOS and Android, the map is the Navigation destination after sign-in. A persistent bottom bar stays on screen during browse, preview, guidance, and arrival. Its destinations are Navigation, New Sortie, Settings, and Calendar. Sign out is on Settings.

**Map.** The map fills the screen. One search field. The person's location when permission is granted. The map has no sign-out control.

**Suggestions.** While the query is non-empty, up to five labels. Selecting a label requests the route. An empty query shows no suggestions.

**Route preview.** The route is drawn, with the destination. The screen shows distance, expected duration, and two actions: start guidance, and dismiss.

**Guiding.** The search field is not shown. A card shows the maneuver, the distance to the end of the current step, and the instruction. The camera follows the device, heading-up and tilted. The bearing follows the device course when the fix includes one, otherwise the device heading. When neither is available, the camera still centers on the fix. A bar shows remaining time, remaining distance, arrival time, and two controls: end guidance, and mute. Where the toolkit exposes a traffic layer, that layer is on. The spoken duration still comes only from the route response.

**Arrived.** The card shows that the person has arrived. End guidance returns to the map.

The phone speaks with the device speech synthesizer. It speaks the current step's instruction once when guidance starts, once when the current step changes, and once on arrival. Mute silences speech. The control starts unmuted. Turning sound back on does not repeat the current instruction.

On web, Navigation shows the slice 001 signed-in identity and live-connection state. Sign out is on Settings.

The person sees a failure in these cases:

- Location permission is denied, or no fix is available. The map stays up. Search may run without a bias point. Selecting a destination does not request a route, and the screen says that location is required.
- The search request fails, or the network is unreachable during search. The map stays up and the screen says that search failed.
- The server rejects the route request, or the network is unreachable. The map stays up with the selected destination and the screen says that the route failed. Guidance does not start.
- A reroute request fails. The previous route stays, guidance continues, and the screen says that rerouting failed.
- Sign-out fails because the network or server is unreachable. The person stays signed in and the screen says that sign-out failed, as slice 001 defines.

The client sends a location only as the route origin, the reroute origin, or the optional search bias. Those coordinates are not stored.

---

# 8. Backend

Commands and queries are HTTP JSON. Zod validates input at the boundary. The provider module lives in `apps/server`. Shared wire types live in `packages/contracts`.

| Operation | Request | Result |
| --- | --- | --- |
| Suggest places | `POST /place-suggestions` with the session token, a query, and an optional bias coordinate | Up to five suggestions, each a label and a coordinate. An empty query returns no suggestions and does not call Google. Rejection when the provider call fails |
| Compute a driving route | `POST /driving-routes` with the session token, an origin coordinate, and a destination coordinate | One driving route, including steps. Rejection when no driving route exists or the provider call fails |

A route the server returns has at least one step. A path is a list of latitude and longitude in degrees.

The authorization rules in this slice: a session may request place suggestions and a driving route. A missing, unknown, or revoked token is rejected. Place suggestions and driving routes do not check a company. There is no second credential and no policy engine.

---

# 9. Persistence

No new tables in this slice. Choosing a suggestion writes the sortie and the location observation that slice 003 defines.

A driving route is not stored. Search and guidance are not operational history events beyond that sortie.

Sign-out still revokes the session row from slice 001.

---

# 10. Realtime

The client still opens the authenticated socket from slice 001 after sign-in, and closes it on sign-out. This slice publishes no domain events, so an authenticated socket still receives no operational traffic.

Guidance, reroute, and arrival are local. They are not sent on the socket.

---

# 11. Acceptance criteria

The slice works when all of the following are true on the local stack:

1. A signed-in person on Android or iOS sees a full-screen map.
2. A non-empty search shows at most five labeled suggestions. An empty query shows none, and the server does not call Google for it.
3. With location available, selecting a suggestion authors a destination-only immediate sortie, then draws one driving route from the current location and shows distance and duration. If that sortie is not created, the route is not drawn and guidance does not start.
4. Starting guidance shows the current maneuver, the distance to it, remaining time, remaining distance, and arrival time, and the map follows the device heading-up.
5. The phone speaks the instruction when guidance starts and when the maneuver changes, once each. Mute silences speech. Speech starts unmuted. Turning sound back on does not repeat the current instruction.
6. A location fix within 30 meters of the current step's end shows the next step, and one fix changes at most one step.
7. Staying more than 50 meters from the route path for 5 seconds requests a new route to the same destination and shows that route. Returning inside 50 meters before 5 seconds does not request one.
8. A failed reroute leaves the previous route on screen and says that rerouting failed.
9. Within 40 meters of the destination, the screen shows arrival and speaks once.
10. Ending guidance, or dismissing a preview, returns to the map and clears the route.
11. Denied location permission, or no fix, leaves the person on the map and does not start a route.
12. A route the server rejects does not start guidance.
13. Sign-out revokes that session. On web, Navigation still shows identity and live-connection state. Sign out is on Settings.
14. Both endpoints reject a missing, unknown, or revoked session. A successful response contains coordinates and plain-text instructions, and does not contain a Google place id or an encoded polyline.
15. The driving route is not stored. The sortie authored by the selection remains. Guidance geometry is not in PostgreSQL after guidance ends or the server restarts.
16. The phone flow runs with `pnpm dev:server` and a local development build. Web runs with `pnpm dev:mobile` and stays on the signed-in screen. No EAS build and no store build are required.

---

# 12. Remains unimplemented

- Sorties, commencement, and completion
- Background location. Persisted location observations, and the multi-stop traffic-aware duration used for a sortie window, are slice 003. Guidance here remains a single origin and destination
- Alternative routes, and avoid-tolls or avoid-highways
- Lane guidance, speed limits, and offline maps
- Walking, transit, and Street View
- Traffic reports, and any traffic duration other than the single duration on the route response
- A second routing provider, and a provider registry
- Company, role, driver, vehicle, and duty checks on these endpoints
- EAS, store distribution, and a deployed environment
