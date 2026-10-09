import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientIds = [
  ["GOOGLE_WEB_CLIENT_ID", "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID"],
  ["GOOGLE_ANDROID_CLIENT_ID", "EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID"],
  ["GOOGLE_IOS_CLIENT_ID", "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID"],
  ["GOOGLE_MAPS_WEB_API_KEY", "EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY"],
];

for (const [source, target] of clientIds) {
  if (!process.env[target]) {
    process.env[target] = process.env[source] ?? "";
  }
}

// Web browsers (notably Firefox fingerprinting protection) may report UTC while the
// host is not. Pin the calendar to the Expo host timezone for local web.
if (!process.env.EXPO_PUBLIC_CALENDAR_TIMEZONE) {
  process.env.EXPO_PUBLIC_CALENDAR_TIMEZONE =
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
}

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "../node_modules/expo/bin/cli");
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
