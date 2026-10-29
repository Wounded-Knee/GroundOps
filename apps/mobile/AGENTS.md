This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation

This app does not use Expo Router. There is no `src/app/` directory.

- `index.ts` registers the root component.
- `App.tsx` is the shell. It owns session phase, the signed-in tab, the compose dialog, the account websocket, availability, and Android overlay consent.
- Signed-in navigation is a `destination` string (`navigation`, `addresses`, `calendar`, `settings`, `directory`) set by `BottomNav`. It is not a file-based router.
- On native, `NavigationScreen` stays mounted under the other tabs so an active route survives a tab change. Calendar, addresses, settings, and directory are covers on top of the map.
- On web, the map screen mounts only while that tab is selected.

## Platform files

Metro loads a `*.web.tsx` file instead of the native file on web:

- `src/AppFrame.web.tsx` omits `react-native-keyboard-controller`.
- `src/NavigationScreen.web.tsx` is a read-only account overview. It is not the native guidance screen.
- `src/GeofenceEditor.web.tsx` renders nothing. Settings does not open the geofence editor on web.

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- `ios/` is generated (Continuous Native Generation). Do not create it by hand.
- `android/` is committed because picture-in-picture guidance needs a customized host. `modules/always-on-top/app.plugin.js` writes the picture-in-picture lifecycle into `android/app/src/main/java/com/groundops/app/MainActivity.kt` (`guidanceKeptAlive`, `onPause`, `onPictureInPictureModeChanged`). Do not regenerate `android/` in a way that drops that host. Other native behavior belongs in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
