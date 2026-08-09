#!/usr/bin/env node
// Installs behalf into ~/.behalf and puts the command on your PATH.
// Nothing is downloaded and nothing is compiled. Node 22+ and Chrome, that is all.
//
//   node install.mjs
//   BEHALF_BIN=~/bin node install.mjs     link the command somewhere specific
import { cpSync, mkdirSync, writeFileSync, chmodSync, existsSync, symlinkSync, unlinkSync, accessSync, constants } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { join, dirname } from 'path';

const SRC = dirname(fileURLToPath(import.meta.url));
const DEST = process.env.BEHALF_DIR || join(homedir(), '.behalf');
const win = process.platform === 'win32';

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`behalf needs Node 22 or newer for its built-in WebSocket. You have ${process.versions.node}.`);
  process.exit(1);
}

console.log(`Installing behalf into ${DEST}`);
mkdirSync(DEST, { recursive: true });
cpSync(join(SRC, 'bin'), DEST, { recursive: true });
for (const doc of ['FIELD-MANUAL.md', 'README.md']) {
  if (existsSync(join(SRC, doc))) cpSync(join(SRC, doc), join(DEST, doc));
}

// A launcher so the command is just "behalf", with no node prefix to remember.
const entry = join(DEST, 'behalf.mjs');
const launcher = join(DEST, win ? 'behalf.cmd' : 'behalf');
// Prefer whatever node is on PATH, because a package manager upgrade moves the
// absolute path out from under us. Fall back to the pinned one so the command
// still works from a hook or a cron job that has no PATH at all.
writeFileSync(launcher, win
  ? `@echo off\r\nnode "%~dp0behalf.mjs" %*\r\n`
  : `#!/bin/sh\nNODE=$(command -v node 2>/dev/null)\n`
  + `[ -n "$NODE" ] || NODE="${process.execPath}"\n`
  + `exec "$NODE" "${entry}" "$@"\n`);
if (!win) { chmodSync(launcher, 0o755); chmodSync(entry, 0o755); }

const writable = d => { try { accessSync(d, constants.W_OK); return true; } catch { return false; } };
const candidates = process.env.BEHALF_BIN ? [process.env.BEHALF_BIN]
  : win ? []
  : ['/usr/local/bin', '/opt/homebrew/bin', join(homedir(), '.local/bin'), join(homedir(), 'bin')];

let linked = null;
for (const d of candidates) {
  if (!existsSync(d) || !writable(d)) continue;
  const target = join(d, 'behalf');
  try { unlinkSync(target); } catch {}
  try { symlinkSync(launcher, target); linked = target; break; } catch {}
}

if (linked) console.log(`Linked: ${linked}`);
else if (win) console.log(`Add this to your PATH:\n  ${DEST}`);
else console.log(`Could not link automatically. Add this to your shell profile:\n  export PATH="${DEST}:$PATH"`);

console.log('\nChecking your setup:');
spawnSync(process.execPath, [entry, 'doctor'], { stdio: 'inherit' });
console.log('\nNext:  behalf start 90     then    behalf open example.com');
