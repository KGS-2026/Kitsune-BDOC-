# ============================================================
# activate.ps1 - turn Web Push on (run once, by the owner)
# ============================================================
# WHY THIS IS A SCRIPT YOU RUN YOURSELF
# It creates a new signing key and adds secrets to Netlify and the droplet. Keys are the
# owner's call (HANDOFF rule 6), so every write is here where you can read it first.
#
# WHAT IT DOES, IN ORDER
#   1. Checks the p161 push code is live, because a new key does not work without it.
#   2. Creates a new VAPID signing key and a random PUSH_SEND_KEY. Neither is printed or
#      written to this PC.
#   3. Adds PUSH_SEND_KEY to /root/.hermes/.env on the droplet, where the sentinel gets it.
#      Hermes re-reads that file on every cron run, so nothing restarts.
#   4. Adds VAPID_PRIVATE_KEY and PUSH_SEND_KEY to Netlify. It only adds: it stops if
#      either already exists, and no existing key is touched.
#   5. Redeploys the site, because functions only see new env vars after a build.
#   6. Waits for sendReady, checks the live function is using the key from step 2, then
#      does a dry run from the droplet. That proves signing works and that the droplet's
#      key opens the Netlify gate. No notification is sent.
#
# THE OLD KEY IS NOT USED. A Hermes report from 2026-09-30, from a job that delivers to
# Telegram, shows what looks like the p140 private key, so a new one replaces it. Nothing
# here reads that report.
#
# THE ONE EXISTING SUBSCRIBER
# It is bound to the old key and cannot receive anything signed by the new one. The next
# time that device opens BDOC it swaps to the new key by itself, with no prompt. Until
# then GET push-subscribe counts it under "stale" and sends skip it.
#
# It needs the Netlify CLI login already on this PC and the droplet SSH key.
# Run: pwsh -File "C:\Users\ARNAUTICA\bdoc-ship\BDOC Deploy\tools\push\activate.ps1"
#
# THEN, ONCE, TO PROVE IT ON A REAL DEVICE
# Open BDOC on a phone or browser, turn on BDOC OPTIONS > Alerts, and run this with
# -TestPush. It shows how many devices are armed, asks first, then sends one real
# notification to all of them.

param([switch]$TestPush)

$ErrorActionPreference = 'Stop'

$Site = '402488ce-dc1a-4cc2-9884-1787663dab09'
$Droplet = 'root@67.205.141.74'
$SshKey = Join-Path $env:USERPROFILE '.ssh\hermes_laptop'
$Fn = 'https://kgsbdoc.netlify.app/.netlify/functions'

function New-Hex([int]$Bytes) {
  $b = [byte[]]::new($Bytes)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($b)
  -join ($b | ForEach-Object { $_.ToString('x2') })
}

