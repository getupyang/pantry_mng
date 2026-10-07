// Explicit live smoke: uploads one to three photos and persists one item in a new test family.
// PANTRY_BASE_URL=https://preview.example PANTRY_ADMIN_TOKEN=... \
// PLAYWRIGHT_MODULE=/path/to/playwright node scripts/test-photo-live.cjs /path/front.jpg /path/expiry.jpg
const fs = require('node:fs/promises');
const { constants: fsConstants } = require('node:fs');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

async function validateImagePaths(args) {
  if (!Array.isArray(args) || args.length < 1 || args.length > 3) {
    throw new Error('Live photo smoke requires 1 to 3 image paths');
  }
  const imagePaths = args.map(value => String(value));
  for (const imagePath of imagePaths) {
    if (!imagePath.trim()) throw new Error('Image paths must be non-empty');
    if (imagePath.startsWith('-')) throw new Error(`Image path must not be flag-like: ${imagePath}`);
    let stat;
    try {
      await fs.access(imagePath, fsConstants.R_OK);
      stat = await fs.stat(imagePath);
    } catch (error) {
      throw new Error(`Image path does not exist or cannot be read: ${imagePath}`, { cause: error });
    }
    if (!stat.isFile()) throw new Error(`Image path must be a regular file: ${imagePath}`);
  }
  return imagePaths;
}

function parseAdminToken(value) {
  const token = String(value || '').trim();
  if (!token) throw new Error('PANTRY_ADMIN_TOKEN is required for every live smoke');
  return token;
}

function parseExpectedPackageSize(value) {
  if (value === undefined || value === null || value === '') return null;
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('PANTRY_EXPECTED_PACKAGE_SIZE must be a positive number');
  }
  return size;
}

function parseExpectedConflict(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'no') return false;
  if (normalized === 'yes') return true;
  throw new Error('PANTRY_EXPECT_CONFLICT must be yes or no');
}

async function createEvidencePaths() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pantry-live-'));
  return {
    directory,
    evidence: path.join(directory, 'evidence.json'),
    screenshot: path.join(directory, 'travel.png')
  };
}

async function assertSuccessfulResponse(response, label) {
  const status = response.status();
  const body = await response.text();
  assert.equal(status, 200, `${label} returned HTTP ${status}; body: ${body}`);
  return { status, body };
}

function verifyAdminReview(payload, familyId, reviewId, imageCount) {
  const review = payload.reviews?.find(candidate => (
    candidate.id === reviewId && candidate.familyId === familyId
  ));
  assert.ok(review, `recognition review ${reviewId} for family ${familyId} was not returned by the admin API`);
  assert.equal(
    review.imageDataUrls?.length,
    imageCount,
    `recognition review ${reviewId} does not contain all supplied images`
  );
  return review;
}

