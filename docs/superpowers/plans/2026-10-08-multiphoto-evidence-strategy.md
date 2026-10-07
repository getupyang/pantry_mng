# Multi-photo Evidence Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Keep all real review images and model responses out of Git.

**Goal:** Make 2–3-photo recognition evidence-gated and fail-closed, with Qwen3-VL as the only multi-photo model, while preserving the existing single-photo behavior.

**Architecture:** Add a small browser-compatible pure module for strict response validation, subject resolution, field evidence checks, safe localization, and date handling. The client selects the strategy by image count and sends a strategy header. The proxy enforces the Qwen route for multi-photo requests and records only consent-appropriate telemetry. Real historical cases are scored by a local replay harness against a frozen, private field-level manifest before any deployment.

**Tech Stack:** Vanilla JavaScript/HTML, Vercel Node functions, OpenRouter multimodal chat API, Supabase/PostgREST, Node test runner, Playwright Chromium.

---

## File map

- Create `multi-photo-evidence.js`: strict schema validator, deterministic resolver, safe localization maps, date evidence parser, stable error/result codes.
- Modify `config.js`: remove the dead Qwen VL Plus fallback while preserving Gemini → Qwen3-VL single-photo order.
- Create `scripts/test-multiphoto-evidence.cjs`: unit tests for schema, subject decision table, evidence admission, conflicts, localization, and ambiguous dates.
- Modify `pantry.html`: load the pure module, issue evidence prompt only for 2–3 photos, route single/multi separately, render resolved values, and preserve retry/manual entry behavior.
- Modify `api/openrouter.js`: accept strategy header, enforce Qwen-only multi route, record actual model/provider/cost and privacy-safe aggregate telemetry.
- Modify `scripts/dev-server.cjs`: forward the strategy header in local smoke.
- Modify `scripts/test-multiphoto-api.mjs`: proxy route/privacy/logging contract tests.
- Modify `scripts/test-multiphoto.cjs`: browser tests for supported, ambiguous, conflict, malformed, timeout/429, retry, and manual blank paths.
- Create `scripts/replay-multiphoto-cases.mjs`: private-manifest replay/scoring harness with dev/holdout split, repeat stability, per-case best-single comparison, and cost report.
- Create/update `docs/2026-10-08-multiphoto-evidence-release.md`: dated implementation, commit, verification, deployment, rollback, and stale-state warning.

Work only in `/private/tmp/pantry-multiphoto-design` on `codex/single-item-multiphoto`. Stage only task files; do not touch the dirty main worktree.

### Task 0: Freeze the private labels and stratified split before strategy code

**Files (local only):**
- Create: `/private/tmp/pantry-multiphoto-manifest.json`
- Create: `/private/tmp/pantry-multiphoto-split.json`

- [ ] Export/read all 16 authorized review rows using the existing read-only audit path. Do not change the multi-photo prompt, parser, resolver, model route, or product code first.
- [ ] Inspect every image and label each scored field as `visible-supported`, `user-provided/non-visual`, `preference-only`, or `unknown`, with `expected`, frozen `allowedAliases`, evidence image indexes, reviewer, reason, and complement marker. Do not infer visual truth from `acceptedData` alone.
- [ ] Require at least 6 audited records, at least 2 multi-photo records, and at least 1 ambiguity/conflict record. If this cannot be met, stop before implementation and report the missing evidence.
- [ ] Produce a stable SHA-256 over the manifest, then generate a stratified 25% holdout containing at least one audited multi-photo case. Save IDs and hashes in the private split file. From this point until the candidate is frozen, inspect only dev-split scores.
- [ ] Record only counts and hashes in the eventual public release note; never copy images, OCR, model text, accepted user values, or the private manifest into Git.

### Task 1: TDD the generic replay scorer before feature implementation

**Files:**
- Create: `scripts/test-replay-multiphoto-cases.mjs`
- Create: `scripts/replay-multiphoto-cases.mjs`

- [ ] Define the private manifest CLI: `node scripts/replay-multiphoto-cases.mjs --manifest <absolute-json> --split <absolute-json> --phase dev|holdout --output <absolute-dir> [--dry-run]`. The manifest schema includes case ID, image references, per-field label/expected/aliases/evidence indexes, complement marker, and split metadata; it contains no embedded base64.
- [ ] Write failing synthetic tests for schema validation, label normalization, frozen aliases, split/hash verification, best-single tie-break, complement gain, per-case non-regression, catastrophic errors, repeat stability, exact model/provider, cost sum, private report paths, and exit codes.
- [ ] Run `node --test scripts/test-replay-multiphoto-cases.mjs` and verify RED because the scorer is not implemented.
- [ ] Implement `--dry-run` scoring from synthetic saved responses and live mode through the existing authenticated local API path. Write JSON + Markdown reports to the requested absolute output directory. Exit `0` only when every hard gate passes; exit nonzero for invalid manifest/hash/split, a per-case gate failure, route instability, cost overflow, or API error.
- [ ] Run the same test command and verify GREEN. Run `--phase dev --dry-run` on a synthetic manifest and verify both pass and fail fixtures produce the documented exit codes.
- [ ] Commit only the generic harness and synthetic fixtures, never real labels or responses.

