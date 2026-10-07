# Multi-photo Evidence Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Keep all real review images and model responses out of Git.

**Goal:** Make 2–3-photo recognition evidence-gated and fail-closed, with Qwen3-VL as the only multi-photo model, while preserving the existing single-photo behavior.

**Architecture:** Add a small browser-compatible pure module for strict response validation, subject resolution, field evidence checks, safe localization, and date handling. The client selects the strategy by image count and sends a strategy header. The proxy enforces the Qwen route for multi-photo requests and records only consent-appropriate telemetry. Real historical cases are scored by a local replay harness against a frozen, private field-level manifest before any deployment.

**Tech Stack:** Vanilla JavaScript/HTML, Vercel Node functions, OpenRouter multimodal chat API, Supabase/PostgREST, Node test runner, Playwright Chromium.

---

## File map

- Create `multi-photo-evidence.js`: strict schema validator, deterministic resolver, safe localization maps, date evidence parser, stable error/result codes.
- Create `scripts/test-multiphoto-evidence.cjs`: unit tests for schema, subject decision table, evidence admission, conflicts, localization, and ambiguous dates.
- Modify `pantry.html`: load the pure module, issue evidence prompt only for 2–3 photos, route single/multi separately, render resolved values, and preserve retry/manual entry behavior.
- Modify `api/openrouter.js`: accept strategy header, enforce Qwen-only multi route, record actual model/provider/cost and privacy-safe aggregate telemetry.
- Modify `scripts/dev-server.cjs`: forward the strategy header in local smoke.
- Modify `scripts/test-multiphoto-api.mjs`: proxy route/privacy/logging contract tests.
- Modify `scripts/test-multiphoto.cjs`: browser tests for supported, ambiguous, conflict, malformed, timeout/429, retry, and manual blank paths.
- Create `scripts/replay-multiphoto-cases.mjs`: private-manifest replay/scoring harness with dev/holdout split, repeat stability, per-case best-single comparison, and cost report.
- Create/update `docs/2026-10-08-multiphoto-evidence-release.md`: dated implementation, commit, verification, deployment, rollback, and stale-state warning.

Work only in `/private/tmp/pantry-multiphoto-design` on `codex/single-item-multiphoto`. Stage only task files; do not touch the dirty main worktree.

### Task 1: Pure evidence contract and deterministic resolver

**Files:**
- Create: `multi-photo-evidence.js`
- Create: `scripts/test-multiphoto-evidence.cjs`

- [ ] Write failing tests first for: all required keys/enums; exactly one observation per image; missing/duplicate/out-of-range indexes; every branch of the subject decision table; exact evidence-to-observedText tracing; partial/unreadable restrictions; field-only conflicts; malformed vs field-level blanking; ambiguous `8/01/08`; exact `EXP 10/2028`; frozen `CLARINS → 娇韵诗` and `Soothing Toning Lotion → 舒缓爽肤水`; unknown names falling back to original.
- [ ] Run `node --test scripts/test-multiphoto-evidence.cjs` and verify RED because the module does not exist.
- [ ] Implement a dependency-free UMD-style module usable through both `require()` and `window.MultiPhotoEvidence`. Export `validateResponse`, `resolveMultiPhotoEvidence`, `normalizeEvidenceText`, `parseEvidenceDate`, and `localizeResolvedProduct`.
- [ ] Return only stable outcomes: `resolved`, `manual_blank_uncertain`, `blocked_product_conflict`, `multi_strategy_invalid_response`; return stable field decisions including `kept`, `blanked_missing`, `blanked_conflict`, `blanked_invalid_evidence`.
- [ ] Run the unit test and `node --test scripts/test-ios-expiry.cjs`; verify GREEN and that the old `YYYYMMDD` input fix still passes.
- [ ] Commit only the new module and unit test.

### Task 2: Client strategy selection, prompt, and fail-closed UX

**Files:**
- Modify: `pantry.html`
- Modify: `scripts/test-multiphoto.cjs`

- [ ] Extend mocked recognition responses and write failing browser assertions for: one photo keeps the legacy request/parse path; two or three photos send only `qwen/qwen3-vl-32b-instruct`, `temperature:0`, numbered images, and strict evidence prompt; supported output fills the form; uncertain output opens a blank manual form; clear different-product output blocks; malformed response never falls back to text extraction or stale values; ambiguous date leaves only expiry blank; retry preserves selected thumbnails.
- [ ] Run `node scripts/test-multiphoto.cjs` and verify the new assertions fail.
- [ ] Load `multi-photo-evidence.js` before the inline application script. Split `recognizePhoto` into explicit single and multi request builders. Keep the existing single-photo prompt and model order unchanged.
- [ ] For multi-photo only, build the strict schema prompt, set the one Qwen model, add `X-Recognition-Strategy: multi_evidence_v1`, parse JSON without regex/text fallback, call the pure resolver, and map stable outcomes to existing confirmation/conflict/manual UX. Never display an old parsed result after invalid, timeout, or 429 responses.
- [ ] Remove the unsafe three-part date tail interpretation so `8/01/08` is blank; keep unambiguous full date and labelled month/year behavior.
- [ ] Run `node scripts/test-multiphoto.cjs` and `node --test scripts/test-ios-expiry.cjs scripts/test-intake.cjs scripts/test-package-type.cjs`; verify GREEN.
- [ ] Commit only client and browser-test changes.

