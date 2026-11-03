import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const TABLES = new Set(['items', 'parties', 'docs', 'payments', 'stockMoves', 'users', 'settings']);
const PAGE = 500;
const MAX_FUTURE_MS = 5 * 60 * 1000;

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS records (
      tbl TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      PRIMARY KEY (tbl, id)
    );
    CREATE INDEX IF NOT EXISTS records_seq ON records (seq);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO meta (key, value) VALUES ('seq', '0');
  `);
  return db;
}

/**
 * Builds the Express app.
 *  - POST /api/sync   push local changes and pull remote ones (idempotent, last-write-wins)
 *  - GET  /api/backup full JSON dump (auth required)
 *  - GET  /api/health liveness check (no auth)
 * When staticDir exists the built client is served too, so one process hosts app + API.
 */
export function createApp({ dbFile = ':memory:', syncKey, staticDir } = {}) {
  if (!syncKey || String(syncKey).length < 8) throw new Error('syncKey must be at least 8 characters');
  const db = openDb(dbFile);
  const keyHash = sha256(syncKey);

  const getSeq = db.prepare("SELECT value FROM meta WHERE key = 'seq'");
  const setSeq = db.prepare("UPDATE meta SET value = ? WHERE key = 'seq'");
  const getRec = db.prepare('SELECT updated_at, device_id FROM records WHERE tbl = ? AND id = ?');
  const putRec = db.prepare(
    'INSERT OR REPLACE INTO records (tbl, id, data, updated_at, device_id, seq) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const scan = db.prepare('SELECT tbl, id, data, seq, device_id FROM records WHERE seq > ? ORDER BY seq LIMIT ?');
  const dump = db.prepare('SELECT tbl, data FROM records');

  const app = express();
  app.disable('x-powered-by');
  // Behind Railway / Render / nginx the real client address is in X-Forwarded-For. Set TRUST_PROXY=1 there.
  const trust = process.env.TRUST_PROXY;
  if (trust) app.set('trust proxy', /^\d+$/.test(trust) ? Number(trust) : trust);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "connect-src *; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // --- brute-force guard on the sync key ------------------------------------
  // Wrong keys are counted per address and blocked after 10 tries for 15 minutes.
  // The correct key is never blocked, so nobody can lock the shop out by guessing.
  const failures = new Map(); // ip -> { n, until }
  setInterval(() => {
    const now = Date.now();
    for (const [ip, f] of failures) if (f.until <= now) failures.delete(ip);
  }, 10 * 60 * 1000).unref();
  function auth(req, res, next) {
    const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
    if (m && crypto.timingSafeEqual(sha256(m[1]), keyHash)) return next();
    const ip = req.ip;
    const f = failures.get(ip);
    const live = f && f.until > Date.now();
    if (live && f.n >= 10) return res.status(429).json({ error: 'Too many attempts' });
    failures.set(ip, { n: (live ? f.n : 0) + 1, until: Date.now() + 15 * 60 * 1000 });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: Date.now() }));

  app.post('/api/sync', auth, (req, res) => {
    const { deviceId, cursor = 0, changes = [] } = req.body ?? {};
    if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 100) {
      return res.status(400).json({ error: 'deviceId required' });
    }
    if (!Number.isFinite(cursor) || !Array.isArray(changes) || changes.length > 1000) {
      return res.status(400).json({ error: 'bad request' });
    }
    const now = Date.now();
    const rejected = [];
    let applied = 0;

    db.exec('BEGIN IMMEDIATE');
    try {
      let seq = Number(getSeq.get().value);
      for (const c of changes) {
        const okShape =
          c && TABLES.has(c.table) && typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 200 &&
          Number.isFinite(c.updatedAt) && c.data && typeof c.data === 'object' &&
          c.data.id === c.id && c.data.updatedAt === c.updatedAt && typeof c.data.deviceId === 'string';
        if (!okShape) { rejected.push(`${c?.table}:${c?.id} (bad shape)`); continue; }
        if (c.updatedAt > now + MAX_FUTURE_MS) { rejected.push(`${c.table}:${c.id} (timestamp in the future)`); continue; }
        const existing = getRec.get(c.table, c.id);
        if (existing) {
          if (existing.updated_at > c.updatedAt) continue; // we already hold a newer version
          if (existing.updated_at === c.updatedAt && existing.device_id >= c.data.deviceId) continue; // duplicate retry
        }
        seq += 1;
        putRec.run(c.table, c.id, JSON.stringify(c.data), c.updatedAt, c.data.deviceId, seq);
        applied += 1;
      }
      setSeq.run(String(seq));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      console.error('sync failed', e);
      return res.status(500).json({ error: 'Server error' });
    }

    // Pull: scan by sequence, hide records that came from this same device.
    const rows = scan.all(cursor, PAGE);
    const out = [];
    for (const r of rows) {
      if (r.device_id === deviceId) continue;
      out.push({ table: r.tbl, id: r.id, updatedAt: JSON.parse(r.data).updatedAt, data: JSON.parse(r.data) });
    }
    const last = rows.length ? rows[rows.length - 1].seq : cursor;
    res.json({ cursor: last, more: rows.length === PAGE, changes: out, applied, rejected });
  });

  app.get('/api/backup', auth, (_req, res) => {
    const out = {};
    for (const r of dump.all()) (out[r.tbl] ||= []).push(JSON.parse(r.data));
    res.setHeader('Content-Disposition', `attachment; filename="ts-auto-trader-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(out);
  });

  if (staticDir && fs.existsSync(staticDir)) {
    app.use(
      express.static(staticDir, {
        setHeaders(res, file) {
          // The service worker and HTML must always be revalidated so updates roll out.
          if (/(sw\.js|index\.html|manifest\.webmanifest|registerSW\.js)$/.test(file)) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.resolve(staticDir, 'index.html')));
  }

  return { app, db };
}