### Task 2: Pure evidence contract and deterministic resolver

**Files:**
- Create: `multi-photo-evidence.js`
- Create: `scripts/test-multiphoto-evidence.cjs`

- [ ] Write failing tests first for: all required keys/enums; exactly one observation per image; missing/duplicate/out-of-range indexes; every branch of the subject decision table; exact evidence-to-observedText tracing; partial/unreadable restrictions; field-only conflicts; malformed vs field-level blanking; ambiguous `8/01/08`; exact `EXP 10/2028`; frozen `CLARINS → 娇韵诗` and `Soothing Toning Lotion → 舒缓爽肤水`; unknown names falling back to original.
- [ ] Run `node --test scripts/test-multiphoto-evidence.cjs` and verify RED because the module does not exist.
- [ ] Implement a dependency-free UMD-style module usable through both `require()` and `window.MultiPhotoEvidence`. Export `validateResponse`, `resolveMultiPhotoEvidence`, `normalizeEvidenceText`, `parseEvidenceDate`, and `localizeResolvedProduct`.
- [ ] Return only stable outcomes: `resolved`, `manual_blank_uncertain`, `blocked_product_conflict`, `multi_strategy_invalid_response`; return stable field decisions including `kept`, `blanked_missing`, `blanked_conflict`, `blanked_invalid_evidence`.
- [ ] Run the unit test and `node --test scripts/test-ios-expiry.cjs`; verify GREEN and that the old `YYYYMMDD` input fix still passes.
- [ ] Commit only the new module and unit test.

### Task 3: Client strategy selection, prompt, and fail-closed UX

**Files:**
- Modify: `config.js`
- Modify: `pantry.html`
- Modify: `scripts/test-multiphoto.cjs`

- [ ] Extend mocked recognition responses and write failing browser assertions for: one photo keeps the legacy request/parse path; two or three photos send only `qwen/qwen3-vl-32b-instruct`, `temperature:0`, numbered images, and strict evidence prompt; supported output fills the form; uncertain output opens a blank manual form; clear different-product output blocks; malformed response never falls back to text extraction or stale values; ambiguous date leaves only expiry blank; retry preserves selected thumbnails.
- [ ] Run `node scripts/test-multiphoto.cjs` and verify the new assertions fail.
- [ ] Load `multi-photo-evidence.js` before the inline application script. Split `recognizePhoto` into explicit single and multi request builders. Remove only dead `qwen/qwen-vl-plus`; lock the single-photo request snapshot to `[google/gemini-2.5-flash, qwen/qwen3-vl-32b-instruct]`, preserving its prompt and fallback order.
- [ ] For multi-photo only, build the strict schema prompt, set the one Qwen model, add `X-Recognition-Strategy: multi_evidence_v1`, parse JSON without regex/text fallback, call the pure resolver, and map stable outcomes to existing confirmation/conflict/manual UX. Never display an old parsed result after invalid, timeout, or 429 responses.
- [ ] Remove the unsafe three-part date tail interpretation so `8/01/08` is blank; keep unambiguous full date and labelled month/year behavior.
- [ ] Start `python3 -m http.server 8031` in Terminal A. In Terminal B run `PLAYWRIGHT_MODULE=/Users/getupyang/.agents/skills/gstack/node_modules/playwright node scripts/test-multiphoto.cjs`, then `PLAYWRIGHT_MODULE=/Users/getupyang/.agents/skills/gstack/node_modules/playwright node scripts/test-package-type.cjs`. Stop Terminal A after both finish. Separately run `node --test scripts/test-ios-expiry.cjs scripts/test-intake.cjs`; verify GREEN.
- [ ] Commit only client and browser-test changes.

### Task 4: Server model/provider enforcement, telemetry, and consent boundary

**Files:**
- Modify: `api/openrouter.js`
- Modify: `scripts/dev-server.cjs`
- Modify: `scripts/test-multiphoto-api.mjs`

