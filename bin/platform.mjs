// Everything that differs between macOS, Linux and Windows lives here, so the
// rest of the tool can pretend there is only one operating system.
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { createServer } from 'net';
import { homedir } from 'os';
import { join } from 'path';

export const OS = process.platform;
export const isWindows = OS === 'win32';

export const DIR = process.env.BEHALF_DIR || join(homedir(), '.behalf');
export const PROFILE = process.env.BEHALF_PROFILE || join(homedir(), '.behalf-chrome');
export const PORTFILE = join(DIR, '.port');
export const PIDFILE = join(DIR, '.chrome-pid');
export const AUTOSTOP = join(DIR, '.autostop');
export const LEASES = join(DIR, '.leases');

// Set BEHALF_CHROME to point at any Chromium-family binary. Everything else is
// a guess at where the installer put it.
export function chromeCandidates(env = process.env, os = OS) {
  if (env.BEHALF_CHROME) return [env.BEHALF_CHROME];
  if (os === 'darwin') return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  if (os === 'win32') return [
    join(env.PROGRAMFILES || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    join(env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    join(env.LOCALAPPDATA || join(homedir(), 'AppData\\Local'), 'Google\\Chrome\\Application\\chrome.exe'),
  ];
  return [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
  ];
}

export function findChrome(env = process.env) {
  return chromeCandidates(env).find(p => existsSync(p)) || null;
}

export function alive(pid) {
  if (!pid) return false;
  try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export function killTree(pid) {
  if (!pid) return;
  if (isWindows) { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); return; }
  try { process.kill(Number(pid), 'SIGTERM'); } catch {}
}

export function hardKill(pid) {
  if (!pid || isWindows) return;
  try { process.kill(Number(pid), 'SIGKILL'); } catch {}
}

// A Chrome someone started by hand with our profile, outside behalf. It has no
// control port and cannot be given one after the fact, so we have to say so
// rather than start a second one that will refuse to run.
export function foreignChrome(profile = PROFILE) {
  if (isWindows) return false;         // no cheap cmdline scan, let Chrome complain instead
  try {
    execFileSync('pgrep', ['-f', `--user-data-dir=${profile}`], { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch { return false; }
}

export function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

export async function answers(port, ms = 2000) {
  try {
    const ctl = AbortSignal.timeout(ms);
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: ctl });
    return r.ok;
  } catch { return false; }
}

export function readPid(file) {
  try { return Number(readFileSync(file, 'utf8').trim()) || null; } catch { return null; }
}

export function writePrivate(file, value) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file, String(value), { mode: 0o600 });
}

export function forget(file) { try { unlinkSync(file); } catch {} }
