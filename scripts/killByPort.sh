#!/usr/bin/env bash

# Kill all processes listening on specified ports or port ranges.
#
# Usage:
#   ./killports.sh 3000 4000
#   ./killports.sh 3000-3010
#   ./killports.sh 3000 4000-4010 8080

if [[ $# -eq 0 ]]; then
    echo "Usage: $0 <port|start-end> [...]"
    exit 1
fi

declare -A PROCESSES

# Expand and validate port arguments
PORTS=()

for ARG in "$@"; do
    if [[ "$ARG" =~ ^([0-9]+)-([0-9]+)$ ]]; then
        START=${BASH_REMATCH[1]}
        END=${BASH_REMATCH[2]}

        if (( START < 1 || END > 65535 || START > END )); then
            echo "Invalid port range: $ARG"
            continue
        fi

        for ((PORT=START; PORT<=END; PORT++)); do
            PORTS+=("$PORT")
        done

    elif [[ "$ARG" =~ ^[0-9]+$ ]] && (( ARG >= 1 && ARG <= 65535 )); then
        PORTS+=("$ARG")

    else
        echo "Invalid port or range: $ARG"
    fi
done

# Find and terminate listening processes
for PORT in "${PORTS[@]}"; do

    PIDS=$(sudo lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | sort -u)

    if [[ -z "$PIDS" ]]; then
        continue
    fi

    for PID in $PIDS; do
        # Avoid processing the same process more than once
        [[ -n "${PROCESSES[$PID]}" ]] && continue
        PROCESSES[$PID]=1

        PROCESS=$(ps -p "$PID" -o comm= 2>/dev/null)

        echo "Killing PID $PID ($PROCESS) listening on port $PORT"

        sudo kill "$PID"
    done

done

echo "Done."

