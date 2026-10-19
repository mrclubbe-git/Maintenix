# Maintenix DEV → LIVE Migration Checklist

**Status:** Living production-migration runbook  
**Source of truth:** GitHub `main`  
**Production changes:** Do not execute any LIVE migration step until the migration is explicitly approved.

This file exists so every server process, worker, runtime dependency, persistent file, and validation step added during development is captured before CRA DEV is migrated to LIVE. Update this file whenever a new worker, background process, service worker, runtime dependency, scheduled task, or persistent runtime file is introduced.

Historical migration notes may still exist in the repository. Where they conflict with this file, this checklist is the current operational reference.

## Approved migration baseline — 2026-10-19

The user has explicitly accepted the current CRA DEV application state as the **migration-approved version baseline**.

- Accepted `main` source head at declaration: `51300a11f7cc85e54093b8af2313aaea8190aeca`
- Accepted `deploy` frontend head at declaration: `2642634614d8a1c47915c13f9eb2b54d4eb7051d`
- Final GitHub Pages deployment for this baseline: workflow run `39270366042` — successful.
- This supersedes the previously recorded accepted migration version.
- The approved baseline includes the accepted Overview tracker/mobile refinements and the Standby/Pictures mobile card improvements in addition to all previously accepted migration functionality.
- This records **which version is approved for migration**. Do not execute the LIVE cutover or make unrelated LIVE changes until the user explicitly instructs that the migration/cutover should proceed.

---

## 1. Current runtime process inventory

The CRA backend currently has **four long-running Node.js processes**. They are launched together by:

```bash
npm run start:all
```

`Server_API/CRA/startAll.js` currently starts:

| Process | File | Long-running | Required at LIVE startup |
| --- | --- | --- | --- |
| API server | `Server_API/CRA/index.js` | Yes | Yes |
| Servicing queue worker | `Server_API/CRA/servicingWorker.js` | Yes | Yes |
| Call Out queue worker | `Server_API/CRA/calloutWorker.js` | Yes | Yes |
| Notification delivery worker | `Server_API/CRA/notificationWorker.js` | Yes | Yes |

**Do not start duplicate Servicing or Call Out workers unless multi-worker queue processing has explicitly been designed and tested.** The notification delivery queue uses atomic claims and stale-claim recovery, but one supervised notification worker remains the standard deployment.

Recommended LIVE supervision is one systemd service whose working directory is the CRA backend and whose start command is:

```bash
npm run start:all
```

The supervisor must restart the stack if it exits unexpectedly and must capture stdout/stderr logs.

---

## 2. Processes that are workers but are NOT separate long-running services

### Formal Reporting worker

`Server_API/CRA/formal-reporting/report_worker.py` is a Python worker, but it is **not** a daemon that should be started with systemd.

The API route `Server_API/CRA/routes/formalReports.js` starts it on demand with Python whenever Formal Reporting health/generation operations run.

LIVE therefore needs the runtime dependencies available to the backend service account:

- `python3`
- Python `python-docx` package
- LibreOffice in headless mode
- `pdftotext` (normally supplied by `poppler-utils`)
- the three Formal Reporting DOCX master templates under `data/templates/formal-reports/`

Optional environment override:

```text
FORMAL_REPORT_PYTHON=/usr/bin/python3
```

Validate before cut-over:

```bash
python3 Server_API/CRA/formal-reporting/report_worker.py health
```

The result must report `"ok": true`.

### Maintenix browser service worker

`Web_UI/public/maintenix-push-sw.js` is the single approved **browser service worker**, not a Linux/systemd process.

It is deployed as part of the Web UI and is registered by the application on supported secure browsers. Device-notification opt-in still controls Push subscription, but worker registration is also required for the offline application shell. It must **not** be added to `startAll.js` or systemd.

Its responsibilities are:

- receive Web Push messages while the Web UI is backgrounded/closed;
- display native device notifications;
- open/focus Maintenix when the user taps a notification;
- cache the CRA application shell (HTML/JS/CSS/static assets) after a successful online load;
- allow the GitHub Pages/hosted CRA shell to cold-start when the network is unavailable.

