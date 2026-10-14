# Maintenix Development — Project Context

> **Purpose:** This file is the persistent source of truth for critical Maintenix development context across ChatGPT project sessions.
>
> **Last updated:** 2026-10-14
>
> Future work should read this file before making architecture, workflow, report-template, or servicing changes.

## 1. Repository and development workflow

- GitHub repository: `mrclubbe-git/Maintenix`
- Default branch: `main`
- Application source is split into:
  - `Web_UI/` — React frontend
  - `Server_API/` — Node/Express backend
- Source changes should be version-controlled in GitHub rather than treated as one-off local edits.
- For significant changes, prefer a feature branch and pull request rather than direct edits to `main`.

### Current servicing implementation branch

- Branch: `feature/servicing-approved-template-v1`
- Draft PR: **#2 — Implement approved servicing checklist report structure**
- The branch contains the first backend mapping for the approved servicing checklist template structure.

## Frontend hosting and deployment

The Maintenix React UI is served from **GitHub Pages**, not from the development API server.

Live UI:

`https://mrclubbe-git.github.io/Maintenix/#/dashboard/overview`

Deployment workflow:

- Workflow: `.github/workflows/deploy-web-ui.yml`
- GitHub Pages deployment is triggered by pushes to the **`deploy` branch** when `Web_UI/**` changes.
- `main` remains the development/source-of-truth branch, but a frontend change on `main` is **not live** until the corresponding `Web_UI` change is synchronized to `deploy`.
- The GitHub Pages build uses `Web_UI/scripts/build-github.js` and currently targets the API base configured by `MAINTENIX_API_BASE_URL`, falling back to `https://dev-api.main-tenix.com`.
- When changing frontend behavior, update `main` first, then synchronize the required frontend files to `deploy` and verify the GitHub Pages workflow completes successfully.
- The React service worker can retain an older bundle temporarily; after a successful deployment, closing/reopening Maintenix tabs or reloading may be required before the new UI becomes active.

## 2. Server paths

The working API root on the development server is:

```text
/home/charl/projects/maintenix-dev-api/Server_API
```

The approved servicing checklist template path on that server is:

```text
/home/charl/projects/maintenix-dev-api/Server_API/data/templates/servicing_checklist_approved_v1.docx
```

Repository-relative equivalent:

```text
Server_API/data/templates/servicing_checklist_approved_v1.docx
```

Legacy servicing template:

```text
Server_API/data/templates/template.docx
```

On the current feature branch, the servicing route is designed to use the approved template when it exists and fall back to the legacy `template.docx` otherwise.

## 3. Important design rule for servicing reports

The MOIC report supplied during template design is a **formatting/style reference only**.

**Do not hard-code MOIC data, systems, areas, equipment, or client-specific content into the generic Maintenix servicing template.**

The current Maintenix servicing workflow and repository implementation are the source of truth for report data.

This was an important correction during the first template iteration and must be preserved in future work.

## 4. Current servicing workflow — source of truth

Primary files:

- `Web_UI/src/pages/Servicing.js`
- `Server_API/routes/servicing.js`
- `Server_API/lib/servicingGenerator.js`
- `Server_API/servicingWorker.js`
- `Server_API/data/templates/full_manual_checklist_questions.json`
- `Server_API/data/templates/conveyor_system_checklist_questions.json`
- `Server_API/data/templates/services.txt`
- `Server_API/data/templates/areas.txt`

### Checklist types

Current backend checklist mapping:

- `substation` → `full_manual_checklist_questions.json`
- `conveyor` → `conveyor_system_checklist_questions.json`

Default checklist type is currently `substation`.

### Service intervals

Current values in `services.txt`:

- Weekly
- Monthly
- 3-Monthly
- Annual

Frontend frequency normalization maps:

- Weekly → `weekly`
- Monthly → `monthly`
- 3-Monthly / quarterly variants → `quarterly`
- Annual / yearly → `annual`

Checklist intervals are cumulative:

- Weekly = weekly questions
- Monthly = weekly + monthly
- Quarterly = weekly + monthly + quarterly
- Annual = weekly + monthly + quarterly + annual

General questions are added separately from the checklist `general` section.

## 5. Servicing responses and defect rules

### Standards-based questions

Response options:

- PASS
- FAIL
- N/A

A FAIL is treated as a defect state.

### General questions

Response options:

- YES
- NO
- N/A

In the current application logic, **YES requires picture evidence**.

This behavior may appear semantically unusual for some General questions, but it is current application behavior and should not be silently changed while working on report generation.

### Defect completeness

For a defect response to be complete, current workflow expects:

- at least one defect entry
- each defect has a non-empty finding/comment
- each defect has picture evidence

The system already supports multiple defect entries against one checklist question.

## 6. Approved servicing report template — Draft V1

The first approved draft came from review version 5.

### Header

The report remains generic and dynamic. Key values include:

- Area
- Service interval
- Date completed
- Technician
- Report ID
- Frequency key
- Applicable standards
- Technician signature

Standards may appear in the report header but are **not required as a column in the findings tables**.

### Findings structure

The findings section is split into three sections:

1. **Detection**
2. **Suppression**
3. **General**

#### Detection table

Keep concise checklist values only:

- Item
- Inspection / Test
- Result / Response
- Reading / Recorded Value

Do **not** include:

- standard reference
- defect comment
- evidence picture

#### Suppression table

Same structure as Detection:

- Item
- Inspection / Test
- Result / Response
- Reading / Recorded Value

Do **not** include:

- standard reference
- defect comment
- evidence picture

#### General table

General is intentionally fuller because YES requires picture evidence.

Current approved structure includes:

- Item
- General Check
- Response
- Comment
- Picture Evidence

General evidence should remain directly beside the General item.

### Detailed Findings

Detection and Suppression defects are shown in a separate **Detailed Findings** table.

Approved column order:

1. **Picture**
2. **Related Item**
3. **Comment**

Critical data-model rule:

> **Each picture is treated as its own evidence object.**

If one checklist question has multiple defect pictures, the report should generate one Detailed Findings row per picture. Each row repeats the related checklist item and carries the comment associated with that picture.

This is intended to improve readability and allow each image/evidence record to be assessed independently.

General YES evidence is **not duplicated** into Detailed Findings.

## 7. Production template data contract

Current approved data arrays added on the feature branch:

- `detectionItems`
- `suppressionItems`
- `generalItems`
- `detailedFindings`

The legacy `items` array is intentionally still populated for backward compatibility.

### Detection item fields

Typical fields:

- `no`
- `question`
- `answer`
- `extra`

### Suppression item fields

Typical fields:

- `no`
- `question`
- `answer`
- `extra`

### General item fields

Typical fields:

- `no`
- `question`
- `answer`
- `comment`
- `photo`

### Detailed finding object

Each object represents one evidence picture:

- `photo`
- `relatedItem`
- `comment`

## 8. Current section mapping

The current feature-branch report mapping follows these rules:

- `General` standard → General section
- NFPA 2001 / ISO 14520 / labels containing suppression, extinguishing, or clean agent → Suppression section
- other non-General servicing standards → Detection section

This mapping is a report-generation concern and should remain isolated from checklist capture unless a future requirement explicitly changes the servicing data model.

## 9. DOCX generation implementation

Current generator:

```text
Server_API/lib/servicingGenerator.js
```

Libraries currently used:

- PizZip
- Docxtemplater
- docxtemplater-image-module-free
- image-size when available

Docxtemplater delimiters:

```text
<< ... >>
```

The generator currently:

- reads `payload.responses`
- validates required picture evidence
- saves signature images
- supports report photos
- generates DOCX output
- preserves report metadata
- keeps deterministic report naming behavior

Current deterministic filename pattern is based on:

```text
<area>_<service>_<date>_<last4>.docx
```

## 10. Report metadata and storage behavior

Servicing reports are generated under the backend report storage structure and include metadata such as:

- report ID
- area
- service
- technician
- creation date
- signature path
- photos
- owner/user information

The asynchronous servicing workflow persists payloads, status, and queue jobs so report generation can continue server-side.

Do not remove this fail-safe behavior while changing report layout.

## 11. Current production-template status

A production-ready DOCX based on Approved Draft V1 has been prepared with dynamic loops for:

- Detection
- Suppression
- General
- Detailed Findings

The expected repository/server filename is:

```text
servicing_checklist_approved_v1.docx
```

The feature branch already contains:

- backend mapping for the new arrays
- template fallback behavior
- a template-contract document:
  `Server_API/data/templates/SERVICING_CHECKLIST_APPROVED_V1.md`

### Outstanding implementation step

The approved binary DOCX still needs to be present at:

```text
Server_API/data/templates/servicing_checklist_approved_v1.docx
```

Once that binary template is in place, run an end-to-end generation test before merging the servicing-template PR.

## 12. Required end-to-end report tests

Before treating Approved Draft V1 as production-ready, test at least:

- clean report with no defects
- Detection defect with one photo
- Detection or Suppression item with multiple defects/photos
- Suppression defect with one photo
- General YES response with required picture evidence
- mixed report containing Detection, Suppression, General, and Detailed Findings
- signature rendering
- report filename and metadata persistence
- asynchronous queued report generation

For the multiple-photo case, verify that **each picture creates its own Detailed Findings row** and remains paired with the correct related item and comment.

## 13. Development guardrails

When making future servicing changes:

1. Inspect the current Maintenix workflow/code before designing new fields or report structures.
2. Do not derive business data from client/example reports.
3. Keep report presentation changes separate from capture/UI changes where possible.
4. Preserve backward compatibility unless a deliberate migration is agreed.
5. Do not change General YES/photo behavior unless explicitly requested.
6. Treat each defect evidence picture as an independent report object.
7. Keep the approved V1 template as a stable baseline; future visual revisions should use new version numbers rather than silently overwriting the approved design.
8. Validate generated DOCX output with realistic servicing scenarios before merging.

## 14. Other project context from earlier sessions

At project setup, Maintenix development was explicitly organized around the two primary directories:

```text
Web_UI
Server_API
```

The repository is intended to remain the version-controlled source of truth for application work.

Formal reporting also exists elsewhere in the repository, but the servicing checklist work documented here is specifically tied to the normal Servicing workflow and must not be conflated with the separate formal-reporting pipeline.

## 15. Context maintenance rule

Update this file whenever a session establishes a durable project fact such as:

