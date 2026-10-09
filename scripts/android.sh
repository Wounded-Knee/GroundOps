#!/usr/bin/env bash
# Run the Expo Android app against the adb device that is online now.
# A tethered phone shows up as <gateway>:<port>, not its USB serial.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${ADB_PORT:-5555}"
mode="run"

usage() {
  cat <<'EOF'
Usage: android.sh [run|start] [expo args...]

  run    Build, install, and launch (expo run:android). This is the default.
  start  Start Metro and open the installed app (expo start --android).

The adb serial is the phone at the current Wi-Fi gateway when that connection
is online. Otherwise the only online adb device is used.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    run | start)
      mode="$1"
      shift
      break
      ;;
    *)
      break
      ;;
  esac
done

if ! command -v adb >/dev/null 2>&1; then
  echo "adb is not on PATH. Install Android platform-tools." >&2
  exit 1
fi

gateway="$(ip -4 route show default 2>/dev/null | awk '$1 == "default" && $2 == "via" { print $3; exit }')"
candidate=""
if [[ -n "$gateway" ]]; then
  candidate="${gateway}:${port}"
fi

device_online() {
  local serial="$1"
  adb devices | awk -v serial="$serial" 'NR > 1 && $1 == serial && $2 == "device" { found = 1 } END { exit found ? 0 : 1 }'
}

if [[ -z "$candidate" ]] || ! device_online "$candidate"; then
  "$root/scripts/adb-connect.sh" || true
fi

target=""
if [[ -n "$candidate" ]] && device_online "$candidate"; then
  target="$candidate"
else
  mapfile -t online < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
  if [[ ${#online[@]} -eq 1 ]]; then
    target="${online[0]}"
  elif [[ ${#online[@]} -eq 0 ]]; then
    echo "No adb device is online." >&2
    exit 1
  else
    echo "More than one adb device is online. Set ANDROID_SERIAL and run again." >&2
    printf '  %s\n' "${online[@]}" >&2
    exit 1
  fi
fi

export ANDROID_SERIAL="$target"
echo "Using adb device ${ANDROID_SERIAL}" >&2

# #region agent log
python3 - "$root" "$ANDROID_SERIAL" <<'PY'
import json, subprocess, sys, time
root, serial = sys.argv[1], sys.argv[2]
try:
    devices = subprocess.check_output(["adb", "devices", "-l"], text=True, stderr=subprocess.STDOUT)
except subprocess.CalledProcessError as error:
    devices = error.stdout or str(error)
payload = {
    "sessionId": "4db1de",
    "runId": "pre-fix",
    "hypothesisId": "A",
    "location": "scripts/android.sh:device-selection",
    "message": "selected adb device before expo",
    "data": {"androidSerial": serial, "devices": devices},
    "timestamp": int(time.time() * 1000),
}
with open(f"{root}/.cursor/debug-4db1de.log", "a", encoding="utf-8") as handle:
    handle.write(json.dumps(payload) + "\n")
PY
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require ${root}/scripts/debug-adb-install-hook.cjs"
# #endregion

# The phone is the hotspot, so its localhost is not this computer. Forward
# Metro through adb, and advertise this computer's address on that network.
adb -s "$ANDROID_SERIAL" reverse tcp:8081 tcp:8081 >/dev/null
api_port="$(awk -F= '$1 == "PORT" { print $2; exit }' "$root/.env" 2>/dev/null || true)"
api_port="${api_port:-3000}"
adb -s "$ANDROID_SERIAL" reverse tcp:"$api_port" tcp:"$api_port" >/dev/null
if [[ -n "$gateway" ]]; then
  packager_host="$(ip -4 route get "$gateway" 2>/dev/null | awk '{ for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit } }')"
  if [[ -n "$packager_host" ]]; then
    export REACT_NATIVE_PACKAGER_HOSTNAME="$packager_host"
    # Node's --env-file does not override variables already set. The phone cannot use localhost.
    export EXPO_PUBLIC_API_URL="http://${packager_host}:${api_port}"
    echo "Metro host ${REACT_NATIVE_PACKAGER_HOSTNAME}:8081" >&2
    echo "API ${EXPO_PUBLIC_API_URL}" >&2
  fi
fi

cd "$root/apps/mobile"
set +e
case "$mode" in
  run)
    node --env-file=../../.env ./scripts/expo-with-env.mjs run:android "$@"
    ;;
  start)
    node --env-file=../../.env ./scripts/expo-with-env.mjs start --android "$@"
    ;;
  *)
    usage >&2
    status=2
    ;;
esac
status="${status:-$?}"
set -e
# #region agent log
python3 - "$root" "$status" "$mode" "$ANDROID_SERIAL" <<'PY'
import json, sys, time
root, status, mode, serial = sys.argv[1:]
payload = {
    "sessionId": "4db1de",
    "runId": "pre-fix",
    "hypothesisId": "E",
    "location": "scripts/android.sh:exit",
    "message": "android.sh finished",
    "data": {"status": int(status), "mode": mode, "androidSerial": serial},
    "timestamp": int(time.time() * 1000),
}
with open(f"{root}/.cursor/debug-4db1de.log", "a", encoding="utf-8") as handle:
    handle.write(json.dumps(payload) + "\n")
PY
# #endregion
exit "$status"
