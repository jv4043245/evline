# Supplier Portal Agent Review

This sandbox worktree is used to harden the EVLine supplier portal before any staging or production rollout.

## Roles

- Coordinator: owns final decisions, merges findings into a single backlog, and keeps the work scoped to the supplier portal.
- QA / Bug Hunter: tries to break flows, forms, status transitions, reload behavior, duplicate submits, and API edge cases.
- Security Reviewer: checks token scope, IDOR risk, public mutations, data leakage, abuse, and staging blockers.
- Product / Ops Reviewer: checks whether managers and Chinese suppliers can use the flow without extra manual work.

## Decision Rules

- P0: production/data-loss/security emergency. Must fix immediately.
- P1: blocks staging or realistic supplier testing. Must fix before preview with real users.
- P2: painful UX, fragile edge case, or operational debt. Fix before broad rollout when practical.
- P3: polish, copy, minor cleanup. Track but do not block MVP learning.

## Consensus Flow

1. Implement a narrow slice in the sandbox worktree.
2. QA and Security review independently.
3. Product / Ops reviews the real workflow.
4. Coordinator merges findings and removes duplicates.
5. Fix P0/P1 first.
6. Re-run the same scenario after each fix batch.

## Current Sandbox

- Worktree: `/Users/JV/Desktop/Codex/сайты/sites/evline-supplier-portal-mvp`
- Branch: `supplier-portal-mvp`
- Local URL: `http://localhost:8788`
- Local admin token: `local-dev`
- Production worktree must remain untouched during review.

## 2026-06-25 Review Result

- Security final pass: no remaining P1/P2 security blocker for the supplier portal MVP.
- Product / Ops final pass: no hard blocker for a controlled sandbox test with a trusted supplier and trained manager.
- Automated regression: passed for invalid JSON, token isolation, public status spoofing, accepted/logistics downgrade attempts, quote and event limits, https-only image URLs, and spoofed admin auth headers.
- Browser smoke: passed for supplier request page, supplier note display, selected quote display, disabled quote form after acceptance, logistics form visibility, and no console errors.
- QA follow-up: fixed the unsafe fallback from supplier `request_text` to the original order request text, and fixed custom supplier reuse by case-insensitive display name lookup.

## Known Follow-Up Backlog

- P1 before broad rollout: add a stronger review/enforcement step so explicit supplier-facing text cannot accidentally include client contacts, finance details, or internal notes.
- P2: decide how to track "viewed" without unsafe GET side effects, for example an explicit lightweight viewed event.
- P2: add dashboard token rotation/revocation before sharing supplier-wide dashboard links broadly.
- P2: selecting a quote should create or offer the next procurement object, such as supplier payment, purchase task, or cost handoff.
- P2: require or validate stronger logistics details when suppliers move a request into shipping/warehouse statuses.
- P2: tighten the concurrent select-vs-new-quote race with an atomic conditional insert or transaction strategy.