- a new server path
- an approved template version
- a changed API contract
- a workflow decision
- a new branch/PR that becomes the active implementation
- a migration or backward-compatibility decision
- a production deployment convention

Avoid filling this document with temporary debugging details. It should remain a concise, durable handoff document for future Maintenix development sessions.


### General response evidence rules

The General checklist uses **YES / NO / N/A** responses with the following mandatory evidence rules:

- **YES** → a picture must be captured. A comment is not mandatory.
- **NO** → a comment is mandatory. A picture is not required.
- **N/A** → a comment is mandatory. A picture is not required.

The frontend must enforce these rules before Review/save/generation, and the server-side servicing generator must reject General NO/N/A responses without comments. General YES picture evidence remains in the General report table and must not be duplicated into Detailed Findings.

## 16. Approved Servicing Report V1 — verified baseline

As of 2026-10-07, the servicing report generated from the approved template has been confirmed to populate correctly and the current report version is accepted as the working baseline.

Accepted formatting details:

- Detection and Suppression use a narrow Item-number column with the recovered width added to Inspection / Test.
- General uses the same narrow Item-number column with the recovered width added to General Check.
- Detailed Findings follows General naturally; there is no forced page break before the section.
- Detailed Findings uses borders consistent with the other servicing tables.
- Detailed Findings remains Picture | Related Item | Comment, with one evidence picture per row.
- General evidence stays in the General table and is not duplicated into Detailed Findings.

The server template remains:

`/home/charl/projects/maintenix-dev-api/Server_API/data/templates/servicing_checklist_approved_v1.docx`

Treat this accepted version as the V1 formatting baseline for future servicing-report changes.


## Offline mode status — temporarily disabled

As of 2026-10-08, browser offline support is intentionally disabled until the overall site is complete.

Current decision:

- The React UI must operate online-only for now.
- Browser service-worker registration has been removed.
- The offline app-shell worker and recovery-worker build hooks/files have been removed.
- Offline sign-in/session support has been removed.
- The Settings offline-mode controls and offline-token notifications have been removed.
- Servicing and Call Out no longer permit offline save/generate workflows; an internet connection is required.
- A startup cleanup in `Web_UI/src/index.js` unregisters any legacy Maintenix browser service-worker registrations and clears Maintenix browser caches so previously installed workers stop controlling the GitHub Pages app.
- The normal server-side report workers (`Server_API/servicingWorker.js`, `Server_API/calloutWorker.js`) remain enabled because they are part of online report generation and are not browser offline workers.
- The current local IndexedDB-backed draft/job staging code may remain where required by the existing online workflow, but it must not be presented or used as an offline mode.

When the overall site is complete, offline functionality can be deliberately reintroduced as a separate project phase.


## Site-wide button standard

As of 2026-10-09, the compact button style from the Servicing **Saved Drafts** widget is the approved site-wide button baseline.

Global implementation lives in:

`Web_UI/src/scss/volt.scss`

Standard behavior:

- compact Bootstrap small-button sizing
- 14px / 0.875rem text
- bold button labels
- 0.25rem × 0.5rem padding
- 0.375rem corner radius
- consistent hover lift/shadow
- consistent active/selected press state
- consistent disabled behavior
- existing Bootstrap semantic variants remain the color source (primary, success, outline-secondary, outline-danger, etc.)
- icon-only controls retain compact zero-padding behavior while inheriting hover/active transitions

New UI work should use the existing Bootstrap button variants and rely on this global standard instead of creating page-specific button dimensions.


## Servicing workflow — Review submits draft

As of 2026-10-09, the Servicing UI uses a three-step user workflow:

1. Pre-Start
2. Checklist
3. Review

The old user-facing Final step is no longer used for manual actions.

On the Review screen:

- the former **Next** button is replaced by **Submit**
- pressing Submit captures the current signature (if drawn) and saves the servicing draft immediately
- a transient **Creating Draft** progress screen is shown while the draft is being prepared/saved
- once saving completes successfully, the workflow automatically returns to Pre-Start
- Saved Drafts remains the place where the user later presses **Generate** to queue report generation
- if draft creation fails, the UI returns to Review with the error instead of clearing the form

The transient draft-creation progress screen is implementation step 4 internally, but the user-facing workflow is presented as 3 steps.


## Call Out workflow — aligned with Servicing

As of 2026-10-09, the Call Out page follows the same user-flow pattern as Servicing.

User-facing steps:

1. **Call Details**
   - Area
   - System type
   - Time call logged
   - Call logged by
   - Client description of defect
2. **Attendance & Resolution**
   - Arrival/departure times
   - Responder defect description
   - Rectification result and conditional action/material fields
   - Jobcard decision and conditional jobcard/reason fields
   - Pictures
3. **Review**
   - Read-only summary of the completed call-out
   - Picture summary
   - **Submit** action

On Submit:

- the completed call-out is saved immediately as a draft
- a transient **Creating Draft** progress screen is shown
- after a successful save the form resets automatically to Call Details
- if saving fails, the form returns to Review without clearing the entered data

Saved Drafts now mirrors the Servicing pattern with:

- Load
- Generate
- Rename
- Delete

Report generation is initiated from the saved draft rather than directly from the active form.

The existing Call Out server-side queue/worker remains responsible for asynchronous report generation.


## Call Out attendance — sequential question flow

As of 2026-10-09, the Call Out **Attendance & Resolution** step is presented one question at a time instead of as one large form.

The sequence is:

1. Time of responder arrival
2. Responder description of defect
3. Could the defect be rectified?
   - YES -> Action taken is required
   - NO -> Equipment/material required is required
4. Time of responder departure
5. Was a jobcard created?
   - YES -> Jobcard number is required
   - NO -> Reason no jobcard was raised is required
6. Pictures

The attendance step shows:

- Question X of 6
- a small question progress bar
- Complete / Pending / Optional status badges
- Back and Next navigation between attendance questions
- Review replaces Next on the final attendance question
- Review Back returns to the final attendance question

Pictures and the responder defect description remain optional, matching the pre-existing Call Out validation rules.


## Call Out V2 baseline — cloned from Servicing

- As of 2026-10-09, the prior Call Out form/question UI has been replaced with a clean baseline cloned from the current Servicing page.
- `Web_UI/src/pages/CallOut.js` now mirrors the Servicing page structure and UX.
- User-facing flow is **Pre-Start → Checklist → Review → Submit**.
- Review Submit creates the draft immediately, shows the same transient draft-creation progress screen, then returns to Pre-Start.
- Saved Drafts mirrors Servicing with Load / Generate / Rename / Delete.
- Generate is intentionally disabled for new Call Out V2 drafts until the Call Out-specific question set and report payload mapping are defined.
- The Call Out V2 browser data is isolated in IndexedDB database `maintenix_callout_v2`.
- V2 draft keys use the prefix `callout_v2_draft_` and type `calloutV2Draft`.
- Existing/legacy Call Out drafts and jobs are not deleted or mixed into the V2 baseline UI.
- The clean baseline temporarily reads the existing Servicing areas/services/checklist APIs solely so the copied UI remains functional until Call Out-specific pre-start data/questions are defined.
- New server draft endpoints are provided under `/api/callout/drafts` and stored separately under `Server_API/data/callout-drafts-v2`.
- The existing Call Out report worker/generator remains unchanged. It will be reconnected after the new Call Out question schema is finalized.
- Servicing is not modified by this Call Out baseline rebuild.


## Shared global Area list

- As of 2026-10-11, Servicing and Call Out use one shared Area list rather than separate/copy lists.
- Canonical data remains `Server_API/data/templates/areas.txt` so existing area data is preserved in place.
- Shared API: `GET /api/areas` returns the global list and `POST /api/areas` adds an area.
- Duplicate prevention is case-insensitive and whitespace-normalized.
- `Web_UI/src/lib/globalAreas.js` is the shared frontend client used by both pages.
- Both Servicing and Call Out area pickers allow a logged-in user to add a typed area when there is no exact match in the list.
- The frontend GET temporarily falls back to legacy `GET /api/servicing/areas` if the shared route has not yet reached the API server; adding areas requires the new shared API route.

## Call Out Pre-Start

- Call Out Pre-Start now exposes only **Area**.
- System Type, Service Type, and Standards were removed from the Call Out Pre-Start UI and Review metadata.
- Temporary hidden baseline values remain internally only while the copied Servicing checklist is still being used as the next-edit starting point.


## API deployment compatibility — shared areas

- The live development API can lag behind GitHub `main`; a frontend deployment does not deploy `Server_API`.
- Shared Area reads now use the already-established `GET /api/servicing/areas` endpoint to avoid a 404 while the server catches up.
- Shared Area writes use `POST /api/servicing/areas` first and fall back to `POST /api/areas` for compatibility.
- `Server_API/routes/servicing.js` now implements `POST /areas`, writing to the same canonical `Server_API/data/templates/areas.txt` used by both Servicing and Call Out.
- If both add-area endpoints return 404, the UI reports that the API server update/restart is required instead of showing a generic failure.
- During the Call Out V2 baseline stage, Call Out draft operations use the isolated browser store only, so the UI does not repeatedly call an undeployed `/api/callout/drafts` route. Server draft sync will be re-enabled after the Call Out API/report mapping is finalized.


## Sign-in recovery and autofill hardening — 2026-10-11

- Root cause of the repeated 401 loop was a stale browser auth token after the API session store was reset/empty. The backend correctly returned 401; the frontend redirected to Sign In without clearing the rejected token, while Sign In trusted the same stored token and redirected back.
- `Web_UI/src/pages/HomePage.js` now clears `authToken` and `authUser` when `/api/profile/me` returns 401/403 before redirecting to Sign In. Network/API failures do not erase the stored session.
- `Web_UI/src/pages/examples/Signin.js` now validates an existing token with `/api/profile/me` before redirecting to Overview. Rejected stored tokens are cleared instead of being trusted from localStorage.
- Sign-in email/password controls are browser-autofill friendly: standard `name` and `autocomplete` attributes, uncontrolled DOM values backed by refs, and submit reads the actual DOM field values so password-manager/browser autofill is not lost when React state events are skipped.
- The login success message now says it is redirecting to Overview, matching the actual route.
- Deploy commit for these frontend fixes: `616bfa6c351ad319e95fde4608bdf6fa46635ef8`. GitHub Pages run: `38140934710` (must be verified successful before describing as live).


## Call Out Pre-Start cleanup — 2026-10-11

