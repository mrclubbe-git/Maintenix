# Maintenix CRA — GitHub Pages DEV Security Remediation Test Instructions

**Document purpose:** Tester instruction / acceptance plan  
**Environment:** CRA DEV only  
**Frontend under test:** https://mrclubbe-git.github.io/Maintenix/CRA/  
**DEV API:** https://dev-api.main-tenix.com/CRA  
**Do not test against LIVE.**  
**Date prepared:** 2026-10-18

---

## 1. Goal of this test cycle

The goal of this test cycle is to validate the **application-level security remediation and functional regression behaviour that can be tested on the current GitHub Pages-hosted DEV site**.

The repaired CRA backend and the matching Web UI have now been deployed together for DEV testing. The application has moved from browser-managed bearer-token authentication to server-managed Secure/HttpOnly session cookies with CSRF protection, and several related security, permission, reporting, upload and session-lifecycle changes were included in the same coordinated remediation.

This test cycle is **not** a final infrastructure security certification.

The final Maintenix site is planned to run behind **Cloudflare**. Some security controls belong to that future edge/hosting layer and cannot be correctly implemented or verified on the current `github.io` frontend. The tester must therefore distinguish between:

1. **application behaviour that must work now and must be tested now**, and
2. **Cloudflare/edge controls that are intentionally deferred until the final hosted architecture exists**.

A missing Cloudflare-owned response header on the current GitHub Pages frontend must **not** be reported as an application defect in this test cycle.

---

## 2. Current DEV architecture being tested

**GitHub Pages project-site note:** this repository is published as a GitHub Pages **project site**, so the repository name `Maintenix` is part of the public path. The correct CRA frontend is `https://mrclubbe-git.github.io/Maintenix/CRA/`. The repository Pages root `https://mrclubbe-git.github.io/Maintenix/` redirects into `CRA/`. The shorter `https://mrclubbe-git.github.io/CRA/` is not the Maintenix project site and may return GitHub's "There isn't a GitHub Pages site here" 404 page.

Current DEV traffic is approximately:

```text
Browser
  |
  | HTTPS
  v
GitHub Pages
https://mrclubbe-git.github.io/Maintenix/CRA/
  |
  | cross-origin HTTPS API requests
  | Secure/HttpOnly session cookie
  | credentials: include
  | CSRF token on authenticated writes
  v
CRA DEV API
https://dev-api.main-tenix.com/CRA
  |
  v
Existing maintenix-dev-api application service
```

This is deliberately still a development architecture.

The backend is the existing CRA DEV application service. **No temporary proxy service, header service, Cloudflare emulator, extra systemd unit or other infrastructure process should be created for testing.**

The tester should test the deployed application exactly as it currently operates.

---

## 3. Planned final Cloudflare architecture

The final production-facing Maintenix site is expected to be placed behind Cloudflare or an equivalent controlled edge/reverse-proxy layer.

That later architecture will be responsible for controls such as:

- final HTTP security response headers;
- `Content-Security-Policy` response-header enforcement, including `frame-ancestors 'none'`;
- `X-Frame-Options: DENY`;
- final HSTS policy;
- final TLS/edge policy;
- final reverse-proxy/origin routing;
- Cloudflare WAF or other approved edge filtering;
- any approved bot/rate-limit/edge protections;
- final DNS and origin exposure controls.

These are **migration/final-hosting requirements**, not missing DEV application services.

The current GitHub Pages build already contains application-side measures that are possible in this environment, including a restrictive CSP delivered by HTML meta policy, source-map removal and a client-side anti-frame fallback. Those should be tested for compatibility, but they do not replace the future Cloudflare response headers.

---

## 4. Items that must NOT be failed in this GitHub Pages test

The tester must **not** fail the current DEV release solely because any of the following are absent from the GitHub Pages HTTP response:

- `Content-Security-Policy: ... frame-ancestors 'none'` as an HTTP response header;
- `X-Frame-Options: DENY`;
- final production HSTS policy;
- final Cloudflare TLS/cipher configuration;
- Cloudflare WAF behaviour;
- Cloudflare bot protection;
- Cloudflare-managed rate limiting;
- final Cloudflare cache rules;
- final Cloudflare DNS/origin hiding;
- final Cloudflare tunnel/proxy routing.