The removed legacy offline/recovery workers must remain removed. Do not introduce a second worker for offline mode; extend the existing `maintenix-push-sw.js` only.

---

## 3. Web Push backend requirements

Web Push delivery is integrated into the API process through:

- `Server_API/CRA/lib/pushNotifications.js`
- `Server_API/CRA/routes/push.js`
- `Server_API/CRA/lib/notifications.js`
- `Server_API/CRA/index.js`

Web Push delivery is dispatched by the separate long-running `notificationWorker.js`. The API persists the notification and enqueues delivery; the worker performs Web Push asynchronously so a push-provider outage does not block the business operation that created the notification.

Required Node dependency:

```text
web-push 3.6.7
```

Install dependencies in the LIVE CRA backend directory using the production-approved installation method. Do not run `npm audit fix` as part of migration.

The backend service account must be able to traverse/read `node_modules`. Validate as that account, for example:

```bash
sudo -u <live-service-user> node -e "require('web-push'); console.log('web-push OK')"
sudo -u <live-service-user> node -e "require('./lib/pushNotifications'); console.log('pushNotifications OK')"
sudo -u <live-service-user> node -e "require('./routes/push'); console.log('push route OK')"
sudo -u <live-service-user> node -e "require('./lib/notifications'); console.log('notifications OK')"
```

### VAPID keys

If `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` are not supplied by environment variables, CRA automatically creates a keypair at:

```text
Server_API/CRA/data/web-push-vapid.json
```

This file contains the private key.

LIVE rules:

- generate/use one LIVE keypair;
- protect it like a secret;
- back it up;
- preserve it across application updates/redeployments;
- never commit it to GitHub;
- do not replace it casually after users have subscribed.

Device subscriptions are stored separately in:

```text
Server_API/CRA/data/push-subscriptions.json
```

Do **not** copy DEV device subscriptions to LIVE. Users should subscribe from the LIVE Web UI. If the LIVE frontend origin changes, browsers must create subscriptions for that LIVE origin.

---

## 4. Current LIVE backend startup target

Historical LIVE backend location:

```text
/opt/apps/maintenix/api
```

Historical LIVE internal port:

```text
5055
```

**Do not modify this production installation during development.** At migration time, confirm the final LIVE directory, service user, port, environment variables, proxy/tunnel route, and systemd unit before applying changes.

The DEV installation remains separate and must not be treated as a Git checkout/synchronization target.

---

## 5. Runtime data: preserve vs. do not copy from DEV

### Current selective-data migration rule — 2026-10-19

Do **not** treat `Server_API/CRA/data/` as one directory that is either kept untouched or replaced wholesale. The LIVE migration is file/directory-specific:

- preserve LIVE production/business records such as `users.json`, `reports.meta.json`, `uploads/` (reports/pictures/evidence), `stock.json`, `standby.json`, planner/notification/preferences data, profile pictures, area metadata, Site Logs, existing LIVE cryptographic keys/subscriptions and in-flight report state when present;
- reset ephemeral `sessions.json` and `presence.json` after taking the migration backup so the new session/presence implementation starts cleanly;
- copy **only** `Server_API/CRA/data/templates/` from CRA DEV;
- because `data/templates/areas.txt` is runtime-mutable, stage the DEV templates and merge LIVE-only Area names into the staged `areas.txt` before installing the template directory;
- do not copy any other CRA DEV runtime data;
- if a new runtime file introduced during development is absent on LIVE, allow LIVE to create its own instance rather than copying DEV state.

The current migration ZIP implementing this rule is `Maintenix_Current_Site_Migration_2026-10-19_v2.zip`. It also uses the exact frontend currently served by the repo at deploy head `8ef05c88f0d263a3bbf9161244f94aa667c1a966`.

The application stores operational state under `Server_API/CRA/data/`.

Before any LIVE migration, take a verified backup of the existing LIVE data directory.

Do **not** blindly replace LIVE runtime data with DEV runtime data.

