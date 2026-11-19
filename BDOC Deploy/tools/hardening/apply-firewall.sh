#!/usr/bin/env bash
# apply-firewall.sh — p202 droplet firewall (run as root).
# Incoming: SSH only. Outgoing: web (80/443), DNS, time (NTP), DHCP, and SSH to GitHub
# (Hermes pushes over git+ssh). Everything else is dropped and logged as [UFW BLOCK],
# which bdoc-tripwire reports to Telegram.
#
# Safety: unless called with --no-rollback, a timer turns the firewall back OFF after
# 5 minutes. Once a fresh SSH login works, cancel it with:
#   systemctl stop bdoc-fw-rollback.timer
set -euo pipefail

rollback=1
[ "${1:-}" = "--no-rollback" ] && rollback=0

if [ "$rollback" = 1 ]; then
  systemctl stop bdoc-fw-rollback.timer 2>/dev/null || true
  systemd-run --quiet --on-active=300 --unit=bdoc-fw-rollback /usr/sbin/ufw --force disable
  echo "rollback armed: firewall turns off at $(date -u -d '+5 min' +%H:%M:%SZ) unless cancelled"
fi

ufw --force reset >/dev/null
ufw default deny incoming
ufw default deny outgoing
ufw default deny routed

ufw allow in 22/tcp comment 'ssh in (keys only, fail2ban)'

ufw allow out 53 comment 'dns'
ufw allow out 123/udp comment 'ntp'
ufw allow out 67:68/udp comment 'dhcp'
ufw allow out 80/tcp comment 'http'
ufw allow out 443/tcp comment 'https'
ufw allow out 22/tcp comment 'git over ssh (GitHub)'

ufw logging low
ufw --force enable
ufw status verbose
