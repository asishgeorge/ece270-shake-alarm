#!/bin/sh
# Local stand-in for the class broker, for development and the 30-student simulation.
# Like HiveMQ Cloud it requires a login. Listens on:
#   mqtt://localhost:1883   (Node-RED)
#   ws://localhost:9001     (phone page, opened as http://localhost:8080/?broker=ws://localhost:9001)
# Test logins: student / $STUDENT_PASS (default dev-student), instructor / $INSTRUCTOR_PASS (default dev-instructor).
# Set BIND=0.0.0.0 to let a phone on the same Wi-Fi reach it (home network only; campus Wi-Fi blocks this).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
STATE="$HERE/.state"
mkdir -p "$STATE"
STUDENT_PASS="${STUDENT_PASS:-dev-student}"
INSTRUCTOR_PASS="${INSTRUCTOR_PASS:-dev-instructor}"
BIND="${BIND:-127.0.0.1}"
MOSQ="$(command -v mosquitto || echo "$(brew --prefix)/sbin/mosquitto")"

rm -f "$STATE/passwd"
touch "$STATE/passwd"
chmod 600 "$STATE/passwd"
mosquitto_passwd -b "$STATE/passwd" student "$STUDENT_PASS"
mosquitto_passwd -b "$STATE/passwd" instructor "$INSTRUCTOR_PASS"

cat > "$STATE/mosquitto.conf" <<CONF
allow_anonymous false
password_file $STATE/passwd
log_type error
log_type warning
log_type notice
listener 1883 $BIND
listener 9001 $BIND
protocol websockets
CONF

echo "Local broker: mqtt://$BIND:1883 and ws://$BIND:9001 (Ctrl-C to stop)"
exec "$MOSQ" -c "$STATE/mosquitto.conf"
