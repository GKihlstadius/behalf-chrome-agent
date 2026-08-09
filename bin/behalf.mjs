#!/usr/bin/env node
// Command line for the controlled Chrome. One command per line instead of
// one-off scripts.
//
//   behalf start [minutes] | stop [name] [--force]
//   behalf doctor | status | tabs | frames
//   behalf open <url> [ms] | read [max] | wait <text> [--gone] | links [filter] | fields
//   behalf click <text> [--mouse] | fill <name> <value> | eval <expression>
//   behalf click-xy <x> <y> | type-xy <x> <y> <text> [--clear]
//   behalf shot [file] | pdf [file] | upload <field> <file...>
//   behalf lease claim|release|list|mine <name>
//
// Flags:  --tab <substring>    pick a tab by url or title
//         --frame <substring>  work inside a same-origin iframe, * = first one
//         --mouse              real mouse events instead of a DOM click
//         --force              close even if another session holds a lease
//
// Environment: BEHALF_DIR, BEHALF_PROFILE, BEHALF_CHROME override the defaults.
import { attach, tabs, base, port, DRILL, FRAMELIST, frameExpression, pause } from './lib.mjs';
import { writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { execFileSync, spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { join } from 'path';
import {
  OS, isWindows, DIR, PROFILE, PORTFILE, PIDFILE, AUTOSTOP, LEASES,
  findChrome, alive, killTree, hardKill, foreignChrome, freePort, answers,
  readPid, writePrivate, forget,
} from './platform.mjs';

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); if (i === -1) return null;
  const v = argv[i+1]; argv.splice(i, v && !v.startsWith('--') ? 2 : 1); return v ?? true; };
const timeoutFlag = flag('--timeout');
const goneMode  = flag('--gone') === true;
const tabMatch  = flag('--tab');
const frameMatch = flag('--frame');
const mouseMode = flag('--mouse') === true;
const clearMode = flag('--clear') === true;
const [cmd, ...arg] = argv;

const out = s => process.stdout.write(s + '\n');
const J = o => JSON.stringify(o);
const DOC = () => frameExpression(frameMatch);
const SELF = fileURLToPath(import.meta.url);
const forceMode = argv.includes('--force');

async function withTab(fn) { const c = await attach(tabMatch); try { return await fn(c); } finally { c.close(); } }
async function objectId(c) {
  const r = await c.evaluate('window.__behalfEl', false);
  if (!r.objectId) throw new Error('no element selected');
  return r.objectId;
}
async function mouseClick(c, x, y) {
  for (const type of ['mouseMoved','mousePressed','mouseReleased'])
    await c.send('Input.dispatchMouseEvent', { type, x, y, button:'left', clickCount: type==='mouseMoved'?0:1 });
}

// --- leases ----------------------------------------------------------------
// Several agent sessions share one browser. Without this, one session closes
// Chrome in the middle of another's work.
const FOUR_HOURS = 4 * 3600 * 1000;
function leaseList() {
  mkdirSync(LEASES, { recursive: true });
  const now = Date.now();
  const out = [];
  for (const name of readdirSync(LEASES)) {
    const f = join(LEASES, name);
    let age;
    try { age = now - statSync(f).mtimeMs; } catch { continue; }
    if (age > FOUR_HOURS) { try { unlinkSync(f); } catch {}; continue; }  // a crashed session must not block forever
    out.push({ name, minutes: Math.floor(age / 60000) });
  }
  return out;
}

// --- lifecycle ---------------------------------------------------------------
async function running() {
  const p = (() => { try { return port(); } catch { return null; } })();
  return p && await answers(p) ? p : null;
}