### Task 3: Server model enforcement, telemetry, and consent boundary

**Files:**
- Modify: `api/openrouter.js`
- Modify: `scripts/dev-server.cjs`
- Modify: `scripts/test-multiphoto-api.mjs`

- [ ] Write failing API tests that multi strategy requires 2–3 images, forces exactly Qwen3-VL, rejects a conflicting requested model, removes `qwen/qwen-vl-plus`, and keeps order/single-photo behavior unchanged. Add tests for strategy/imageCount/status/error/cost aggregate properties and ensure images, filenames, OCR, evidence, and raw responses are absent without review consent.
- [ ] Run `node --experimental-default-type=module --test scripts/test-multiphoto-api.mjs` and verify RED.
- [ ] Parse and validate `X-Recognition-Strategy`. Enforce exact model/temperature for `multi_evidence_v1`, and include `strategyVersion`, image count, requested model, actual returned model/provider, upstream status, error code, and cost in aggregate usage properties.
- [ ] Keep full images/model response only in the existing consented recognition-review row. Do not add OCR/evidence/base64 to console or analytics. Return distinguishable timeout/upstream 429/invalid-response errors for client handling.
- [ ] Forward the strategy header through the local dev proxy.
- [ ] Run API tests plus `node --test scripts/test-photo-live-args.cjs`; verify GREEN.
- [ ] Commit only server, proxy, and API-test changes.

### Task 4: Private historical manifest and replay scorer

**Files:**
- Create: `scripts/replay-multiphoto-cases.mjs`
- Create locally only: `/private/tmp/pantry-multiphoto-manifest.json`
- Output locally only: `/private/tmp/pantry-multiphoto-regression/`

- [ ] Write scorer tests with synthetic fixtures before any paid call: field labels (`visible-supported`, `user-provided/non-visual`, `preference-only`, `unknown`), normalization, frozen aliases, stable stratified 25% holdout with at least one multi case, best-single tie-break, complementary evidence rule, per-case non-regression, aggregate reporting, catastrophic error count, repeat stability, actual model/provider checks, and cost summation.
- [ ] Build the private manifest from all 16 review rows. Audit every scored field against the image; record expected value, allowed aliases, evidence image indexes, reviewer, reason, complement marker, and manifest SHA-256. Require at least 6 audited records, 2 multi, and 1 ambiguity/conflict case before paid replay.
- [ ] Run the development subset only. For each multi case run every image alone plus the joint set twice at `temperature=0`; run single-photo compatibility once. Do not inspect holdout results while changing prompt/code.
- [ ] Freeze the candidate, open holdout once, and generate JSON + Markdown reports with per-case/per-field scores, repeat stability, actual route, and cost. If holdout fails, stop release and add new unseen real samples before another final evaluation.
- [ ] Hard gate: every multi case coverage ≥ its best single, wrong rate ≤ its best single, complementary cases gain ≥1 correct field, zero catastrophic wrong fields in every repeat, identical keep/blank decisions, correct Qwen model/provider, total development spend ≤ `$0.05` unless explicitly documented.
- [ ] Commit only the generic harness and synthetic fixtures. Never commit the private manifest, images, OCR, raw responses, accepted user data, or local reports.

### Task 5: Layered verification and release record

**Files:**
- Create: `docs/2026-10-08-multiphoto-evidence-release.md`

- [ ] Run smoke: `node --test scripts/test-multiphoto-evidence.cjs scripts/test-ios-expiry.cjs scripts/test-intake.cjs scripts/test-package-type.cjs`.
- [ ] Run touched suites: `node --experimental-default-type=module --test scripts/test-multiphoto-api.mjs` and `node scripts/test-multiphoto.cjs`.
- [ ] Run the gated private replay from Task 4. Do not deploy if any hard gate fails.
- [ ] Write the dated release note with branch, final commit, files, user-visible behavior, commands/results, case counts, aggregate and per-case gate status, actual spend, scope, and what may become stale. Include no private sample content.
- [ ] Commit the release note and relevant implementation files only. Confirm `git status --short` has no unrelated changes.

### Task 6: Preview, production smoke, and rollback

- [ ] Deploy preview and test three authorized fixtures: supported multi-photo, ambiguous/weak image, different-product conflict. Confirm form behavior and consent/no-consent logs.
- [ ] Inspect preview generation metadata: actual model Qwen3-VL, fixed provider, `multi_evidence_v1`, and cost below `$0.001` per call.
- [ ] Deploy production only after preview and regression gates pass. Verify the deployment commit/hash and health endpoint/static page.
- [ ] Run one minimal authorized production multi-photo smoke and recheck review/usage rows, actual route, and cost. Avoid a broad paid full regression in production.
- [ ] If model route, privacy logging, UX outcome, or cost gate fails, immediately promote the prior production deployment and document deployment IDs and rollback result.
- [ ] Push the feature branch and record the exact commit hash. Do not merge or push to `main` unless explicitly authorized.

