// Unit tests for the parts that differ per operating system. These run on any
// platform, which is the point: a Mac can check the Windows and Linux branches.
//
//   node --test test/unit.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromeCandidates, alive, freePort, answers } from '../bin/platform.mjs';

test('BEHALF_CHROME overrides every guess', () => {
  const c = chromeCandidates({ BEHALF_CHROME: '/somewhere/odd/chrome' }, 'linux');
  assert.deepEqual(c, ['/somewhere/odd/chrome']);
});

test('macOS looks in Applications, both system and user', () => {
  const c = chromeCandidates({}, 'darwin');
  assert.ok(c[0].startsWith('/Applications/Google Chrome.app'));
  assert.ok(c.some(p => p.includes('Chromium')), 'falls back to Chromium');
  assert.ok(c.some(p => !p.startsWith('/Applications')), 'covers a per-user install');
});

test('Windows honours the Program Files variables', () => {
  const c = chromeCandidates({
    PROGRAMFILES: 'D:\\Apps',
    'PROGRAMFILES(X86)': 'D:\\Apps86',
    LOCALAPPDATA: 'D:\\Users\\x\\AppData\\Local',
  }, 'win32');
  assert.ok(c[0].startsWith('D:\\Apps'), 'uses PROGRAMFILES when set');
  assert.ok(c.some(p => p.startsWith('D:\\Apps86')));
  assert.ok(c.some(p => p.includes('AppData')));
  assert.ok(c.every(p => p.endsWith('chrome.exe')));
});

test('Windows still has defaults when the variables are missing', () => {
  const c = chromeCandidates({}, 'win32');
  assert.ok(c[0].includes('Program Files'));
  assert.ok(c.every(p => p.endsWith('chrome.exe')));
});

test('Linux covers the distro and snap paths', () => {
  const c = chromeCandidates({}, 'linux');
  for (const want of ['google-chrome', 'chromium', '/snap/bin/chromium']) {
    assert.ok(c.some(p => p.includes(want)), `expected a candidate containing ${want}`);
  }
});

test('alive reports on this process and not on a dead one', () => {
  assert.equal(alive(process.pid), true);
  assert.equal(alive(0), false);
  assert.equal(alive(null), false);
  assert.equal(alive(2 ** 22), false);      // above any real pid on mac and linux
});

test('freePort returns a port nobody is listening on', async () => {
  const p = await freePort();
  assert.ok(p > 1024 && p < 65536, `got ${p}`);
  assert.equal(await answers(p, 400), false, 'nothing should answer there');
});
