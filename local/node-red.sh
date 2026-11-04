#!/bin/bash
# Start, stop or check the permanent Node-RED set up by local/setup-node-red.sh.
#   local/node-red.sh start | stop | restart | status | log
# Editor: http://127.0.0.1:1880   Dashboards: /dashboard/shake and /dashboard/console
set -uo pipefail

NODE_MAJOR=26
USER_DIR="$HOME/.node-red"
PID_FILE="$USER_DIR/node-red.pid"
LOG_FILE="$USER_DIR/node-red.log"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
. "$NVM_DIR/nvm.sh" >/dev/null 2>&1 && nvm use "$NODE_MAJOR" >/dev/null 2>&1

running() { [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; }

case "${1:-status}" in
  start)
    if running; then echo "Already running (pid $(cat "$PID_FILE")): http://127.0.0.1:1880"; exit 0; fi
    nohup node-red --userDir "$USER_DIR" >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    disown 2>/dev/null || true
    for _ in $(seq 1 30); do
      curl -s -o /dev/null http://127.0.0.1:1880/ && { echo "Node-RED running (pid $(cat "$PID_FILE")): http://127.0.0.1:1880"; exit 0; }
      sleep 1
    done
    echo "Node-RED did not answer within 30 s. Last log lines:"; tail -20 "$LOG_FILE"; exit 1 ;;
  stop)
    if running; then kill "$(cat "$PID_FILE")" && rm -f "$PID_FILE" && echo "Stopped."; else echo "Not running."; rm -f "$PID_FILE"; fi ;;
  restart)
    "$0" stop; sleep 2; "$0" start ;;
  status)
    if running; then echo "Running (pid $(cat "$PID_FILE")): http://127.0.0.1:1880"; else echo "Not running. Start with: $0 start"; fi ;;
  log)
    tail -40 "$LOG_FILE" ;;
  *)
    echo "Usage: $0 start|stop|restart|status|log"; exit 2 ;;
esac
