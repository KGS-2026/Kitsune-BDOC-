# p202 droplet lockdown

Item 1b chunk A of the November master plan. Everything here runs on the droplet as root.
Netlify 404s `/tools/*`, so none of it is served by the site.

| File | Installed at | What it does |
|---|---|---|
| `apply-firewall.sh` | run from here | ufw: inbound SSH only; outbound DNS, NTP, DHCP, 80, 443 and 22 (git to GitHub). Everything else is dropped and logged as `[UFW BLOCK]`. Arms a 5-minute auto-disable unless run with `--no-rollback`. |
| `10-bdoc-hardening.conf` | `/etc/ssh/sshd_config.d/` | Keys only, root by key only, no X11 or agent forwarding, 3 auth tries, 30 s login grace. |
| `fail2ban-bdoc.local` | `/etc/fail2ban/jail.d/bdoc.local` | 5 failed SSH logins in 10 min → 1 h ban; 3 bans in a day → 1 week ban. |
| `bdoc-tripwire` | `/usr/local/bin/` | Compares the droplet with a saved baseline every 5 min and pings Healthchecks (`HC_TRIPWIRE` in `/etc/bdoc-alarm/pings.env`), which pages Telegram. |
| `bdoc-tripwire.service` / `.timer` | `/etc/systemd/system/` | Runs the tripwire 3 min after boot, then every 5 min. |

## Install (fresh droplet)

```bash
# 1. firewall: keep this SSH session open, then check a NEW login works within 5 minutes
bash apply-firewall.sh
systemctl stop bdoc-fw-rollback.timer        # only after the new login worked

# 2. ssh
install -m 0644 10-bdoc-hardening.conf /etc/ssh/sshd_config.d/
sshd -t && systemctl restart ssh             # then test a NEW login before closing this one

# 3. fail2ban
apt-get install -y fail2ban
install -m 0644 fail2ban-bdoc.local /etc/fail2ban/jail.d/bdoc.local
systemctl enable --now fail2ban && fail2ban-client status

# 4. tripwire (needs HC_TRIPWIRE in /etc/bdoc-alarm/pings.env)
install -m 0755 bdoc-tripwire /usr/local/bin/
install -m 0644 bdoc-tripwire.service bdoc-tripwire.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now bdoc-tripwire.timer
bdoc-tripwire accept                          # the timer's first run flags itself as a new service
```

## When the tripwire alerts

The Telegram message lists what changed. Look at it on the droplet:

- `NEW PUBLIC PORT …`: `ss -tulpn`. Something is listening on the internet that was not before.
- `SSH KEYS CHANGED …`: `cat /root/.ssh/authorized_keys`. A key was added or removed.
- `NEW ROOT-LEVEL ACCOUNT …`: `awk -F: '$3==0' /etc/passwd`.
- `SSHD CONFIG CHANGED` / `NEW ENABLED SERVICE …` / `SYSTEM CRONTAB CHANGED`: someone changed the system.
- `NEW PROGRAM …`: a program path that has never run here before. Alerts once, then is learned.
- `SUSPICIOUS PROGRAM …`: something running from `/tmp`, `/dev/shm` or a deleted file. Always alerts. Treat as an intrusion until proven otherwise.
- `BLOCKED OUTBOUND …`: the firewall stopped the droplet connecting out to that address and port. If a legitimate new feature needs it, add a `ufw allow out` rule to `apply-firewall.sh` and re-run it.

If the change was expected (you installed something, rotated a key), run `bdoc-tripwire accept`.
Port, key, account, sshd, service and cron changes keep alerting every 5 minutes until accepted.

`bdoc-tripwire show` prints the current snapshot. State is in `/var/lib/bdoc-tripwire/`.

## Undo

```bash
ufw --force disable
rm /etc/ssh/sshd_config.d/10-bdoc-hardening.conf && systemctl restart ssh
systemctl disable --now fail2ban bdoc-tripwire.timer
```

Backups taken before the change: `/root/bdoc-backup-p202/` (sshd config and iptables rules).