These items should be recorded in the tester's report under **Deferred to Cloudflare / final hosting**, not under defects.

Do not create or request a temporary Linux service, proxy daemon, Nginx instance, header-injection process or scheduled task merely to simulate these items.

---

## 5. Items that ARE in scope on the current site

The following application behaviours are in scope and should be tested now:

- authentication and login;
- Secure/HttpOnly server session behaviour;
- removal of JavaScript-readable bearer authentication;
- logout and session invalidation;
- session invalidation after password/account/role changes;
- CSRF protection;
- application CORS/origin enforcement;
- controlled login failure throttling;
- Stock Control role permissions;
- private draft ownership/isolation;
- Administration -> System access control;
- removal of public server telemetry from Overview;
- mandatory signatures in Servicing and Call Out;
- backend image/signature validation;
- avatar replacement;
- Servicing and Call Out generation;
- Section Report generation and validation;
- report publication behaviour;
- report moderation and download access;
- notifications and device push where the browser/device supports them;
- Administration -> Areas;
- Standby mutations using synthetic data;
- checklist variants and feature branching;
- mobile layout and physical camera behaviour where devices are available;
- absence of production source maps;
- compatibility with the current CSP;
- client-side frame-deny fallback;
- general regression of the application after the security changes.

---

## 6. Tester safety rules

### 6.1 DEV only

Use the GitHub Pages CRA DEV site only:

```text
https://mrclubbe-git.github.io/Maintenix/CRA/
```

Do not perform any test against LIVE.

### 6.2 Use synthetic data

Where a test requires creating data, use clearly identifiable synthetic names, for example:

```text
SEC-TEST-AREA-001
SEC-TEST-STOCK-001
SEC-TEST-DRAFT-001
SEC-TEST-USER-001
```

Do not alter genuine operational records when an expendable test fixture can be used.

### 6.3 Use expendable users for destructive account tests

Role change, denial, password reset and deletion tests must be performed on dedicated test accounts.

Do not disable, delete or change the role of a real operational user.

### 6.4 No denial-of-service testing

Do not perform:

- flooding;
- uncontrolled concurrency;
- high-volume brute force;
- resource exhaustion;
- repeated large uploads intended to fill storage;
- destructive fuzzing;
- service restart/reboot tests unless separately authorised.

### 6.5 No infrastructure changes

The tester is not expected to:

- SSH to the server;
- create services;
- edit systemd;
- install Nginx;
- install Cloudflare components;
- alter DNS;
- change server environment variables;
- change backend files.

This cycle is browser/API acceptance testing of the deployed DEV application.

---

## 7. Recommended test accounts and browser setup

Where available, prepare these dedicated CRA DEV test users:

- one ADMIN;
- one L1;
- one L2;
- one L3;
- at least one additional ordinary test user for ownership/isolation testing;
- one expendable user for role/denial/deletion/session-revocation testing.

Do not place passwords in the test report.

Recommended browsers:

- current Chrome or Chromium;
- current Edge;
- Firefox;
- Safari where available;
- Android Chrome on a physical phone where available;
- iOS Safari on a physical iPhone where available.

Physical-device checks are particularly useful for:

- cross-origin cookie behaviour;
- camera capture;
- mobile layout;
- signatures;
- push notifications.

Record browser and OS versions in the test evidence.

---

# 8. Test execution

## A. Basic deployment and application smoke test

### A-01 — Frontend loads

**Steps**

1. Open the CRA DEV URL.
2. Hard-refresh the page.
3. Open browser Developer Tools.
4. Check Console and Network.

**Expected**

- page loads without a blank screen;
- Sign In renders normally;
- static files load from GitHub Pages;
- no repeated JavaScript exceptions;
- no CSP violation that breaks required application behaviour.

### A-02 — API connectivity

Sign in with a valid test account.

**Expected**

