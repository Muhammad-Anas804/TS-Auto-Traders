import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(here, '..', 'data'));
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(here, '..', '..', 'client', 'dist'));
fs.mkdirSync(DATA_DIR, { recursive: true });

// The sync key: from the environment, or generated once and kept in the data folder.
let syncKey = process.env.SYNC_KEY;
const keyFile = path.join(DATA_DIR, 'sync-key.txt');
if (!syncKey) {
  if (fs.existsSync(keyFile)) syncKey = fs.readFileSync(keyFile, 'utf8').trim();
  else {
    syncKey = crypto.randomBytes(18).toString('base64url');
    fs.writeFileSync(keyFile, syncKey + '\n', { mode: 0o600 });
    console.log('Generated a new sync key (saved to data/sync-key.txt).');
  }
}

const dbFile = path.join(DATA_DIR, 'ts-auto-trader.sqlite');
const { app, db } = createApp({ dbFile, syncKey, staticDir: STATIC_DIR });

// Daily backup copy of the database, keeping the last 14.
function backup() {
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `backup-${new Date().toISOString().slice(0, 10)}.sqlite`);
  if (!fs.existsSync(target)) {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    console.log('Backup written:', target);
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 14))) fs.unlinkSync(path.join(dir, f));
}
try { backup(); } catch (e) { console.error('backup failed', e); }
setInterval(() => { try { backup(); } catch (e) { console.error('backup failed', e); } }, 6 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`TS Auto Trader server listening on http://localhost:${PORT}`);
  console.log(`Sync key: ${syncKey}`);
  console.log(fs.existsSync(STATIC_DIR) ? `Serving app from ${STATIC_DIR}` : 'Client build not found; run "npm run build" in client/ to serve the app from here.');
});
