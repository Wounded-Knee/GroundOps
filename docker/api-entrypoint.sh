#!/bin/sh
set -eu

attempt=0
until node --input-type=module -e 'import net from "node:net"; const socket=net.connect(4222,"127.0.0.1"); socket.on("connect",()=>{socket.end(); process.exit(0)}); socket.on("error",()=>process.exit(1));'; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 50 ]; then
    echo "NATS did not accept connections on 127.0.0.1:4222" >&2
    exit 1
  fi
  sleep 0.2
done

exec "$@"