function ConvertTo-Base64Url([byte[]]$Bytes) {
  [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function New-VapidKey {
  $ec = [System.Security.Cryptography.ECDsa]::Create([System.Security.Cryptography.ECCurve+NamedCurves]::nistP256)
  $p = $ec.ExportParameters($true)
  $ec.Dispose()
  [byte[]]$public = @([byte]4) + $p.Q.X + $p.Q.Y
  @{ Private = ConvertTo-Base64Url $p.D; Public = ConvertTo-Base64Url $public }
}

function Invoke-Droplet([string]$Command, [string]$Stdin) {
  if ($PSBoundParameters.ContainsKey('Stdin')) {
    $Stdin | & ssh -i $SshKey -o BatchMode=yes $Droplet $Command
  } else {
    & ssh -i $SshKey -o BatchMode=yes $Droplet $Command
  }
  if ($LASTEXITCODE -ne 0) { throw "Droplet step failed (exit $LASTEXITCODE)." }
}

# curl reads the key from .env on the droplet, so it never comes back to this PC, and a
# result here proves the copy the sentinel uses opens the Netlify gate.
function Send-Push([string]$Json) {
  $cmd = 'curl -sS -m 60 -X POST -H ''content-type: application/json'' ' +
         '-H @<(grep -m1 ''^PUSH_SEND_KEY='' /root/.hermes/.env | sed ''s/^PUSH_SEND_KEY=/x-push-key: /'') ' +
         "--data-binary @- $Fn/push-send"
  Invoke-Droplet $cmd $Json | ConvertFrom-Json
}

if ($TestPush) {
  $live = Invoke-RestMethod -Uri "$Fn/push-subscribe"
  if (-not $live.sendReady) {
    Write-Host 'Stopped: sendReady is false, so run this script once without -TestPush first.'
    exit 1
  }
  Write-Host "Armed devices: $($live.count)    Still on the old key: $($live.stale)"
  if ($live.count -lt 1) {
    Write-Host 'Nothing to send to yet. On the device: open BDOC, turn on BDOC OPTIONS > Alerts,'
    Write-Host 'wait 10 seconds, then run this again.'
    exit 1
  }
  if ((Read-Host 'Send one real test notification to every armed device? (y/N)') -ne 'y') {
    Write-Host 'Nothing was sent.'
    exit 0
  }
  $sent = Send-Push '{"title":"BDOC test alert","body":"Web Push works. This is the activation test, not a real event.","severity":"info","tag":"bdoc-activation-test","url":"/"}'
  Write-Host ($sent | ConvertTo-Json -Compress)
  if ($sent.sent -gt 0) {
    Write-Host 'The push service accepted it. Check that the notification appeared on the device.'
    exit 0
  }
  Write-Host 'Nothing was accepted. The numbers above say why.'
  exit 1
}

$live = Invoke-RestMethod -Uri "$Fn/push-subscribe"
if ($null -eq $live.stale) {
  Write-Host 'Stopped: the p161 push code is not live yet. Nothing was changed.'
  exit 1
}
if ($live.sendReady) {
  Write-Host 'Stopped: push is already on. Nothing was changed.'
  exit 1
}

$cfg = Get-Content (Join-Path $env:APPDATA 'netlify\Config\config.json') -Raw | ConvertFrom-Json
$headers = @{ Authorization = 'Bearer ' + $cfg.users.($cfg.userId).auth.token }
$acct = (Invoke-RestMethod -Headers $headers -Uri "https://api.netlify.com/api/v1/sites/$Site").account_id
$envUrl = "https://api.netlify.com/api/v1/accounts/$acct/env?site_id=$Site"

$existing = (Invoke-RestMethod -Headers $headers -Uri $envUrl) | ForEach-Object { $_.key }
$clash = @('VAPID_PRIVATE_KEY', 'PUSH_SEND_KEY') | Where-Object { $existing -contains $_ }
if ($clash) {
  Write-Host "Stopped: already set on Netlify: $($clash -join ', ')"
  Write-Host 'Nothing was changed. To replace them, delete them in the Netlify UI, then run this again.'
  exit 1
}

$vapid = New-VapidKey
$sendKey = New-Hex 32

# Droplet first: it replaces its own line, so a failure after this point is fixed by
# running the script again.
Write-Host '1/4  Adding PUSH_SEND_KEY to the sentinel environment on the droplet'
Invoke-Droplet 'sed -i -e ''/^PUSH_SEND_KEY=/d'' -e ''$a\'' /root/.hermes/.env && tr -d ''\r'' >> /root/.hermes/.env' "PUSH_SEND_KEY=$sendKey"

Write-Host '2/4  Adding env vars to Netlify'
$body = @(
  @{ key = 'VAPID_PRIVATE_KEY'; scopes = @('functions'); is_secret = $true; values = @(@{ context = 'production'; value = $vapid.Private }) },
  @{ key = 'PUSH_SEND_KEY';     scopes = @('functions'); is_secret = $true; values = @(@{ context = 'production'; value = $sendKey }) }
) | ConvertTo-Json -Depth 6 -AsArray
Invoke-RestMethod -Method Post -Headers $headers -ContentType 'application/json' -Uri $envUrl -Body $body | Out-Null

Write-Host '3/4  Redeploying the site so functions see the new vars'
Invoke-RestMethod -Method Post -Headers $headers -Uri "https://api.netlify.com/api/v1/sites/$Site/builds" | Out-Null
$body = $null; $sendKey = $null; $headers = $null

Write-Host '4/4  Waiting for the deploy, usually about 2 minutes'
$deadline = (Get-Date).AddMinutes(8)
do {
  Start-Sleep -Seconds 10
  try { $live = Invoke-RestMethod -Uri "$Fn/push-subscribe" } catch { $live = $null }
} until (($live -and $live.sendReady) -or (Get-Date) -gt $deadline)
if (-not ($live -and $live.sendReady)) {
  throw 'sendReady never turned true. Check the latest deploy in the Netlify UI.'
}
if ($live.publicKey -ne $vapid.Public) {
  throw 'The live function is using a different key from the one just created.'
}
$vapid = $null

$dry = Send-Push '{"title":"activation dry run","dryRun":true}'
if (-not $dry.ok -or -not $dry.dryRun) {
  throw "Dry run failed: $($dry | ConvertTo-Json -Compress)"
}

Write-Host ''
Write-Host "Dry run passed: signed=$($dry.signed) stale=$($dry.stale) failed=$($dry.failed), nothing was sent."
if ($dry.failed -gt 0) { Write-Host "A stored subscription could not be encrypted for: $($dry.errors -join ', ')" }
Write-Host 'Push is on. To prove it on a real device, turn on Alerts in BDOC, then run:'
Write-Host "  pwsh -File `"$PSCommandPath`" -TestPush"
