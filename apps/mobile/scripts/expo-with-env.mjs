import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientIds = [
  ["GOOGLE_WEB_CLIENT_ID", "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID"],
  ["GOOGLE_ANDROID_CLIENT_ID", "EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID"],
  ["GOOGLE_IOS_CLIENT_ID", "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID"],
];

for (const [source, target] of clientIds) {
  if (!process.env[target]) {
    process.env[target] = process.env[source] ?? "";
  }
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
