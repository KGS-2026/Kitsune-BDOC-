#!/usr/bin/env bash
# ============================================================
# deploy.sh — install or update bdoc-wire on the droplet
# ============================================================
# WHY THIS EXISTS
# The daemon shares a droplet with Hermes, so an install has to be boring: the same
# result every time it runs, nothing touched outside its own paths, and no chance of
# a secret reaching a terminal scrollback or a chat log.
#
# Run it as root on the droplet from a copy of tools/wire:
#   bash tools/wire/deploy.sh
#
# Safe to run again at any time. It:
#   - never prints /etc/bdoc-wire/env, and never overwrites it once it exists
#   - never touches Hermes, /root/.hermes or any other service
#   - leaves /var/lib/bdoc-wire (the database) alone
#   - keeps the running version if the new one fails to copy

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP=/opt/bdoc-wire
ETC=/etc/bdoc-wire
ENV_FILE="$ETC/env"
UNIT=/etc/systemd/system/bdoc-wire.service
NODE_BIN=/usr/bin/node
NODE_MIN=22

die() { echo "deploy: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"
[ -f "$SRC/wire.js" ] && [ -d "$SRC/lib" ] && [ -f "$SRC/bdoc-wire.service" ] || die "run from a copy of tools/wire"

# ProtectHome hides /root and /home from the service, so a Node installed by nvm under
# either would start here and then fail under systemd. Check the path the unit uses.
[ -x "$NODE_BIN" ] || die "$NODE_BIN not found. The unit needs a system Node, not nvm"
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge "$NODE_MIN" ] || die "Node $NODE_MIN+ required, found $NODE_MAJOR"

# Syntax-check before touching anything live. A typo should fail here, not in a restart.
for f in "$SRC/wire.js" "$SRC"/lib/*.js; do
  "$NODE_BIN" --check "$f" || die "syntax error in $f"
done

# Build beside the live copy and swap, so a failed copy leaves the old one intact.
# dev-server.js and the README are deliberately not installed.
NEW="$(mktemp -d /opt/.bdoc-wire.XXXXXX)"
trap 'rm -rf "$NEW"' EXIT
cp -R "$SRC/wire.js" "$SRC/lib" "$NEW/"
chown -R root:root "$NEW"
find "$NEW" -type d -exec chmod 0755 {} +
find "$NEW" -type f -exec chmod 0644 {} +

if [ -d "$APP" ]; then
  OLD="$(mktemp -d /opt/.bdoc-wire-old.XXXXXX)"
  mv "$APP" "$OLD/app"
  mv "$NEW" "$APP"
  rm -rf "$OLD"
else
  mv "$NEW" "$APP"
fi

# Created once, with no values. Everything after this reads the file without showing it.
install -d -m 0750 -o root -g root "$ETC"
if [ ! -e "$ENV_FILE" ]; then
  ( umask 077
    cat > "$ENV_FILE" <<'TEMPLATE'
# bdoc-wire environment. Spec section 10. Readable by root only.
WIRE_TOPIC=
WIRE_INGEST_KEY=
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
# Optional, these are the defaults:
# WIRE_SITE=https://kgsbdoc.netlify.app
# WIRE_DB=/var/lib/bdoc-wire/wire.db
TEMPLATE
  )
  echo "deploy: created an empty $ENV_FILE"
fi
chown root:root "$ENV_FILE"
chmod 0600 "$ENV_FILE"

install -m 0644 -o root -g root "$SRC/bdoc-wire.service" "$UNIT"
systemctl daemon-reload
systemctl enable bdoc-wire >/dev/null 2>&1

# Tests only that the names are set. grep -q prints nothing.
for name in WIRE_TOPIC WIRE_INGEST_KEY SUPABASE_URL SUPABASE_PUBLISHABLE_KEY; do
  if ! grep -q "^${name}=." "$ENV_FILE"; then
    echo "deploy: installed but NOT started: $name is empty in $ENV_FILE"
    echo "deploy: fill it in, then run: systemctl restart bdoc-wire"
    exit 0
  fi
done
for name in TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID; do
  grep -q "^${name}=." "$ENV_FILE" || echo "deploy: WARNING $name is empty, pages will not be delivered"
done

systemctl restart bdoc-wire
sleep 5
if ! systemctl is-active --quiet bdoc-wire; then
  echo "deploy: bdoc-wire did not stay up. Recent log:" >&2
  journalctl -u bdoc-wire -n 20 --no-pager >&2
  exit 1
fi

echo "deploy: bdoc-wire is running"
journalctl -u bdoc-wire -n 5 --no-pager --output=cat