async function main() {
  const imagePaths = await validateImagePaths(process.argv.slice(2));
  const baseURL = process.env.PANTRY_BASE_URL || 'http://127.0.0.1:8031';
  const adminToken = parseAdminToken(process.env.PANTRY_ADMIN_TOKEN);
  const expectedPackageSize = parseExpectedPackageSize(process.env.PANTRY_EXPECTED_PACKAGE_SIZE);
  const expectConflict = parseExpectedConflict(process.env.PANTRY_EXPECT_CONFLICT);
  if (expectConflict && imagePaths.length < 2) {
    throw new Error('PANTRY_EXPECT_CONFLICT=yes requires 2 to 3 mismatched image paths');
  }
  const evidencePaths = await createEvidencePaths();

  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const proxy = baseURL.startsWith('https:') && process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY }
    : undefined;
  const browser = await chromium.launch({ headless: true, proxy });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    const responses = [];
    let recognitionRequests = 0;
    let familyPutRequests = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/openrouter') recognitionRequests += 1;
      if (request.method() === 'PUT' && new URL(request.url()).pathname.startsWith('/api/families/')) familyPutRequests += 1;
    });
    page.on('response', response => {
      if (response.url().includes('/api/')) {
        responses.push({ path: new URL(response.url()).pathname, status: response.status() });
      }
    });
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.goto(baseURL + '/pantry.html?from=codex-live-test');
    await page.waitForFunction(() => cloudReady, {}, { timeout: 60000 });
    console.log('Cloud initialized in isolated browser');
    await page.evaluate(() => nav('scr-add'));
    await page.getByRole('button', { name: '单件商品', exact: true }).click();

    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('#photo-intake-entry').click();
    if (await page.getByRole('button', { name: '同意并继续' }).isVisible()) {
      await page.getByRole('button', { name: '同意并继续' }).click();
    }
    await (await chooserPromise).setFiles(imagePaths);
    await page.waitForFunction(
      count => document.querySelectorAll('.pending-photo').length === count,
      imagePaths.length
    );
    assert.equal(await page.locator('.pending-photo').count(), imagePaths.length);
    assert.equal(recognitionRequests, 0, 'photos must not call recognition before explicit start');

    await page.locator('#start-photo-recognition').click();
    if (expectConflict) {
      await page.waitForFunction(() => (
        photoRecognitionBusy === false &&
        document.getElementById('pending-photo-error').textContent.trim().length > 0
      ), {}, { timeout: 180000 });
      assert.equal(recognitionRequests, 1, 'one recognition request combines the mismatched photos');
      assert.equal(await page.locator('#recog-result').isHidden(), true, 'conflict must not expose a merged confirmation form');
      assert.match(await page.locator('#pending-photo-error').innerText(), /不同|冲突|无法确认|同一|移除|重试/);
      const reviewId = await page.evaluate(() => _currentRecognitionReviewId);
      assert.ok(reviewId, 'conflict recognition response did not include a review ID');
      assert.equal(familyPutRequests, 0, 'conflict smoke must not save or PUT family data');
      const evidence = await page.evaluate(async () => {
        const response = await fetch('/api/families/' + pantryFamilyId, {
          headers: { 'X-Client-Id': getOrCreateClientId() }
        });
        return {
          status: response.status,
          server: await response.json(),
          clientId: getOrCreateClientId(),
          familyId: pantryFamilyId,
          local: JSON.parse(localStorage.getItem(PANTRY_ITEMS_KEY) || '[]')
        };
      });
      assert.equal(evidence.status, 200);
      assert.equal(evidence.server.data.items.length, 0, 'conflict family must remain empty');
      assert.equal(evidence.local.length, 0, 'conflict local state must remain empty');
      const adminResponse = await page.request.get(
        baseURL + '/api/admin/recognition-reviews?familyId=' + encodeURIComponent(evidence.familyId) + '&limit=80',
        { headers: { 'X-Admin-Token': adminToken } }
      );
      const adminResult = await assertSuccessfulResponse(adminResponse, 'admin recognition-review GET');
      const adminPayload = JSON.parse(adminResult.body);
      verifyAdminReview(adminPayload, evidence.familyId, reviewId, imagePaths.length);
      await page.screenshot({ path: evidencePaths.screenshot, animations: 'disabled' });
      assert.deepEqual(errors, []);
      await fs.writeFile(
        evidencePaths.evidence,
        JSON.stringify({ mode: 'expected-conflict', reviewId, imageCount: imagePaths.length, ...evidence, responses, errors }, null, 2)
      );
      console.log(`PASS expected conflict for ${imagePaths.length} photos, no merge/save, empty family, exact review image count; evidence ${evidencePaths.evidence}; screenshot ${evidencePaths.screenshot}`);
      return;
    }
    await page.locator('#recog-result').waitFor({ state: 'visible', timeout: 180000 });
    assert.equal(recognitionRequests, 1, 'one recognition request combines all supplied photos');
    const reviewId = await page.evaluate(() => _currentRecognitionReviewId);
    assert.ok(reviewId, 'recognition response did not include a review ID');
    const recognized = await page.evaluate(() => ({
      name: document.getElementById('fi-name').value,
      brand: document.getElementById('fi-brand').value,
      size: document.getElementById('fi-size').value,
      expiry: document.getElementById('fi-exp').value,
      packageType: document.getElementById('fi-package-type').value
    }));
    console.log('Recognized:', JSON.stringify(recognized));
    const recognizedPackageSize = Number(recognized.size);
    assert.equal(Number.isFinite(recognizedPackageSize) && recognizedPackageSize > 0, true, 'recognized package size must be a positive number');
    if (expectedPackageSize !== null) {
      assert.equal(recognizedPackageSize, expectedPackageSize, 'recognized package size differs from PANTRY_EXPECTED_PACKAGE_SIZE');
    }
    assert.equal(recognized.packageType, '', 'type remains user-controlled');
    await page.locator('#fi-package-type').selectOption('travel');
    const savedPromise = page.waitForResponse(
      response => response.request().method() === 'PUT' && response.url().includes('/api/families/'),
      { timeout: 60000 }
    );
    await page.getByRole('button', { name: '确认录入 →', exact: true }).click();
    const savedResponse = await savedPromise;
    const saveResult = await assertSuccessfulResponse(savedResponse, 'family PUT');
    console.log('Family PUT:', JSON.stringify(saveResult));

    const evidence = await page.evaluate(async () => {
      const response = await fetch('/api/families/' + pantryFamilyId, {
        headers: { 'X-Client-Id': getOrCreateClientId() }
      });
      const server = await response.json();
      return {
        status: response.status,
        server,
        clientId: getOrCreateClientId(),
        familyId: pantryFamilyId,
        local: JSON.parse(localStorage.getItem(PANTRY_ITEMS_KEY))
      };
    });
    assert.equal(evidence.status, 200);
    assert.equal(evidence.server.data.items.length, 1, 'live smoke must save exactly one item');
    assert.equal(evidence.local.length, 1, 'local state must contain exactly one item');
    const saved = evidence.server.data.items[0];
    assert.equal(saved.packageType, 'travel');
    assert.equal(saved.packageSize, recognizedPackageSize, 'server read-back size must match recognized size');
    assert.equal(evidence.local[0].packageType, 'travel');
    assert.equal(evidence.local[0].packageSize, recognizedPackageSize, 'local read-back size must match recognized size');

    const adminResponse = await page.request.get(
      baseURL + '/api/admin/recognition-reviews?familyId=' + encodeURIComponent(evidence.familyId) + '&limit=80',
      { headers: { 'X-Admin-Token': adminToken } }
    );
    const adminResult = await assertSuccessfulResponse(adminResponse, 'admin recognition-review GET');
    let adminPayload;
    try {
      adminPayload = JSON.parse(adminResult.body);
    } catch (error) {
      throw new Error(`admin recognition-review GET returned invalid JSON: ${adminResult.body}`, { cause: error });
    }
    verifyAdminReview(adminPayload, evidence.familyId, reviewId, imagePaths.length);

    await page.evaluate(() => switchTab(1));
    await page.getByRole('button', { name: '旅行装', exact: true }).click();
    assert.equal(await page.locator('.gcard').count(), 1);
    await page.reload();
    await page.waitForFunction(() => cloudReady);
    await page.evaluate(() => switchTab(1));
    assert.equal(await page.locator('.gcard').count(), 1);
    assert.equal(await page.getByRole('button', { name: '旅行装', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: '正装', exact: true }).click();
    assert.equal(await page.locator('.gcard').count(), 0);
    await page.getByRole('button', { name: '旅行装', exact: true }).click();
    await page.screenshot({ path: evidencePaths.screenshot, animations: 'disabled' });
    assert.deepEqual(errors, []);
    await fs.writeFile(
      evidencePaths.evidence,
      JSON.stringify({ recognized, reviewId, imageCount: imagePaths.length, ...evidence, responses, errors }, null, 2)
    );
    console.log(`PASS ${imagePaths.length} photo(s), one recognition request, exact family/review image count, one-item save, independent GET, local storage, reload and filters; evidence ${evidencePaths.evidence}; screenshot ${evidencePaths.screenshot}`);
  } finally {
    await browser.close();
  }
}

module.exports = {
  assertSuccessfulResponse,
  createEvidencePaths,
  parseAdminToken,
  parseExpectedConflict,
  parseExpectedPackageSize,
  validateImagePaths,
  verifyAdminReview
};

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
