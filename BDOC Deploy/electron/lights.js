// Strobes the ASUS keyboard through the Aura SDK that Armoury Crate installs. Windows only.
// The script takes only numbers from this file, and an alarm must never fail because of it,
// so a laptop without the SDK simply gets no strobe.
const { execFile } = require('child_process');

let running = null;

function script(bgr, ms) {
  return `
$s = New-Object -ComObject aura.sdk.1
$s.SwitchMode()
try {
  $devs = $s.Enumerate(0)
  $end = (Get-Date).AddMilliseconds(${ms})
  $on = $true
  while ((Get-Date) -lt $end) {
    $c = if ($on) { ${bgr} } else { 0 }
    foreach ($d in $devs) { foreach ($l in $d.Lights) { $l.Color = $c }; $d.Apply() | Out-Null }
    $on = -not $on
    [System.Threading.Thread]::Sleep(375)
  }
} finally { $s.ReleaseControl(0) }
`;
}

// Aura takes colors as 0xBBGGRR.
function strobe(bgr, ms) {
  if (process.platform !== 'win32' || running) return;
  running = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script(bgr, ms)],
    { windowsHide: true, timeout: ms + 15000 }, () => { running = null; });
}

module.exports = { strobe, RED: 0x0000FF, GREEN: 0x00FF00 };
