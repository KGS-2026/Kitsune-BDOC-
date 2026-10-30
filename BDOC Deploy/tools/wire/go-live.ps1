# ============================================================
# go-live.ps1 — turn LIVE WIRE on (run once, by the owner)
# ============================================================
# WHY THIS IS A SCRIPT YOU RUN YOURSELF
# It adds secrets to Netlify, copies the Telegram bot token to the collector, and installs
# a service on the droplet. Those are the owner's decisions, so they are all here in one
# place where you can read them before anything happens.
#
# WHAT IT DOES, IN ORDER
#   1. Generates two random secrets. They are never printed and never written to this PC.
#   2. Adds WIRE_INGEST_KEY, WIRE_TOPIC and BDOC_OWNER_IDS to the Netlify site. It only
#      adds: it stops if any already exist, and no existing key is touched.
#   3. Writes /etc/bdoc-wire/env on the droplet (root-only, mode 600) with those secrets.
#      The Telegram token is copied from /root/.hermes/.env on the droplet itself, so it
#      never passes through this machine.
#   4. Installs the collector from origin/main with tools/wire/deploy.sh, as a sandboxed
#      service that cannot read /root and opens no port. Hermes is not touched.
#   5. Triggers a Netlify redeploy, because functions only see new env vars after a build.
#
# It needs the Netlify CLI login already on this PC and the droplet SSH key.
# Run: pwsh -File "C:\Users\ARNAUTICA\bdoc-ship\BDOC Deploy\tools\wire\go-live.ps1"

$ErrorActionPreference = 'Stop'

$Site  = '402488ce-dc1a-4cc2-9884-1787663dab09'
$Owner = '63364153-2fd6-48be-95a8-0807950b3a7f'
$Droplet = 'root@67.205.141.74'
$SshKey = Join-Path $env:USERPROFILE '.ssh\hermes_laptop'
$ChatId = '6304076017'

function New-Hex([int]$Bytes) {
  $b = [byte[]]::new($Bytes)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($b)
  -join ($b | ForEach-Object { $_.ToString('x2') })
}

function Invoke-Droplet([string]$Command, [string]$Stdin) {
  if ($PSBoundParameters.ContainsKey('Stdin')) {
    $Stdin | & ssh -i $SshKey -o BatchMode=yes $Droplet $Command
  } else {
    & ssh -i $SshKey -o BatchMode=yes $Droplet $Command
  }
  if ($LASTEXITCODE -ne 0) { throw "Droplet step failed (exit $LASTEXITCODE)." }
}

$cfg = Get-Content (Join-Path $env:APPDATA 'netlify\Config\config.json') -Raw | ConvertFrom-Json
$headers = @{ Authorization = 'Bearer ' + $cfg.users.($cfg.userId).auth.token }
$acct = (Invoke-RestMethod -Headers $headers -Uri "https://api.netlify.com/api/v1/sites/$Site").account_id
$envUrl = "https://api.netlify.com/api/v1/accounts/$acct/env?site_id=$Site"

$existing = (Invoke-RestMethod -Headers $headers -Uri $envUrl) | ForEach-Object { $_.key }
$clash = @('WIRE_INGEST_KEY', 'WIRE_TOPIC', 'BDOC_OWNER_IDS') | Where-Object { $existing -contains $_ }
if ($clash) {
  Write-Host "Stopped: already set on Netlify: $($clash -join ', ')"
  Write-Host 'Nothing was changed. To rotate, delete them in the Netlify UI, then run this again.'
  exit 1
}

$ingest = New-Hex 32
$topic = 'wire-' + (New-Hex 24)

Write-Host '1/4  Adding env vars to Netlify'
$body = @(
  @{ key = 'WIRE_INGEST_KEY'; scopes = @('functions'); is_secret = $true;  values = @(@{ context = 'production'; value = $ingest }) },
  @{ key = 'WIRE_TOPIC';      scopes = @('functions'); is_secret = $true;  values = @(@{ context = 'production'; value = $topic }) },
  @{ key = 'BDOC_OWNER_IDS';  scopes = @('functions'); is_secret = $false; values = @(@{ context = 'all'; value = $Owner }) }
) | ConvertTo-Json -Depth 6 -AsArray
Invoke-RestMethod -Method Post -Headers $headers -ContentType 'application/json' -Uri $envUrl -Body $body | Out-Null

Write-Host '2/4  Writing the collector env on the droplet'
$pub = (Invoke-RestMethod -Uri 'https://kgsbdoc.netlify.app/.netlify/functions/config').supabase_anon_key
$envText = "WIRE_TOPIC=$topic`nWIRE_INGEST_KEY=$ingest`nSUPABASE_URL=https://ulgxbqhbgbyxlzoyxcus.supabase.co`nSUPABASE_PUBLISHABLE_KEY=$pub`n"
Invoke-Droplet "umask 077; install -d -m 0750 /etc/bdoc-wire; { cat; grep -E '^TELEGRAM_BOT_TOKEN=' /root/.hermes/.env; echo TELEGRAM_CHAT_ID=$ChatId; } > /etc/bdoc-wire/env; chmod 600 /etc/bdoc-wire/env" $envText

Write-Host '3/4  Installing and starting the collector'
Invoke-Droplet "set -e; cd /root/Kitsune-BDOC-; git fetch -q origin main; rm -rf /tmp/wire-src; mkdir /tmp/wire-src; git archive FETCH_HEAD 'BDOC Deploy/tools/wire' | tar -x -C /tmp/wire-src; bash '/tmp/wire-src/BDOC Deploy/tools/wire/deploy.sh'"

Write-Host '4/4  Redeploying the site so functions see the new vars'
Invoke-RestMethod -Method Post -Headers $headers -Uri "https://api.netlify.com/api/v1/sites/$Site/builds" | Out-Null

$ingest = $null; $topic = $null; $envText = $null; $headers = $null
Write-Host ''
Write-Host 'Done. Give Netlify about 2 minutes to finish the deploy, then open:'
Write-Host '  https://kgsbdoc.netlify.app/wire'