- frontend can communicate with `https://dev-api.main-tenix.com/CRA`;
- login completes normally;
- authenticated pages load;
- there is no endless login loop or CORS failure.

---

# 9. Authentication and session tests

## AUTH-01 — Normal login

Sign in with a valid approved CRA user.

**Expected**

- HTTP login succeeds;
- user reaches the application;
- correct user name/role is shown;
- refresh does not immediately lose the session.

## AUTH-02 — Session cookie security attributes

Use Developer Tools -> Application/Storage -> Cookies.

Find the Maintenix session cookie.

**Expected**

The authentication cookie should be:

- `HttpOnly`;
- `Secure`;
- `SameSite=None` for the current cross-origin GitHub Pages DEV arrangement;
- scoped appropriately to the API;
- not deliberately exposed to frontend JavaScript.

Do not fail the site because the final production cookie/origin shape will differ behind Cloudflare. The purpose here is to confirm the current DEV cross-origin cookie model works securely.

## AUTH-03 — No browser-stored bearer credential

Inspect:

- Local Storage;
- Session Storage;
- page JavaScript-accessible storage.

**Expected**

There must not be an active authentication bearer token stored for application use in Local Storage or Session Storage.

Normal non-secret preferences may still exist.

## AUTH-04 — Refresh/reopen session behaviour

1. Sign in.
2. Refresh.
3. Close the tab.
4. Open the site again in the same browser profile.

**Expected**

The existing valid server session may continue within its 48-hour validated-activity window. Closing/reopening the browser must not manufacture a new session without the existing Secure/HttpOnly cookie or a valid signed offline lease.

## AUTH-05 — Logout invalidates the active session

This is a critical remediation test.

Before logout:

1. In Developer Tools Network, select a successful authenticated request such as `/api/auth/me`.
2. Save enough information to replay the same authenticated request after logout. "Copy as cURL" is acceptable if available.
3. Log out normally.
4. Replay the pre-logout request.

**Expected**

- UI returns to Sign In;
- the old session is invalid immediately;
- replay of the previous authenticated session returns **401 Unauthorized**;
- the old cookie/session must not continue to work.

## AUTH-06 — Logout affects only the active session

1. Sign in as the same test user in Browser A.
2. Sign in separately in Browser B/incognito.
3. Log out from Browser A.
4. Continue using Browser B.

**Expected**

- Browser A session is invalidated;
- Browser B remains valid;
- logout is not an unintended "log out all devices" action.

## AUTH-07 — 48-hour validated-activity session window

The application policy is a **48-hour renewable session/inactivity window** coordinated with the signed offline lease.

At minimum:

- record the `expiresAt` value after login and confirm it is approximately 48 hours ahead;
- allow automatic sync/profile validation to run while connected and confirm the cookie/session expiry moves forward;
- confirm ordinary client-side timestamp edits alone cannot create a valid offline session;
- confirm a device that cannot successfully validate online for 48 hours can no longer continue protected offline workflows.

If a full-duration test is performed, an expired offline lease must require successful online validation/sign-in before protected operational work can continue.

## AUTH-07A — Signed offline lease

1. Sign in online.
2. Confirm the authentication/profile response includes an `offlineLease` object with an expiry about 48 hours ahead.
3. Load Servicing, Call Out and (as ADMIN) Section Reports once while online.
4. Disconnect the device/network.
5. Refresh/reopen Maintenix from the installed/cached application shell.
6. Confirm the same user can enter only while the stored lease verifies successfully.
7. Tamper with the stored token payload or signature in a disposable test browser profile.

**Expected**

- untampered lease permits the synchronized offline workflows until expiry;
- tampered/expired lease is rejected;
- the offline lease is never accepted as an API bearer credential;
- logout or a later server-side 401/403 does not silently fall back to an invalid local lease.

## AUTH-07B — Automatic reconnect synchronization

1. While offline, create a Servicing or Call Out draft locally.
2. For ADMIN, create or edit a Section Report draft locally.
3. Restore connectivity without manually pressing a sync button.
4. Keep Maintenix open or refocus the tab.

**Expected**