async function stopBrowser({ mine = '', force = false, quiet = false } = {}) {
  const say = s => { if (!quiet) out(s); };
  if (!force) {
    const others = leaseList().filter(l => l.name !== mine).map(l => l.name);
    if (others.length) {
      say(`Not closing. Other sessions hold leases: ${others.join(', ')}`);
      say("Run 'behalf stop --force' if you know they are dead.");
      return false;
    }
  }
  if (mine) forget(join(LEASES, mine));

  // Do not kill the watcher if the watcher is what called us. It would die
  // here, and Chrome would stay open with the port still listening, which is
  // precisely the situation the timer exists to prevent.
  const auto = readPid(AUTOSTOP);
  if (auto && Number(auto) !== process.pid && alive(auto)) killTree(auto);
  forget(AUTOSTOP);

  const pid = readPid(PIDFILE);
  if (pid && alive(pid)) {
    killTree(pid);
    for (let i = 0; i < 20 && alive(pid); i++) await pause(300);
    if (alive(pid)) hardKill(pid);
    say('Chrome closed.');
  } else if (!isWindows && foreignChrome()) {
    // started outside behalf, so there is no pid file to go on
    spawnSync('pkill', ['-TERM', '-f', `--user-data-dir=${PROFILE}`], { stdio: 'ignore' });
    say('Chrome closed.');
  } else {
    say('Was not running.');
  }
  forget(PIDFILE);
  forget(PORTFILE);
  say('Port file gone. No control channel is open.');
  return true;
}

