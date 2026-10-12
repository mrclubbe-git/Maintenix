# Maintenix Development — Project Context

> **Purpose:** This file is the persistent source of truth for critical Maintenix development context across ChatGPT project sessions.
>
> **Last updated:** 2026-10-07
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