- Call Out Pre-Start is now Area-only. Removed copied Servicing Pre-Start state/data for Service Type, System Type and Standards from new Call Out drafts and reset/load flow.
- The shared Area selector remains the only Call Out Pre-Start field and is required. Users can search the global list or add a missing Area directly.
- `Web_UI/src/lib/globalAreas.js` now uses the canonical shared `/api/areas` GET/POST endpoints first, with `/api/servicing/areas` retained only as a 404 compatibility fallback. Servicing and Call Out both use this same helper/list.
- The temporary copied Servicing questionnaire is still loaded internally only as a baseline for the next development stage; it is no longer treated as Pre-Start configuration.
- Removed temporary Pre-Start/baseline readiness messaging from the Call Out Pre-Start card and cleaned the header wording.
- Main Call Out cleanup commit: `503cc9793f57e723e4e6bb3524970ee8f97a36cf`.
- Main shared Area API frontend commit: `4b5afae12ddd044395fec8d606221dee5ef8f5f0`.
- Deploy commit: `a020ac1fad028531d625a64a679abfdb22bb44b9`.
- GitHub Pages run: `38142377672` (verify completed success before describing this change as live).


## Call Out start timestamp — 2026-10-11

- Call Out Pre-Start remains Area-only.
- When the technician presses Next from Pre-Start for the first time, the frontend records the Call Out start timestamp using the technician/browser local date and time.
- Stored draft fields: `callOutStartAt` (offset-aware local timestamp), `callOutStartDate` (YYYY-MM-DD), and `callOutStartTime` (HH:mm:ss).
- Navigating back to Pre-Start and pressing Next again does not overwrite the original Call Out start timestamp. Starting/resetting a new Call Out clears it.
- Loading a draft restores these fields; older drafts without them capture a new start timestamp when Next is pressed.
- Review displays Call Out Start Date and Call Out Start Time.
- Main implementation commit: `215605cc56dea295ff35f3b0327f843234c21ec5`.
- Deploy commit: `4dd1dea6232c8a46ea555711133650d7e9a7cf6c`.
- GitHub Pages run: `38143796936` (verify completed success before describing this change as live).


## Call Out questionnaire v1 — 2026-10-11

- Replaced the temporary copied Servicing checklist on Call Out with a Call Out-specific sequential questionnaire.
- Question 1: `Is the system defective?`
  - Yes opens the camera immediately.
  - At least one picture is required.
  - Defect description is compulsory.
  - An `Add picture` button allows additional evidence pictures.
  - No currently completes Question 1 with no additional fields; extra No-path behavior will be added later.
- Question 2 is only reached when Question 1 = Yes: `Could the defect be resolved?`
  - Yes opens the camera immediately, requires at least one picture, and requires a description of what was done to repair the defect.
  - No requires at least one repair requirement. Users can add/remove multiple requirement entries with `Add another requirement`.
- Questionnaire is one question at a time. Back from Question 2 returns to Question 1; Back from Review returns to the last applicable question.
- Draft schema now stores `system_defective` and `defect_resolved` answers with comments, picture evidence and repair requirements. Old copied Servicing checklist data is no longer used for the Call Out questionnaire.
- Review shows the defect response, descriptions, picture counts, resolution response and repair requirements.
- Call Out still saves browser-backed drafts and report generation remains disabled until final Call Out report mapping is defined.
- Main implementation head: `cf938563280622fa073c4c035bdf215585745ac7`.
- Deploy commit: `9958ae4de9ef55d02e06d3b0e61249842076aec9`.
- GitHub Pages run: `38145545382` completed successfully, including deployment.


## Call Out picture comments — 2026-10-11

- Every picture added to the Call Out questionnaire now has its own compulsory comment.
- Applies to both defect evidence and repair evidence pictures.
- Picture objects now store `dataUrl`, `name`, and `comment` (with browser-only `file` while active).
- A Yes answer that requires picture evidence is not complete until at least one picture exists, the question-level description is complete, and every picture has a non-empty picture comment.
- Each picture card shows its own required `Picture comment` textarea.
- Review displays every picture and its associated comment text by picture number.
- Draft serialization preserves each picture comment. Older drafts with pictures but no picture comments become incomplete until comments are added.
- Main commit: `6fadffcf6be842c7134c3c0046d4e87ea6c8d0da`.
- Deploy commit: `bc0c970d5db47cf6cfc9a7119cf1fd2ffc1ed7ce`.
- GitHub Pages run: `38146279974` (verify completed success before describing as live).


## Call Out defect description removal — 2026-10-11

- Question 1 `Is the system defective?` no longer has or requires a separate overall Defect description field.
- When Question 1 = Yes, completion now requires at least one picture and a compulsory comment on every picture.
- Question 2 `Could the defect be resolved?` keeps its overall Repair description requirement when Yes is selected, in addition to compulsory comments on every repair picture.
- Review for Question 1 now relies on the per-picture comments instead of a separate defect description.
- Main commit: `3a6adee8680720b6181806dab85e2e686a938115`.
- Deploy commit: `80c67b196be5929352e27afefec5c0f9bdf012ac`.
- GitHub Pages run: `38146661534` (verify completed success before describing as live).


## Call Out report template Draft V2 — 2026-10-11

- Based on the approved Servicing report presentation and the Call Out Draft V1 template.
- Completion date/time is now captured by the frontend at the instant Submit is pressed and stored in the draft as `callOutCompletedAt`, `callOutCompletedDate`, and `callOutCompletedTime`.
- Main frontend commit: `2b52984c605c51e9ab6cc63578b75273efe3eb38`.
- Deploy commit: `2126f83cc2143be2c45d06c65c55d31cfd658368`. GitHub Pages run `38153592164` must complete successfully before describing the frontend change as live.
- Draft V2 template file generated at `/mnt/data/call_out_report_template_draft_v2.docx` for review; it is not yet wired into the Call Out worker.
- Template metadata and sign-off use `<<callOutCompletedDate>> <<callOutCompletedTime>>`.
- Repair outcome sections are mutually exclusive using template booleans: `<<#repairResolved>>...<</repairResolved>>` for Repair Evidence and `<<#repairOutstanding>>...<</repairOutstanding>>` for Repair Requirements. The generator must set exactly one of these true when Question 2 is answered; if Question 2 is not applicable, both should be false.
- The Questionnaire Summary uses `<<resolutionSummary>>` so the generator can provide outcome-specific supporting detail.
- Both resolved and outstanding visual variants were rendered and checked successfully.


## Call Out report generator integration — 2026-10-11

- Backend `Server_API/calloutWorker.js` is now mapped to the current Call Out Draft V2 report template fields and conditional sections.
- Main backend commit: `64b356a4d85da05a4082deda460c587bd4712ad9`.
- The worker validates and maps: Area, technician, start date/time, Submit completion date/time, system-defective outcome, defect pictures with per-picture comments, repair outcome, repair description, repair pictures with per-picture comments, unresolved repair requirements, and signature.
- Template conditionals are mutually exclusive: `repairResolved` drives Repair Evidence; `repairOutstanding` drives Repair Requirements; both are false when no defect was reported.
- The worker writes the signature image into the report photo folder for template embedding, generates the DOCX into `data/uploads/reports`, and updates Call Out status/report metadata.
- No `routes/callout.js`, package.json, or package-lock replacement is required for this generator update.
- Frontend Generate mapping is staged on main in commit `852cc23c93a7623e1a7421bc87466c426d5bf3bb`, but has NOT been synced to `deploy` yet. Do not describe Generate as live until the server worker is installed and the Pages deploy is verified successful.
- Backend deployment ZIP created for the user: `/mnt/data/Maintenix_CallOut_Backend_Generator_Update_2026-10-11.zip`. It contains only `Server_API/calloutWorker.js`, placement/restart instructions, and SHA256.
- Required server destination: `/home/charl/projects/maintenix-dev-api/Server_API/calloutWorker.js`.
- Required template path remains: `/home/charl/projects/maintenix-dev-api/Server_API/data/templates/call_out_template.docx`.


## Call Out frontend Generate deployment — 2026-10-11

- Call Out V2 Generate support from main commit `852cc23c93a7623e1a7421bc87466c426d5bf3bb` has been synchronized to the `deploy` branch.
- Deploy commit: `76c9f5c5118c8b18eeb8846c6e6c89d87490c15a`.
- `Web_UI/src/pages/CallOut.js` on `deploy` now matches the current main blob `ade0a2b14882bed99b6d70e0403409e626f7aa5d`.
- The GitHub Pages workflow is triggered by this `deploy` branch Web_UI change. Do not treat end-to-end Call Out generation as verified until the backend Call Out worker/template are installed and a real generation succeeds.


## Call Out image embedding fix — 2026-10-11

- First live Call Out report tests populated questionnaire text correctly but rendered blank picture cells and printed the signature filename as text instead of embedding images.
- Root cause: the deployed Draft V2 template uses ordinary `<<photo>>` / `<<signature>>` placeholders while `docxtemplater-image-module-free` requires image tags `<<%photo>>` / `<<%signature>>`.
- Backend fix commit: `0b96604fdf0f075375cae6e66929283cbfea221d`.
- `Server_API/calloutWorker.js` now upgrades the legacy plain image tags to image-module tags in the template ZIP at generation time, so the existing `call_out_template.docx` does not need to be replaced solely for this issue.
- The worker now rejects missing/invalid technician signatures instead of silently writing a transparent placeholder, requires the DOCX image module, and fails explicitly when a referenced report image is missing on disk.
- Backend must be updated/restarted with this worker commit before retesting Call Out report generation.

## Report image aspect-ratio fix — 2026-10-12

- Confirmed root cause of image-less generated reports on the development backend: the `maintenix-dev` systemd service user could not load `docxtemplater-image-module-free` because its `xmldom` dependency was not resolvable/readable from the mixed-ownership `node_modules` tree. Rebuilding dependencies with `npm ci` as `maintenix-dev` restored module loading.
- Call Out and Servicing report generators were then updated to resolve the callable exported by `image-size` v2 through `imageSize` (while retaining compatibility with callable/default export shapes).
- The existing `getSize` logic now receives each image's real width/height and scales it proportionally inside the existing report-cell bounds, preserving aspect ratio without cropping or distortion.
- Call Out generator commit: `d7c5fb4fdfdf81ad08ed382f2a2c39c76f78dea0` (`Server_API/calloutWorker.js`).
- Servicing generator commit: `3aff5924afe2f5a344a603714468ece5c04eaa52` (`Server_API/lib/servicingGenerator.js`).
- Server destinations remain:
  - `/home/charl/projects/maintenix-dev-api/Server_API/calloutWorker.js`
  - `/home/charl/projects/maintenix-dev-api/Server_API/lib/servicingGenerator.js`
