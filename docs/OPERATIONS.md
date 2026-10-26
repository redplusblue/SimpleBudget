# Operations

## Run it
```bash
cp .env.example .env            # set APP_SECRET (openssl rand -hex 32) and TZ
docker compose up -d --build
docker compose logs -f simplebudget
```
The container listens on 3000 (publish another host port with `HOST_PORT`). Health check: `GET /api/health` → `{"ok":true}`; Docker uses it for `HEALTHCHECK`.
Data lives in `./data` (mounted at `/data`): `simplebudget.db` (+ `-wal`/`-shm`) and `backups/`.

**Permissions:** the image runs as uid **10001**. If `./data` is owned by someone else you'll see `attempt to write a readonly database` or `EACCES`: `sudo chown -R 10001:10001 data`.

## Environment variables
| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `APP_SECRET` | yes | | ≥ 32 chars. Encrypts stored secrets (SimpleFIN access URL, AI key, alert address) and signs sessions. **Changing it invalidates stored secrets** (you'll re-enter them) and logs everyone out. Keep it out of the data folder so a leaked backup isn't enough. |
| `TZ` | no | `UTC` | IANA zone. Decides local days/months, cron times (backup 03:30, sync schedule) |
| `DATABASE_PATH` | no | `/data/simplebudget.db` in Docker, `./data/simplebudget.db` otherwise | |
| `BACKUP_DIR` | no | `<db folder>/backups` | |
| `COOKIE_SECURE` | no | `false` | `true` behind HTTPS (Secure cookie + HSTS) |
| `LOG_LEVEL` | no | `info` | `silent` in tests |
| `PORT` / `HOSTNAME` | no | 3000 / 0.0.0.0 in Docker | Next's own |
| `HOST_PORT` | no | 3000 | Compose only |
There is no other configuration file; everything else (SimpleFIN, AI, alerts, currency rates, sync schedule) is set in the UI and stored in the database.

## HTTPS / reverse proxy
Caddy (automatic certificates):
```caddyfile
budget.example.com {
    reverse_proxy simplebudget:3000
}
```
nginx must forward `Host` (or `X-Forwarded-Host`) and `X-Forwarded-Proto`; the CSRF check compares the browser's `Origin` with that host. Set `COOKIE_SECURE=true`.
Prefer a private network (Tailscale/WireGuard) over exposing it publicly. There is one password and a login rate limit; no accounts or sharing.

## Backups and restore
- Automatic: nightly 03:30 (and once ~1 min after boot if the newest is over 24 h old) → `backups/simplebudget-YYYYMMDD-HHMMSS.sqlite`, newest 14 kept.
- Manual: **Settings → About → Back up now**; download via **Settings → Export** (`GET /api/export/backup`); CSV of transactions via `GET /api/export/transactions`.
- Copy `data/backups/` off the machine (they contain your encrypted bank connection and the password hash; treat as secrets).
- **Restore:** `docker compose down`; replace `data/simplebudget.db` with the backup file (delete `simplebudget.db-wal` and `-shm`); `chown 10001:10001`; `docker compose up -d`. The same `APP_SECRET` is required to read the stored secrets.

## Upgrading
```bash
git pull
docker compose up -d --build     # migrations run automatically on start
```
Take a backup first (Settings → About). Migrations only move forward; to roll back restore the backup and the previous image. Check `DECISIONS.md` and the git log for notes.

## SimpleFIN limits
~24 requests/day per connection are allowed; the app keeps itself to 20 and refuses manual incremental syncs within 15 minutes of the last. The background schedule (Settings → Sync: off / 3 h / 6 h / 12 h / daily) runs incremental syncs over the last 14 days. A failed sync keeps the data you have and shows the reason; with **Settings → Alerts** on you also get a push message (at most one per 6 h).

## Monitoring and logs
JSON logs on stdout (pino) with secrets redacted: `docker compose logs`. `LOG_LEVEL=debug` for more. Sync history: Settings → Sync. Database size and backups: Settings → About.

## Automations and Discord
- Scheduled automations run inside the server process, so they need it to be running at that time. **Missed runs are not caught up**: if the server was off at 09:00 on Sunday, that run simply doesn't happen. Times use the server's `TZ`.
- Transaction, target and balance automations are checked after each sync. A slow or failing destination never delays or fails a sync; failures show in the automation's History as a plain reason.
- **Discord:** in your server, Server Settings → Integrations → Webhooks → New Webhook → Copy URL, then paste it into Settings → Automations → Add destination (or Settings → Alerts). The address is the credential: anyone with it can post to that channel, so don't share it.
- Each automation keeps its newest 50 runs.

## Troubleshooting
| Symptom | Fix |
| --- | --- |
| `Invalid environment configuration: APP_SECRET…` at boot | set `APP_SECRET` to ≥ 32 chars |
| "Decryption failed (wrong APP_SECRET…)" in logs / "stored credentials missing" | `APP_SECRET` changed: remove and re-add the connection, re-enter AI key and alert address |
| `readonly database` / `EACCES` | `chown -R 10001:10001 data` |
| Can't log in over HTTPS / cookie not kept | `COOKIE_SECURE=true` only with HTTPS; plain-HTTP access with it set will fail |
| 403 "Cross-site request refused" on every save behind a proxy | proxy isn't forwarding `Host`/`X-Forwarded-Host` |
| "Daily SimpleFIN request limit reached" | wait until tomorrow; sync less often |
| Wrong "today"/month boundaries | set `TZ` |
| Port 3000 busy | `HOST_PORT=3300` in `.env` |
| Web page works but PWA won't install | needs HTTPS (or localhost) |
