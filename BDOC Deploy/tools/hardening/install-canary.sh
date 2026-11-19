#!/usr/bin/env bash
# install-canary.sh — p205 droplet canary (run as root, from this folder).
#
#   KGS_OPS_TOKEN=<decoy token> bash install-canary.sh
#
# The decoy token is NOT in the repo. Only its sha256 is, in netlify/functions/canary.mjs, so if
# someone steals the file and tries the token at /ops/auth the site pages "droplet compromised".
# To make a new one: node -e "console.log('kgsops_'+require('crypto').randomBytes(24).toString('hex'))"
# and put its sha256 into DROPLET_DECOY_SHA256 in canary.mjs.
set -euo pipefail
: "${KGS_OPS_TOKEN:?set KGS_OPS_TOKEN to the decoy token}"
FILE=/root/.config/kgs-ops/credentials.env

command -v auditctl >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -q auditd >/dev/null

mkdir -p "$(dirname "$FILE")"
chmod 700 "$(dirname "$FILE")"
umask 077
cat > "$FILE" <<EOF
# KGS ops console — service credentials (rotated 2026-09). Do not commit.
KGS_OPS_CONSOLE=https://kgsbdoc.netlify.app/ops/auth
KGS_OPS_TOKEN=$KGS_OPS_TOKEN
# usage: curl -H "Authorization: Bearer \$KGS_OPS_TOKEN" \$KGS_OPS_CONSOLE
EOF
chmod 600 "$FILE"

install -m 0640 bdoc-canary.rules /etc/audit/rules.d/bdoc-canary.rules
augenrules --load >/dev/null
systemctl enable --now auditd >/dev/null 2>&1 || true
auditctl -l | grep -q bdoc-canary && echo "audit watch active on $FILE"

# The tripwire reports audit events newer than this, so the setup writes above do not alert.
mkdir -p /var/lib/bdoc-tripwire
date +%s > /var/lib/bdoc-tripwire/audit_last
rm -f /var/lib/bdoc-tripwire/audit.ckpt
echo "done. Now run: bdoc-tripwire accept   (auditd is a new enabled service, the canary a new file)"
