# Servicing Checklist Approved Draft V1 - Template Contract

This document records the data contract for the first approved servicing checklist report template.

## Template file

Expected production file:

`Server_API/data/templates/servicing_checklist_approved_v1.docx`

The servicing route falls back to the legacy `template.docx` until the approved template binary is present.

## Header fields

- `<<area>>`
- `<<service>>`
- `<<createdAt>>`
- `<<technician>>`
- `<<reportId>>`
- `<<frequencyKey>>`
- `<<standards>>`
- `<<%signature>>`

## Detection table

Loop: `detectionItems`

Fields per row:

- `no`
- `question`
- `answer`
- `extra`

Detection rows contain no standard reference, comment, or picture column.

## Suppression table

Loop: `suppressionItems`

Fields per row:

- `no`
- `question`
- `answer`
- `extra`

Suppression rows contain no standard reference, comment, or picture column.

## General table

Loop: `generalItems`

Fields per row:

- `no`
- `question`
- `answer`
- `comment`
- `photo` rendered with the image tag `<<%photo>>`

The existing servicing workflow requires picture evidence when a General item is answered YES.

## Detailed Findings table

Loop: `detailedFindings`

Each row is one independent evidence object:

- `photo` rendered with `<<%photo>>`
- `relatedItem`
- `comment`

A checklist question with multiple defects/pictures therefore creates multiple Detailed Findings rows. Each picture is independently associated with its related checklist item and its own defect comment.

General evidence is not duplicated into Detailed Findings.

## Section mapping

Current mapping in `servicingGenerator.js`:

- General: standard = `General`
- Suppression: NFPA 2001, ISO 14520, or standard labels containing suppression/extinguishing/clean agent
- Detection: all remaining non-General servicing standards

The original `items` array remains populated for backward compatibility with the legacy template and queued jobs.
