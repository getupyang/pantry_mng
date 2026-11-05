# Single-item Multi-photo Recognition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing single-product photo intake so one explicit recognition action jointly reads one to three camera or local photos, while preserving the current confirmation, save, order-screenshot, consent, and review workflows.

**Architecture:** Keep the repository's single-HTML application pattern. Add an in-memory photo-group state and collector UI in `pantry.html`, send repeated `image_url` entries through the existing proxy, validate image counts server-side, and serialize multi-image review samples backward-compatibly in the existing text column. No inventory or Supabase schema migration is required.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Vercel Node functions, Supabase/PostgREST, OpenRouter multimodal chat requests, Node test runner, Playwright Chromium.

---

## File map

- Modify `pantry.html`: segmented intake mode, photo collector, in-memory photo state, sequential preprocessing, multi-image request construction, conflict handling, retry/reset lifecycle, accessible/responsive styling.
- Modify `api/openrouter.js`: image extraction/count validation, request-type-specific limits, backward-compatible review-image serialization.
- Modify `api/admin/recognition-reviews.js`: normalize legacy single images and JSON-array image groups while retaining `imageDataUrl`.
- Modify `admin.html`: render all photos belonging to a recognition sample.
- Create `scripts/test-multiphoto-api.mjs`: pure proxy/admin contract tests.
- Create `scripts/test-multiphoto.cjs`: browser regression for collector, explicit recognition, retry, conflict, confirmation, and responsive layout.
- Modify `scripts/test-photo-live.cjs`: accept one to three image paths for an explicit real-model smoke.
- Create `scripts/test-photo-live-args.cjs`: dry tests for live-script path limits and proxy forwarding.
- Modify `scripts/dev-server.cjs`: forward recognition type and review-consent headers during local real-model verification.
- Create `docs/2026-10-07-single-item-multiphoto-release.md`: dated implementation, verification, deployment, and remaining-risk record.
- Keep `supabase/schema.sql` unchanged.

Use the isolated worktree `/private/tmp/pantry-multiphoto-design` on branch `codex/single-item-multiphoto`. Do not touch the unrelated dirty files in `/Users/getupyang/Documents/ai/coding/pantry_mng`.

### Task 1: Server multi-image contract and review serialization

**Files:**
- Create: `scripts/test-multiphoto-api.mjs`
- Modify: `api/openrouter.js` around `hasImage`, `findImageDataUrl`, `sanitizeVisionRequest`, and `createRecognitionReview`
- Modify: `api/admin/recognition-reviews.js` around `summarize`

- [ ] **Step 1: Write the failing proxy/admin contract test**

Create an ESM Node test that imports named pure helpers which do not exist yet:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeVisionRequest,
  extractImageDataUrls,
  serializeReviewImages,
} from '../api/openrouter.js';
import { normalizeReviewImages } from '../api/admin/recognition-reviews.js';

const image = n => ({type:'image_url', image_url:{url:`data:image/jpeg;base64,img${n}`}});
const request = count => ({
  messages:[{role:'user',content:[{type:'text',text:'identify'}, ...Array.from({length:count},(_,i)=>image(i+1))]}],
  model:'google/gemini-2.5-flash',
});

test('photo accepts one to three images and rejects zero or four', () => {
  assert.equal(sanitizeVisionRequest(request(1),'photo').error, undefined);
  assert.equal(sanitizeVisionRequest(request(3),'photo').error, undefined);
  assert.match(sanitizeVisionRequest(request(0),'photo').error, /1.*3/);
  assert.match(sanitizeVisionRequest(request(4),'photo').error, /1.*3/);
});

test('text that looks like a data URL is not an image entry', () => {
  const malformed={messages:[{role:'user',content:[{type:'text',text:'data:image/jpeg;base64,not-an-image-node'}]}],model:'google/gemini-2.5-flash'};
  assert.match(sanitizeVisionRequest(malformed,'photo').error,/1.*3/);
});

test('order remains a single screenshot', () => {
  assert.equal(sanitizeVisionRequest(request(1),'order').error, undefined);
  assert.match(sanitizeVisionRequest(request(2),'order').error, /one image/i);
});