const commands = {
  async start() {
    const minutes = Number(arg[0]) || null;
    const live = await running();
    if (live) { out(`Already running on port ${live}`); return; }
    forget(PORTFILE); forget(PIDFILE);

    if (foreignChrome()) {
      out('Chrome is already running with this profile but without a control port.');
      out('A running browser cannot be given one after the fact. Run: behalf stop');
      process.exitCode = 1; return;
    }
    const chrome = findChrome();
    if (!chrome) {
      out('Google Chrome not found. Set BEHALF_CHROME to the binary if it lives somewhere unusual.');
      process.exitCode = 1; return;
    }
    const p = await freePort();
    const child = spawn(chrome, [
      `--user-data-dir=${PROFILE}`,
      `--remote-debugging-port=${p}`,
      '--no-first-run', '--no-default-browser-check',
    ], { detached: true, stdio: 'ignore' });
    child.unref();

    let up = false;
    for (let i = 0; i < 40 && !up; i++) { await pause(400); up = await answers(p); }
    if (!up) { out('Chrome did not start, or never opened the port.'); process.exitCode = 1; return; }

    writePrivate(PORTFILE, p);
    writePrivate(PIDFILE, child.pid);
    out(`Running on port ${p} (127.0.0.1 only)`);

    if (minutes) {
      // A detached child that outlives this command, so the port still closes
      // if you walk away and forget. An open control port is an open bank window.
      const w = spawn(process.execPath, [SELF, '__autostop', String(minutes)],
        { detached: true, stdio: 'ignore', env: { ...process.env, BEHALF_DIR: DIR, BEHALF_PROFILE: PROFILE } });
      w.unref();
      writePrivate(AUTOSTOP, w.pid);
      out(`Closes automatically in ${minutes} minutes.`);
    }
  },

  async __autostop() {
    await pause(Number(arg[0]) * 60000);
    await stopBrowser({ force: true, quiet: true });
  },

  async stop() {
    const mine = arg.find(a => !a.startsWith('--')) || '';
    const ok = await stopBrowser({ mine, force: forceMode });
    if (!ok) process.exitCode = 1;
  },

  async lease() {
    const [sub, name] = arg;
    if (sub === 'list') {
      const l = leaseList();
      if (!l.length) return out('no active leases');
      for (const x of l) out(`${x.name.padEnd(24)} ${x.minutes} min old`);
      return;
    }
    if (!name) { out(`usage: behalf lease <claim|release|list|mine> [name]`); process.exitCode = 1; return; }
    // A lease name becomes a filename, so it must not be able to point anywhere else.
    const rent = name.replace(/[^A-Za-z0-9._-]/g, '');
    if (!rent || rent === '.' || rent === '..') { out('lease names may contain letters, digits, dot, dash and underscore'); process.exitCode = 1; return; }
    mkdirSync(LEASES, { recursive: true });
    if (sub === 'claim')   { writeFileSync(join(LEASES, rent), String(Date.now())); return out(`lease taken: ${rent}`); }
    if (sub === 'release') { forget(join(LEASES, rent)); return out(`lease released: ${rent}`); }
    if (sub === 'mine')    { return out(`behalf-tab-${rent}`); }
    out('usage: behalf lease <claim|release|list|mine> [name]'); process.exitCode = 1;
  },

  async doctor() {
    const rows = [];
    const major = Number(process.versions.node.split('.')[0]);
    rows.push([`Node ${process.versions.node}`, major >= 22 ? 'ok' : 'TOO OLD, needs 22+ for WebSocket']);
    rows.push(['Platform', OS === 'darwin' ? 'macOS' : OS === 'win32' ? 'Windows' : OS]);
    const chrome = findChrome();
    rows.push(['Chrome', chrome ? 'ok, ' + chrome : 'MISSING. Set BEHALF_CHROME to the binary']);
    rows.push(['Profile', existsSync(PROFILE) ? 'ok, ' + PROFILE : 'absent, created on start']);
    let p = null;
    try { p = port(); rows.push(['Port file', 'ok, port ' + p]); }
    catch { rows.push(['Port file', 'absent, run: behalf start']); }
    if (p) {
      try {
        const v = await (await fetch(`${base()}/json/version`)).json();
        rows.push(['Chrome answers', 'ok, ' + v.Browser]);
        rows.push(['Tabs', String((await tabs()).length)]);
      } catch { rows.push(['Chrome answers', 'NO. Port file left behind but the process is gone, run: behalf stop && behalf start']); }
      if (!isWindows) {
        try {
          const lsof = execFileSync('lsof', ['-nP','-iTCP:'+p,'-sTCP:LISTEN'], {encoding:'utf8'});
          rows.push(['Bound to', /127\.0\.0\.1/.test(lsof) ? 'ok, loopback only' : 'WARNING: not loopback only']);
        } catch { /* lsof may be missing */ }
      }
    }
    const w = Math.max(...rows.map(r => r[0].length));
    for (const [a,b] of rows) out(`  ${a.padEnd(w)}  ${b}`);
  },

  async status() {
    const v = await (await fetch(`${base()}/json/version`)).json();
    out(`port ${port()} · ${v.Browser} · ${(await tabs()).length} tabs`);
  },

  async tabs() { for (const t of await tabs()) out(`${(t.title||'').slice(0,45).padEnd(46)} ${t.url.slice(0,90)}`); },

  async frames() {
    await withTab(async c => {
      const r = JSON.parse(await c.evaluate(FRAMELIST));
      if (!r.length) return out('(no iframes)');
      for (const f of r) out(`  ${f.status.padEnd(26)} ${f.name ? '['+f.name+'] ' : ''}${f.src}`);
      out('\nUse --frame <substring of src> or --frame * for the first reachable one.');
    });
  },

  async open() { await withTab(async c => {
    // Page.navigate resolves even when the load fails. Without this check a dead
    // host or a typo leaves you on the previous page and every later command
    // reports something confusing about the wrong document.
    const r = await c.send('Page.navigate', { url: arg[0] });
    if (r.errorText) { out(`could not open ${arg[0]}: ${r.errorText}`); process.exitCode = 1; return; }
    await pause(Number(arg[1] || 4000));
    out(await c.evaluate('location.href')); }); },

  async read() { await withTab(async c => {
    const max = Number(arg[0] || 4000);
    out(await c.evaluate(`(() => { ${DRILL}
      const d = ${DOC()};
      let t = d.body ? d.body.innerText : '';
      if (t.trim().length < 300) {           // shadow DOM: the top frame looks empty
        const parts = [];
        for (const el of __all(d)) if (el.shadowRoot) { const s = el.shadowRoot.textContent||''; if (s.trim()) parts.push(s); }
        if (parts.length) t += '\\n' + parts.join('\\n');
      }
      return t.replace(/[ \\t]+/g,' ').replace(/\\n{3,}/g,'\\n\\n').slice(0, ${max}) || '(empty page)';
    })()`)); }); },

  async links() { const f = arg[0] || ''; await withTab(async c => {
    const r = await c.evaluate(`(() => { ${DRILL}
      return __all(${DOC()}).filter(e => /^(A|BUTTON)$/.test(e.tagName) || (e.getAttribute && e.getAttribute('role')==='button'))
        .filter(__visible)
        .map(e => ({ tag:e.tagName, t:(e.innerText||e.textContent||e.value||'').replace(/\\s+/g,' ').trim().slice(0,45),
                     v:e.value||'', h:(e.getAttribute && e.getAttribute('href'))||'' }))
        .filter(x => x.t && (${J(f)}==='' || (x.t+x.h).toLowerCase().includes(${J(f)}.toLowerCase()))).slice(0,60);
    })()`);
    for (const x of r) out(`${x.tag.padEnd(7)} ${x.t.padEnd(46)} ${x.v?'value='+x.v+' ':''}${x.h.slice(0,60)}`);
    if (!r.length) out('(no matches)'); }); },

  async fields() { await withTab(async c => {
    const r = await c.evaluate(`(() => { ${DRILL}
      return __all(${DOC()}).filter(e => /^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName)).filter(__visible)
        .map(e => ({ n:e.name||e.id||'', ty:e.type||e.tagName.toLowerCase(), v:(e.value||'').slice(0,30), chk:e.checked===true })).slice(0,80);
    })()`);
    for (const f of r) out(`${(f.n||'(unnamed)').padEnd(52)} ${f.ty.padEnd(10)} ${f.chk?'[x] ':''}"${f.v}"`);
    if (!r.length) out('(no fields)'); }); },

  async click() {
    const text = arg.join(' ');
    await withTab(async c => {
      const hits = await c.evaluate(`(() => { ${DRILL}
        const found = __all(${DOC()})
          .filter(e => /^(A|BUTTON|INPUT|SUMMARY|LABEL)$/.test(e.tagName) || (e.getAttribute && e.getAttribute('role')==='button'))
          .filter(e => __text(e).includes(${J(text)}) && __visible(e))
          .sort((a,b) => { const ra=a.getBoundingClientRect(), rb=b.getBoundingClientRect();
                           return ra.width*ra.height - rb.width*rb.height; });
        window.__behalfEl = found[0] || null; return found.length;
      })()`);
      if (!hits) { out(`not found: "${text}"`); process.exitCode = 1; return; }

      if (!mouseMode) {                     // DOM click first: cheapest, and some apps accept only this
        await c.evaluate('window.__behalfEl.click()');
        out(`clicked "${text}" (${hits} match, DOM click. Nothing happened? try --mouse)`);
        return;
      }
      const oid = await objectId(c);        // real mouse events: required by older server-rendered forms
      await c.send('DOM.scrollIntoViewIfNeeded', { objectId: oid }).catch(()=>{});
      await pause(250);
      const { model } = await c.send('DOM.getBoxModel', { objectId: oid });   // PAGE coordinates, iframes included
      const q = model.content;
      const x = Math.round((q[0]+q[2]+q[4]+q[6])/4), y = Math.round((q[1]+q[3]+q[5]+q[7])/4);
      const ih = await c.evaluate('innerHeight');
      if (y < 0 || y > ih) { out(`element is outside the viewport (y=${y}, height=${ih})`); process.exitCode = 1; return; }
      await mouseClick(c, x, y);
      out(`clicked "${text}" (${hits} match, real mouse click at ${x},${y})`);
    });
  },

  async 'click-xy'() { const [x,y] = arg.map(Number);
    await withTab(async c => { await mouseClick(c, x, y); out(`mouse click at ${x},${y}`); }); },

  async 'type-xy'() { const [x,y,...rest] = arg; const text = rest.join(' ');
    await withTab(async c => {
      await mouseClick(c, Number(x), Number(y)); await pause(300);
      if (clearMode) { for (const t of ['keyDown','keyUp'])
        await c.send('Input.dispatchKeyEvent', { type:t, modifiers:4, key:'a', code:'KeyA', windowsVirtualKeyCode:65 }); await pause(150); }
      await c.send('Input.insertText', { text });          // goes to the FOCUSED element, in any frame
      out(`typed ${text.length} characters at ${x},${y}`);
    }); },

  // The strongest primitive is waiting for state instead of waiting for time.
  // Every fixed sleep in a script is a race waiting to be lost.
  async wait() {
    const text = arg.join(' ');
    const timeout = Number(timeoutFlag || 15000);
    const gone = goneMode;
    const start = Date.now();
    await withTab(async c => {
      let last = null;
      while (Date.now() - start < timeout) {
        const there = await c.evaluate(`(() => { ${DRILL}
          const d = ${DOC()};
          let t = d.body ? d.body.innerText : '';
          if (t.trim().length < 300) for (const el of __all(d)) if (el.shadowRoot) t += el.shadowRoot.textContent || '';
          return t.includes(${J(text)});
        })()`).catch(e => { last = e.message; return false; });
        if (there !== gone) { out(`${gone ? 'gone' : 'found'} after ${Date.now()-start} ms: "${text}"`); return; }
        await pause(300);
      }
      out(`TIMEOUT after ${timeout} ms. "${text}" ${gone ? 'was still there' : 'never appeared'}${last ? ' ('+last.slice(0,40)+')' : ''}`);
      process.exitCode = 1;
    });
  },

  async fill() { const [name, ...rest] = arg; const value = rest.join(' ');
    await withTab(async c => {
      const r = await c.evaluate(`(() => { ${DRILL}
        const el = __all(${DOC()}).filter(e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName))
          .filter(e => e.name===${J(name)} || e.id===${J(name)} || (e.name||'').includes(${J(name)}) || (e.id||'').includes(${J(name)}))[0];
        if (!el) return '\\u0000missing';
        el.focus();
        const proto = el.tagName==='TEXTAREA' ? window.HTMLTextAreaElement.prototype
                    : el.tagName==='SELECT'   ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${J(value)});
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
        el.blur(); return el.value;
      })()`);
      if (r === '\u0000missing') { out(`no such field: ${name} (inside a frame? add --frame)`); process.exitCode = 1; return; }
      out(`${name} = "${r}"`); }); },

  async eval() { await withTab(async c => out(String(await c.evaluate(arg.join(' '))))); },

  // Default into the private state directory, not /tmp. A screenshot of a page
  // you are signed into is exactly as sensitive as the session itself, and /tmp
  // is readable by every user on the machine.
  async shot() { const file = arg[0] || join(DIR, 'shot.png');
    await withTab(async c => { const r = await c.send('Page.captureScreenshot',{format:'png'});
      mkdirSync(DIR, { recursive: true });
      writeFileSync(file, Buffer.from(r.data,'base64'), { mode: 0o600 }); out(file); }); },

  async pdf() { const file = arg[0] || join(DIR, 'page.pdf');
    await withTab(async c => { const r = await c.send('Page.printToPDF',{ printBackground:true, preferCSSPageSize:true,
      marginTop:0, marginBottom:0, marginLeft:0, marginRight:0 });
      mkdirSync(DIR, { recursive: true });
      writeFileSync(file, Buffer.from(r.data,'base64'), { mode: 0o600 }); out(file); }); },

  async upload() { const [name, ...files] = arg;
    await withTab(async c => {
      await c.send('DOM.enable');
      const n = await c.evaluate(`(() => { ${DRILL}
        const found = __all(${DOC()}).filter(e => e.tagName==='INPUT' && e.type==='file')
          .filter(e => ${J(name)}==='*' || (e.name||'').includes(${J(name)}) || (e.id||'').includes(${J(name)}));
        window.__behalfEl = found[0] || null; return found.length;
      })()`);
      if (!n) { out('no file input found (inside a frame? add --frame)'); process.exitCode = 1; return; }
      await c.send('DOM.setFileInputFiles', { files: files.map(f => f.startsWith('/') ? f : join(process.cwd(), f)), objectId: await objectId(c) });
      out(`attached ${files.length} file(s)`); }); },

};

const fn = commands[cmd];
if (!fn) {
  out('behalf <start|stop|doctor|status|tabs|frames|open|read|wait|links|fields|click|click-xy|type-xy|fill|eval|shot|pdf|upload|lease>');
  out('       [--tab match] [--frame match|*] [--mouse] [--clear] [--timeout ms] [--gone]');
  process.exit(1);
}
fn().catch(e => { out('ERROR: ' + e.message); process.exit(1); });
