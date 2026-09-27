#!/usr/bin/env bash
# Detect Android phones and connect adb to them by IP.
#
# USB phones are switched to TCP/IP with adb tcpip. A phone sharing its
# connection is the Wi-Fi gateway; that address comes from the default route.
# After tcpip, adb connects there. Wireless debugging is not required.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: adb-connect.sh [-p port]

Detect Android phones and connect adb to them by IP.

A phone that is sharing its connection is the Wi-Fi gateway. Plug it in over
USB and the script runs adb tcpip, then connects to the gateway address from
the current default route. Wireless debugging stays off in that setup, because
the phone is providing the network rather than joined to one.

  -p, --port PORT   adb TCP port (default: 5555, or $ADB_PORT)
  -h, --help        Show this help
EOF
}

is_ipv4() {
  local ip="$1"
  [[ "$ip" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
  ((10#${BASH_REMATCH[1]} <= 255 && 10#${BASH_REMATCH[2]} <= 255 &&
    10#${BASH_REMATCH[3]} <= 255 && 10#${BASH_REMATCH[4]} <= 255))
}

run_adb() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 15 adb "$@"
  else
    adb "$@"
  fi
}

device_label() {
  local serial="$1"
  local model
  model="$(adb -s "$serial" shell getprop ro.product.model 2>/dev/null | tr -d '\r' || true)"
  if [[ -n "$model" ]]; then
    printf '%s (%s)\n' "$model" "$serial"
  else
    printf '%s\n' "$serial"
  fi
}

host_default_gateway() {
  ip -4 route show default 2>/dev/null | awk '$1 == "default" && $2 == "via" { print $3; exit }'
}

usb_phone_present() {
  local dev vendor
  for dev in /sys/bus/usb/devices/*; do
    [[ -f "$dev/idVendor" ]] || continue
    vendor="$(cat "$dev/idVendor" 2>/dev/null || true)"
    case "$vendor" in
      04e8 | 18d1 | 2717 | 22b8 | 1004 | 0fce | 12d1 | 22d9 | 0bb4 | 0b05 | 17ef | 2e04) return 0 ;;
    esac
  done
  return 1
}

# GNOME's MTP handler keeps the phone's USB device open, which hides it from adb.
mtp_stopped=0
release_desktop_mtp() {
  usb_phone_present || return 0
  if systemctl --user is-active --quiet gvfs-mtp-volume-monitor.service 2>/dev/null; then
    systemctl --user stop gvfs-mtp-volume-monitor.service >/dev/null 2>&1 || true
    mtp_stopped=1
  fi
  pkill -u "$(id -u)" -x gvfsd-mtp >/dev/null 2>&1 || true
  sleep 0.3
}

restore_desktop_mtp() {
  [[ "$mtp_stopped" -eq 1 ]] || return 0
  systemctl --user start gvfs-mtp-volume-monitor.service >/dev/null 2>&1 || true
}

device_ipv4() {
  local serial="$1"
  local gateway="" ip=""

  # The hotspot address is this computer's default gateway. Prefer it when the
  # phone owns that address. The route toward the internet is often cellular
  # and is not reachable from here.
  gateway="$(host_default_gateway || true)"
  if is_ipv4 "${gateway:-}" && adb -s "$serial" shell ip -4 -o addr show 2>/dev/null | tr -d '\r' | awk -v gateway="$gateway" '
    $3 == "inet" {
      split($4, parts, "/")
      if (parts[1] == gateway) found = 1
    }
    END { exit found ? 0 : 1 }
  '; then
    printf '%s\n' "$gateway"
    return 0
  fi

  ip="$(adb -s "$serial" shell ip -4 -o addr show 2>/dev/null | tr -d '\r' | awk '
    $3 == "inet" {
      split($4, parts, "/")
      addr = parts[1]
      iface = $2
      if (iface == "lo" || addr ~ /^127\./ || addr ~ /^169\.254\./) next
      if (iface ~ /^(rmnet|ccmni|pdp|v4-rmnet|rmnet_data)/) next
      if (iface ~ /^(ap|softap|swlan|wlan|rndis|usb|ncm)/) {
        print addr
        exit
      }
    }
  ' || true)"
  ip="${ip%%[[:space:]]*}"
  if is_ipv4 "$ip"; then
    printf '%s\n' "$ip"
    return 0
  fi

  ip="$(adb -s "$serial" shell ip -4 route get 8.8.8.8 2>/dev/null | tr -d '\r' | awk '
    {
      for (i = 1; i <= NF; i++) {
        if ($i == "src") {
          print $(i + 1)
          exit
        }
      }
    }
  ' || true)"
  ip="${ip%%[[:space:]]*}"
  if is_ipv4 "$ip"; then
    printf '%s\n' "$ip"
    return 0
  fi

  ip="$(adb -s "$serial" shell ip -4 -o addr show 2>/dev/null | tr -d '\r' | awk '
    $3 == "inet" && $2 != "lo" {
      split($4, parts, "/")
      if (parts[1] ~ /^127\./ || parts[1] ~ /^169\.254\./) next
      print parts[1]
      exit
    }
  ' || true)"
  ip="${ip%%[[:space:]]*}"
  if is_ipv4 "$ip"; then
    printf '%s\n' "$ip"
    return 0
  fi

  ip="$(adb -s "$serial" shell getprop dhcp.wlan0.ipaddress 2>/dev/null | tr -d '\r' || true)"
  ip="${ip%%[[:space:]]*}"
  if is_ipv4 "$ip"; then
    printf '%s\n' "$ip"
    return 0
  fi

  return 1
}

is_online() {
  local target="$1"
  awk -v target="$target" '
    $1 == target && $2 == "device" { found = 1 }
    END { exit (found ? 0 : 1) }
  ' <<<"$devices_output"
}

connect_once() {
  local target="$1"
  local output
  output="$(run_adb connect "$target" 2>&1 || true)"
  printf '%s\n' "$output"
  [[ "$output" == "connected to "* || "$output" == "already connected to "* ]]
}

connect_with_retry() {
  local target="$1"
  local attempt output=""
  for attempt in 1 2 3 4 5 6; do
    sleep 1
    output="$(run_adb connect "$target" 2>&1 || true)"
    if [[ "$output" == "connected to "* || "$output" == "already connected to "* ]]; then
      printf '%s\n' "$output"
      return 0
    fi
  done
  printf '%s\n' "$output"
  return 1
}

record_success() {
  local ip="$1"
  local message="$2"
  handled["$ip"]=1
  connected=$((connected + 1))
  printf '%s\n' "$message"
}

record_failure() {
  local message="$1"
  failed=$((failed + 1))
  printf '%s\n' "$message" >&2
}

service_rank() {
  case "$1" in
    *tls-connect*) printf '3\n' ;;
    adb) printf '2\n' ;;
    scan | tether) printf '1\n' ;;
    *) printf '2\n' ;;
  esac
}

add_endpoint() {
  local host="$1"
  local svc_port="$2"
  local service="$3"
  local name="$4"
  local new_rank old_rank
  new_rank="$(service_rank "$service")"
  if [[ -n "${mdns_service[$host]:-}" ]]; then
    old_rank="$(service_rank "${mdns_service[$host]}")"
    if ((new_rank <= old_rank)); then
      return
    fi
  else
    mdns_hosts+=("$host")
  fi
  mdns_port["$host"]="$svc_port"
  mdns_name["$host"]="$name"
  mdns_service["$host"]="$service"
}

discover_lan() {
  python3 - "$1" <<'PY'
import ipaddress
import os
import select
import socket
import struct
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

ADB_SERVICES = {
    "_adb-tls-connect._tcp.local": "connect",
    "_adb-tls-pairing._tcp.local": "pair",
    "_adb._tcp.local": "connect",
}
SKIP_PREFIXES = (
    "docker",
    "br-",
    "veth",
    "virbr",
    "tun",
    "tap",
    "wg",
    "zt",
    "tailscale",
    "cni",
    "flannel",
    "cali",
)


def encode_name(name: str) -> bytes:
    out = bytearray()
    for label in name.rstrip(".").split("."):
        raw = label.encode()
        out.append(len(raw))
        out.extend(raw)
    out.append(0)
    return bytes(out)


def decode_name(data: bytes, offset: int) -> tuple[str, int]:
    labels = []
    cursor = offset
    jumped = False
    end = offset
    hops = 0
    while hops < 16 and cursor < len(data):
        length = data[cursor]
        if length == 0:
            cursor += 1
            if not jumped:
                end = cursor
            break
        if length & 0xC0 == 0xC0:
            if cursor + 1 >= len(data):
                break
            pointer = ((length & 0x3F) << 8) | data[cursor + 1]
            cursor += 2
            if not jumped:
                end = cursor
                jumped = True
            cursor = pointer
            hops += 1
            continue
        if cursor + 1 + length > len(data):
            break
        labels.append(data[cursor + 1 : cursor + 1 + length].decode("utf-8", "replace"))
        cursor += 1 + length
        if not jumped:
            end = cursor
    return ".".join(labels), end


def classify(name: str) -> tuple[str, str] | None:
    lowered = name.lower().rstrip(".")
    table = (
        ("_adb-tls-connect._tcp.local", "connect", "tls-connect"),
        ("_adb-tls-pairing._tcp.local", "pair", "tls-pairing"),
        ("_adb._tcp.local", "connect", "adb"),
    )
    for suffix, kind, token in table:
        if lowered == suffix or lowered.endswith("." + suffix):
            return kind, token
    return None


def parse_adb(data: bytes, src_ip: str) -> list[tuple[str, str, int, str, str]]:
    results = []
    if len(data) < 12:
        return results
    _ident, _flags, questions, answers, authorities, additionals = struct.unpack(
        ">HHHHHH", data[:12]
    )
    offset = 12
    for _ in range(questions):
        _name, offset = decode_name(data, offset)
        offset += 4
    instances = []
    ports = {}
    targets = {}
    addresses = {}
    for _ in range(answers + authorities + additionals):
        if offset >= len(data):
            break
        name, offset = decode_name(data, offset)
        if offset + 10 > len(data):
            break
        typ, _cls, _ttl, rdlen = struct.unpack(">HHIH", data[offset : offset + 10])
        offset += 10
        rdata_at = offset
        offset += rdlen
        if offset > len(data):
            break
        if typ == 12:
            instance, _end = decode_name(data, rdata_at)
            classified = classify(name)
            if classified:
                kind, token = classified
                instances.append((kind, token, instance))
        elif typ == 33 and rdlen >= 6:
            port = struct.unpack(">H", data[rdata_at + 4 : rdata_at + 6])[0]
            target, _end = decode_name(data, rdata_at + 6)
            key = name.rstrip(".").lower()
            ports[key] = port
            targets[key] = target.rstrip(".").lower()
        elif typ == 1 and rdlen == 4:
            addresses[name.rstrip(".").lower()] = socket.inet_ntoa(data[rdata_at : rdata_at + 4])

    def endpoint(kind: str, token: str, instance: str) -> tuple[str, str, int, str, str] | None:
        key = instance.rstrip(".").lower()
        port = ports.get(key)
        if not port:
            return None
        target = targets.get(key, "")
        ip = addresses.get(target) or addresses.get(key) or src_ip
        try:
            ipaddress.IPv4Address(ip)
        except ipaddress.AddressValueError:
            return None
        if ip.startswith("127."):
            return None
        label = instance.split(".", 1)[0] or ip
        return kind, ip, port, label, token

    for kind, token, instance in instances:
        found = endpoint(kind, token, instance)
        if found:
            results.append(found)
    if not instances:
        for key, _port in ports.items():
            classified = classify(key)
            if not classified:
                continue
            kind, token = classified
            found = endpoint(kind, token, key)
            if found:
                results.append(found)
    return results


def selftest() -> None:
    service = "_adb-tls-connect._tcp.local"
    instance = "phone._adb-tls-connect._tcp.local"
    host = "phone.local"

    def rr(name: str, typ: int, rdata: bytes) -> bytes:
        return encode_name(name) + struct.pack(">HHIH", typ, 1, 120, len(rdata)) + rdata

    message = struct.pack(">HHHHHH", 0, 0x8400, 0, 3, 0, 0)
    message += rr(service, 12, encode_name(instance))
    message += rr(instance, 33, struct.pack(">HHH", 0, 0, 5555) + encode_name(host))
    message += rr(host, 1, socket.inet_aton("192.168.1.50"))
    found = parse_adb(message, "192.168.1.50")
    if found != [("connect", "192.168.1.50", 5555, "phone", "tls-connect")]:
        raise SystemExit(f"selftest failed: {found!r}")

    compressed = struct.pack(">HHHHHH", 0, 0x8400, 0, 1, 0, 0)
    compressed += encode_name(service) + struct.pack(">HHIH", 12, 1, 120, 2) + b"\xc0\x0c"
    pointed, _end = decode_name(compressed, len(compressed) - 2)
    if pointed != service:
        raise SystemExit(f"selftest pointer failed: {pointed!r}")
    print("selftest ok")


def eligible(name: str) -> bool:
    return name != "lo" and not name.startswith(SKIP_PREFIXES)


def local_networks() -> list[tuple[str, ipaddress.IPv4Network, str]]:
    try:
        output = subprocess.check_output(["ip", "-4", "-o", "addr", "show", "scope", "global"], text=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f"Could not list network interfaces: {exc}", file=sys.stderr)
        return []
    networks = []
    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        iface = parts[1]
        if not eligible(iface):
            continue
        try:
            address, prefix = parts[3].split("/", 1)
            prefix_len = int(prefix)
        except ValueError:
            continue
        if prefix_len < 24:
            prefix_len = 24
        network = ipaddress.ip_network(f"{address}/{prefix_len}", strict=False)
        networks.append((iface, network, address))
    return networks


def gateways() -> dict[str, str]:
    found = {}
    try:
        output = subprocess.check_output(["ip", "-4", "route", "show", "default"], text=True)
    except (OSError, subprocess.CalledProcessError):
        return found
    for line in output.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[0] == "default" and parts[1] == "via" and "dev" in parts:
            found[parts[parts.index("dev") + 1]] = parts[2]
    return found


def reachable_hosts(iface: str, skip: set[str]) -> list[str]:
    try:
        output = subprocess.check_output(["ip", "-4", "neigh", "show", "dev", iface], text=True)
    except (OSError, subprocess.CalledProcessError):
        return []
    hosts = []
    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 4 or "lladdr" not in parts:
            continue
        if parts[-1] not in {"REACHABLE", "DELAY", "PROBE"}:
            continue
        ip = parts[0]
        if ip in skip:
            continue
        hosts.append(ip)
    return hosts


def query(name: str, unicast: bool) -> bytes:
    qclass = 1 | 0x8000 if unicast else 1
    return struct.pack(">HHHHHH", 0, 0, 1, 0, 0, 0) + encode_name(name) + struct.pack(">HH", 12, qclass)


def device_name(data: bytes) -> str | None:
    if len(data) < 12:
        return None
    _ident, _flags, questions, answers, authorities, additionals = struct.unpack(">HHHHHH", data[:12])
    offset = 12
    for _ in range(questions):
        _name, offset = decode_name(data, offset)
        offset += 4
    for _ in range(answers + authorities + additionals):
        if offset >= len(data):
            return None
        _name, offset = decode_name(data, offset)
        if offset + 10 > len(data):
            return None
        typ, _cls, _ttl, rdlen = struct.unpack(">HHIH", data[offset : offset + 10])
        offset += 10
        rdata = data[offset : offset + rdlen]
        offset += rdlen
        if typ != 16:
            continue
        index = 0
        while index < len(rdata):
            length = rdata[index]
            index += 1
            field = rdata[index : index + length].decode("utf-8", "replace")
            index += length
            if field.startswith("name=") and field[5:].strip():
                return field[5:].strip()
    return None


def listen_mdns(
    ifaces: list[tuple[str, str]], gateways: list[str]
) -> tuple[list[tuple[str, str, int, str, str]], dict[str, str]]:
    own_ips = {address for _iface, address in ifaces}
    sockets = []
    for iface, address in ifaces:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        except OSError:
            pass
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 255)
        try:
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(address))
        except OSError:
            pass
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, iface.encode())
        except OSError:
            pass
        sock.bind(("", 0))
        sock.setblocking(False)
        sockets.append(sock)

        listener = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        except OSError:
            pass
        try:
            listener.bind(("", 5353))
            membership = struct.pack("4s4s", socket.inet_aton("224.0.0.251"), socket.inet_aton(address))
            listener.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, membership)
            listener.setblocking(False)
            sockets.append(listener)
        except OSError:
            listener.close()

    names = [name for name in ADB_SERVICES] + ["_kdeconnect._udp.local"]
    destinations = [("224.0.0.251", 5353)] + [(gateway, 5353) for gateway in gateways]
    for sock in sockets:
        if sock.getsockname()[1] == 5353:
            continue
        for name in names:
            packet = query(name, True)
            for destination in destinations:
                try:
                    sock.sendto(packet, destination)
                except OSError:
                    pass

    found = []
    phone_names: dict[str, str] = {}
    deadline = time.time() + 3
    while time.time() < deadline:
        readable, _writable, _errors = select.select(sockets, [], [], 0.4)
        for sock in readable:
            try:
                data, addr = sock.recvfrom(9000)
            except OSError:
                continue
            src_ip = addr[0]
            if src_ip in own_ips:
                continue
            try:
                label = device_name(data)
                if label:
                    phone_names[src_ip] = label
                found.extend(parse_adb(data, src_ip))
            except Exception:
                continue
    for sock in sockets:
        sock.close()
    return found, phone_names


def scan_port(network: ipaddress.IPv4Network, port: int, skip: set[str]) -> list[str]:
    hosts = [str(host) for host in network.hosts() if str(host) not in skip]

    def probe(ip: str) -> str | None:
        try:
            with socket.create_connection((ip, port), timeout=0.3):
                return ip
        except OSError:
            return None

    if not hosts:
        return []
    with ThreadPoolExecutor(max_workers=64) as pool:
        return [ip for ip in pool.map(probe, hosts) if ip]


def main() -> None:
    if os.environ.get("ADB_CONNECT_SELFTEST") == "1":
        selftest()
        return
    port = int(sys.argv[1])
    networks = local_networks()
    route_gateways = gateways()
    ifaces = [(iface, address) for iface, _network, address in networks]
    gateway_list = []
    for iface, _network, address in networks:
        gateway = route_gateways.get(iface, "")
        if gateway and gateway != address and gateway not in gateway_list:
            gateway_list.append(gateway)
    endpoints, phone_names = listen_mdns(ifaces, gateway_list) if ifaces else ([], {})
    seen = set()
    connect_ips = set()
    for kind, ip, found_port, label, token in endpoints:
        key = (kind, ip, found_port)
        if key in seen:
            continue
        seen.add(key)
        if kind == "connect":
            connect_ips.add(ip)
        print(f"{kind}\t{ip}\t{found_port}\t{label}\t{token}")

    for gateway in gateway_list:
        if gateway in connect_ips:
            continue
        connect_ips.add(gateway)
        print(f"connect\t{gateway}\t{port}\t{phone_names.get(gateway, 'tether phone')}\ttether")

    scanned = []
    neighbor_count = 0
    gateway_ips = []
    for iface, network, address in networks:
        scanned.append(str(network))
        gateway = route_gateways.get(iface, "")
        if gateway:
            gateway_ips.append(gateway)
        skip = {address}
        for ip in scan_port(network, port, skip):
            if ip in connect_ips:
                continue
            connect_ips.add(ip)
            print(f"connect\t{ip}\t{port}\tWi-Fi\tscan")
        present = reachable_hosts(iface, {address, gateway} - {""})
        neighbor_count += len(present)
    print("info\tsubnets\t" + ",".join(scanned))
    print("info\tgateways\t" + ",".join(gateway_ips))
    print(f"info\tneighbors\t{neighbor_count}")


if __name__ == "__main__":
    main()
PY
}

port="${ADB_PORT:-5555}"
port_from_arg=0
selftest=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --selftest)
      selftest=1
      shift
      ;;
    -p | --port)
      [[ $# -ge 2 ]] || {
        echo "Missing value for $1." >&2
        exit 2
      }
      port="$2"
      port_from_arg=1
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ "$port_from_arg" -eq 1 ]]; then
        echo "Unexpected argument: $1" >&2
        usage >&2
        exit 2
      fi
      port="$1"
      port_from_arg=1
      shift
      ;;
  esac
done

if [[ $# -gt 0 ]]; then
  echo "Unexpected argument: $1" >&2
  usage >&2
  exit 2
fi

if [[ ! "$port" =~ ^[0-9]+$ ]] || ((port < 1 || port > 65535)); then
  echo "Port must be between 1 and 65535." >&2
  exit 2
fi

if [[ "$selftest" -eq 1 ]]; then
  ADB_CONNECT_SELFTEST=1 discover_lan "$port"
  exit
fi

if ! command -v adb >/dev/null 2>&1; then
  echo "adb is not on PATH. Install Android platform-tools." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is not on PATH. It is required to find phones on Wi-Fi." >&2
  exit 1
fi

trap restore_desktop_mtp EXIT
release_desktop_mtp
adb kill-server >/dev/null 2>&1 || true
adb start-server

devices_output="$(adb devices)"
mdns_output="$(adb mdns services 2>/dev/null || true)"

adb_usb_ready() {
  awk 'NR > 1 && $2 == "device" && $1 !~ /:/ && $1 !~ /^emulator-/ { found = 1 } END { exit found ? 0 : 1 }' <<<"$devices_output"
}

adb_usb_authorizing() {
  awk 'NR > 1 && $2 == "authorizing" { found = 1 } END { exit found ? 0 : 1 }' <<<"$devices_output"
}

wait_for_usb_adb() {
  local try announced=0
  for try in $(seq 1 45); do
    devices_output="$(adb devices)"
    if adb_usb_ready; then
      return 0
    fi
    if adb_usb_authorizing; then
      if [[ "$announced" -eq 0 ]]; then
        echo "USB debugging is authorizing. Waiting for the phone to become a device." >&2
        announced=1
      fi
      sleep 1
      continue
    fi
    if ! usb_phone_present; then
      return 0
    fi
    if [[ "$try" -eq 1 ]]; then
      echo "Phone is on USB. Waiting for adb." >&2
    fi
    sleep 1
  done
  devices_output="$(adb devices)"
}

usb_serials=()
unauthorized_serials=()
network_targets=()
mdns_hosts=()
declare -A mdns_port=()
declare -A mdns_name=()
declare -A mdns_service=()
declare -A pair_port=()
declare -A pair_name=()
declare -A handled=()
connected=0
failed=0
searched_subnets=""
gateway_list=""
neighbor_count=""

while read -r serial state _; do
  [[ -z "${serial:-}" ]] && continue
  [[ "$serial" == "List" ]] && continue
  case "$state" in
    device)
      if [[ "$serial" == emulator-* ]]; then
        continue
      fi
      if [[ "$serial" == *:* ]]; then
        network_targets+=("$serial")
      else
        usb_serials+=("$serial")
      fi
      ;;
    unauthorized | offline | authorizing)
      if [[ "$serial" != *:* && "$serial" != emulator-* ]]; then
        unauthorized_serials+=("$serial")
      fi
      ;;
  esac
done <<<"$devices_output"

while read -r instance service address; do
  [[ -z "${address:-}" ]] && continue
  [[ "$instance" == "List" ]] && continue
  [[ "$service" != *adb* ]] && continue
  host="${address%:*}"
  service_port="${address##*:}"
  [[ "$service_port" =~ ^[0-9]+$ ]] || continue
  is_ipv4 "$host" || continue
  if [[ "$service" == *pairing* ]]; then
    pair_port["$host"]="$service_port"
    pair_name["$host"]="$instance"
    continue
  fi
  add_endpoint "$host" "$service_port" "$service" "$instance"
done <<<"$mdns_output"

if ! lan_output="$(discover_lan "$port")"; then
  echo "Could not scan the local network for adb." >&2
  lan_output=""
fi

while IFS=$'\t' read -r kind host svc_port label service; do
  [[ -z "${kind:-}" ]] && continue
  case "$kind" in
    connect)
      is_ipv4 "$host" || continue
      [[ "$svc_port" =~ ^[0-9]+$ ]] || continue
      add_endpoint "$host" "$svc_port" "${service:-scan}" "${label:-Wi-Fi}"
      ;;
    pair)
      is_ipv4 "$host" || continue
      [[ "$svc_port" =~ ^[0-9]+$ ]] || continue
      pair_port["$host"]="$svc_port"
      pair_name["$host"]="${label:-$host}"
      ;;
    info)
      case "$host" in
        subnets) searched_subnets="$svc_port" ;;
        gateways) gateway_list="$svc_port" ;;
        neighbors) neighbor_count="$svc_port" ;;
      esac
      ;;
  esac
done <<<"$lan_output"

wait_for_usb_adb
usb_serials=()
unauthorized_serials=()
network_targets=()
declare -A usb_state=()
while read -r serial state _; do
  [[ -z "${serial:-}" ]] && continue
  [[ "$serial" == "List" ]] && continue
  case "$state" in
    device)
      if [[ "$serial" == emulator-* ]]; then
        continue
      fi
      if [[ "$serial" == *:* ]]; then
        network_targets+=("$serial")
      else
        usb_serials+=("$serial")
      fi
      ;;
    unauthorized | offline | authorizing)
      if [[ "$serial" != *:* && "$serial" != emulator-* ]]; then
        unauthorized_serials+=("$serial")
        usb_state["$serial"]="$state"
      fi
      ;;
  esac
done <<<"$devices_output"

for serial in "${unauthorized_serials[@]}"; do
  case "${usb_state[$serial]}" in
    authorizing)
      record_failure "${serial} is still authorizing USB debugging and has not become a device."
      ;;
    unauthorized)
      record_failure "${serial} is unauthorized. The phone is refusing this computer's adb key. If no Allow dialog is on screen, open Developer options, revoke USB debugging authorizations, then unplug and reconnect the cable."
      ;;
    *)
      record_failure "USB debugging on ${serial} did not finish (${usb_state[$serial]})."
      ;;
  esac
done

for serial in "${usb_serials[@]}"; do
  label="$(device_label "$serial")"
  if ! ip="$(device_ipv4 "$serial")"; then
    record_failure "${label}: no reachable IPv4 address."
    continue
  fi

  mdns_target=""
  if [[ -n "${mdns_port[$ip]:-}" ]]; then
    mdns_target="${ip}:${mdns_port[$ip]}"
  fi
  tcp_target="${ip}:${port}"

  if [[ -n "$mdns_target" ]] && is_online "$mdns_target"; then
    record_success "$ip" "${label}: already connected at ${mdns_target}."
    continue
  fi
  if is_online "$tcp_target"; then
    record_success "$ip" "${label}: already connected at ${tcp_target}."
    continue
  fi

  if [[ -n "$mdns_target" ]]; then
    echo "Connecting ${label} at ${mdns_target}."
    if message="$(connect_once "$mdns_target")"; then
      record_success "$ip" "${label}: ${message}."
      continue
    fi
    echo "${label}: wireless connect failed (${message}). Switching to TCP port ${port}." >&2
  fi

  echo "Connecting ${label} at ${tcp_target}."
  tcpip_output="$(adb -s "$serial" tcpip "$port" 2>&1 || true)"
  if [[ "$tcpip_output" != *"restarting in TCP mode port: ${port}"* ]]; then
    record_failure "${label}: could not enable TCP/IP (${tcpip_output})."
    continue
  fi

  echo "Waiting for ${label} to listen on ${tcp_target}."
  if message="$(connect_with_retry "$tcp_target")"; then
    record_success "$ip" "${label}: ${message}."
  else
    record_failure "${label}: ${message}."
  fi
done

for host in "${mdns_hosts[@]}"; do
  [[ -n "${handled[$host]:-}" ]] && continue
  target="${host}:${mdns_port[$host]}"
  name="${mdns_name[$host]}"
  if is_online "$target"; then
    record_success "$host" "${name}: already connected at ${target}."
    continue
  fi
  if [[ "${mdns_service[$host]:-}" == "tether" ]] && { adb_usb_authorizing || [[ ${#unauthorized_serials[@]} -gt 0 ]]; }; then
    continue
  fi
  echo "Connecting ${name} at ${target}."
  if message="$(connect_once "$target")"; then
    record_success "$host" "${name}: ${message}."
  else
    if [[ -n "${pair_port[$host]:-}" ]]; then
      record_failure "${name}: ${message}. Pair it with: adb pair ${host}:${pair_port[$host]}"
    elif [[ "${mdns_service[$host]:-}" == "tether" ]]; then
      if usb_phone_present; then
        record_failure "${name} at ${target} is not listening for adb. The phone is on USB, but it is not answering on the adb interface. Turn USB debugging off and on, set USB to File transfer, and reconnect the cable."
      else
        record_failure "${name} at ${target} is not listening for adb. This computer does not see the phone on USB. Use a data cable, unlock the phone, and choose File transfer."
      fi
    else
      record_failure "${name}: ${message}."
    fi
  fi
done

if [[ "${#pair_port[@]}" -gt 0 ]]; then
  for host in "${!pair_port[@]}"; do
    [[ -n "${handled[$host]:-}" ]] && continue
    [[ -n "${mdns_port[$host]:-}" ]] && continue
    record_failure "${pair_name[$host]} at ${host} is waiting for wireless-debugging pairing. Pair it with: adb pair ${host}:${pair_port[$host]}"
  done
fi

for target in "${network_targets[@]}"; do
  host="${target%:*}"
  [[ -n "${handled[$host]:-}" ]] && continue
  if is_ipv4 "$host"; then
    record_success "$host" "Already connected at ${target}."
  else
    echo "Already connected at ${target}."
    connected=$((connected + 1))
  fi
done

echo
if [[ "$connected" -eq 0 && "$failed" -eq 0 ]]; then
  echo "No Android phones found."
  if [[ -n "$searched_subnets" ]]; then
    echo "Searched USB, wireless-debugging mDNS, and TCP port ${port} on ${searched_subnets}."
  fi
  if [[ -n "$neighbor_count" && "$neighbor_count" != "0" ]]; then
    echo "${neighbor_count} other device(s) answered, and none are listening for adb."
    echo "Plug the phone in over USB and run this script again. It will enable adb over TCP."
  fi
else
  echo "Connected ${connected}, failed ${failed}."
fi

echo
adb devices

if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
