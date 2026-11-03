import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

const KEY = 'test-key-12345';

async function start() {
  const { app, db } = createApp({ syncKey: KEY });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, key = KEY) => fetch(`${base}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  return { base, post, close: () => { server.close(); db.close(); } };
}
const rec = (table, id, updatedAt, deviceId, extra = {}) => ({
  table, id, updatedAt, data: { id, updatedAt, deviceId, ...extra },
});

test('rejects missing or wrong key', async () => {
  const s = await start();
  assert.equal((await s.post({ deviceId: 'a', changes: [] }, 'nope')).status, 401);
  assert.equal((await fetch(`${s.base}/api/sync`, { method: 'POST' })).status, 401);
  s.close();
});

test('push then pull from another device; own changes are not echoed', async () => {
  const s = await start();
  const r1 = await (await s.post({ deviceId: 'A', cursor: 0, changes: [rec('items', 'i1', 1000, 'A', { name: 'Clutch' })] })).json();
  assert.equal(r1.applied, 1);
  assert.equal(r1.changes.length, 0);
  const r2 = await (await s.post({ deviceId: 'B', cursor: 0, changes: [] })).json();
  assert.equal(r2.changes.length, 1);
  assert.equal(r2.changes[0].data.name, 'Clutch');
  assert.ok(r2.cursor >= 1);
  const r3 = await (await s.post({ deviceId: 'B', cursor: r2.cursor, changes: [] })).json();
  assert.equal(r3.changes.length, 0);
  s.close();
});

test('retrying the same push is idempotent', async () => {
  const s = await start();
  const body = { deviceId: 'A', cursor: 0, changes: [rec('docs', 'd1', 5000, 'A', { no: 'A-1' })] };
  assert.equal((await (await s.post(body)).json()).applied, 1);
  assert.equal((await (await s.post(body)).json()).applied, 0);
  const pull = await (await s.post({ deviceId: 'B', cursor: 0, changes: [] })).json();
  assert.equal(pull.changes.length, 1);
  s.close();
});

test('last write wins; stale writes are ignored', async () => {
  const s = await start();
  await s.post({ deviceId: 'A', changes: [rec('items', 'i1', 2000, 'A', { name: 'new' })] });
  const stale = await (await s.post({ deviceId: 'B', changes: [rec('items', 'i1', 1000, 'B', { name: 'old' })] })).json();
  assert.equal(stale.applied, 0);
  const pull = await (await s.post({ deviceId: 'C', cursor: 0, changes: [] })).json();
  assert.equal(pull.changes[0].data.name, 'new');
  s.close();
});

test('rejects unknown tables, bad shapes and far-future timestamps', async () => {
  const s = await start();
  const res = await (await s.post({
    deviceId: 'A',
    changes: [
      rec('evil', 'x', 1, 'A'),
      { table: 'items', id: 'i1', updatedAt: 5, data: { id: 'other', updatedAt: 5, deviceId: 'A' } },
      rec('items', 'i2', Date.now() + 24 * 3600 * 1000, 'A'),
    ],
  })).json();
  assert.equal(res.applied, 0);
  assert.equal(res.rejected.length, 3);
  s.close();
});

test('pulls are paged and the cursor advances past own records', async () => {
  const s = await start();
  const many = Array.from({ length: 700 }, (_, i) => rec('stockMoves', `m${i}`, 1000 + i, 'A', { qty: 1 }));
  await s.post({ deviceId: 'A', changes: many.slice(0, 350) });
  await s.post({ deviceId: 'A', changes: many.slice(350) });
  let cursor = 0, got = 0, rounds = 0;
  for (;;) {
    const r = await (await s.post({ deviceId: 'B', cursor, changes: [] })).json();
    got += r.changes.length; cursor = r.cursor; rounds++;
    if (!r.more) break;
  }
  assert.equal(got, 700);
  assert.equal(rounds, 2);
  s.close();
});

test('backup requires auth and returns records grouped by table', async () => {
  const s = await start();
  await s.post({ deviceId: 'A', changes: [rec('items', 'i1', 10, 'A', { name: 'x' })] });
  assert.equal((await fetch(`${s.base}/api/backup`)).status, 401);
  const b = await (await fetch(`${s.base}/api/backup`, { headers: { Authorization: `Bearer ${KEY}` } })).json();
  assert.equal(b.items.length, 1);
  s.close();
});

test('the correct key still works after many wrong guesses (no lock-out of the owner)', async () => {
  const s = await start();
  for (let i = 0; i < 12; i++) await s.post({ deviceId: 'x', changes: [] }, 'wrong' + i);
  assert.equal((await s.post({ deviceId: 'x', changes: [] }, 'wrong-again')).status, 429);
  assert.equal((await s.post({ deviceId: 'a', changes: [] })).status, 200);
  s.close();
});

test('sends security headers and hides the framework', async () => {
  const s = await start();
  const r = await fetch(`${s.base}/api/health`);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-powered-by'), null);
  s.close();
});

test('SQL-looking ids and table names are stored or rejected as plain text, never executed', async () => {
  const s = await start();
  const evil = "a'; DROP TABLE records;--";
  const r = await (await s.post({ deviceId: 'd', changes: [rec('items', evil, 1, 'd'), rec('items; DROP TABLE records;--', 'z', 1, 'd')] })).json();
  assert.equal(r.applied, 1);
  assert.equal(r.rejected.length, 1);
  const again = await (await s.post({ deviceId: 'e', cursor: 0, changes: [] })).json();
  assert.equal(again.changes[0].id, evil);
  s.close();
});