- Restart `maintenix-dev-api.service` after installing either backend file so the long-running workers load the updated generator code.

## Call Out Question 1 NO workflow — 2026-10-12

- Call Out Question 1 ("Is the system defective?") now has a complete NO branch.
- Selecting NO opens a compulsory comment field and focuses it automatically.
- Question 1 is only complete for NO when that comment contains text.
- Pressing Next after a valid Question 1 response now always advances to Question 2, regardless of whether Question 1 was YES or NO.
- Question 2 is always included in progress counts, draft validation, Review, and Back navigation.
- Review shows the compulsory Question 1 NO comment.
- Question 1 YES behavior is unchanged: at least one picture is required and every picture requires a comment.
- Main frontend commit: `7c53123d90b2eae1dcf601a533b7b69b4aee67d8`.
- Deploy frontend commit: `6159919d3615c77ffac88d411e042ec397c57fbd`.
- This change is frontend-only; no `Server_API` files were modified.

## Servicing and Call Out functional milestone complete — 2026-10-12

- User confirmed the current functional development scope for both the Servicing page and Call Out page is complete.
- Servicing report generation is operational with embedded photos/signatures and proportional image scaling.
- Call Out report generation is operational with embedded photos/signatures and proportional image scaling.
- Call Out Question 1 supports both YES and NO workflows; NO requires a compulsory comment and still proceeds to Question 2.
- The current Servicing and Call Out implementations should now be treated as the completed baseline for future development unless a new change request explicitly revisits them.

## Cross-browser per-user draft storage — 2026-10-12

- Draft persistence is being standardized so a signed-in user can access their own drafts across browsers/sessions for Servicing, Call Out, and Section Reports.
- Servicing already had server-backed per-user drafts under `Server_API/data/servicing-drafts/<userKey>/` with IndexedDB as a browser mirror/fallback. No Servicing code change was required in this step.
- Call Out frontend now uses its existing authenticated server draft API as the primary online source while retaining IndexedDB as a local mirror/fallback. Save, list, load, rename, delete, and Generate-from-draft now work with server-backed drafts. Main commit: `36ec855c404e2aa13d5cd9f8fffa86f771048bcd`. Deploy commit: `725d69e262bb52b782acd095b676cd1cc246d71f`.
- Call Out server draft endpoints remain under `/api/callout/drafts` and store per-user JSON under `Server_API/data/callout-drafts-v2/<userKey>/`.
- Section Reports already used server drafts, but the draft folder was global. `Server_API/routes/formalReports.js` now scopes drafts by authenticated user under `Server_API/data/formal-reporting/drafts/<userKey>/`, prevents one user from listing/loading/renaming/deleting another user's draft, and migrates legacy root-level drafts when their existing `savedBy` matches the current user.
- Section Reports backend commit: `97a1bd609cd8048dc835549e5a6b596e3fbe51b4`.
- Section Reports is still ADMIN-only; per-user scoping therefore currently isolates drafts between Admin accounts.
- The development server must receive the updated `Server_API/routes/formalReports.js` and restart `maintenix-dev-api.service` before Section Reports cross-browser draft isolation is active.

## Cross-browser draft validation complete — 2026-10-12

- User confirmed cross-browser draft access is working.
- The per-user server-backed draft model is now validated for the current development workflow.
- Servicing and Call Out drafts can be resumed from another browser/session when the same user account is used.
- Section Reports retains per-user server scoping introduced in `Server_API/routes/formalReports.js`.
- This cross-browser draft behavior should be treated as the new baseline for future draft-related development.

## Persistent Overview presence / last seen — 2026-10-12

- User requested that Overview "Last seen" survive API restarts without writing heartbeat activity into critical user account/password storage.
- `Server_API/routes/presence.js` now stores durable last-seen timestamps in the separate file `Server_API/data/presence.json`.
- The API keeps current-process heartbeats in memory for Online status. After any API restart the in-memory map starts empty, so users are correctly shown Offline until a fresh heartbeat arrives; persisted `lastSeenAt` remains available immediately.
- Durable presence writes are throttled to at most once every 60 seconds per user and use the existing locked/atomic JSON helpers. `users.json` is not modified by presence tracking.
- Backend presence commit: `897a957a200dd04632e00f2eb49339c0fed575b7`.
- A global presence heartbeat was already mounted in `Web_UI/src/index.js`, so logged-in users are tracked while using any Maintenix page, not only Overview.
- `Web_UI/src/pages/dashboard/DashboardOverview.js` no longer sends its own duplicate heartbeat; it only polls the presence list. Main frontend commit: `f6e0fd5d0e9bb8ffbd0cb11635897a88a24bf7ef`.
- Deploy frontend commit: `476b28fc09300d3c90e5f171aa8f6ad4059881c4`.
- Deploy the updated backend file to `/home/charl/projects/maintenix-dev-api/Server_API/routes/presence.js` and restart `maintenix-dev-api.service`.

## Persistent presence validation complete — 2026-10-12

- User confirmed the persistent Overview presence / Last Seen implementation passed testing.
- `Server_API/data/presence.json` now provides durable `lastSeenAt` across API restarts.
- Online status remains transient and is correctly rebuilt from fresh heartbeats after restart.
- Presence tracking does not modify `users.json`.
- This behavior is now the accepted baseline for Overview user activity tracking.

## Overview approval controls removed — 2026-10-12

- The Overview page no longer contains the Pending approvals / Users online toggle.
- Pending-user approval UI, polling, and Approve/Decline actions were removed from `Web_UI/src/pages/dashboard/DashboardOverview.js`.
- Overview now always shows the Users Online / Last Seen presence table next to Server Info.
- User approval will be moved to a dedicated Admin page in a future change.
- Main frontend commit: `58710c150a90221212cf0888ed90002201632ca3`.
- This frontend change has not been pushed to the `deploy` branch yet.

## Overview page baseline complete — 2026-10-12

- User confirmed the current Overview page work is complete for this stage.
- Overview now includes Server Info and persistent Users Online / Last Seen activity.
- Last Seen survives API restarts via `Server_API/data/presence.json`; Online status remains transient and heartbeat-driven.
- Pending approval controls have been removed from Overview. User approval will be handled on a dedicated Admin page in a future development stage.
- Treat the current Overview implementation as the completed baseline unless the user explicitly revisits it.

## CRA organization-instance frontend foundation — 2026-10-12

- Maintenix is moving toward fully separate organization instances rather than multi-tenant shared application behavior.
- CRA (Collaborative Risk Applications) is the first organization instance and remains the reference implementation.
- Development frontend URL is now built for `https://mrclubbe-git.github.io/Maintenix/CRA/`.
- The GitHub Pages workflow assembles CRA under `/CRA/` and leaves a root redirect from `/Maintenix/` to `/Maintenix/CRA/`, preserving the existing hash route when possible.
- CRA frontend API base is now `https://dev-api.main-tenix.com/CRA`, controlled by repository variable `MAINTENIX_CRA_API_BASE_URL`.
- CRA organization build settings use `REACT_APP_ORGANIZATION_CODE=CRA` and `REACT_APP_ORGANIZATION_NAME=Collaborative Risk Applications`.
- Added `Web_UI/src/config/organization.js` as the frontend organization boundary.
- Browser local/session storage is organization-scoped using the `maintenix:CRA:` prefix. Known legacy CRA values (auth token/user, settings visibility, notifications) migrate automatically once from the old unscoped keys.
- IndexedDB access now goes through `organizationDbName(...)`. CRA deliberately retains its historical DB names to preserve existing queued jobs/cache; future organizations will receive distinct organization-suffixed DB names.
- Existing CRA pages and functionality remain unchanged apart from organization scoping and deployment path/API routing.
- Main frontend organization foundation begins at commit `bea038304cd35b5dc32c5a89a484cc8aaddabc17`; final CRA deployment commit on `deploy` is `ba452b6d562aa9293b8ec7114d5215a273859b0e`.
- GitHub Actions run `38235783216` completed successfully for both build and deploy.
- Backend is not yet changed for the CRA URL prefix. The next server step is to expose the existing DEV CRA API instance (127.0.0.1:5056) beneath `https://dev-api.main-tenix.com/CRA/api/` and CRA uploads beneath `https://dev-api.main-tenix.com/CRA/uploads/`, without touching production.
- Future organizations should have independent frontend builds, API processes/services, users, data, uploads, templates, and business logic. No cross-organization authentication or data access is intended.

## DEV CRA API routing correction — 2026-10-12

- Development API traffic does NOT use Nginx.
- `dev-api.main-tenix.com` is carried by Cloudflare Tunnel directly to the private development API at `127.0.0.1:5056`.
- A Cloudflare Transform Rule runs before the request enters the tunnel and rewrites organization-prefixed CRA paths internally:
  - `/CRA/api/...` -> `/api/...`
  - `/CRA/uploads/...` -> `/uploads/...`
- The browser retains the CRA-prefixed public URL while the existing Node API continues receiving its original routes unchanged.
- Correct DEV request flow: Cloudflare edge rewrite -> existing Cloudflare Tunnel -> existing CRA dev API on `127.0.0.1:5056`.
- No Nginx changes are required for the CRA DEV migration.
- No Node route changes are required for this CRA DEV URL-prefix migration.
- Production remains separate and must not be modified.
- Previous Nginx-based CRA backend migration instructions are obsolete and must not be followed.

## CRA DEV routing validation — 2026-10-12

- User validated the CRA development API path through Cloudflare.
- `maintenix-dev-api.service` is active and the API listens privately on `127.0.0.1:5056`.
- Public CRA-prefixed health check succeeded:
  - `https://dev-api.main-tenix.com/CRA/api/health`
  - HTTP 200
  - response `{"ok":true}`
- This confirms the intended DEV request flow is working:
  Cloudflare Transform Rule -> Cloudflare Tunnel -> `127.0.0.1:5056` -> existing CRA Node routes.
- No Nginx or Node routing change is required for the CRA DEV URL prefix.

## CRA frontend path/data validation — 2026-10-12

