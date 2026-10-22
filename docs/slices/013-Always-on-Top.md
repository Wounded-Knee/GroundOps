# Slice 013 — Always on Top

## Status

**Previous slice:** 012 — Address Book

**Derived from:** guiding and arrived on the navigation map, as slice 002 defines, including VisualAlert `throb(10)` when guidance is muted.

**Purpose:** While guidance or arrival is active, leaving the Android app floats the map alone above other apps, and VisualAlert still covers the full display.

This document is the implementation boundary. An iOS or web floating map, a setting to turn the window off, and any change to guidance, mute, the meter, or availability stay outside.

---

# 1. User capability

After this slice, a signed-in driver on Android can:

1. Leave the app during guidance or arrival, by going to the home screen or another application, and keep a small portrait map above that screen. The map shows the route, the driver's position, the destination, and traffic. It does not show search, the maneuver or arrival card, map buttons, icons, the preview sheet, messages, the departure countdown, the meter, the availability indicator, the bottom menu, another signed-in screen, or any overlay.
2. Do that while Calendar, Settings, Addresses, Directory, or the sortie dialog is the screen they left. The map underneath is what floats.
3. Tap the floating window and return to that same screen, still guiding or arrived.
4. Close the floating window from the system and leave guidance running. Opening Groundops again shows the screen they left.
5. End guidance while the window is up and have the window close.
6. Hear speech, follow a reroute, and keep the meter and the location watch running while the window is up.
7. See VisualAlert at the full size of the display while the map is floating, when Android has granted Display over other apps. The steady rim shows when that alert is enabled. A throb still runs when the rim is off, including VisualAlert `throb(10)` for a muted maneuver. The alert does not take touches or focus.
8. Be asked for Display over other apps on the first launch, before guidance starts. That screen is the consent for always on top. Leaving it without the grant is a decline: later launches do not open it again, and the map does not float. Settings has a button that opens the same screen at any time. After the grant is held, leaving the app during guidance or arrival floats the map. Guidance is not blocked while the grant is missing.

Browse and route preview do not float. The Back gesture does not float the map. iOS and web keep the behavior from slice 002: leaving the app does not leave a map above other apps, and VisualAlert stays inside the app.

A phone on Android 7, or a device without picture-in-picture, does not float the map.

---

# 2. Actors

One actor: a signed-in driver. No new role.

---

# 3. Domain objects

None. This slice is phone presentation.

The sortie, the meter, the route, and the availability choice do not change because the window floated or closed.

---

# 4. State transitions

- Guiding or arrived, on any signed-in screen, becomes the same guidance inside the floating map when the driver leaves for the home screen or another app.
- Tapping the window, or opening Groundops again after closing it, returns to the screen that was showing. Guidance or arrival continues.
- Closing the window from the system does not end guidance.
- Ending guidance while the window is up closes the window and returns to the map, as slice 002 defines for ending guidance.
- Browse and route preview never float.

No operational event is written.

---

# 5. Interfaces

On Android, during guiding or arrived, and while Display over other apps is granted, the activity enters picture-in-picture when the driver leaves the app. The window is portrait. The route line is thin enough to read in that window. The camera stays in the mode already chosen, follow or overview.

While the window is up, the in-app chrome listed in section 1 is not drawn. Those screens stay as they were and reappear when the window expands. Safe area insets and the keyboard inset are dropped so the map fills the window.

VisualAlert, when the Display over other apps grant is held, is a separate full-screen overlay on the display, not a child of the floating window. It uses the same color, intensity, brightness, edges, and throb timing as the in-app alert. The rim reaches the physical screen edges. The floating window does not draw that alert, or any other overlay. The overlay is removed when the window closes or guidance ends.

The installed Android client declares picture-in-picture on the main activity and `SYSTEM_ALERT_WINDOW` for that overlay. `smallestScreenSize` stays in the activity config changes so entering the window does not recreate the activity and drop the route. Expo Go does not include this. A local Android development build is required.

iOS and web have no floating window and no overlay prompt.

---

# 6. Backend

No new commands or queries.

---

# 7. Persistence

No new tables. The overlay grant belongs to the operating system. Remembering that the first-launch prompt already opened is stored on the device, so a decline is not asked again.

---

# 8. Realtime

This slice publishes and subscribes to nothing.

---

# 9. Acceptance criteria

The slice works when all of the following are true:

1. On an Android development build with Display over other apps granted, leaving the app during guidance or during arrival shows a portrait map and hides the chrome from section 1. Leaving during browse or route preview does not float a window. Back does not float a window.
2. Leaving from Calendar, with guidance still active underneath, floats that map. Tapping the window returns to Calendar. Closing the window from the system does not end guidance.
3. Ending guidance while the window is up closes the window.
4. The first Android launch opens Display over other apps when that grant is missing. Declining it does not open that screen on a later launch, and leaving the app does not float the map. Settings can open that screen at any time. With the grant held, a muted maneuver throbs on the full display and does not take touches. The floating map does not also draw that alert.
5. iOS and web do not float a map when the app is left.
6. Speech, reroute, the meter, and the location watch continue while the window is up. The sortie, the meter reading, and availability are unchanged by the window itself.

---

# 10. Remains unimplemented

- A floating map on iOS or web
- A setting to turn the window off
- Any change to guidance, mute, the meter, or availability
- Background location beyond what earlier slices already run
