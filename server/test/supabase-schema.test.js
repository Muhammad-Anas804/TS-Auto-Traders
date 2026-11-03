import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Runs supabase/schema.sql in a real (in-memory) Postgres and checks the sync rules and the security rules.
const schema = fs.readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8');

test('supabase/schema.sql: sync rules and access rules', { timeout: 120000 }, async () => {
  const db = new PGlite();

  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    grant usage on schema public to anon, authenticated;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.jwt() to anon, authenticated;
  `);
  await db.exec(schema);
  await db.exec(schema); // second run must be harmless
  await db.exec(`insert into public.allowed_users (email) values ('Owner@Example.com') on conflict do nothing;`);
  const as = async (email) => { await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(email ? { email } : {})}', false); set role ${email ? 'authenticated' : 'anon'};`); };
  const rec = (table, id, updatedAt, deviceId, extra = {}) => ({ table, id, updatedAt, data: { id, updatedAt, deviceId, ...extra } });
  const sync = async (device, cursor, changes) => (await db.query('select public.sync_exchange($1,$2,$3::jsonb) as r', [device, cursor, JSON.stringify(changes)])).rows[0].r;
  let n = 0; const ok = () => ++n;

  await as('owner@example.com');
  let r1 = await sync('A', 0, [rec('items', 'i1', 1000, 'A', { name: 'Clutch' })]);
  assert.equal(r1.applied, 1); assert.equal(r1.changes.length, 0); ok('push applies, own change not echoed');
  let r2 = await sync('B', 0, []);
  assert.equal(r2.changes.length, 1); assert.equal(r2.changes[0].data.name, 'Clutch'); assert.ok(r2.cursor >= 1); assert.equal(r2.changes[0].updatedAt, 1000); ok('other device pulls it');
  assert.equal((await sync('B', r2.cursor, [])).changes.length, 0); ok('cursor advances, nothing repeated');
  const body = [rec('docs', 'd1', 5000, 'A', { no: 'A-1' })];
  assert.equal((await sync('A', 0, body)).applied, 1); assert.equal((await sync('A', 0, body)).applied, 0); ok('retry is idempotent');
  await sync('A', 0, [rec('items', 'i9', 2000, 'A', { name: 'new' })]);
  assert.equal((await sync('B', 0, [rec('items', 'i9', 1000, 'B', { name: 'old' })])).applied, 0);
  assert.equal((await sync('C', 0, [])).changes.find((c) => c.id === 'i9').data.name, 'new'); ok('last write wins, stale ignored');
  const bad = await sync('A', 0, [rec('evil', 'x', 1, 'A'), { table: 'items', id: 'i1', updatedAt: 5, data: { id: 'other', updatedAt: 5, deviceId: 'A' } }, rec('items', 'i2', Date.now() + 24 * 3600 * 1000, 'A'), { table: 'items', id: 'q', updatedAt: 'x', data: {} }, 'junk', null]);
  assert.equal(bad.applied, 0); assert.equal(bad.rejected.length, 6); ok('bad tables, shapes, future times, junk refused: ' + bad.rejected.slice(0, 3).join(' | '));
  const evil = "a'; DROP TABLE records;--";
  const sq = await sync('d', 0, [rec('items', evil, 1, 'd'), rec('items; DROP TABLE records;--', 'z', 1, 'd')]);
  assert.equal(sq.applied, 1); assert.equal(sq.rejected.length, 1);
  assert.equal((await sync('e', 0, [])).changes.find((c) => c.id === evil).id, evil); ok('SQL-looking text stored as text only');
  const many = Array.from({ length: 700 }, (_, i) => rec('stockMoves', 'm' + i, 1000 + i, 'P', { qty: 1 }));
  await sync('P', 0, many.slice(0, 350)); await sync('P', 0, many.slice(350));
  let cursor = 0, got = 0, rounds = 0, ids = new Set();
  for (;;) { const r = await sync('Q', cursor, []); r.changes.filter((c) => c.table === 'stockMoves').forEach((c) => ids.add(c.id)); cursor = r.cursor; rounds++; if (!r.more) break; }
  assert.equal(ids.size, 700); ok('paging: all 700 moves arrive in ' + rounds + ' rounds');
  await db.exec(`reset role;`);
  assert.equal((await db.query(`select count(*)::int c from public.records where id='a''; DROP TABLE records;--'`)).rows[0].c, 1); ok('records table still exists');

  // Security
  await as('stranger@example.com');
  await assert.rejects(sync('X', 0, []), /not allowed/); ok('a logged-in stranger cannot sync');
  await assert.rejects(db.query('select * from public.records'), /./).catch(() => {}); const sel = await db.query('select count(*)::int c from public.records'); assert.equal(sel.rows[0].c, 0); ok('a stranger sees zero rows if they query the table directly');
  await assert.rejects(db.query(`insert into public.records values ('items','hack','{}',1,'x',1)`), /row-level security|permission/); ok('a stranger cannot write the table directly');
  await as(null);
  await assert.rejects(sync('X', 0, []), /permission denied/); ok('not-logged-in (anon) cannot call sync');
  await assert.rejects(db.query('select * from public.records'), /permission denied/); ok('anon cannot read the table');
  await as('owner@example.com');
  await assert.rejects(db.query('select * from public.allowed_users'), /permission denied/); ok('even the owner cannot list allowed_users through the API');
  assert.ok(n >= 15);

});
