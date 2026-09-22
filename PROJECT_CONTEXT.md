# Maintenix Development — Project Context

> **Purpose:** This file is the persistent source of truth for critical Maintenix development context across ChatGPT project sessions.
>
> **Last updated:** 2026-09-22
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