- User confirmed the CRA development frontend correctly redirects to `https://mrclubbe-git.github.io/Maintenix/CRA/#/dashboard/overview`.
- Existing CRA data appears available after the move to the organization-specific frontend path.
- Combined with the previously validated CRA-prefixed API health check, the CRA organization-instance migration is functioning correctly at the routing and existing-data level.
- Continue using `/Maintenix/CRA/` for CRA development frontend access.

## CRA organization migration fully validated — 2026-10-12

- User confirmed all CRA functional checks pass after migration to `/Maintenix/CRA/`.
- Current CRA DEV backend remains physically at `/home/charl/projects/maintenix-dev-api/Server_API`; there is no required `CRA/` subdirectory inside `Server_API`.
- The current DEV backend instance itself is treated as the CRA instance. Organization separation is provided by the frontend path, Cloudflare edge rewrite, dedicated API process/port, and the backend instance's own users/data/templates.
- A future organization should use a separate sibling backend instance/directory and service (for example a separate TEST instance on another port), not share CRA's `Server_API/data`.
- Renaming the existing CRA backend directory/service to explicitly include CRA is optional cleanup and not required for functional isolation.

## CRA backend repository path split — 2026-10-12

- User chose to make the CRA backend organization boundary explicit in the repository and development server filesystem.
- All tracked CRA backend files were moved from `Server_API/*` to `Server_API/CRA/*`.
- Repository move commit: `afbb94960a1b5d7dc55a4bcd5797b65502ad1895`.
- `Web_UI/package.json` local API helper now targets `../Server_API/CRA`; commit `817c44ac11337250fa33f0f4cbfe2d0eefa65239`.
- Target DEV filesystem path is `/home/charl/projects/maintenix-dev-api/Server_API/CRA/`.
- The entire existing live DEV `Server_API` directory, including runtime data/uploads/untracked state, should be moved intact into the new `CRA` directory rather than reconstructed from Git, so CRA data is preserved.
- `maintenix-dev-api.service` may keep its current service name, but its WorkingDirectory must change to `/home/charl/projects/maintenix-dev-api/Server_API/CRA`.
- The API/worker code itself uses relative paths/`__dirname`, so no Node route or data-path code change is required when the whole backend directory is moved intact.
- Cloudflare routing remains unchanged: CRA public requests are rewritten at the edge and tunneled to `127.0.0.1:5056`.
- Production remains separate and must not be modified.

## CRA backend directory migration completed — 2026-10-12

- User reported the CRA backend filesystem/service-path migration completed.
- CRA DEV backend target path is now `/home/charl/projects/maintenix-dev-api/Server_API/CRA/`.
- This aligns the live DEV backend layout with the repository structure under `Server_API/CRA/`.
- Existing CRA Cloudflare routing remains unchanged: public `/CRA/` requests are rewritten at the edge and tunneled to the CRA DEV API on `127.0.0.1:5056`.
- Production remains separate and untouched.

## CRA 8-hour authentication expiry — 2026-10-12

- User selected an absolute 8-hour login lifetime for CRA.
- This is a maximum session age from login, not an inactivity/sliding timeout.
- Frontend implementation is committed on `main` but has NOT been deployed to `deploy` yet.
- Frontend organization config now defines an 8-hour auth TTL and stores `authExpiresAt` alongside the CRA token/user.
- Sign-in stores the backend-provided `expiresAt` when available, otherwise falls back to 8 hours from login.
- Protected routes enforce the expiry with a timer and clear CRA auth when the deadline is reached.
- Explicit logout/password-reset flows clear `authExpiresAt` as well as token/user.
- Relevant frontend commits:
  - `55d560c985cc6c1162360bff84fe2d315e486d2d` — auth expiry helpers
  - `07711ad44445ea888fb9669daf3f83557174a39e` — sign-in expiry handling
  - `a335e4f7f8cfa80d78bba71721fdffec82953f27` — protected-route expiry timer
  - `91baaa057abddbbd9f486ddb144f5ad0d42600fa`, `afaa4917655df34142820c3bcc8433d50dbe6857`, `26f4766bc3ccf2f54cfac50c83aa5bb072c87cdf` — logout/reset cleanup
- Backend remains authoritative and must be changed by Annie:
  - `Server_API/CRA/lib/sessions.js`: reduce fixed TTL from 30 days to 8 hours while keeping expiry based on `createdAt`.
  - `Server_API/CRA/routes/auth.js`: return the exact session `expiresAt` in successful login responses.
- Annie instruction artifact created as `Annie_CRA_8_hour_session_expiry.txt`.
- CRA DEV backend restart is required after Annie's backend file changes.
- Production must remain untouched.

## CRA 8-hour authentication expiry — 2026-10-12

- User selected an absolute 8-hour login/session lifetime for CRA (not an inactivity/sliding timeout).
- Frontend now stores and enforces an organization-scoped auth expiry and clears CRA auth when the expiry is reached.
- Frontend login consumes backend `expiresAt` when supplied; legacy sessions without that key receive an 8-hour client-side ceiling.
- Logout/password-reset auth cleanup also removes the stored expiry.
- Frontend deployment commit: `8381d51da905e13d4fd2634d5f5e3e13144e7425`.
- GitHub Actions run `38251213987` completed successfully for both build and deploy.
- User reported Annie completed the corresponding CRA DEV backend change.
- Intended backend behavior: `SESSION_TTL_MS = 8 hours`, expiry remains based on original `createdAt`, and successful login returns an `expiresAt` millisecond timestamp.
- Important version-control note: at the time of this record, GitHub `main` still shows the pre-change 30-day TTL in `Server_API/CRA/lib/sessions.js` and no `expiresAt` login response in `Server_API/CRA/routes/auth.js`. The live Annie change therefore needs to be reconciled back into GitHub before the backend source of record is considered synchronized.

## CRA 8-hour backend files synchronized to GitHub — 2026-10-12

- User supplied the tested CRA backend files for the 8-hour authentication change as `Maintenix_CRA_8_hour_session_updates_2026-10-12.tar.gz`.
- Archive contained exactly:
  - `lib/sessions.js`
  - `routes/auth.js`
- Both uploaded files passed `node --check`.
- Uploaded `sessions.js` SHA256: `736dae0495564a359c5ed5ebf50694be08d3c156ce6e489261eddce427f46845`.
- Uploaded `auth.js` SHA256: `1bd3e57631da75a280d4033b43db9f1cb164387f440a4376bab397dd1e25183c`.
- GitHub `main` was synchronized to the tested backend behavior:
  - `Server_API/CRA/lib/sessions.js` commit `21cd38779f059dce25764a6151914769a1f163d8`
  - `Server_API/CRA/routes/auth.js` commit `8380da76221edfe63c1e27d7fe8d9b2b7b874966`
- Verified on GitHub main:
  - `SESSION_TTL_MS = 1000 * 60 * 60 * 8`
  - expiry remains based on `createdAt`
  - `getSessionExpiresAt()` returns `createdAt + SESSION_TTL_MS`
  - successful login includes `expiresAt`
- Backend source of record is now aligned with the live CRA DEV 8-hour session implementation.

## CRA Settings refocus — 2026-10-12

- User approved refocusing Settings as a personal user page and moving administrator functions to a separate Administration page later.
- `Web_UI/src/pages/Settings.js` was updated on `main`.
- Main commit: `f04e181ce18c3622b94ef8af8a2d2a4fa11edc15`.
- Settings page heading is now `My Settings`.
- Current Settings content is intentionally limited to:
  - profile photo
  - editable name
  - read-only email
  - read-only organization identity
  - read-only role
  - read-only account status
  - Security card showing the configured absolute session duration
  - Change password
  - Sign out now
- The session duration display derives from `AUTH_SESSION_TTL_MS` so it stays aligned with the CRA 8-hour frontend auth ceiling.
- The previous Admin-only User Management widget was removed from Settings. Admin user-management functionality is intended to move to a dedicated Administration page in a subsequent change.
- The browser-side profile image size check was corrected to 2 MB to match the Settings UI/backend expectation.
- No backend changes are required for this Settings revision.
- This frontend change is committed to `main` only and has NOT been pushed to the `deploy` branch yet.

## CRA Settings deployed — 2026-10-12

- User explicitly requested deployment of the refocused CRA Settings page.
- Deploy branch commit: `f4a284f40e0878c16ecf5d50d65d4f7ddd43675b`.
- GitHub Actions run `38253962326` completed successfully for both build and deploy.
- Live CRA Settings now contains personal Profile and Security functionality only; Admin User Management remains removed pending a dedicated Administration page.

## CRA Settings session expiry countdown — 2026-10-12

- User requested the static session-duration display be replaced with a live session-expiry countdown.
- `Web_UI/src/pages/Settings.js` now reads the organization-scoped auth expiry via `ensureOrgAuthExpiresAt()` and updates the remaining time once per second.
- The Security card now displays: `Your session will expire in HH:MM` with a tabular-numeric countdown.
- Countdown format uses hours and minutes only; expiry enforcement remains handled by the existing CRA auth/session logic.
- Frontend main commit: `3e10d26228df0e3b2fa3d2ad2e538687c771d25e`.
- No backend change is required.
- This change is on `main` only and has NOT been deployed yet.

## CRA session expiry countdown deployed — 2026-10-12

- User explicitly requested deployment of the live session-expiry countdown on the CRA Settings page.
- Deploy branch commit: `975c2071d839946aabac9c709f4b89fb9ea249ae`.
- GitHub Actions run `38254608994` completed successfully for both build and deploy.
- Live CRA Settings now shows a dynamic `Your session will expire in HH:MM` countdown sourced from the organization-scoped auth expiry timestamp.
- No backend changes were required for this display enhancement.

## CRA Settings session countdown visual cleanup — 2026-10-12

- User confirmed the live session-expiry countdown works but noted the countdown was visually duplicated.
- `Web_UI/src/pages/Settings.js` was simplified so the remaining session time appears only once in the sentence `Your session will expire in HH:MM`.
- The redundant right-aligned duplicate countdown and `HH:MM` helper label were removed.
- Frontend main commit: `f6709fde7bf0706f85b8a8b9865344b6bf71cb0f`.
- This visual cleanup is on `main` only and has NOT been deployed yet.

## Frontend deployment approval behavior — 2026-10-12