- [ ] Write failing API tests that `multi_evidence_v1` requires 2–3 images and, conversely, every 2–3-photo request is rejected unless it carries that strategy. Assert it forces exactly `qwen/qwen3-vl-32b-instruct`, provider `{order:["alibaba"], allow_fallbacks:false}`, and `temperature:0`; rejects conflicting model/provider settings; and keeps order/single-photo behavior unchanged. Add tests for strategy/imageCount/status/error/cost aggregate properties and ensure images, filenames, OCR, evidence, and raw responses are absent without review consent.
- [ ] Run `node --experimental-default-type=module --test scripts/test-multiphoto-api.mjs` and verify RED.
- [ ] Parse and validate `X-Recognition-Strategy`. Enforce the reverse 2–3-photo requirement plus exact model, `temperature:0`, and Alibaba-only routing with fallbacks disabled. Preserve the provider object through sanitization only when it exactly matches the server-owned value; preferably overwrite client values with the constant. Remove `qwen/qwen-vl-plus` from the server allowlist after Task 3 removes it from the client request. Include `strategyVersion`, image count, requested model, actual returned model/provider, upstream status, error code, and cost in aggregate usage properties. The provider tag is verified from OpenRouter's endpoint metadata and must be rechecked before release.
- [ ] Keep full images/model response only in the existing consented recognition-review row. Do not add OCR/evidence/base64 to console or analytics. Return distinguishable timeout/upstream 429/invalid-response errors for client handling.
- [ ] Forward the strategy header through the local dev proxy and add `/multi-photo-evidence.js` to its explicit static-file allowlist so real local smoke loads the same resolver as production.
- [ ] Run API tests plus `node --test scripts/test-photo-live-args.cjs`; verify GREEN.
- [ ] Commit only server, proxy, and API-test changes.

### Task 5: Run the frozen private historical replay

**Files (local data only):**
- Read: `/private/tmp/pantry-multiphoto-manifest.json`
- Read: `/private/tmp/pantry-multiphoto-split.json`
- Output: `/private/tmp/pantry-multiphoto-regression/`

- [ ] Verify the manifest and split hashes still equal the values frozen in Task 0. Abort on any change.
- [ ] Run the development subset only through the CLI from Task 1. For each multi case run every image alone plus the joint set twice at `temperature=0`; run single-photo compatibility once. Do not inspect holdout results while changing prompt/code.
- [ ] Freeze the candidate, open holdout once, and generate JSON + Markdown reports with per-case/per-field scores, repeat stability, actual route, and cost. If holdout fails, stop release and add new unseen real samples before another final evaluation.
- [ ] Hard gate: every multi case coverage ≥ its best single, wrong rate ≤ its best single, complementary cases gain ≥1 correct field, zero catastrophic wrong fields in every repeat, identical keep/blank decisions, correct Qwen model/provider, total development spend ≤ `$0.05` unless explicitly documented.
- [ ] Never commit the private manifest, split, images, OCR, raw responses, accepted user data, or local reports.

### Task 6: Layered verification and release record

**Files:**
- Create: `docs/2026-10-08-multiphoto-evidence-release.md`

- [ ] Run smoke: `node --test scripts/test-multiphoto-evidence.cjs scripts/test-replay-multiphoto-cases.mjs scripts/test-ios-expiry.cjs scripts/test-intake.cjs`.
- [ ] Run API touched suite: `node --experimental-default-type=module --test scripts/test-multiphoto-api.mjs`.
- [ ] For browser touched suites, start `python3 -m http.server 8031` in Terminal A; in Terminal B run both Playwright commands from Task 3 with the explicit `PLAYWRIGHT_MODULE`; then stop the server. Do not claim browser verification from a bare `node --test` command.
- [ ] Run the gated private replay from Task 4. Do not deploy if any hard gate fails.
- [ ] Write the dated release note with branch, final commit, files, user-visible behavior, commands/results, case counts, aggregate and per-case gate status, actual spend, scope, and what may become stale. Include no private sample content.
- [ ] Commit the release note and relevant implementation files only. Confirm `git status --short` has no unrelated changes.

### Task 7: Preview, production smoke, rollback, and private-data cleanup

- [ ] Before any production deployment, capture the current target with `vercel inspect pantry-mng.vercel.app --format=json` and record its immutable deployment ID/URL and commit hash in the release note as the rollback target.
- [ ] Deploy preview and test three authorized fixtures: supported multi-photo, ambiguous/weak image, different-product conflict. Confirm form behavior and consent/no-consent logs.
- [ ] Inspect preview generation metadata: actual model Qwen3-VL, fixed provider, `multi_evidence_v1`, and cost below `$0.001` per call.
- [ ] Deploy production only after preview and regression gates pass. Verify the deployment commit/hash and health endpoint/static page.
- [ ] Run one minimal authorized production multi-photo smoke and recheck review/usage rows, actual route, and cost. Avoid a broad paid full regression in production.
- [ ] If model route, privacy logging, UX outcome, or cost gate fails, run `vercel rollback <captured-prior-deployment-id-or-url> --yes`, then `vercel rollback status` and `vercel inspect pantry-mng.vercel.app --format=json`. Recheck page hash, basic health, one no-consent aggregate row, and absence of private payloads; document both deployment IDs and result.
- [ ] Push the feature branch and record the exact commit hash. Do not merge or push to `main` unless explicitly authorized.
- [ ] After retaining only the sanitized aggregate release metrics, delete the exact private artifacts created for this run: `/private/tmp/pantry-multiphoto-manifest.json`, `/private/tmp/pantry-multiphoto-split.json`, `/private/tmp/pantry-multiphoto-regression/`, and any explicitly recorded downloaded-image/response directories. Confirm each path is absent and `git status --short` contains no private or unrelated files.
