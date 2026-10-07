# Single-item multi-photo recognition

记录时间：2026-10-07（KST）

## Goal

Upgrade the existing single-product photo-recognition flow from one image to a group of one to three images. The user may take photos or choose local photos, reviews the collected thumbnails, and explicitly starts one joint recognition request. Everything after recognition continues through the existing confirmation and save flow.

The primary use case is one product whose name/specification and expiry date appear on different sides of the package.

## Confirmed product decisions

- The final intake information architecture distinguishes `单件商品` and `多件商品`, defaulting to `单件商品`.
- Phase 1 implements multi-photo recognition for a single physical product.
- Phase 2 will implement multi-product physical-photo intake. It is not part of this specification.
- The existing order-screenshot batch import remains available and unchanged.
- A single-product group contains at least one and at most three photos.
- Adding a photo never starts recognition. Recognition begins only when the user taps `开始识别`.
- Camera capture and local photo selection both append to the same pending group.
- The images are sent as separate images in one model request. They are not stitched into a contact sheet and are not recognized independently.
- With the user's existing recognition-review consent, compressed photos continue to be retained for debugging together with the model output and accepted values. Original device files are never stored.
- The existing first-use recognition-review consent remains. No additional disclosure copy is added.

## Scope boundaries

### In scope

- A `单件商品 / 多件商品` segmented control on the intake screen, defaulted to `单件商品`.
- The single-item photo collector, thumbnail removal, one-to-three-photo validation, joint recognition, retry, and reset behavior.
- Multi-image request validation in the server proxy.
- Backward-compatible retention and admin display of multi-image recognition-review samples.
- Focused regression coverage and one real two-image recognition smoke before production release.

### Out of scope

- Grouping photos for multiple physical products.
- Automatically splitting a group photo into multiple inventory items.
- A multi-item queue or save-all action.
- Changes to the inventory item schema or family-data schema.
- Automatic package-type inference.
- Reworking the existing order-screenshot recognition flow.

In Phase 1, switching to `多件商品` exposes the existing order-screenshot batch entry and clearly marks physical-product batch photography as a later capability. It must not present a clickable control that appears functional but is not implemented.

## User experience

### Entry and mode selection

The intake screen opens in `单件商品`. The current `拍照识别` card remains the entry point, so the workflow feels like the current single-photo flow rather than a new tool.

Entering single-item photo recognition opens a photo-collection state:

1. An empty photo area offers `添加照片`.
2. The browser's normal image chooser remains responsible for offering camera capture and local photos. No forced `capture` mode removes either source.
3. Every returned file is appended until the three-photo limit is reached. Direct camera capture commonly returns one file, so the user can reopen the chooser and continue. A supporting browser may return multiple selected library files in one operation.
4. Selected images appear as thumbnails with a remove control. Order is preserved but has no semantic meaning.
5. `开始识别` is disabled when the group is empty and enabled with one to three photos.
6. At three photos, the add control is hidden or disabled. Removing a photo makes it available again.
7. Tapping `开始识别` locks add/remove controls and starts exactly one recognition attempt.

On success, the existing recognition confirmation form is populated. The thumbnail strip remains visible as read-only context, with a `重新选择照片` action that discards the current recognition attempt and returns to collection. The existing manual edits, package-type selection, open/stock state, location, and save behavior remain unchanged.

Saving, abandoning the intake, or starting a new intake clears the pending photo group and revokes every object URL.

## Client state and processing

The browser maintains an in-memory collection similar to:

```js
pendingPhotos = [
  { id, file, objectUrl }
]
```

The files are not written to local storage or family data. Object URLs exist only for previews.

When recognition starts, photos are preprocessed sequentially to reduce peak memory use on iOS Safari. Each file follows the existing HEIC conversion, orientation handling, canvas resize, and JPEG compression path. The group compressor then checks the encoded request budget and reduces image dimensions/quality as needed. The complete JSON request should remain below a conservative 6.5 MB client budget, leaving room beneath the proxy's 7 MB hard limit. If the group cannot fit while retaining the configured minimum quality, the client stops before networking and asks the user to remove or retake a photo.

The UI keeps the original `File` objects and previews until the attempt succeeds or the user leaves. A network, timeout, parse, or upstream error therefore permits retry without another photo-selection step.

## Model request and response

`buildVisionRequest` accepts an array of one to three data URLs. Its user content contains one text prompt followed by one `image_url` entry per photo.

The prompt states that every image is expected to show the same product and instructs the model to combine complementary evidence across images. The JSON response extends the current product fields with:

```json
{
  "sameProduct": true,
  "conflictReason": ""
}
```

If the images appear to show different products, the model returns `sameProduct: false`, explains the conflict briefly, and must not synthesize one product from conflicting evidence. The client then returns to the photo group, preserves all thumbnails, and asks the user to remove the unrelated photo before retrying.