test('review serialization keeps legacy single and round-trips groups', () => {
  const urls=extractImageDataUrls(request(3).messages);
  assert.equal(urls.length,3);
  assert.equal(serializeReviewImages(urls.slice(0,1)),urls[0]);
  assert.deepEqual(JSON.parse(serializeReviewImages(urls)),urls);
  assert.deepEqual(normalizeReviewImages(urls[0]),{imageDataUrl:urls[0],imageDataUrls:[urls[0]]});
  assert.deepEqual(normalizeReviewImages(JSON.stringify(urls)),{imageDataUrl:urls[0],imageDataUrls:urls});
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --experimental-default-type=module --test scripts/test-multiphoto-api.mjs
```

Expected: FAIL because the named helpers are not exported/implemented.

- [ ] **Step 3: Implement the smallest server helpers and validation**

In `api/openrouter.js`:

```js
export function extractImageDataUrls(value, found=[]) {
  if (!value) return found;
  if (Array.isArray(value)) value.forEach(item=>extractImageDataUrls(item,found));
  else if (typeof value === 'object') {
    if (value.type === 'image_url' && typeof value.image_url?.url === 'string' && value.image_url.url.startsWith('data:image/')) {
      found.push(value.image_url.url);
    } else Object.values(value).forEach(item=>extractImageDataUrls(item,found));
  }
  return found;
}

export function serializeReviewImages(urls) {
  if (!urls.length) return null;
  return urls.length === 1 ? urls[0] : JSON.stringify(urls);
}
```

Change `sanitizeVisionRequest(body, reqType='photo')` to count unique content entries and require `1..3` for `photo`, exactly one for `order`. Do not count the same nested node twice. Continue returning the sanitized body and model list.

In the request handler, derive `reqType` first and call `sanitizeVisionRequest(body, reqType)`. Add an assertion to the test source (or a focused source check) that prevents the handler from silently falling back to the `photo` default for order requests.

Replace the single-image review path with `imageDataUrls`, serializing only when consent is present. Keep the database column name `image_data_url`.

In `api/admin/recognition-reviews.js`, export:

```js
export function normalizeReviewImages(value) {
  if (!value) return {imageDataUrl:null,imageDataUrls:[]};
  let urls=[value];
  if (typeof value === 'string' && value.startsWith('[')) {
    try { const parsed=JSON.parse(value); if (Array.isArray(parsed)) urls=parsed; } catch {}
  }
  urls=urls.filter(url=>typeof url==='string'&&url.startsWith('data:image/'));
  return {imageDataUrl:urls[0]||null,imageDataUrls:urls};
}
```

Spread the normalized fields into `summarize(row)`.

- [ ] **Step 4: Run the API test and verify GREEN**

Run the command from Step 2.

Expected: all multi-image contract tests PASS with zero failures.

- [ ] **Step 5: Run existing server/static smoke**

Run:

```bash
node --test scripts/test-intake.cjs scripts/test-ios-expiry.cjs
```

Expected: 8 tests PASS.

- [ ] **Step 6: Commit Task 1 only**

```bash
git add api/openrouter.js api/admin/recognition-reviews.js scripts/test-multiphoto-api.mjs
git commit -m "Support multi-image recognition requests"
```

### Task 2: Client photo-group request and compression budget

**Files:**
- Create: `scripts/test-multiphoto-request.cjs`
- Modify: `pantry.html` around `compressImage`, `imageToBase64`, `buildVisionRequest`, and `recognizePhoto`

- [ ] **Step 1: Write a failing pure client-request test**

Follow the existing `vm` extraction pattern from `scripts/test-intake.cjs`. Provide a context with `OPENROUTER_CONFIG`, then assert:

```js
test('vision request contains every photo once and keeps order',()=>{
  const c=clientContext();
  const body=c.buildVisionRequest('prompt',['data:image/jpeg;base64,a','data:image/jpeg;base64,b'],700);
  const content=body.messages[0].content;
  assert.deepEqual(content.slice(1).map(x=>x.image_url.url),[
    'data:image/jpeg;base64,a','data:image/jpeg;base64,b'
  ]);
});

test('encoded request enforces the 6.5 MB client budget',()=>{
  const c=clientContext();
  assert.equal(c.isVisionRequestWithinBudget({messages:[]}),true);
  assert.equal(c.isVisionRequestWithinBudget({payload:'x'.repeat(6.6*1024*1024)}),false);
});
```

Also assert named compression constants: 1280 dimensions, quality `0.7`, minimum quality `0.4`, target `300 * 1024`, request budget `6.5 * 1024 * 1024`.

- [ ] **Step 2: Run and verify RED**

```bash
node --test scripts/test-multiphoto-request.cjs
```

Expected: FAIL because array request construction and budget helper do not exist.

- [ ] **Step 3: Implement named constants and array request construction**

Promote existing compression literals to constants near the image helpers:

```js
const IMAGE_MAX_WIDTH=1280;
const IMAGE_MAX_HEIGHT=1280;
const IMAGE_INITIAL_QUALITY=0.7;
const IMAGE_MIN_QUALITY=0.4;
const IMAGE_TARGET_BYTES=300*1024;
const VISION_REQUEST_BUDGET_BYTES=Math.floor(6.5*1024*1024);
```

Change `buildVisionRequest(prompt,base64Urls,maxTokens)` to validate an array and append one `image_url` item per URL. Keep `recognizeOrder` calling it with `[base64Url]`.

Add:

```js
function isVisionRequestWithinBudget(body){
  return new TextEncoder().encode(JSON.stringify(body)).byteLength<=VISION_REQUEST_BUDGET_BYTES;
}
```

Pass the host `TextEncoder` into the VM test context so the same UTF-8 calculation runs in Node and the browser.

Change `recognizePhoto(imageFiles)` to preprocess files sequentially, build a single request, reject locally with a clear message if over budget, and make one fetch. Extend the prompt/JSON schema with `sameProduct` and `conflictReason`.

- [ ] **Step 4: Run and verify GREEN**

Run the request test from Step 2.

Expected: all tests PASS.

- [ ] **Step 5: Run parser/date regression**

```bash
node --test scripts/test-intake.cjs scripts/test-ios-expiry.cjs scripts/test-multiphoto-request.cjs
```

Expected: all tests PASS.

- [ ] **Step 6: Commit Task 2 only**

```bash
git add pantry.html scripts/test-multiphoto-request.cjs
git commit -m "Build joint single-item photo requests"
```

### Task 3: Intake mode selector and photo collector UI

**Files:**
- Create: `scripts/test-multiphoto.cjs`
- Modify: `pantry.html` in intake CSS, `#scr-add`, `createFileInput`, `doScan`, `cancelScan`, and `nav`

- [ ] **Step 1: Write the failing browser collector test**

Use Playwright from `/Users/getupyang/.agents/skills/gstack/node_modules/playwright`. Route API calls and prevent real cloud/model writes. The test must:

```js
await page.evaluate(()=>nav('scr-add'));
assert.equal(await page.getByRole('button',{name:'单件商品'}).getAttribute('aria-pressed'),'true');
await page.evaluate(()=>addPendingPhotos([
  new File(['a'],'front.jpg',{type:'image/jpeg'}),
  new File(['b'],'back.jpg',{type:'image/jpeg'})
]));
assert.equal(await page.locator('.pending-photo').count(),2);
assert.equal(recognitionCalls,0,'adding photos must not recognize');
assert.equal(await page.getByRole('button',{name:'开始识别'}).isEnabled(),true);
```

Continue with a third file, attempt a fourth, remove one, and assert the add control returns. Switch to `多件商品` and assert the existing order-screenshot card is available while physical batch is visibly unavailable and not clickable. Switch back and verify the default single-item structure.

Add one valid image plus one unreadable/non-image file and assert the valid thumbnail remains while the rejected filename receives an individual visible error; a bad file must not roll back already accepted files.

- [ ] **Step 2: Start the static server and verify RED**

Terminal A:

```bash
python3 -m http.server 8031
```

Terminal B:

```bash
PLAYWRIGHT_MODULE=/Users/getupyang/.agents/skills/gstack/node_modules/playwright node scripts/test-multiphoto.cjs
```

Expected: FAIL because mode buttons, collector DOM, and state helpers do not exist.

- [ ] **Step 3: Implement collector markup, state, and accessible styling**

Add:

```js
const MAX_SINGLE_ITEM_PHOTOS=3;
let pendingPhotos=[];
let photoRecognitionBusy=false;
```

Implement focused helpers:

```js
function setIntakeMode(mode) {}
function addPendingPhotos(files) {}
function removePendingPhoto(id) {}
function renderPendingPhotos() {}
function clearPendingPhotos() {}
function startPendingPhotoRecognition() {}
```

`addPendingPhotos` appends up to remaining slots, creates object URLs, and reports ignored extras. `clearPendingPhotos` revokes every URL. `renderPendingPhotos` is the only function that writes collector markup and button state.

Update `createFileInput` so photo collection sets `multiple=true` and passes `Array.from(e.target.files||[])`; order screenshot remains single-file. Picker cancellation must not call `cancelScan` in a way that clears existing pending photos.

Keep the current photo entry card: tapping it opens the chooser and adds to the group but does not show the scan overlay or call the model. Add explicit `添加照片` and `开始识别` controls in the collector.

Add the segmented control. In `多件商品`, show the existing order screenshot action and a non-interactive message for future physical batch intake. Default to single every time a fresh add flow opens.

- [ ] **Step 4: Run browser test and verify GREEN for collection behavior**

Run the browser test from Step 2.

Expected: all collection and mode assertions written in Task 3 PASS with no syntax or runtime errors. Recognition lifecycle assertions are added only in Task 4.

- [ ] **Step 5: Check responsive overflow**

In the browser test, loop over `320`, `390`, and `1280` widths and assert mode buttons, thumbnails, and collector actions remain within the viewport.

- [ ] **Step 6: Commit Task 3 only**

```bash
git add pantry.html scripts/test-multiphoto.cjs
git commit -m "Add single-item photo collection UI"
```

### Task 4: Explicit recognition, conflict handling, retry, and lifecycle cleanup

**Files:**
- Modify: `scripts/test-multiphoto.cjs`
- Modify: `pantry.html` around `startPendingPhotoRecognition`, `fillRecognitionResult`, `confirmAdd`, `cancelScan`, `nav`, and recognition-review state

- [ ] **Step 1: Extend the browser test for one explicit request**

Route `/api/openrouter` and count requests. Return a successful response whose content contains `sameProduct:true`. Assert:

- adding two files causes zero requests;
- a double click or two near-simultaneous calls creates exactly one request;
- request JSON has two `image_url` entries;
- controls lock while pending;
- success fills the existing confirmation form;
- the read-only thumbnail strip remains visible;
- `重新选择照片` returns to collection and marks an unaccepted review discarded;
- saving clears pending files and revokes previews.

- [ ] **Step 2: Run and verify RED**

Run the browser test.

Expected: FAIL on explicit recognition/lifecycle assertions.

- [ ] **Step 3: Implement busy guard and success lifecycle**

`startPendingPhotoRecognition` must:

1. Return immediately if busy or empty.
2. Set busy and render locked controls.
3. Show the existing scan overlay only after the explicit start action.
4. Call `recognizePhoto(pendingPhotos.map(x=>x.file))` once.
5. Preserve files on failure.
6. On success, call `fillRecognitionResult`, retain a read-only thumbnail strip, and unlock only the appropriate retry/reselect action.
7. Clear busy in `finally`.

Update recognition analytics explicitly:

- `scan_start`: `reqType`, `imageCount`, total selected bytes, and whether the picker returned one or multiple files.
- `scan_success`: existing result metadata plus `imageCount` and total encoded request bytes.
- `scan_error`: existing truncated message plus `imageCount` and a bounded `failureCategory` from `too_large`, `mixed_product`, `network`, `timeout`, `parse`, or `unknown`.
- Never include filenames or image contents in analytics properties.

After `confirmAdd` successfully saves a photo item, call `clearPendingPhotos`. Also clear on a genuine fresh intake or navigation away after the user has abandoned the attempt; do not clear on picker cancel or retryable error.

- [ ] **Step 4: Add mixed-product RED test**

Change the mocked response to `sameProduct:false, conflictReason:'正面和背面品牌不同'`. Assert no form fields are populated from a merged result, all thumbnails remain, and the visible message tells the user to remove the unrelated photo.

- [ ] **Step 5: Implement minimal conflict guard and verify GREEN**

Guard before `fillRecognitionResult`:

```js
if (result.sameProduct === false) {
  showError(result.conflictReason || '这些照片可能不属于同一件商品，请删除不相关照片后重试');
  return;
}
```

Run the complete browser test. Expected: all collector, success, retry, conflict, cleanup, and responsive assertions PASS with no `pageerror` events.

- [ ] **Step 6: Run touched suites**

```bash
node --test scripts/test-intake.cjs scripts/test-ios-expiry.cjs scripts/test-multiphoto-request.cjs
PLAYWRIGHT_MODULE=/Users/getupyang/.agents/skills/gstack/node_modules/playwright node scripts/test-multiphoto.cjs
```

Expected: all tests PASS.

- [ ] **Step 7: Commit Task 4 only**

```bash
git add pantry.html scripts/test-multiphoto.cjs
git commit -m "Complete multi-photo recognition lifecycle"
```

### Task 5: Admin review gallery for multi-photo samples

**Files:**
- Modify: `admin.html` around `.review-img` and `renderRecognitionReviews`
- Modify: `scripts/test-multiphoto.cjs`

- [ ] **Step 1: Add a failing admin browser test**

Route `/api/admin/recognition-reviews` to return one row with two `imageDataUrls` and legacy `imageDataUrl` set to the first. Open `admin.html`, provide a test token through the page's existing control, load reviews, and assert the sample card renders exactly two images in one group.

- [ ] **Step 2: Run and verify RED**

Run the Playwright suite.

Expected: FAIL because the admin currently renders only `imageDataUrl`.

- [ ] **Step 3: Implement the smallest grouped gallery**

Render `row.imageDataUrls` when present, else fall back to `[row.imageDataUrl]`. Add a compact `.review-images` grid that supports one to three images and retains the existing empty-image state. Give each image an indexed alt label.

- [ ] **Step 4: Run and verify GREEN**

Run:

```bash
PLAYWRIGHT_MODULE=/Users/getupyang/.agents/skills/gstack/node_modules/playwright node scripts/test-multiphoto.cjs
node --experimental-default-type=module --test scripts/test-multiphoto-api.mjs
```

Expected: multi-photo admin and API compatibility tests PASS.

- [ ] **Step 5: Commit Task 5 only**

```bash
git add admin.html scripts/test-multiphoto.cjs
git commit -m "Show recognition photo groups in admin"
```

### Task 6: Regression, preview smoke, documentation, and production release

**Files:**
- Modify: `scripts/test-photo-live.cjs`
- Modify: `scripts/dev-server.cjs`
- Create: `scripts/test-photo-live-args.cjs`
- Create: `docs/2026-10-07-single-item-multiphoto-release.md`
- Modify only if needed: `README.md`

- [ ] **Step 1: Write a failing live-script argument test or dry-run assertion**

Export or isolate live-script argument parsing so one to three paths are accepted before optional flags, and four paths fail. Test it in `scripts/test-photo-live-args.cjs` without making network requests.

In the same test file, add a focused proxy source assertion that `scripts/dev-server.cjs` forwards `x-recognition-type` and `x-review-consent` in addition to the existing content/client/family headers.

- [ ] **Step 2: Verify RED, implement, and verify GREEN**

Update the script to select multiple files in the single-item collector, click `开始识别`, confirm one item, and preserve its existing independent family/readback checks. Capture the returned recognition-review ID. Require `PANTRY_ADMIN_TOKEN` for the preview/production live smoke and query `/api/admin/recognition-reviews` to assert that the matching row exposes two `imageDataUrls`; this check is automated and must fail the smoke if the token is absent or the row is incomplete. Update `scripts/dev-server.cjs` to forward `x-recognition-type` and `x-review-consent`. Run the dry argument and proxy-header tests and verify PASS.

```bash
node --test scripts/test-photo-live-args.cjs
```

- [ ] **Step 3: Run the complete local verification layer**

Start the static server on port 8031, then run:

```bash
node --experimental-default-type=module --test scripts/test-multiphoto-api.mjs
node --test scripts/test-intake.cjs scripts/test-ios-expiry.cjs scripts/test-multiphoto-request.cjs scripts/test-photo-live-args.cjs
PLAYWRIGHT_MODULE=/Users/getupyang/.agents/skills/gstack/node_modules/playwright node scripts/test-multiphoto.cjs
PLAYWRIGHT_MODULE=/Users/getupyang/.agents/skills/gstack/node_modules/playwright node scripts/test-package-type.cjs
git diff --check
```

Expected: zero failures and no browser runtime errors. This is smoke plus touched suites; it is sufficient because there is no schema change and persistence uses the unchanged item shape. Do not claim full product regression.

- [ ] **Step 4: Commit the completed implementation before any Vercel deployment**

```bash
git status --short --branch
git add scripts/test-photo-live.cjs scripts/test-photo-live-args.cjs scripts/dev-server.cjs README.md
git commit -m "Verify live multi-photo intake"
```

Stage `README.md` only if it actually changed. Confirm no unrelated files are staged. All product/API/admin changes are already committed by Tasks 1-5.

- [ ] **Step 5: Push the feature branch**

```bash
git push -u origin codex/single-item-multiphoto
git ls-remote origin refs/heads/codex/single-item-multiphoto
```

Expected: remote hash equals local `HEAD`.

- [ ] **Step 6: Deploy a preview of the new API and run controlled real-model smoke**

The existing local dev proxy targets the current production API and therefore cannot validate the new multi-image server contract before release. Bind the isolated worktree to the existing project and create a non-production preview:

```bash
vercel link --project pantry-mng --yes
vercel deploy --yes
```

Stop if Vercel attempts to create or bind a different project. Capture the returned preview URL.

Use two non-private controlled photos of the same synthetic or test product, one with name/specification and one with expiry, then run the live script directly against the preview:

```bash
PANTRY_BASE_URL=https://<captured-preview-url> PLAYWRIGHT_MODULE=/Users/getupyang/.agents/skills/gstack/node_modules/playwright node scripts/test-photo-live.cjs /absolute/front.jpg /absolute/expiry.jpg
```

Verify one request includes both images, combined fields appear, the review row contains two images, confirmation saves one item, independent GET reads it back, and refresh preserves it. Then use a deliberately mismatched pair and verify no item is merged or saved. Keep fixtures and private results out of Git.

- [ ] **Step 7: Promote the verified code to production**

The worktree is now explicitly bound and the preview has passed the new API path. Deploy production:

```bash
vercel deploy --prod --yes
```

Expected: output says `Deploying .../pantry-mng` and aliases the result to `https://pantry-mng.vercel.app`. Stop if Vercel attempts to create a different project.

- [ ] **Step 8: Verify the live artifact and production behavior**

Download `https://pantry-mng.vercel.app/pantry.html`, confirm multi-photo markers, and compare its SHA-256 with local `pantry.html`. Run the two-photo live smoke against `PANTRY_BASE_URL=https://pantry-mng.vercel.app`. Record API recognition, browser flow, cloud persistence, and true-device Safari as separate verification layers.

- [ ] **Step 9: Write and commit the dated release record**

Create `docs/2026-10-07-single-item-multiphoto-release.md` with:

- implementation date and branch;
- the implementation commit hash that the release describes; the documentation commit hash is reported in the final delivery after that commit exists, avoiding a self-referential hash;
- affected files and user-visible behavior;
- exact verification commands and counts;
- deployment ID, production URL, and live/local hash;
- no schema migration and no backend restart requirement;
- true-device Safari status and remaining risk;
- explicit statement that unrelated original-worktree changes were excluded.

Commit and push:

```bash
git add docs/2026-10-07-single-item-multiphoto-release.md
git commit -m "Document multi-photo production release"
git push
```

- [ ] **Step 10: User acceptance on iPhone Safari**

Ask the user to refresh the production page, choose `单件商品`, add one camera photo plus one local photo, remove/re-add a thumbnail, tap `开始识别` once, review the combined result, and save. Expected: one inventory item, no early recognition, and no lost photos during retry. This is the only layer that closes true-device acceptance.
