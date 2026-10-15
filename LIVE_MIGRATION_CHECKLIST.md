# Maintenix DEV → LIVE Migration Checklist

**Status:** Living production-migration runbook  
**Source of truth:** GitHub `main`  
**Production changes:** Do not execute any LIVE migration step until the migration is explicitly approved.

This file exists so every server process, worker, runtime dependency, persistent file, and validation step added during development is captured before CRA DEV is migrated to LIVE. Update this file whenever a new worker, background process, service worker, runtime dependency, scheduled task, or persistent runtime file is introduced.

Historical migration notes may still exist in the repository. Where they conflict with this file, this checklist is the current operational reference.

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

### Web Push browser service worker

`Web_UI/public/maintenix-push-sw.js` is a **browser service worker**, not a Linux/systemd process.

It is deployed as part of the Web UI and is registered by users' browsers when they enable **Device notifications**. It must **not** be added to `startAll.js` or systemd.

Its responsibilities are:

- receive Web Push messages while the Web UI is backgrounded/closed;
- display native device notifications;
- open/focus Maintenix when the user taps a notification.

The old offline worker must remain removed. Only the dedicated push worker should be preserved by frontend cleanup logic.

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
- `notification-delivery.json`
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
- Treat `data/templates/areas.txt` as operationally mutable data, not merely source.
- Preserve LIVE `data/area-metadata.json`; it contains organisation-specific Admin overrides and pending metadata for dynamically added Areas.
- Do not replace LIVE `area-metadata.json` with DEV runtime data during deployment.
- Preserve LIVE uploads and generated reports unless an explicit data-migration plan says otherwise.
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
- frontend logic that preserves the push-only worker while removing legacy offline workers.

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
- [ ] 8-hour absolute session expiry works.
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
| Push service worker | Browser JS `maintenix-push-sw.js` | Registered by browser | Required for device push | Deploy with Web UI; no systemd process |

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