Important runtime files include, but are not limited to:

- `users.json`
- `sessions.json`
- `presence.json`
- `notifications.json`
- `daily-planner.json`
- `user-preferences.json`
- `push-subscriptions.json`
- `web-push-vapid.json`
- `offline-lease-private.pem`
- `offline-lease-public.pem`
- `notification-delivery.json`
- `site-logs/` daily NDJSON runtime logs
- `area-metadata.json`
- drafts
- queue/status data
- uploaded files
- generated reports
- report metadata
- operational areas/services lists

Specific rules:

- **Never overwrite LIVE `users.json` with DEV data.**
- Do not migrate DEV sessions to LIVE.
- Do not migrate DEV presence data to LIVE.
- Do not migrate DEV push subscriptions to LIVE.
- Preserve the LIVE VAPID key once LIVE push subscriptions exist.
- Do **not** migrate the DEV offline-lease RSA private/public keypair to LIVE. Allow LIVE to generate its own organisation/runtime keypair on first authenticated lease issuance (or pre-provision a LIVE-specific pair through the documented environment paths).
- Once LIVE offline leases have been issued, preserve the LIVE offline-lease signing keypair across ordinary redeployments. Replacing it invalidates still-valid local leases until users reconnect and receive a new lease.
- Treat `data/templates/areas.txt` as operationally mutable data, not merely source.
- Preserve LIVE `data/area-metadata.json`; it contains organisation-specific Admin overrides and pending metadata for dynamically added Areas.
- Do not replace LIVE `area-metadata.json` with DEV runtime data during deployment.
- Preserve LIVE uploads and generated reports unless an explicit data-migration plan says otherwise.
- Do not copy DEV Site Logs into LIVE. LIVE Site Logs are runtime operational/audit data and must remain separate from DEV.
- Source-controlled templates/configuration may be deployed from GitHub, but verify whether a file is runtime-mutated before replacing it.

---

## 6. Source-controlled backend files that must be present for current features

At minimum the LIVE migration must include the current CRA backend source and dependencies, including:

- `index.js`
- `startAll.js`
- `servicingWorker.js`
- `calloutWorker.js`
- `notificationWorker.js`
- `lib/notificationRegistry.js`
- `lib/notificationService.js`
- `lib/notificationDelivery.js`
- `lib/notifications.js`
- `lib/pushNotifications.js`
- `lib/userPreferences.js`
- `lib/areaMetadata.js`
- `lib/reportStorage.js`
- `routes/admin.js`
- `routes/areas.js`
- `routes/notifications.js`
- `routes/push.js`
- `lib/profileRoutes.js`
- `routes/dailyPlanner.js`
- `lib/dailyPlanner.js`
- `routes/formalReports.js`
- `formal-reporting/report_worker.py`
- `package.json`
- `package-lock.json`
- required report/document templates under `data/templates/`

This is not intended to be a substitute for deploying the complete approved CRA backend source. It highlights files associated with runtime/background functionality that are easy to miss.

---

## 7. Frontend items required for background/device behavior

The approved LIVE Web UI must contain:

- notification preference UI;
- Navbar in-app notification handling;
- `Web_UI/src/lib/devicePush.js`;
- `Web_UI/public/maintenix-push-sw.js`;
- `Web_UI/src/lib/offlineSession.js`;
- `Web_UI/src/lib/offlineSync.js`;
- frontend logic that preserves the single Maintenix worker while removing legacy offline/recovery workers;
- IndexedDB reference-data fallback for Servicing, Call Out and ADMIN Section Reports.

The production build must use the correct LIVE API base URL.

After deployment, verify that the push worker is served from the expected LIVE Web UI scope and that the browser can register it successfully.

---

## 8. Service-account permissions

Before starting LIVE, validate that the dedicated service account can:

- read all deployed backend source files;
- traverse/read all installed Node dependencies;
- read required templates;
- execute Node and Python;
- invoke LibreOffice and `pdftotext`;
- write required runtime files under `data/`;
- write uploads/generated reports;
- create/update queue/status files;
- create/read `web-push-vapid.json`;
- create/read/update `push-subscriptions.json`;
- create/read/update `area-metadata.json`.

