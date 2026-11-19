#!/usr/bin/env bash
# install.sh — install or update the p201 outage alarm on the droplet (run as root).
# Safe to re-run. Never overwrites /etc/bdoc-alarm/pings.env once it exists.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

install -m 0755 "$here/bdoc-alarm-ping" /usr/local/bin/bdoc-alarm-ping
for u in bdoc-alarm.service bdoc-alarm.timer bdoc-alarm-lifecycle.service bdoc-alarm-canary.service; do
  install -m 0644 "$here/$u" "/etc/systemd/system/$u"
done

install -d -m 0700 /etc/bdoc-alarm
if [ ! -e /etc/bdoc-alarm/pings.env ]; then
  install -m 0600 "$here/pings.env.example" /etc/bdoc-alarm/pings.env
  echo "created /etc/bdoc-alarm/pings.env from the template: fill in the ping URLs"
fi
chmod 0600 /etc/bdoc-alarm/pings.env

systemctl daemon-reload
systemctl enable --now bdoc-alarm-canary.service bdoc-alarm-lifecycle.service bdoc-alarm.timer
systemctl --no-pager --plain list-timers bdoc-alarm.timer
echo "installed. test a round now with: systemctl start bdoc-alarm.service && journalctl -u bdoc-alarm -n 20"
