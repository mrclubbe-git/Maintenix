# Maintenix LIVE Version Clone — 2026-10-19

This file marks the frozen repository state designated by the user as the **LIVE VERSION CLONE** after development was paused on 2026-10-19.

## Frozen references

- Source/documentation marker branch: `live-version-clone-main-20261019`
- Frontend marker branch: `live-version-clone-deploy-20261019`
- Exact currently served frontend deploy commit: `8ef05c88f0d263a3bbf9161244f94aa667c1a966`
- Successful GitHub Pages workflow run: `39281337899`
- Accepted/current CRA backend tree SHA: `35e7367e289e4f0a30213bdf7a90253a9de2476d`
- Current migration package: `Maintenix_Current_Site_Migration_2026-10-19_v2.zip`
- Migration package SHA-256: `869f89b4a62d2d7d225a8a7ecf92831eea7abbfe8bf420f87f29b8fa0d4942ff`

The frontend marker includes the native Web Push **Mark as read / Acknowledge** enhancement.

## Marker policy

The dated LIVE-clone marker branches are immutable reference points. Future development continues from `main` and, for frontend deployment, `deploy`. Do not move or delete these marker branches unless the user explicitly instructs that the historical marker itself must be changed.

Future accepted LIVE-clone states must receive new dated marker branches.

## Development workflow

The authoritative development workflow and project rules are recorded at the top of `PROJECT_CONTEXT.md` under:

`## 0. CURRENT OPERATING STATE — READ THIS FIRST`

Future sessions must read that section before making changes.

Key rules include:

- `main` is source of truth.
- `deploy` is the frontend GitHub Pages branch.
- Backend changes are repo-first, then the exact changed backend files are provided in-session for manual installation on CRA DEV.
- CRA DEV is the development/acceptance environment.
- LIVE is not modified without explicit authorization.
- Runtime data is migrated selectively; LIVE business data is preserved and only CRA DEV templates are copied during migration.
- Final Cloudflare/edge controls remain infrastructure responsibilities.
- Significant changes require testing, durable context updates, and a new explicit user acceptance before replacing this LIVE clone.