Avoid solving permission problems by running the application as root.

---

## 9. Pre-cut-over worker validation

Before directing LIVE traffic to the upgraded application:

```bash
# Run from the final LIVE CRA backend directory.

node --check index.js
node --check startAll.js
node --check servicingWorker.js
node --check calloutWorker.js
node --check notificationWorker.js
node --check lib/notificationRegistry.js
node --check lib/notificationService.js
node --check lib/notificationDelivery.js
node --check lib/notifications.js
node --check lib/pushNotifications.js
node --check lib/areaMetadata.js
node --check lib/reportStorage.js
node --check routes/admin.js
node --check routes/areas.js
node --check routes/push.js

# Run module resolution as the LIVE service account.
sudo -u <live-service-user> node -e "require('web-push'); console.log('web-push OK')"
sudo -u <live-service-user> node -e "require('./lib/pushNotifications'); console.log('pushNotifications OK')"

# Formal Reporting dependency/worker health.
python3 formal-reporting/report_worker.py health
```

Do not proceed if any required check fails.

---

## 10. LIVE startup validation

After starting/restarting the LIVE service, verify that **all four long-running Node processes** are present:

- API
- Servicing worker
- Call Out worker
- Notification delivery worker

Example checks:

```bash
sudo systemctl status <live-maintenix-service> --no-pager
ps -ef | grep -E 'index\.js|servicingWorker\.js|calloutWorker\.js' | grep -v grep
ss -ltnp | grep <live-port>
```

Then verify the local origin:

```bash
curl -i http://127.0.0.1:<live-port>/api/health
```

Expected application response:

```json
{"ok":true}
```

Then verify the public LIVE health endpoint through the actual LIVE reverse proxy/tunnel.

---

## 11. Feature acceptance after cut-over

Do not consider the migration complete until all applicable checks pass:

- [ ] Authentication/login works.
- [ ] Administration -> Site Logs is ADMIN-only and loads recent activity/error records.
- [ ] Site Logs records show request IDs for correlated API failures.
- [ ] Client error ingestion is authenticated/CSRF-protected and does not expose passwords, tokens, cookies, signatures or private keys.
- [ ] Site Logs runtime retention/storage permissions work without a separate service or cron job.
- [ ] 48-hour renewable session/inactivity window works while connected.
- [ ] A signed 48-hour offline lease is issued after successful online validation.
- [ ] Offline access is denied after lease expiry until successful online validation/sign-in.
- [ ] Automatic sync runs on reconnect/app resume and refreshes Areas, Servicing reference data and ADMIN Section Report inventory.
- [ ] Profile/preferences persist.
- [ ] Notification bell loads.
- [ ] In-app notification sound works.
- [ ] Device Web Push subscription can be enabled.
- [ ] Native test push arrives while Maintenix is backgrounded.
- [ ] Admin/L3 broadcast produces both in-app and subscribed-device delivery.
- [ ] Notification delivery worker processes queued push deliveries and retries transient failures without blocking the API.
- [ ] Daily Planner allocation notification and acknowledgement work.
- [ ] Administration → Areas lists baseline and runtime areas and shows pending metadata.
- [ ] Adding a genuinely new Area creates a PENDING runtime metadata record and Admin notification without blocking Servicing.
- [ ] Configured runtime Area metadata overrides baseline/fuzzy resolution for future reports.
- [ ] Substation NFPA 72 Servicing requires an ASD-installed choice; ASD = No excludes ASD questions from the session, draft payload and generated report.
- [ ] Conveyor NFPA 72 Servicing requires a Linear heat type choice; Fiber keeps the existing fibre/FiberSystem questions, while Standard substitutes the approved interface-unit/end-of-line question set in the session, saved draft and generated report.
- [ ] Cumulative Servicing frequencies do not duplicate recurring logical checks; higher-frequency wording supersedes the equivalent lower-frequency copy for both Substation and Conveyor questionnaires.
- [ ] Servicing queue worker processes a test job.
- [ ] Call Out queue worker processes a test job.
- [ ] Formal Reporting worker health passes.
- [ ] Formal Reporting can generate DOCX/PDF output.
- [ ] Uploads and generated reports are readable through LIVE URLs.
- [ ] Existing LIVE users/data remain intact.
- [ ] Existing LIVE uploads/reports remain intact.
- [ ] Service survives a controlled restart.
- [ ] Service starts correctly after server reboot.