- User explicitly stated that approval of a frontend change automatically grants deployment approval going forward.
- Therefore, when the user approves or asks to implement a frontend change, deploy the corresponding tested frontend change to the `deploy` branch without requiring a second deployment confirmation.
- Continue to keep backend changes separate and route backend instructions through Annie unless the user requests otherwise.
- The CRA session countdown visual cleanup was deployed under this approval.
- Deploy branch commit: `e0442969e07a2b0e3d31803c64626cf58b6d2bd4`.
- GitHub Actions run `38255289137` completed successfully for both build and deploy.

## CRA session countdown unit label — 2026-10-12

- User requested the word `hours` be displayed next to the Settings session countdown so the remaining-time value is self-explanatory.
- `Web_UI/src/pages/Settings.js` now displays the session message as `Your session will expire in HH:MM hours.`
- Main commit: `ea30de8a289449cb3f3b688f608a5096bd7a43e5`.
- The approved frontend change was automatically deployed under the standing deployment approval.
- Deploy branch commit: `587cab369cab2acc5c9f2401b04140b3606bc59c`.
- GitHub Actions run `38255949487` completed successfully for both build and deploy.

## CRA user notification preferences — first implementation — 2026-10-12

- User approved starting work on user notification settings.
- Frontend notification preference helpers were added in `Web_UI/src/config/organization.js`.
- Preferences are organization-scoped and locally keyed per CRA user.
- Initial defaults:
  - notification alerts enabled
  - notification sound disabled
- `Web_UI/src/pages/Settings.js` now has a Notifications card with:
  - Notification alerts switch
  - Notification sound switch
- Turning notification alerts off automatically turns notification sound off.
- `Web_UI/src/components/Navbar.js` now applies the preference:
  - normal unread badge when alerts are enabled
  - when alerts are disabled, required-acknowledgement notifications still remain visibly badged so mandatory notices cannot be hidden
  - optional short Web Audio notification tone can play when a new unread notification arrives and sound is enabled
  - first notification load does not play a sound for existing notifications
- Browser audio may be blocked until the user has interacted with the page; this is handled silently.
- Frontend is already compatible with future server-backed preferences through authenticated `GET/PATCH /api/profile/preferences`. Until that endpoint is installed, HTTP 404 is silently treated as local-only fallback.
- Main frontend commits:
  - `d3a2aa1b39fe84e019e80a254318b568a46237f4` notification preference helpers
  - `9d3e86c744520a4ed1aaac3c73f9c8434a21608c` Settings notification controls
  - `95c820a93e07ad02ba3d5b5fe3d8d533c4fc7802` Navbar preference behavior and notification sound
- Deploy branch commit: `621e26dda5ef11689a6dad37edb0a2da4cdcc0ea`.
- GitHub Actions run `38256865941` completed successfully for build and deploy.
- Server-backed cross-browser persistence is the next backend step and should use a separate `data/user-preferences.json`, not `users.json`.
- Annie instruction artifact created: `Annie_CRA_notification_preferences_backend.txt`.
- Do not sync backend source to GitHub until Annie returns the tested backend files.

## Repository/server separation and backend handoff workflow — 2026-10-13

- The CRA development server and GitHub repository are intentionally separate platforms.
- Never use git clone, git pull, git push, or repository synchronization commands on the development server.
- GitHub `main` is the source of truth for backend source files going forward.
- Backend workflow:
  1. inspect/edit/create the backend file in GitHub first;
  2. commit it to `main`;
  3. provide the exact new/edited backend file(s) to Charl;
  4. Charl/Annie manually places those files under `/home/charl/projects/maintenix-dev-api/Server_API/CRA/`;
  5. restart only `maintenix-dev-api.service` when required and validate DEV.
- Frontend approval continues to imply deployment approval; approved frontend changes are committed and deployed automatically.
- Mutable server runtime data is not treated as GitHub source code and must not be overwritten merely to make byte-for-byte comparisons match. Examples include sessions, presence, notifications, drafts, queues/status, uploads, generated reports, and live user/account state.

### 2026-10-13 CRA Server_API reconciliation findings

The uploaded 2026-10-12 18:35 SAST CRA backend snapshot was compared with GitHub `main`.

Server is functionally newer/preferred for these source/artifact files:
- `Server_API/CRA/index.js`: server gates host-metric status behind `SERVER_STATUS_ENABLED=true` and defaults HOST to `127.0.0.1`, matching the current Cloudflare-tunnel DEV architecture.
- `Server_API/CRA/routes/areas.js`: server has the newer canonical area helper implementation with safer atomic writes and exported `readAreas`/`addArea` helpers.
- `Server_API/CRA/routes/servicing.js`: server delegates the compatibility area routes to the canonical shared areas implementation instead of duplicating area writes.
- `Server_API/CRA/routes/callout.js`: server has later draft validation, no-store headers, atomic draft writes, stricter ID/value validation, and safer delete/load behavior.
- `Server_API/CRA/package-lock.json`: server lock reflects the validated installed DEV dependency set and is newer than the repo lock.
- `Server_API/CRA/data/templates/call_out_template.docx`: server template was updated during the validated Call Out work; repo copy is the older initial template.
- `Server_API/CRA/data/templates/servicing_checklist_approved_v1.docx`: present and actively preferred on the server but missing from GitHub; it must be added to the repo.
- `Server_API/CRA/.env.example`: safe DEV configuration example exists on server and should be added to GitHub; real `.env` remains server-only.

Repo is newer/preferred for:
- `Server_API/CRA/SERVER_REQUIREMENTS.txt`: server exactly matches an older 2026-09-09 repo revision; current repo document is newer and DEV-aligned.
- `Server_API/CRA/formal-reporting/report_worker.py`: runtime code is functionally identical; server only contains a stale path comment, so repo remains authoritative.

No functional reconciliation is needed for the three formal-report master DOCX templates: their Git blobs differ, but internal ZIP entry content/CRC and sizes match, so the document content is equivalent.

Do not source-sync mutable runtime files such as `data/users.json`, `data/reports.meta.json`, `data/standby.json`, or runtime-modified `data/templates/areas.txt` simply because the live server differs. In particular, never overwrite live `users.json` during source reconciliation.

## CRA backend reconciliation progress — 2026-10-13

The one-time server-to-repository reconciliation has been applied for the validated DEV backend source files.

Exact DEV server copies now present on GitHub main:
- `Server_API/CRA/.env.example` — blob `293068f4a278e82d408175be46d5611f62d4f960`
- `Server_API/CRA/index.js` — blob `9099ac344fe5dcae9b4825edfb9c9715af147c33`
- `Server_API/CRA/routes/areas.js` — blob `b6896fc21d97728983bc60f3cb8f0af2e4664aac`
- `Server_API/CRA/routes/servicing.js` — blob `ff81b2db66af9125467fbca082ea0a9c2ef6143f`
- `Server_API/CRA/routes/callout.js` — blob `07234735bbc3019bc6048bab2d1d153e779fbc91`
- `Server_API/CRA/data/templates/call_out_template.docx` — blob `5cd5404e8a9b638d52ee657659c34710f4fe65bb`

Relevant commits:
- `84f7227a600cc5c6ccd5f18a4f91234dac2157b4` — validated DEV index.js
- `266fd6bf1fd6c6c1cd26b1b1c2f00cae92753729` — validated DEV areas.js
- `e9dc8f86f6630567b3f2593daa26aae9b0c72648` — servicing.js, callout.js, .env.example and reconciled package lock
- `7881d498768dca9af91598048152b1a2748e7cd9` — validated Call Out DOCX template

`Server_API/CRA/package-lock.json` on main is a reconstructed lock matching the validated DEV dependency set; its current repo blob is `b04b7d3e9b3432ab9d3b4a40fea6b46910c5e4f4`. It is valid JSON and functionally represents the live dependency versions, although it is not byte-identical to the server lock blob `122f16ebc95dacc4d29275a15cee976d12b7b8c2`.

One binary reconciliation item remains:
- `Server_API/CRA/data/templates/servicing_checklist_approved_v1.docx`
- DEV server SHA-256: `d837600a8059d46393905f208468b91d39695669598960fb95bc8c45fdbf02ad`
- DEV server Git blob would be `15b780524eed08919c030b25594423c4aed077f5`
- This template is actively preferred by `routes/servicing.js` when present and therefore must be added to GitHub before the repository can be considered a complete source-of-truth representation of the current Servicing runtime.
- The current GitHub connector cannot directly upload a local binary file by container path; do not substitute or regenerate this DOCX. Use the exact validated server binary.

No server deployment is required for the reconciliation commits above because the server already contains those validated files. This was a server -> repo source-of-truth catch-up only.

### CRA backend reconciliation completed — 2026-10-13

The final missing binary template has now been verified on GitHub main:

- `Server_API/CRA/data/templates/servicing_checklist_approved_v1.docx`
- Git blob: `15b780524eed08919c030b25594423c4aed077f5`
- This exactly matches the validated DEV server binary that was expected.

The one-time DEV server -> GitHub backend reconciliation is therefore complete. GitHub `main` is now the source of truth for future CRA backend changes. Future workflow: make backend changes in GitHub first, commit them, then provide only the changed backend files for placement on the DEV server.

## CRA notification preferences backend — repo-first implementation — 2026-10-13

- Development resumed with the Notifications settings backend after the repository/server reconciliation completed.
- GitHub main is the source of truth. No git operations are performed on the DEV server.
- Added `Server_API/CRA/lib/userPreferences.js`.
  - Stores per-user preferences separately in `data/user-preferences.json`.
  - Does not modify `data/users.json`.
  - Defaults: notification alerts enabled, notification sound disabled.
  - If alerts are disabled, sound is normalized to false.
  - Uses the existing locked/atomic JSON utilities and corrupt-file backup handling.
- Updated `Server_API/CRA/lib/profileRoutes.js`.
  - `GET /api/profile/preferences`
  - `PATCH /api/profile/preferences`
  - Validates notification preference booleans.
- Commits:
  - `d8b49c2120f1886679b8537a04bc1ce71fad1f81` — userPreferences.js
  - `bc6c23ecf3083f0ce47562dba394fb809cd3bbbe` — profile preference routes
- Both changed JS files passed `node --check` in the handoff package.
- Backend server handoff package: `CRA_notification_preferences_backend.zip`.
- Server destinations:
  - `/home/charl/projects/maintenix-dev-api/Server_API/CRA/lib/userPreferences.js`
  - `/home/charl/projects/maintenix-dev-api/Server_API/CRA/lib/profileRoutes.js`
- Restart required after placement: `maintenix-dev-api.service`.
- The previously deployed frontend already calls `/api/profile/preferences` when available, so no additional frontend deployment is required for this backend step.