- automatic sync validates the server session;
- Areas/Servicing reference data refresh;
- ADMIN Section Report inventory refreshes;
- pending local drafts synchronize to their server draft folders;
- the successful sync renews the local 48-hour lease;
- server-only actions such as report generation remain blocked until connectivity is actually usable.

## AUTH-08 — Password change revokes prior session

Use an expendable user.

1. Sign in with the test user.
2. Change the user's password through the normal authorised flow.
3. Attempt to continue using the pre-change session.

**Expected**

The old session is invalidated and a fresh login is required.

## AUTH-09 — Role/status lifecycle revocation

Use an expendable user in one browser and ADMIN in another.

Test individually where the Administration UI permits:

- role change;
- denial/disable/suspension;
- deletion.

**Expected**

A role/status change that affects access invalidates the affected user's active server sessions. The affected browser should return cleanly to Sign In rather than remaining on a broken authenticated page.

Do not use operational accounts.

## AUTH-10 — Legacy Bearer authentication is not accepted

Where practical:

1. Capture the current session token from Developer Tools for test purposes.
2. Make a direct request **without the session cookie** but with:
   `Authorization: Bearer <token>`.

**Expected**

The request must not authenticate solely through the Bearer header.

This confirms that the old browser bearer-token mechanism has not silently remained active.

---

# 10. CSRF and origin protection

## CSRF-01 — Normal authenticated writes succeed

Perform harmless normal writes such as:

- save a user preference;
- rename a synthetic draft;
- update other expendable test data.

**Expected**

Normal frontend operations succeed.

## CSRF-02 — Missing CSRF token is rejected

Use Developer Tools request editing or another controlled HTTP client.

Replay an authenticated POST/PATCH/PUT/DELETE request while keeping the session cookie but removing the `X-CSRF-Token` header.

**Expected**

**403 Forbidden** with a clear CSRF-related response.

## CSRF-03 — Incorrect CSRF token is rejected

Replay an authenticated write with:

```text
X-CSRF-Token: deliberately-wrong
```

**Expected**

**403 Forbidden**.

## CSRF-04 — Disallowed Origin is rejected

If the tester is comfortable using cURL/Postman:

- use a valid authenticated test session;
- send an authenticated state-changing request with an Origin other than the approved CRA frontend origin.

Example conceptual Origin:

```text
https://example.invalid
```

**Expected**

**403 Forbidden**.

Do not perform cross-site attacks against third-party systems.

---

# 11. Controlled login throttling

## AUTH-RATE-01 — Failed-login threshold

This test should be performed with an expendable account and preferably near the end of the authentication test set because the temporary throttle window may affect subsequent login attempts for that account.

The default application policy is eight failed attempts within a 15-minute window unless the DEV environment has explicitly overridden it.

Perform controlled incorrect-password attempts, stopping as soon as rate limiting is observed.

**Expected**

At the configured threshold:

- response becomes **429 Too Many Requests**;
- `Retry-After` is returned;
- the application does not continue unlimited password attempts.

Do **not** continue hammering the endpoint after rate limiting is confirmed.

This test validates the application's own controlled login throttling. It does not test future Cloudflare edge rate limiting.

---

# 12. Stock Control permission matrix

The approved role matrix is:

| Stock action | L1 | L2 | L3 | ADMIN |
| --- | --- | --- | --- | --- |
| Create stock item | Allow | Allow | Allow | Allow |
| Receive stock | Deny | Deny | Allow | Allow |
| Issue stock | Deny | Allow | Allow | Allow |
| Edit stock metadata | Deny | Deny | Deny | Allow |
| Adjust stock quantity | Deny | Deny | Deny | Allow |
| View movement/audit history | Deny | Allow | Allow | Allow |

Use synthetic stock records.

For each role:

1. check that the UI exposes only permitted controls;
2. exercise the permitted control;
3. where practical, directly call a denied API operation to confirm the backend also rejects it.

**Pass requirement**

Frontend and backend must agree with the matrix. A hidden UI button alone is not sufficient if the API still allows the action.

---

# 13. Administration -> System / telemetry

## SYS-01 — Admin access

