// BDOC Tool Bridge — the app's front desk for the tools installed on this laptop.
//
// WHY AN APPROVED LIST AND NOT ADMIN: everything here is a fixed action with validated inputs,
// run with no shell. Nothing can pass in a command, so a bad model answer, a hostile headline
// or a strange radio packet has no way to become one. Add a tool by adding a row.
//
// Only electron/tools.html may call this (see main.js). The offline AI reads what these
// actions return when the operator sends it. It cannot call them.

'use strict';

const { execFile, spawn } = require('child_process');
const { shell } = require('electron');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const IT_TOOLS = path.join(os.homedir(), 'OneDrive', 'Desktop', 'IT TOOLS');
const TSHARK = 'C:\\Program Files\\Wireshark\\tshark.exe';
const OLLAMA = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
const OUT_MAX = 4 * 1024 * 1024;
const BAUDS = new Set([9600, 19200, 38400, 57600, 115200, 921600]);

const APPS = [
  ['satdump', 'SatDump', 'SatDump.lnk', 'Decode weather satellite images. Needs a USB radio receiver.'],
  ['earth', 'Google Earth Pro', 'Google Earth Pro.lnk', 'Maps. Only areas you viewed before the outage stay cached.'],
  ['inssider', 'inSSIDer', 'inSSIDer.lnk', 'See nearby Wi-Fi networks and channels.'],
  ['btech', 'BTECH BF-F8HP Pro CPS', 'BTECH BF-F8HP Pro CPS.lnk', 'Program your handheld radio.'],
  ['anythingllm', 'AnythingLLM', 'AnythingLLM.lnk', 'Ask questions about your own documents.'],
  ['freecad', 'FreeCAD', 'FreeCAD 1.1.lnk', 'Design parts and repairs.']
];

function exec(file, args, ms) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: ms, maxBuffer: OUT_MAX, windowsHide: true, shell: false }, (err, stdout, stderr) => {
      const out = String(stdout || '').trim();
      const why = err ? String(stderr || err.message).trim().slice(0, 500) : '';
      resolve({ ok: !err, out: out || why || 'No output.' });
    });
  });
}

const powershell = (script, ms) => exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], ms);

function linkReady(file) {
  try { return fs.existsSync(shell.readShortcutLink(path.join(IT_TOOLS, file)).target); } catch (_) { return false; }
}

const ACTIONS = {
  wifi: { name: 'Scan Wi-Fi networks', use: 'What is on the air around you.', ready: () => true,
    run: () => exec('netsh', ['wlan', 'show', 'networks', 'mode=bssid'], 15000) },
  ports: { name: 'Find plugged-in radios', use: 'Lists COM ports. A Meshtastic or other USB radio shows up here.', ready: () => true,
    run: () => powershell("Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\\(COM\\d+\\)' } | ForEach-Object { $_.Name }", 15000) },
  ifaces: { name: 'List network adapters', use: 'Wireshark adapter numbers for a capture.', ready: () => fs.existsSync(TSHARK),
    run: () => exec(TSHARK, ['-D'], 15000) },
  capture: { name: 'Capture packets', use: 'Summary of live traffic on one adapter, 10 seconds at most.', ready: () => fs.existsSync(TSHARK), fields: ['adapter', 'count'],
    run: ({ adapter, count }) => {
      const a = String(adapter || '');
      const n = Math.min(500, Math.max(1, Number(count) || 50));
      if (!/^\d{1,2}$/.test(a)) return { ok: false, out: 'Adapter must be a number from "List network adapters".' };
      // -p: this laptop's own traffic only, never other people's on a shared network.
      return exec(TSHARK, ['-i', a, '-p', '-c', String(n), '-a', 'duration:10', '-l', '-n', '-T', 'fields', '-e', 'frame.time_relative',
        '-e', 'ip.src', '-e', 'ip.dst', '-e', '_ws.col.Protocol', '-e', '_ws.col.Info', '-E', 'separator=|'], 15000);
    } },
  serial: { name: 'Read raw radio bytes', use: 'Reads a COM port for 5 seconds and shows the bytes as hex.', ready: () => true, fields: ['port', 'baud'],
    run: ({ port, baud }) => {
      const p = String(port || '').toUpperCase();
      const b = Number(baud) || 115200;
      if (!/^COM\d{1,3}$/.test(p)) return { ok: false, out: 'Port must look like COM3.' };
      if (!BAUDS.has(b)) return { ok: false, out: 'Unsupported speed.' };
      return powershell(`$p=New-Object System.IO.Ports.SerialPort '${p}',${b};$p.ReadTimeout=250;$p.Open();` +
        '$l=New-Object System.Collections.Generic.List[byte];$e=(Get-Date).AddSeconds(5);' +
        'while((Get-Date) -lt $e -and $l.Count -lt 8192){try{$l.Add([byte]$p.ReadByte())}catch{}};$p.Close();' +
        "if($l.Count){($l|ForEach-Object{$_.ToString('x2')}) -join ' '}else{'No data in 5 seconds.'}", 12000);
    } }
};

function list() {
  return {
    actions: Object.entries(ACTIONS).map(([id, a]) => ({ id, name: a.name, use: a.use, ready: !!a.ready(), fields: a.fields || [] })),
    apps: APPS.map(([id, name, file, use]) => ({ id, name, use, ready: linkReady(file) }))
  };
}

async function run(id, input) {
  const app = APPS.find(a => a[0] === id);
  if (app) {
    const err = await shell.openPath(path.join(IT_TOOLS, app[2]));
    return { ok: !err, out: err || `${app[1]} opened.` };
  }
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, id) || !ACTIONS[id].ready()) return { ok: false, out: 'Not available on this laptop.' };
  return ACTIONS[id].run(input || {});
}

function ollamaUp() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:11434/api/tags', { timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// Started hidden, so the AI is there with no terminal and no internet.
async function ensureOllama() {
  if (await ollamaUp()) return true;
  if (!fs.existsSync(OLLAMA)) return false;
  spawn(OLLAMA, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await ollamaUp()) return true;
  }
  return false;
}

module.exports = { list, run, ensureOllama };
