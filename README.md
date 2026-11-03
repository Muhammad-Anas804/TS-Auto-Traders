# TS Auto Trader

Billing, stock and ledger software for an auto-parts trading shop. It works in any browser, **online or offline**, and installs like an app on phones and PCs. The sale invoice follows the Master Auto Traders layout (invoice no., date, bill-to, PO / challan boxes, Qty, Rate, Gross, Discount, Net, free-quantity lines).

## What it does

- **Sale invoices** with search-as-you-type items, per-line discount (% or Rs), free (bonus) quantities, extra discount, amount in words, A4 print / Save as PDF, 80 mm thermal receipt, and a **WhatsApp PDF** button that sends the invoice as a real A4 PDF file (on phones and Windows it opens the share list; elsewhere it saves the PDF and opens WhatsApp so you can attach it).
- **Purchases** (updates stock and optionally item cost), **sale and purchase returns**.
- **Stock** kept as an append-only ledger of movements, with low-stock alerts, adjustments and CSV import/export of items.
- **Customers and suppliers** with opening balance, credit limit, default discount, statements and ledgers.
- **Payments** (cash / bank / cheque / online), received or paid, against an invoice or on account.
- **Reports**: daily sales, profit per item, stock value, outstanding balances, top items, CSV export.
- **Users and roles**: owner, salesman, storekeeper (only the owner sees profit and settings).
- **Calculator** on every screen (button in the top bar, or Alt+C). Type or tap; supports brackets and percent (`525-12%` = 462).
- **Urdu and English.** One tap on the language button (top bar, login and setup screens) switches the whole app, including right-to-left layout. The printed invoice has its own language setting in Settings: English (default), Urdu, or both, with the amount in words in the same language. Texts live in `client/src/i18n/ur/*.ts`; a test fails if any screen text is missing its Urdu.
- **Backup**: one-click JSON backup and restore on each device, plus daily server backups (last 14 kept) when you use your own server.
- **Online copy in Supabase or your own server.** In Settings you choose where the shop's online copy lives: your own small server (SQLite) or a Supabase project (free tier, Postgres). The app saves on the device first either way. Supabase steps are in `SUPABASE.md`; the database script is `supabase/schema.sql`.

## How offline works

Every save goes to the browser database (IndexedDB) first, so the app never waits for the network. Changes are queued and sent to the server when a connection is available; changes from other devices are pulled back. The badge at the top shows `Offline · N waiting`, `Syncing…` or `Synced`. The app shell is cached by a service worker, so reloading with no internet works.

Conflicts: stock movements, invoices and payments are only ever added, so they merge cleanly. Item prices and customer details use last-write-wins. Each device has its own invoice prefix (for example `A-`, `B-`) so two offline devices never issue the same number.

## Run it

Requirements: Node.js 22 or newer.

```bash
npm run install:all
npm run build        # builds the app into client/dist
npm start            # server + app on http://localhost:8787
```

The first start prints a **sync key** (also saved in `server/data/sync-key.txt`). Open `http://localhost:8787`, choose *Set up a new shop*, and create the owner login.

To add a second device: open the app from the server address on that device, choose *Connect another device*, enter the sync key and give the device its own invoice prefix.

Environment variables: `PORT`, `DATA_DIR` (database and backups), `SYNC_KEY` (use your own key), `STATIC_DIR`.

## Putting it online

Using Supabase for the data? Read `SUPABASE.md`; the app files can then be hosted anywhere (the same server, or static hosting for `client/dist`).

See `DEPLOY.md` for step-by-step Railway / Render instructions (a `Dockerfile` is included).

## Using it on phones

Browsers only allow install and offline mode over **HTTPS** (or `localhost`). Put the server behind HTTPS, for example on a small VPS with Caddy or nginx, or on Railway/Render with a persistent disk for `DATA_DIR`. Then open the HTTPS address on each phone and choose *Install app* / *Add to Home Screen*.

## Development

```bash
npm --prefix client run dev     # app with hot reload (http://localhost:5173)
npm test                        # calculation, stock, ledger, sync and server tests
```

Layout: `client/src/lib` holds money, discount, stock, ledger, sync and database code (tested); `client/src/pages` the screens; `server/src/app.js` the sync API (SQLite via `node:sqlite`).

## Important notes

- Keep the **sync key** and the owner password safe. The key lets a device download all shop data.
- Browsers can clear site data in rare cases (storage pressure, "clear browsing data"). Keep syncing to the server and download a backup weekly.
- Money is stored in paisa (integers), so totals never drift by rounding.
- Passwords are hashed on the device (PBKDF2). This protects against casual access; the sync key is the real gate for shop data on the server.