## CRA notification preferences validated — 2026-10-13

- User confirmed the new server-backed notification preference implementation is working on CRA DEV.
- Backend source of truth:
  - `Server_API/CRA/lib/userPreferences.js`
  - `Server_API/CRA/lib/profileRoutes.js`
- Preferences persist per user in the DEV runtime file `data/user-preferences.json`; this runtime data file is not committed.
- Supported settings:
  - notification alerts enabled/disabled
  - notification sound enabled/disabled
  - sound is normalized to false when alerts are disabled
- The frontend already reads/writes these preferences through `/api/profile/preferences` and retains organization-scoped local fallback behavior.

## CRA notification sound volume increased — 2026-10-13

- User requested the in-app notification sound volume be increased to the maximum application gain.
- `Web_UI/src/components/Navbar.js` notification oscillator gain changed from `0.035` to `1`.
- Main commit: `236a2dfd252428325cf04d58195e68734877e14d`
- Selective deploy commit: `cbc09c9e38fb69c7f1902e87e521d395777d73e9`
- GitHub Actions run: `38395415814`
- Both `build` and `deploy` jobs completed successfully.
- Device/browser/system volume and muted-tab policies still control the final audible output.

## CRA Web Push implementation — 2026-10-13

Web Push/device notifications were implemented repo-first.

Frontend:
- Added push-only service worker: `Web_UI/public/maintenix-push-sw.js`.
- Added browser subscription client: `Web_UI/src/lib/devicePush.js`.
- Updated `Web_UI/src/index.js` so the legacy offline-worker cleanup preserves the new push-only worker and does not mistake it for the removed offline worker.
- Updated `Web_UI/src/pages/Settings.js` with a Device notifications switch and Send test device notification button.
- Device subscriptions are per browser/device. Disabling on one device removes that device's subscription without affecting the user's other devices.
- Frontend main commits include:
  - `e2cdc0d9e1b967b959ad942d074525934cf25584` push service worker
  - `0a30c3039507d072295e5efed8ed85a7e083dd47` push client helper
  - `bf16c53da7d1d81cfe01a07a6fd94a4d42cda2d9` service-worker cleanup compatibility
  - `a56c389e87a8f9393371726b162d967904354056` Settings device notification UI
- Selective deploy commit: `003cb04ba9894b98ff6eaf64ecfc8ee5595bfbb2`
- GitHub Actions run: `38397991574`
- Both build and deploy jobs completed successfully.

Backend source of truth:
- Added `Server_API/CRA/lib/pushNotifications.js`.
- Added `Server_API/CRA/routes/push.js`.
- Updated `Server_API/CRA/lib/notifications.js` so newly created notifications also queue Web Push delivery to eligible subscribed users.
- Updated `Server_API/CRA/index.js` to mount `/api/push`.
- Added pinned backend dependency `web-push@3.6.7` in package.json/package-lock.json.
- Updated `.env.example` with optional VAPID overrides.
- Backend commits include:
  - `69b28bf82244b6f0998a108f136503d64a8e0e87`
  - `abc9310df2a4512a1c5ad75b078bbc9dfde3fee5`
  - `46f9433f4518bc9739a905995ca2a63402e7898c`
  - `3a14af56ce418f2f1856eaed2eb408085f644f61`
  - `d295bb31ea76346aefe5bf16d1033e854d259e7d`
  - `0f72c438d5bdb175f7c57ff89ce0441bb04e438c`
  - `e8209e80e7a42541e3c1cc73d36aa43c6c1333ba`
  - `480aa7f1b05225a4a073f89b11e69db0de81039f`

VAPID/runtime behavior:
- If explicit VAPID environment variables are absent, CRA automatically generates one organization-specific VAPID keypair on first Web Push use.
- The generated keypair is stored in DEV runtime data at `data/web-push-vapid.json`; the private key must never be committed.
- Browser/device subscriptions are stored separately at `data/push-subscriptions.json`; this runtime file is not committed.
- Expired push subscriptions are removed automatically after provider HTTP 404/410 responses.
- Backend handoff package generated as `CRA_web_push_backend.zip`; server deployment/validation is still pending user installation.

## CRA Web Push DEV deployment validated — 2026-10-13

- CRA Web Push backend was manually installed on DEV under `/home/charl/projects/maintenix-dev-api/Server_API/CRA/` and `web-push@3.6.7` was installed.
- Initial restart failed because the `maintenix-dev` service account could not traverse/read the newly installed `node_modules/web-push` files even though the `charl` shell could resolve them.
- Root cause confirmed by `sudo -u maintenix-dev node -e "require('web-push')"` returning `MODULE_NOT_FOUND`.
- DEV-only fix: `sudo chmod -R a+rX node_modules`, preserving ownership while adding read/traverse access.
- Service-account module checks then succeeded for `web-push`, `lib/pushNotifications.js`, `routes/push.js`, and `lib/notifications.js`.
- `maintenix-dev-api.service` restarted successfully with API + servicing worker + callout worker all running.
- API bound successfully to `127.0.0.1:5056`.
- Local health `http://127.0.0.1:5056/api/health` returned HTTP 200 `{"ok":true}`.
- Public DEV health `https://dev-api.main-tenix.com/CRA/api/health` returned HTTP 200 `{"ok":true}`.
- Never run `npm audit fix`; the audit warnings are not part of this Web Push issue.

## Living DEV → LIVE migration checklist — 2026-10-13

- Added root-level `LIVE_MIGRATION_CHECKLIST.md` as the current operational migration runbook.
- The file must be updated whenever development adds a long-running worker, scheduled task, systemd service, browser service worker, Python/background subprocess, external runtime dependency, persistent runtime file, or persistent secret/key.
- Current long-running backend processes are:
  - API: `index.js`
  - Servicing worker: `servicingWorker.js`
  - Call Out worker: `calloutWorker.js`
  All three are started by `npm run start:all` through `startAll.js`.
- Formal Reporting `report_worker.py` is on-demand and must not be daemonized; LIVE needs Python, python-docx, LibreOffice and pdftotext.
- Web Push delivery runs inside the API; there is no separate server push worker.
- `Web_UI/public/maintenix-push-sw.js` is a browser service worker deployed with the frontend, not a systemd service.
- LIVE Web Push must preserve its production VAPID key after subscriptions exist; DEV push subscriptions must not be copied to LIVE.
- Historical `LIVE_V1.2_MIGRATION_NOTES.txt` now points to `LIVE_MIGRATION_CHECKLIST.md` as the current operational reference.
- Production remains untouched until an explicit LIVE migration is approved.

## Central notification architecture + delivery worker — 2026-10-14

- Implemented a centralized CRA notification architecture on GitHub `main`.
- Added `lib/notificationRegistry.js` as the event contract/registry. Current registered event families include Admin broadcast, Daily Planner assignment, report approval/rejection, Standby update/clear, Servicing completion/failure, Call Out completion/failure, and Formal Reporting completion/failure.
- Added `lib/notificationService.js` so application modules emit named events through `notify()` / `notifySafe()` rather than constructing delivery behavior independently.
- Reworked `lib/notifications.js` to schema version 2 with locked/atomic persistence, event/category metadata, mandatory/channel metadata, source event IDs, and idempotency keys. Duplicate idempotency keys return the existing notification instead of creating another.
- Added persistent delivery outbox `lib/notificationDelivery.js`, runtime file `data/notification-delivery.json`, stale-claim recovery, bounded delivery history, retry scheduling, and Admin/L3 delivery-diagnostic access.
- Added long-running `notificationWorker.js`. CRA `startAll.js` now launches FOUR processes: API, Servicing worker, Call Out worker, and Notification delivery worker.
- Web Push is now a secondary asynchronous delivery channel. Business actions first persist the in-app notification and enqueue delivery; the notification worker sends push and retries transient failures. Dead 404/410 subscriptions remain permanently removed.
- `lib/pushNotifications.js` now exposes structured delivery outcomes including sent/failed/retryable/permanent counts while retaining existing test-push behavior.
- Daily Planner assignment notifications now use the registry/service. Acknowledging from Daily Planner and from the bell now follows the same backend acknowledgement-notice behavior.
- Report approval/rejection and Standby notifications were migrated to the central service.
- Servicing and Call Out workers now generate owner-targeted success/failure notifications. Failure notifications require acknowledgement and are idempotent per report ID.
- Formal Reporting now creates success/failure notifications for the generating user, keyed to its generation ID.
- Added Admin/L3 notification metadata endpoints: `GET /api/notifications/events` and `GET /api/notifications/:id/delivery`.
- Added backend regression test `test/notifications.test.js` plus `npm run test:notifications`.
- Added GitHub Actions workflow `.github/workflows/test-cra-server-api.yml` with Node 22, `npm ci`, syntax validation, and notification regression tests.
- Backend CI run `38552304037` succeeded. Latest backend CI run `38552619984` also succeeded after the deployment-instruction file was added.
- Added `Server_API/CRA/NOTIFICATION_ARCHITECTURE_DEPLOY.txt` with the exact DEV manual deployment/restart/validation procedure.
- Updated `LIVE_MIGRATION_CHECKLIST.md` to include the notification worker as the fourth long-running Node process, the persistent delivery outbox, required source files, service-account checks, and LIVE acceptance checks. Migration checklist update commit: `0dbf5823ff364ada824f4f85ff7fff4776679d6e`.
- Frontend notification hardening:
  - Navbar badge now remains active for required acknowledgements even after the item is marked read.
  - Removed obsolete browser-only Reports `appNotifications` rejection notifications so the server notification store is the single source of truth.
- First selective frontend deploy commit `93133df96d0d4617dba95b270e3867b4e91d09d2` failed build because the Reports cleanup accidentally removed `getReportTypeForRow`; deploy was skipped. The helper was restored on main in commit `74677a9cb92412bfc715c91ee6e07c30f0637cb2`.
- Final selective frontend deploy commit `5677077ef169101aad72bf78721144e017cb3a53`, Actions run `38552466948`: build SUCCESS and deploy SUCCESS.
- Added packaging workflow `.github/workflows/package-cra-notification-backend.yml`; run `38553004271` succeeded and produced artifact `cra-notification-architecture-backend` (artifact ID `11886799140`, SHA-256 `b10e272e90ec25cf3a9d37b2a26f43b4f8e2d34d8d8e9df561ece8168cbd2d62`).
- Backend source is committed and CI-validated but the central architecture is NOT yet installed on the CRA DEV server. The next operational step is manual copy of the packaged backend files to `/home/charl/projects/maintenix-dev-api/Server_API/CRA/`, run the supplied checks, restart only `maintenix-dev-api.service`, verify all four processes and both health endpoints, then validate notification delivery.
- Production remains untouched.