Sign in as ADMIN and open:

```text
Administration -> System
```

**Expected**

- server/application telemetry loads;
- the panel is read-only;
- no restart/service-control action is exposed.

## SYS-02 — Non-admin denial

Attempt to access the server-status endpoint as L1/L2/L3.

**Expected**

**403 Forbidden**.

## SYS-03 — Unauthenticated denial

Sign out and request the detailed status endpoint.

**Expected**

**401 Unauthorized**.

## SYS-04 — Overview cleanup

Open Overview.

**Expected**

The old detailed server telemetry tile is no longer shown there.

---

# 14. Mandatory signature tests

Mandatory signatures apply to both **Servicing** and **Call Out**.

## SIG-01 — Servicing cannot submit unsigned

Create an otherwise valid synthetic Servicing draft but do not sign.

**Expected**

- frontend blocks submission;
- signature requirement is clearly communicated.

## SIG-02 — Call Out cannot submit unsigned

Repeat for Call Out.

**Expected**

Submission is blocked.

## SIG-03 — Valid signature succeeds

Capture a normal technician signature and submit.

**Expected**

- draft/submission succeeds;
- generated report contains the signature image;
- no black placeholder or corrupt signature graphic is present.

## SIG-04 — Backend cannot be bypassed

If direct API testing is within tester capability, replay a valid submission while removing or corrupting the signature payload.

**Expected**

Backend rejects it. The UI rule must not be the only protection.

## SIG-05 — Tiny/placeholder signature rejected

Use a deliberately invalid tiny PNG or malformed signature only on synthetic test data.

**Expected**

Backend rejects it as invalid or too small.

---

# 15. Image and upload validation

The backend must inspect image contents instead of trusting filename extensions or browser MIME declarations.

## IMG-01 — Valid supported image

Upload a normal valid image through an applicable workflow.

**Expected**

Upload succeeds.

## IMG-02 — Non-image renamed to image extension

Create a harmless text file and rename it to `.jpg` or `.png`.

Attempt upload where a test upload is allowed.

**Expected**

Rejected. No partial file should remain as a valid upload.

## IMG-03 — MIME/content mismatch

Where the HTTP tool permits it, send valid/invalid bytes with an incorrect declared image MIME type.

**Expected**

Rejected.

## IMG-04 — Malformed image

Use a deliberately truncated/corrupt test image.

**Expected**

Rejected cleanly without application crash.

Do not perform large-scale upload fuzzing during this cycle.

---

# 16. Avatar acceptance

## AVATAR-01 — Replace avatar successfully

1. Upload a valid supported image.
2. Confirm the avatar changes.
3. Refresh.
4. Sign out and sign back in.

**Expected**

New avatar persists.

## AVATAR-02 — Replace avatar again

Replace it with a second valid image.

**Expected**

- second replacement works;
- no broken image reference appears.

## AVATAR-03 — Invalid avatar rejected

Attempt a clearly invalid/non-image test file.

**Expected**

Rejected by backend validation.

---

# 17. Section Report reliability

Formal/Section Reporting is ADMIN-controlled.

## SECTION-01 — Normal report generation

Create a synthetic valid report and generate the final output.

**Expected**

- generation succeeds;
- expected DOCX/PDF files are produced;
- files open correctly;
- no partial or obviously truncated final document appears.

## SECTION-02 — Long but valid compiler fields

Use realistic long values within the supported boundaries:

- Compiled By name: up to 120 characters;
- designation: up to 160 characters.

**Expected**

Report generation succeeds without "Compiled By section split across pages" or equivalent layout failure.

## SECTION-03 — Over-limit compiler name

Attempt more than 120 characters.

**Expected**

Clear validation error before successful publication.

## SECTION-04 — Over-limit compiler designation

Attempt more than 160 characters.

**Expected**

Clear validation error.

## SECTION-05 — No partial publication after rejected generation

After SECTION-03 / SECTION-04 or any naturally occurring failed generation, inspect Reports.

**Expected**

A failed/rejected generation must not appear as a completed report.

