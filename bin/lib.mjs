// The core: browser-level connection, shadow DOM drilling, robust clicks.
// Read FIELD-MANUAL.md before changing anything here. Every choice below comes
// from a bug met in production, not from taste.
import { readFileSync, existsSync } from 'fs';
import { DIR, PORTFILE } from './platform.mjs';

export { DIR, PORTFILE };

export function port() {
  if (!existsSync(PORTFILE)) throw new Error('Chrome is not running. Start it with: behalf start 90');
  return readFileSync(PORTFILE, 'utf8').trim();
}
export const base = () => `http://127.0.0.1:${port()}`;

export const pause = ms => new Promise(r => setTimeout(r, ms));
export const withTimeout = (p, ms = 20000, what = 'call') =>
  Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`timeout: ${what}`)), ms))]);

export async function tabs() {
  const r = await withTimeout(fetch(`${base()}/json/list`), 8000, 'json/list');
  return (await r.json()).filter(t => t.type === 'page');
}

// Always browser level. A direct connection to /devtools/page/<id> tolerates only
// one client and has hung us twice. Do not use it.
export async function attach(match) {
  const list = await tabs();
  // Matches target id too, so a session can own a tab that cannot be confused
  // with anyone else's. Several sessions share one Chrome; without this they
  // navigate away from each other's tabs.
  const t = match
    ? list.find(x => x.id === match) ||
      list.find(x => (x.url + ' ' + (x.title || '')).includes(match))
    : list[0];
  if (!t) throw new Error(`no tab matches "${match ?? ''}"`);

  const v = await (await fetch(`${base()}/json/version`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  let id = 0; const waiting = new Map();
  // With no deadline here a half-open socket hangs the command forever, and an
  // agent waiting on a command that never returns is worse than one that fails.
  await withTimeout(new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }),
    10000, 'connecting to the browser');
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  };
  const raw = (method, params = {}, sess) => new Promise((res, rej) => {
    const mine = ++id;
    const timer = setTimeout(() => rej(new Error('timeout ' + method)), 45000);
    waiting.set(mine, m => { clearTimeout(timer); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); });
    ws.send(JSON.stringify({ id: mine, method, params, ...(sess ? { sessionId: sess } : {}) }));
  });
  const { sessionId } = await raw('Target.attachToTarget', { targetId: t.id, flatten: true });
  const send = (m, p) => raw(m, p, sessionId);
  await send('Page.enable').catch(() => {});
  await send('DOM.enable').catch(() => {});
  // Without this, real mouse clicks silently stop working after the first
  // navigation. The browser window does not have OS focus, your terminal does,
  // and Chrome quietly drops synthetic input into a page it considers
  // unfocused. The first click of a session works, every later one is
  // swallowed with no error anywhere. Cost us an afternoon of measuring
  // coordinates that were correct the whole time.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});

  return {
    tab: t,
    send,
    async evaluate(expression, byValue = true) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: byValue });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' : ' + (r.exceptionDetails.exception?.description || '').slice(0, 200));
      return byValue ? r.result.value : r.result;
    },
    close() { ws.close(); },
  };
}

// Injected into the page. Walks through shadow roots, because portals built from
// web components otherwise return an empty document while displaying a full form.
export const DRILL = `
function __all(root, out, depth){
  root = root || document; out = out || []; depth = depth || 0;
  if (depth > 15) return out;
  for (const el of root.querySelectorAll('*')) {
    out.push(el);
    if (el.shadowRoot) __all(el.shadowRoot, out, depth + 1);
  }
  return out;
}
function __visible(el){ return el.getClientRects && el.getClientRects().length > 0; }
// All text in an element, every source joined. NEVER use value||innerText:
// a button with value="1561" and the label "Transfer amount" would then match
// only the number, and your text search silently finds nothing.
function __text(el){
  const d = [el.innerText, el.textContent, el.value,
             el.getAttribute && el.getAttribute('aria-label'),
             el.getAttribute && el.getAttribute('title'),
             el.getAttribute && el.getAttribute('placeholder')];
  return d.filter(Boolean).join(' \\u241f ');
}`;

// --- Frames ------------------------------------------------------------
// Many business apps render everything inside an iframe. Without this neither
// click, fill nor fields find anything, even though read drills through.
//   --frame <substring>  matches the iframe src or name
//   --frame *            first same-origin frame with content
export function frameExpression(match) {
  if (!match) return 'document';
  const m = JSON.stringify(match);
  return `(() => {
    for (const f of document.querySelectorAll('iframe')) {
      let d = null;
      try { d = f.contentDocument; } catch (e) { continue; }
      if (!d || !d.body) continue;
      if (${m} === '*' || (f.src || '').includes(${m}) || (f.name || '').includes(${m})) return d;
    }
    throw new Error('no same-origin frame matches ' + ${m});
  })()`;
}

// Every reachable frame, for diagnosis
export const FRAMELIST = `(() => {
  const out = [];
  for (const f of document.querySelectorAll('iframe')) {
    let status = 'blocked (cross-origin)';
    try { const d = f.contentDocument; status = d && d.body ? (d.body.innerText||'').trim().length + ' chars of text' : 'empty'; }
    catch (e) { /* keep blocked */ }
    out.push({ src: (f.src || '(no src)').slice(0, 70), name: f.name || '', status });
  }
  return JSON.stringify(out);
})()`;