---

## 12. Worker/service register — update this whenever architecture changes

| Component | Runtime | Start model | Current status | LIVE action |
| --- | --- | --- | --- | --- |
| API | Node.js `index.js` | Long-running via `startAll.js` | Required | Start/supervise |
| Servicing worker | Node.js `servicingWorker.js` | Long-running via `startAll.js` | Required | Start/supervise |
| Call Out worker | Node.js `calloutWorker.js` | Long-running via `startAll.js` | Required | Start/supervise |
| Notification delivery worker | Node.js `notificationWorker.js` | Long-running via `startAll.js` | Required | Start/supervise; processes persistent Web Push outbox |
| Formal Reporting worker | Python `report_worker.py` | Spawned on demand by API | Required dependency | Do not daemonize; install/validate dependencies |
| Web Push delivery | Node.js `notificationWorker.js` + `lib/pushNotifications.js` | Persistent outbox worker | Required | Start with `startAll.js`; preserve `notification-delivery.json` as runtime state |
| Maintenix browser worker | Browser JS `maintenix-push-sw.js` | Registered by browser | Required for device push + offline app shell | Deploy with Web UI; no systemd process; preserve as the single worker |

### Rule for future development

Whenever development adds any of the following, update this table and the relevant migration sections in the same GitHub change:

- a new long-running worker;
- a scheduled/cron task;
- a new systemd service;
- a browser service worker;
- a Python/background subprocess;
- a new external runtime dependency;
- a new persistent runtime data file;
- a new secret/key that must survive redeployment.

This prevents DEV-only infrastructure from being forgotten when CRA is promoted to LIVE.

## Cloudflare / edge-managed security controls

The final Maintenix site is expected to run behind Cloudflare. Security controls that are naturally delivered by the final Cloudflare/edge hosting layer must be recorded here and implemented during final hosting/migration rather than recreated as temporary DEV services.

Rules:

- Do **not** create a separate systemd service, local proxy daemon, header-injection process, scheduled task, or other persistent host service solely to imitate a control that Cloudflare will provide in the final architecture.
- Do **not** add such temporary infrastructure to `startAll.js`.
- Application-owned runtime processes remain limited to processes the Maintenix application itself needs.
- The current GitHub Pages test frontend may use application-compatible fallbacks where necessary, but these do not replace final edge enforcement.

Final edge requirements include, at minimum:

- HTTP `Content-Security-Policy` response headers appropriate to the final origin, including `frame-ancestors 'none'`;
- `X-Frame-Options: DENY`;
- final TLS/HSTS policy;
- final reverse-proxy/origin routing and security headers;
- any additional Cloudflare edge controls approved during migration.

These controls must be validated on the final Cloudflare-hosted candidate before LIVE acceptance. They are migration configuration, not additional Maintenix application services.


## Profile photo runtime storage

The repaired CRA application now stores newly uploaded profile photos in `Server_API/CRA/data/profilepics` by default. The public application URL remains `/uploads/profilepics/<file>`.

Migration requirements:

- preserve `data/profilepics` as runtime state;
- also preserve any legacy `data/uploads/profilepics` directory while user records may still reference older avatar files;
- do not overwrite either directory from Git;
- if `PROFILE_PICS_DIR` is deliberately configured, preserve and restore that configured runtime directory instead;
- retain service-account write access to the active profile-photo directory;
- verify a valid avatar replacement and persistence after the final migration.

The application serves the new directory first and retains legacy-folder fallback, so no destructive one-time avatar migration is required before cut-over.