Do not intentionally damage server templates or stop the report worker merely to force an internal failure.

---

# 18. Draft ownership and isolation

Use two independent test users where possible.

## DRAFT-01 — User A private draft

User A saves a Servicing draft.

User B signs in.

**Expected**

User B cannot see User A's private draft.

## DRAFT-02 — Direct draft access

Capture User A's draft ID.

As User B, attempt direct read/update/rename/delete/generate access where technically possible.

**Expected**

User B must not obtain or mutate User A's private draft.

Use the same principle for Call Out and Formal/Section Report drafts where applicable.

---

# 19. Servicing regression

Use synthetic test records.

At minimum validate:

- clean Servicing submission;
- one Detection defect + photo;
- multiple defects/photos on one checklist item;
- one Suppression defect + photo;
- General YES with required picture evidence;
- signature;
- draft save/load;
- final generation;
- generated report accessible through Reports.

For multi-defect evidence, verify each defect remains paired with the correct picture/comment in the output.

---

# 20. Servicing checklist variants

The remediation acceptance should cover the supported cumulative intervals:

- Weekly;
- Monthly;
- 3-Monthly / Quarterly;
- Annual.

Verify cumulative behaviour:

- Weekly = Weekly;
- Monthly = Weekly + Monthly;
- Quarterly = Weekly + Monthly + Quarterly;
- Annual = Weekly + Monthly + Quarterly + Annual.

Recurring logical questions must not appear as duplicate checks merely because they occur at multiple frequencies. The higher-frequency wording may replace the lower-frequency wording while preserving Weekly-first ordering.

## SERV-ASD — Substation NFPA 72 ASD branch

Where applicable:

- ASD installed = Yes -> ASD questions included;
- ASD installed = No -> ASD-specific questions excluded.

Verify this in:

- checklist;
- Review;
- saved draft;
- generated report.

## SERV-LH — Conveyor NFPA 72 linear heat branch

Verify required selection:

- Fiber linear heat;
- Standard linear heat.

Expected:

- only the selected question variant is shown;
- draft/review/report contain the selected variant;
- wrong-variant questions do not leak into generated output.

---

# 21. Call Out regression

Test both major outcome paths.

## CALLOUT-01 — Defect resolved

**Expected**

Repair Evidence path appears and report generation completes.

## CALLOUT-02 — Defect not resolved

**Expected**

Repair Requirements path appears instead.

## CALLOUT-03 — Evidence capture

Use the current **Add picture** control.

Where a physical mobile device is available, confirm that evidence capture opens the camera-oriented flow.

## CALLOUT-04 — Multiple evidence images

Where supported by the scenario, confirm every image and comment remains correctly paired in the report.

---

# 22. Report access and moderation

Using appropriate test roles:

- confirm authorised Reports access;
- confirm report downloads work;
- confirm moderation actions follow role policy;
- confirm unauthorised users cannot perform restricted moderation actions;
- confirm generated DOCX/PDF/ZIP files open correctly where those outputs are available.

If corrections or regenerated bundles are tested, verify the corrected output replaces/publishes cleanly and does not mix stale files into the bundle.

---

# 23. Administration -> Areas

Use a temporary synthetic area.

Suggested name:

```text
SEC-TEST-AREA-001
```

Test:

1. creation through the normal user workflow where available;
2. area becomes usable without blocking work;
3. pending metadata appears for ADMIN;
4. ADMIN configures metadata;
5. section and F/First/G/Second values persist;
6. readback shows the saved values;
7. future applicable report mapping uses the configured metadata;
8. remove the synthetic fixture only through an approved normal process if deletion is supported and safe.

Do not alter genuine Area metadata to perform this test.

---

# 24. Standby mutation safety

Use an isolated synthetic Standby schedule.

Test:

- create;
- update;
- clear/delete where the UI supports it;
- unauthorised mutation attempt.

**Expected**

- only the intended synthetic schedule changes;
- unrelated schedules remain unchanged;
- failed/unauthorised mutation leaves existing data intact.

Do not use a populated operational schedule as the destructive test target.

---

# 25. Notifications and Web Push

