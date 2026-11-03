# Putting TS Auto Trader online (one shop, one computer)

Cost: about $5 to $8 per month on Railway or Render, plus an optional domain (about $10 to $15 per year).

The app is packaged with a `Dockerfile`, so these services build and run it for you. The Docker image itself was not built in the environment where this project was written (no Docker there). The first deploy on Railway or Render is its first real build; if it shows an error, send the log.

## Option A: Railway (simplest)

1. Create a free GitHub account and upload this project to a **private** repository.
2. On railway.com, choose **New Project > Deploy from GitHub repo** and pick the repository. Railway finds the `Dockerfile` by itself.
3. Open the service, then **Settings > Volumes > Add volume** and mount it at `/data`. This disk keeps the shop database. Without it, every redeploy erases the data.
4. Open **Variables** and add `SYNC_KEY` with a long secret value (at least 8 characters, 20 or more is better). Write it down safely: this is the key the shop computer uses to connect.
5. Open **Settings > Networking > Generate domain**. You get an `https://...up.railway.app` address.
6. Wait for the deploy to turn green, then open the address. Check `https://YOUR-ADDRESS/api/health`: it should show `{"ok":true,...}`.

## Option B: Render

1. Upload the project to a private GitHub repository.
2. On render.com choose **New > Web Service**, pick the repository, set **Runtime: Docker**, and choose a paid instance (the free one sleeps and has no disk).
3. Under **Disks**, add a disk mounted at `/data`.
4. Add the environment variable `SYNC_KEY` as above.
5. Deploy and open the `onrender.com` address.

## First-time setup on the shop computer

1. Open the HTTPS address in Chrome or Edge.
2. Choose **Set up a new shop**. Enter the shop name, address, phone, owner login, and the invoice number to continue from (for example 5511).
3. Go to **Settings > Sync between devices**, leave the server address empty, paste the `SYNC_KEY`, and press **Save and sync now**. The badge at the top should say **Synced**.
4. Install the app: use the **Install app** button in the side menu (or the install icon in the address bar). It then opens like a normal program and keeps working without internet.
5. Add the customers and items (Items page can import a CSV), and print one test invoice.

## Keeping the data safe

- The server keeps a daily copy of the database for the last 14 days, on the same disk.
- Once a week, in **Settings**, press **Download backup** and copy the file to a USB drive or Google Drive. A copy kept somewhere else is the only protection if the hosting disk is lost.
- Never share the `SYNC_KEY`. Anyone who has it can download all the customer and sales data. If it leaks, change `SYNC_KEY` in the service variables and enter the new key in Settings.
- Use a strong owner password. Use the app on one trusted computer.

## Changing the app later

Push the change to GitHub. Railway and Render rebuild and redeploy on their own, and the shop computer picks up the new version the next time it is opened with internet.

## Running it on your own computer instead

See `README.md` ("Run it").