If `sameProduct` is true but some fields remain uncertain, the existing `missingFields` flow applies and the user may complete them manually.

The model's boolean is a safety signal rather than proof. No inventory item is created until the user reviews and confirms the populated form.

## Server validation and review samples

The proxy counts `image_url` entries rather than only checking whether at least one exists.

- `photo` recognition accepts one to three images.
- `order` recognition continues to accept the existing single screenshot.
- Zero images or too many images returns a 400 response with a user-actionable message.
- The existing 7 MB request-body limit, identity checks, model allowlist, usage limits, and error recording remain in force.

When recognition-review consent is present, the proxy extracts all compressed image data URLs. To avoid a database migration, `pantry_recognition_reviews.image_data_url` remains a text column:

- Existing and new one-photo samples may remain a plain data URL.
- A multi-photo sample is stored as a JSON-encoded array of data URLs.
- The admin API normalizes both representations to `imageDataUrls: string[]` while retaining compatibility for consumers that still read the first image.
- Admin review renders each image in the group and makes the group boundary visible.

The review record continues to retain model response, parsed result, accepted data, edited fields, outcome, and error code. Original uncompressed device files are never retained.

## Failure and cancellation behavior

- Picker cancellation leaves the existing pending group unchanged.
- Unsupported or unreadable files are reported individually; valid files already selected remain available.
- Selecting more files than the remaining slots adds only up to the limit and reports which extras were not added.
- Recognition controls are locked only while a request is active.
- Network, timeout, server, and parse failures preserve the group and offer retry.
- A request that produces no usable fields preserves the group and offers retry or manual entry.
- A `sameProduct: false` response preserves the group and does not populate a merged confirmation form.
- Leaving the flow marks an unaccepted recognition review as discarded through the existing mechanism.
- Double taps on `开始识别` cannot create duplicate requests.

## Accessibility and layout

- The segmented control exposes selected state through `aria-pressed` or equivalent semantics.
- Thumbnail remove controls have photo-specific accessible labels.
- The photo grid and controls must fit at 320 px, 390 px, and desktop widths without horizontal overflow.
- Loading, error, photo-count, and disabled-button states are expressed in text as well as color.
- The UI follows the existing spacing, typography, button, surface, and status styles; no decorative color system is introduced.

## Analytics

Existing recognition events remain, with non-sensitive metadata added where useful:

- `imageCount`
- total selected bytes before preprocessing
- total encoded bytes sent
- whether selection came back as one file or multiple files
- failure category such as `too_large`, `mixed_product`, `network`, or `parse`

Image contents and filenames are not placed in analytics event properties.

## Verification plan

### Automated smoke and touched suite

- HTML scripts parse without runtime syntax errors.
- The collector accepts one, two, and three files.
- A fourth file is not added; deleting one re-enables addition.
- Camera-style sequential additions and library-style multi-file additions produce the same group state.
- Adding files never calls the recognition endpoint.
- One tap on `开始识别` sends exactly one request containing every selected image once.
- Zero-image and four-image proxy requests are rejected; valid photo and existing order requests are accepted.
- Picker cancellation and failed requests preserve existing thumbnails.
- Successful recognition populates the existing form; saving clears files and object URLs.
- `sameProduct: false` does not populate a merged item.
- Single-image and JSON-array recognition-review rows both normalize and render.
- Existing intake/date tests, package-type browser tests, and order progression tests continue to pass.
- Responsive checks cover 320, 390, and 1280 px widths.

### Release verification

- Run smoke plus the touched multi-photo/browser/API suites. Full regression is reserved for shared parsing or persistence changes beyond this design.
- Use a controlled pair of photos of the same product for one real model smoke and verify the combined fields, review record, confirmation, save, independent cloud readback, and refresh.
- Run a controlled mismatched-photo smoke and verify that no item is silently merged or saved.
- Confirm the production HTML matches the deployed local artifact.
- Treat true-device Safari selection/camera behavior as a separate acceptance layer. On iPhone Safari, verify one camera photo plus one locally selected photo, thumbnail removal, one explicit recognition action, retry preservation, and final save.

## Phase 2 compatibility

The reusable unit for future physical-product batch intake is a photo group that produces one candidate item. Phase 2 can create a queue of such groups and add batch review/save without changing the Phase 1 recognition contract. This specification intentionally does not define queue limits, automatic grouping, concurrency, or batch-save semantics; those require separate testing and product decisions.

## Release and documentation

Implementation will occur on the isolated `codex/single-item-multiphoto` branch/worktree. Only task-related files will be staged. A dated release note will identify the implementation commit, files, verification commands, production deployment ID, live artifact hash, remaining true-device risk, and whether any database or backend restart was required.
