// Explicit live smoke: uploads one to three photos and persists one item in a new test family.
// PANTRY_BASE_URL=https://preview.example PANTRY_ADMIN_TOKEN=... \
// PLAYWRIGHT_MODULE=/path/to/playwright node scripts/test-photo-live.cjs /path/front.jpg /path/expiry.jpg
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');

function parseImagePaths(args) {
  if (!Array.isArray(args) || args.length < 1 || args.length > 3) {
    throw new Error('Live photo smoke requires 1 to 3 image paths');
  }
  return args.map(value => String(value));
}

function requiresAdminToken(baseURL) {
  const url = new URL(baseURL);
  return !['localhost', '127.0.0.1', '::1'].includes(url.hostname);
}

async function main() {
  const imagePaths = parseImagePaths(process.argv.slice(2));
  const baseURL = process.env.PANTRY_BASE_URL || 'http://127.0.0.1:8031';
  const adminToken = process.env.PANTRY_ADMIN_TOKEN || '';
  if (requiresAdminToken(baseURL) && !adminToken) {
    throw new Error('PANTRY_ADMIN_TOKEN is required for preview/production live smoke');
  }

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
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/openrouter') recognitionRequests += 1;
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
    assert.equal(recognized.size, '12');
    assert.equal(recognized.packageType, '', 'type remains user-controlled');
    await page.locator('#fi-package-type').selectOption('travel');
    const savedPromise = page.waitForResponse(
      response => response.request().method() === 'PUT' && response.url().includes('/api/families/') && response.status() === 200,
      { timeout: 60000 }
    );
    await page.getByRole('button', { name: '确认录入 →', exact: true }).click();
    await savedPromise;

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
    assert.equal(saved.packageSize, 12);
    assert.equal(evidence.local[0].packageType, 'travel');

    if (adminToken) {
      const adminResponse = await page.request.get(
        baseURL + '/api/admin/recognition-reviews?familyId=' + encodeURIComponent(evidence.familyId) + '&limit=80',
        { headers: { 'X-Admin-Token': adminToken } }
      );
      assert.equal(adminResponse.status(), 200, 'admin recognition-review lookup failed');
      const adminPayload = await adminResponse.json();
      const review = adminPayload.reviews?.find(candidate => candidate.id === reviewId);
      assert.ok(review, `recognition review ${reviewId} was not returned by the admin API`);
      assert.equal(
        review.imageDataUrls?.length,
        imagePaths.length,
        `recognition review ${reviewId} does not contain all supplied images`
      );
    } else if (requiresAdminToken(baseURL)) {
      throw new Error('PANTRY_ADMIN_TOKEN is required to verify recognition review images');
    }

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
    await page.screenshot({ path: '/tmp/pantry-live-travel.png', animations: 'disabled' });
    assert.deepEqual(errors, []);
    await fs.writeFile(
      '/tmp/pantry-live-evidence.json',
      JSON.stringify({ recognized, reviewId, imageCount: imagePaths.length, ...evidence, responses, errors }, null, 2)
    );
    console.log(`PASS ${imagePaths.length} photo(s), one recognition request, review image count, one-item save, independent GET, local storage, reload and filters; evidence /tmp/pantry-live-evidence.json`);
  } finally {
    await browser.close();
  }
}

module.exports = { parseImagePaths, requiresAdminToken };

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