## NOTIF-01 — Notification bell

**Expected**

Notification bell loads and normal in-app notifications appear.

## NOTIF-02 — In-app notification sound

Where enabled by user preference/browser permission, verify normal notification sound behaviour.

## NOTIF-03 — Device notifications

On a supported HTTPS browser/device:

1. enable Device notifications;
2. allow browser notification permission;
3. background/close the Web UI;
4. trigger an approved test notification.

**Expected**

Native push arrives and opens/focuses Maintenix when tapped.

GitHub Pages is HTTPS and can support the browser push service worker. If a specific browser/platform prevents the test, record the case as **Not Testable on that browser**, not automatically as an application defect.

## NOTIF-04 — Broadcast where test fixtures permit

If ADMIN/L3 broadcast functionality is available to the supplied tester role, use synthetic test recipients only and verify both in-app and subscribed-device delivery.

---

# 26. Mobile / physical device checks

The previous automated coverage used browser emulation, so physical-device testing is useful.

On at least one narrow phone viewport, check:

- Sign In;
- sidebar/navigation;
- Administration;
- Saved Drafts;
- Servicing;
- Call Out;
- Section Reports;
- Stock Control;
- Daily Planner;
- long IDs/names/errors;
- action button wrapping;
- no document-level horizontal overflow.

Where available, test:

- Android Chrome;
- iOS Safari.

For camera workflows, use an actual phone if possible.

---

# 27. Current CSP compatibility

The GitHub Pages deployment uses a CSP meta policy because the host does not allow arbitrary security response headers.

The tester should verify:

- application loads under the CSP;
- no required script is blocked;
- API requests still work;
- images and signatures still render;
- the single Maintenix service worker still supports Web Push and the offline application shell where supported;
- there are no unexpected CSP console violations that break a legitimate feature.

The tester should **not** expect `frame-ancestors` inside this meta policy because browsers require that directive to be delivered as an HTTP response header.

That part is deferred to Cloudflare.

---

# 28. Anti-framing behaviour on GitHub Pages

The production goal is:

```text
Content-Security-Policy: frame-ancestors 'none'
X-Frame-Options: DENY
```

Those headers are not available from the current GitHub Pages host.

For this DEV cycle only, the application contains a client-side fallback intended to prevent an interactive Maintenix UI from remaining usable in a third-party frame.

If the tester has a simple local test HTML page, Maintenix may be loaded in an iframe for an application-level check.

**Expected on current DEV**

The application should attempt to break out of framing or hide the framed UI rather than remain normally interactive.

**Do not report missing X-Frame-Options or frame-ancestors HTTP response headers as a current application defect.**

Final header enforcement will be retested after Cloudflare deployment.

---

# 29. Production source-map check

The deployed Web UI build must not publish JavaScript source maps.

Using Developer Tools / Network / Sources:

- inspect deployed JS bundles;
- check that `.map` files are not available for the production build;
- confirm the bundle does not rely on a downloadable production source map.

A missing source map is the expected result.

---

# 30. Recovery after ordinary interruption

Without restarting servers or altering infrastructure, test normal browser-side interruption:

1. begin editing a draft;
2. save it;
3. close/refresh the browser;
4. return;
5. load the saved draft.

Where asynchronous generation is used:

- submit/generate normally;
- navigate away and return;
- verify the resulting job/report remains consistent.

Do not kill workers or services to manufacture infrastructure failure in this cycle.

---

# 31. Tests to mark "Not Testable / Deferred"

Use one of these statuses rather than Fail when the current architecture cannot provide a meaningful test:

- **PASS**
- **FAIL**
- **NOT TESTABLE ON CURRENT DEV**
- **DEFERRED TO CLOUDFLARE**
- **BLOCKED BY TEST DATA / ACCOUNT**
- **NOT APPLICABLE**

Examples that should normally be **DEFERRED TO CLOUDFLARE**:

- `frame-ancestors 'none'` HTTP response header;
- `X-Frame-Options: DENY`;
- final HSTS edge policy;
- Cloudflare WAF;
- Cloudflare Bot Management;
- Cloudflare cache/routing controls;
- final TLS edge configuration;
- final origin hiding/tunnel policy.

