# p201 outage alarm (droplet → Healthchecks.io → Telegram)

The droplet pings Healthchecks.io every 2 minutes. Healthchecks.io sends the Telegram (and email) alerts
when pings stop or a failure ping arrives, and a recovery message when they resume. Nothing here holds a
Telegram token; the ping URLs live only in `/etc/bdoc-alarm/pings.env` on the droplet (root, mode 600).

| Healthchecks.io check | Period / grace | DOWN means |
|---|---|---|
| Droplet heartbeat | 2 min / 2 min | no ping for 4 min: power loss, hard shutdown, network gone, or the timer died |
| Hermes gateway service | 2 min / 2 min | `hermes-gateway` not active (instant `/fail`), or silence |
| BDOC LIVE WIRE collector service | 2 min / 2 min | `bdoc-wire` not active (instant `/fail`), or silence |
| Alarm canary | 2 min / 2 min | test service, safe to kill |
| Droplet PLANNED shutdown/reboot | 1 day / 1 day | a clean shutdown or reboot started (`/fail` from `ExecStop`); UP again at boot |

A real power loss sends four DOWN alerts at once (heartbeat plus the three service checks, all silent).

## Files

- `bdoc-alarm-ping` → `/usr/local/bin/`: `tick` (timer), `boot` / `shutdown` (lifecycle unit). Dormant without `pings.env`.
- `bdoc-alarm.service` + `bdoc-alarm.timer`: one round every 120 s.
- `bdoc-alarm-lifecycle.service`: boot and clean-shutdown signals. **Do not stop it by hand**; stopping it sends the shutdown alert.
- `bdoc-alarm-canary.service`: `sleep infinity`, only for testing.
- `install.sh`: install or update (as root). Never overwrites an existing `pings.env`.
- `pings.env.example`: the template. Never commit real ping URLs.

## Watch another service

Add the unit to `BDOC_ALARM_SERVICES` in `/etc/bdoc-alarm/pings.env`, create a Healthchecks.io check
(2 min / 2 min), and add `HC_SVC_<unit name with - as _>=<ping URL>`. No restart needed.

## Pass test (run 2026-11-19, all passed)

```bash
systemctl kill -s KILL bdoc-alarm-canary   # Telegram DOWN within ~2 min
systemctl start bdoc-alarm-canary          # Telegram UP within ~2 min
systemctl stop bdoc-alarm.timer            # heartbeat DOWN within ~4-5 min (power-loss path)
systemctl start bdoc-alarm.timer           # all UP on the next round
```

Tests: `node --test tests/alarm-p201.test.js`.