## Central notification architecture validated on CRA DEV — 2026-10-14

- User manually deployed the GitHub-main notification architecture files to `/home/charl/projects/maintenix-dev-api/Server_API/CRA/` and restarted only `maintenix-dev-api.service`.
- CRA DEV systemd service started successfully at 2026-10-14 13:09:28 SAST.
- Verified all four expected DEV long-running Node processes are running under the CRA DEV stack:
  - `index.js`
  - `servicingWorker.js`
  - `calloutWorker.js`
  - `notificationWorker.js`
- Service log explicitly reported:
  - `Notification delivery worker started.`
  - `Servicing worker started.`
  - `CallOut worker running...`
  - `Maintenix server API listening on 127.0.0.1:5056`
- Local CRA DEV health check `http://127.0.0.1:5056/api/health` returned HTTP 200 with `{"ok":true}`.
- Public CRA DEV health check `https://dev-api.main-tenix.com/CRA/api/health` returned HTTP 200 with `{"ok":true}`.
- The process listing also showed the separate production processes under `/opt/apps/maintenix/api`; they were only observed and were not modified.
- CRA DEV notification worker infrastructure is therefore installed and operational. Next validation is functional delivery/outbox processing with a real notification event.

## Report moderation notification fix — 2026-10-14

- User testing found that approving/rejecting a report did not produce a notification.
- Inspection identified two weaknesses in `Server_API/CRA/routes/reports.js`:
  1. report moderation notifications were explicitly skipped when the reviewer email matched the report owner email, so self-approval/self-rejection testing produced no notification;
  2. fallback owner resolution looked for servicing/callout runtime status and payload JSON directly under their root directories, while the current queue/status layout stores them under per-user subdirectories.
- Fixed in main commit `366d46b6fc84baef1e8966d05541e83a4bb88cc6`:
  - report moderation now notifies the resolved report owner even when the moderator is the same user;
  - owner resolution canonicalizes against `users.json` by ID/email and uniquely matching name;
  - legacy/report metadata fallbacks now consider ownerUserId, ownerEmail, by, userEmail, createdByEmail, technicianEmail and technician;
  - servicing/callout runtime owner lookup now searches the direct path plus one per-user directory level;
  - approve/deny responses expose `notificationCreated` and `notificationId` for safe diagnostics;
  - moderation remains successful even if notification creation fails, but the server now logs a safe warning instead of silently swallowing the condition.
- Added regression coverage in commit `8c30be2b36f7267dd52c86049ce4b5374911e33a` for report-approved self-target delivery and report-rejected owner delivery, including outbox job creation.
- CRA backend CI runs `38565502676` and `38565533650` both completed SUCCESS.
- Updated notification backend packaging workflow in commit `1401b7d1405013e84f27423cb252b7e87094b2f4` so relevant notification backend changes automatically produce a handoff artifact.
- Packaging run `38565571592` completed SUCCESS; artifact ID `11895335828`, SHA-256 `fbeeffb6fede38cda245810dc9e995dec80a8ba43fa7d34c19f674f43a19fc9a`.
- Backend fix is committed and CI-validated but still requires manual replacement of `Server_API/CRA/routes/reports.js` on CRA DEV followed by restart/validation.

## Report moderation notifications validated on CRA DEV — 2026-10-14

- User confirmed the corrected report approval/rejection notification flow works on CRA DEV after replacing `Server_API/CRA/routes/reports.js` and restarting the DEV service.
- Report moderation notifications are therefore validated end-to-end on DEV, including the corrected owner resolution/self-review behavior.

## Administration foundation + Area metadata management — 2026-10-14

- Implemented the permanent CRA Administration foundation with tabs for Users, Areas, and Notifications. The Areas tab is functional in this phase; Users and Notifications remain placeholders for their later migration/configuration phases.
- Frontend route: `#/administration`. Admin area-notification deep link: `#/administration?tab=areas&status=pending`.
- The Administration navigation item is only shown to users whose role is `ADMIN`; backend Admin endpoints remain authoritative for access control.
- Added `Web_UI/src/pages/Administration.js` with:
  - merged Area estate listing;
  - All Areas / Metadata Required filters;
  - search;
  - status, source and mapping diagnostics;
  - Section dropdown sourced from existing baseline metadata;
  - read-only Area name;
  - editable Section, Base area, F/First and G/Second values;
  - optional F/G values for legitimate no-code areas.
- Frontend source changes were committed to `main` and selectively synchronized to `deploy`; final deploy-branch source commit for the route wiring is `bd3ad46a567de1ddb8ed19e56248cf599126ebec`. The GitHub Pages workflow is expected to run from that deploy change; do not describe the new page as validated live until the Pages run is confirmed successful.

Backend Area metadata architecture:
- Added `Server_API/CRA/lib/areaMetadata.js`.
- Runtime organisation metadata file: `Server_API/CRA/data/area-metadata.json`.
- `area-metadata.json` is runtime data, is ignored by Git, must be preserved across deployments, and must not be replaced with DEV data during a LIVE migration.
- Pending records contain Area identity and creator audit data. Admin configuration sets status `CONFIGURED`, Section, Base area, optional First/F code and optional Second/G code, plus update audit fields.
- `area-sections.json` remains untouched baseline/reference data originating from the service-list workbook.
- `reportStorage.resolveSectionForArea()` now resolves in this order:
  1. configured runtime Admin metadata;
  2. existing baseline `area-sections.json` exact/normalized matching;
  3. existing fuzzy/code matching;
  4. `Unmapped`.
- Pending runtime metadata does not override the existing resolver; servicing remains available while metadata is incomplete.
- Historical reports are not moved automatically when metadata is configured. Runtime metadata changes affect future report placement only.

Area creation:
- Existing case/whitespace-normalized Area duplicate handling remains authoritative.
- When a genuinely new Area is appended through either `POST /api/areas` or the Servicing compatibility `POST /api/servicing/areas`, CRA creates a PENDING runtime metadata record unless that Area already has an exact baseline mapping.
- Area creation is deliberately not blocked if metadata/notification follow-up fails; the Area remains immediately usable.
- Added centralized notification event `AREA_METADATA_REQUIRED`:
  - category ADMIN;
  - warning severity;
  - targets ADMIN role only;
  - no acknowledgement required;
  - Open action routes to Administration -> Areas pending filter;
  - idempotent per normalized Area.
- Existing operational Areas that predate this feature and have no exact baseline/runtime metadata are backfilled as PENDING when Admin loads the Area estate, without generating retroactive notification spam.

Admin Area API:
- `GET /api/admin/areas`
- `GET /api/admin/areas/pending`
- `PATCH /api/admin/areas/:area/metadata`
- The Admin listing merges `data/templates/areas.txt`, baseline `data/templates/area-sections.json`, and runtime `data/area-metadata.json`.
- Rename and delete are intentionally not implemented in this first pass because existing drafts/reports may already reference Area names.

Validation/deployment support:
- Added `test/area-metadata.test.js` and extended notification regression coverage for Admin-only Area metadata notifications.
- `npm run test:areas` and `npm run test:backend` are available.
- CRA backend CI now syntax-checks Area/Admin files and runs both notification and Area regression suites.
- Added `Server_API/CRA/ADMIN_AREAS_DEPLOY.txt`.
- Added packaging workflow `.github/workflows/package-cra-admin-areas-backend.yml` producing the `cra-admin-areas-backend` handoff artifact.
- `LIVE_MIGRATION_CHECKLIST.md` now records `area-metadata.json` as preserved runtime organisation data and includes Area Administration acceptance checks.
- Backend source is committed on GitHub `main` but still requires manual placement on CRA DEV followed by restart/validation under the established repo-first/server-manual workflow.
- Production remains untouched.

## Administration Areas CI/package/frontend deployment validated — 2026-10-14

- CRA backend CI for main commit `c7d076ba7531531a3f1538582a19ee35f18c1aa1` completed successfully.
- GitHub Actions run `38584713794` (`Test CRA Server API`) passed syntax checks and the combined backend regression suite, including notification and Area metadata tests.
- Administration Areas backend packaging run `38584713798` completed successfully.
- Handoff artifact: `cra-admin-areas-backend`, artifact ID `11904493974`, SHA-256 `67c781b5260dfda105d21c0d0eb4afa7dee8940f4929a7f1c2ed27861d671ae7`.
- Selective frontend deployment head: `bd3ad46a567de1ddb8ed19e56248cf599126ebec`.
- GitHub Pages run `38584369247` completed successfully: both `build` and `deploy` jobs passed.
- The Administration frontend foundation is therefore deployed to the CRA GitHub Pages DEV UI. Backend-dependent Areas data/configuration will become functional after the packaged backend files are manually installed on CRA DEV and `maintenix-dev-api.service` is restarted/validated.
- Production remains untouched.

## Administration Areas UI refinement + form crash fix — 2026-10-14

- Refined `Web_UI/src/pages/Administration.js` after first user testing.
- Administration page navigation now uses three equal contained pill/tile controls for Users, Areas, and Notifications. Active highlighting stays inside the selected tile and labels are centered.
- Area metadata table was compacted:
  - removed the Mapping diagnostics column from the UI;
  - reduced cell padding and font size;
  - assigned tighter column proportions;
  - removed the inner `table-responsive` wrapper so ordinary desktop use no longer introduces an unnecessary table scrollbar.
- Fixed the configuration form crash while typing.
- Root cause: CRA is still on React 16.13, where SyntheticEvent objects are pooled. The original controlled inputs referenced `event.target.value` inside a functional state updater, which can run after the event has been released.
- Fix: each form control now reads `event.currentTarget.value` synchronously and passes the plain value into `updateFormField()`; no pooled event object is retained by state updates.
- Main implementation commit: `8a8d7e11769bc7d568cc2065214d1641c19df8ae`.
- Selective deploy commit: `b083a7eb4bbf044717d534f542ff3461e20a69f1`.
- GitHub Pages Actions run `38602924023` completed successfully; both build and deploy jobs passed.
- No backend files, runtime data, CRA DEV service, or LIVE service were changed for this refinement.