---

# 32. Defect reporting format

For every FAIL, record:

**Test ID:**  
**Date/time:**  
**Browser / version:**  
**OS / device:**  
**User role:**  
**Page / URL:**  
**Synthetic test data used:**  
**Preconditions:**  
**Exact steps:**  
**Expected result:**  
**Actual result:**  
**HTTP status / endpoint if applicable:**  
**Console error if applicable:**  
**Network response if applicable:**  
**Screenshot/video:**  
**Can reproduce:** Always / Intermittent / Once  
**Severity:** Critical / High / Medium / Low  
**Notes:**

Do not include passwords, session cookies, CSRF tokens or other active credentials in screenshots or reports.

---

# 33. Severity guidance

## Critical

Examples:

- authentication bypass;
- user can act as another user;
- non-admin obtains ADMIN-only access;
- private draft/data exposure across users;
- direct API bypass of mandatory security boundaries;
- destructive data corruption affecting unrelated records.

## High

Examples:

- logout session remains reusable;
- CSRF protection can be bypassed;
- wrong Stock role can perform a restricted action;
- unsigned report can be submitted/generated;
- failed generation publishes a partial final report;
- upload validation accepts executable/non-image content as an image.

## Medium

Examples:

- valid workflow fails for one role/browser;
- report layout/content is materially incorrect;
- notification workflow is broken;
- mobile workflow cannot be completed.

## Low

Examples:

- cosmetic issue;
- minor wrapping issue;
- non-blocking console warning;
- wording issue.

A missing Cloudflare-only header on GitHub Pages is **not** a defect in this cycle.

---

# 34. Minimum release-blocking acceptance set

Before the current remediation is considered application-validated on DEV, the tester should at minimum obtain PASS for:

1. normal login;
2. Secure/HttpOnly cookie session;
3. no bearer credential in browser storage;
4. logout replay rejection;
5. normal CSRF-protected writes;
6. missing/wrong CSRF rejection;
7. account/password session revocation;
8. approved Stock role matrix;
9. ADMIN-only System telemetry;
10. mandatory Servicing signature;
11. mandatory Call Out signature;
12. invalid image rejection;
13. successful avatar replacement;
14. Servicing generation;
15. Call Out generation;
16. Section Report generation with long valid compiler/sign-off text;
17. over-limit report field validation;
18. no completed report published from a rejected/failed generation;
19. private draft isolation;
20. Reports access/moderation smoke test;
21. application works under current CSP;
22. deployed source maps are absent;
23. basic mobile regression;
24. no new application regression severe enough to prevent normal CRA use.

Cloudflare-only controls are excluded from this release-blocking list for the current GitHub Pages DEV cycle.

---

# 35. Tester deliverable

The tester should return one consolidated report containing:

1. **Executive summary**
   - overall result;
   - number of Pass / Fail / Deferred / Not Testable items;
   - any release-blocking defects.

2. **Environment**
   - tested URL;
   - browsers/devices;
   - tester roles used;
   - test date/time.

3. **Test matrix**
   - every executed Test ID;
   - result;
   - short evidence note.

4. **Defects**
   - detailed reproduction evidence using the format above.

5. **Deferred Cloudflare controls**
   - list them separately;
   - do not mix them into application defects.

6. **Residual acceptance gaps**
   - items that could not be exercised because an account, physical device or safe synthetic fixture was unavailable.

7. **Recommendation**
   - application suitable to continue;
   - application suitable with known defects;
   - remediation required before further acceptance.

---

## 36. Final testing principle

This test cycle answers:

> **Does the repaired Maintenix application behave securely and correctly on the current GitHub Pages + CRA DEV API environment, within the controls the application itself owns?**

It does **not** answer:

> **Is the final Cloudflare-hosted production architecture fully hardened?**

That second question will be answered during the later Cloudflare-hosted acceptance cycle, when the final response headers, TLS/edge controls, proxy behaviour and other infrastructure security can be tested in the environment that will actually provide them.
