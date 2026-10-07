// Run: PLAYWRIGHT_MODULE=/path/to/playwright node scripts/test-multiphoto.cjs
// Serve the repository on port 8031 first. Every API call is mocked.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('pantry.html', 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
  'base64'
);
const image = name => ({ name, mimeType: 'image/png', buffer: png });

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    let recognitionCalls = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('pantry_recognition_review_consent', 'yes');
      localStorage.setItem('pantry_deduct_v4', String(Date.now()));
    });
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    await page.route('https://openrouter.ai/**', route => {
      recognitionCalls += 1;
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/families/ensure') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ familyId: 'test-family', version: 1, data: { items: [], locations: [] } })
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('http://127.0.0.1:8031/pantry.html');
    await page.evaluate(() => {
      cloudReady = false;
      pantryFamilyId = null;
      cloudState = 'error';
      renderCloudStatus();
      nav('scr-add');
    });

    const single = page.getByRole('button', { name: '单件商品', exact: true });
    const multi = page.getByRole('button', { name: '多件商品', exact: true });
    assert.equal(await single.getAttribute('aria-pressed'), 'true', 'fresh intake defaults to single item');
    assert.equal(await multi.getAttribute('aria-pressed'), 'false');

    let chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.locator('#photo-intake-entry').click();
    let chooser = await chooserPromise;
    assert.equal(await page.locator('input[type=file]').getAttribute('multiple'), '', 'photo chooser accepts multiple files');
    await chooser.setFiles([image('front.png'), image('expiry.png')]);
    await page.waitForFunction(() => document.querySelectorAll('.pending-photo').length === 2);
    assert.equal(await page.locator('.pending-photo').count(), 2);
    assert.match(await page.locator('#pending-photo-status').innerText(), /已选择 2\/3 张/);
    assert.equal(await page.locator('#start-photo-recognition').isEnabled(), true);
    assert.equal(await page.locator('#scan-ov').getAttribute('class'), 'scan-ov', 'collecting does not show scan overlay');
    assert.equal(recognitionCalls, 0, 'collecting does not call recognition');

    chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.locator('#add-pending-photo').click();
    chooser = await chooserPromise;
    await chooser.setFiles(image('side.png'));
    await page.waitForFunction(() => document.querySelectorAll('.pending-photo').length === 3);
    assert.equal(await page.locator('#add-pending-photo').isVisible(), false, 'add action hides at limit');
    await page.evaluate(async () => addPendingPhotos([new File(['extra'], 'fourth.png', { type: 'image/png' })]));
    assert.equal(await page.locator('.pending-photo').count(), 3, 'fourth image is blocked');
    assert.match(await page.locator('#pending-photo-error').innerText(), /fourth\.png|最多.*3|忽略/);
    await page.getByRole('button', { name: '移除照片 front.png' }).click();
    assert.equal(await page.locator('.pending-photo').count(), 2);
    assert.equal(await page.locator('#add-pending-photo').isVisible(), true, 'deleting restores add action');

    await page.evaluate(() => clearPendingPhotos());
    for (const name of ['camera-1.png', 'camera-2.png']) {
      chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
      await page.locator(name === 'camera-1.png' ? '#photo-intake-entry' : '#add-pending-photo').click();
      chooser = await chooserPromise;
      await chooser.setFiles(image(name));
    }
    chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.locator('#add-pending-photo').click();
    chooser = await chooserPromise;
    await chooser.setFiles([image('library-1.png'), image('library-overflow.png')]);
    await page.waitForFunction(() => document.querySelectorAll('.pending-photo').length === 3);
    assert.deepEqual(
      await page.locator('.pending-photo img').evaluateAll(images => images.map(img => img.alt)),
      ['预览 camera-1.png', '预览 camera-2.png', '预览 library-1.png'],
      'single and multi additions append in order to one group'
    );
    assert.match(await page.locator('#pending-photo-error').innerText(), /library-overflow\.png/);

    await page.evaluate(() => clearPendingPhotos());
    chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.locator('#photo-intake-entry').click();
    chooser = await chooserPromise;
    await chooser.setFiles([
      image('valid.png'),
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') }
    ]);
    await page.waitForFunction(() => document.querySelectorAll('.pending-photo').length === 1);
    assert.equal(await page.locator('.pending-photo').count(), 1, 'valid file survives a mixed invalid selection');
    assert.match(await page.locator('#pending-photo-error').innerText(), /notes\.txt/);

    const beforeCancel = await page.locator('.pending-photo').count();
    await page.evaluate(() => {
      createFileInput('photo', () => { throw new Error('cancel callback must not run'); });
      _fileInput.oncancel();
      cancelScan();
    });
    assert.equal(await page.locator('.pending-photo').count(), beforeCancel, 'picker and scan cancellation preserve pending photos');

    await multi.click();
    assert.equal(await multi.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#single-intake-panel').isHidden(), true);
    assert.equal(await page.locator('#order-intake-entry').isVisible(), true);
    const futureBatch = page.locator('#future-physical-batch');
    assert.match(await futureBatch.innerText(), /实物.*批量拍摄.*后续开放/);
    assert.equal(await futureBatch.evaluate(el => el.matches('button,a,[role=button]') || el.hasAttribute('onclick')), false);
    await page.evaluate(() => {
      cloudReady = true;
      pantryFamilyId = 'test-family';
      renderCloudStatus();
    });
    chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.locator('#order-intake-entry').click();
    chooser = await chooserPromise;
    assert.equal(await page.locator('input[type=file]').getAttribute('multiple'), null, 'order screenshot remains single file');
    await page.evaluate(() => _fileInput.oncancel());

    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => setIntakeMode('single'));
      assert.equal(await page.evaluate(() => {
        const root = document.querySelector('#scr-add .add-wrap');
        const elements = [root, ...root.querySelectorAll('.intake-mode-selector,.pending-photo-grid,.pending-photo-actions,.pending-photo')];
        return elements.every(el => {
          if (el.hidden) return true;
          const rect = el.getBoundingClientRect();
          return rect.left >= -0.5 && rect.right <= innerWidth + 0.5 && el.scrollWidth <= el.clientWidth + 1;
        });
      }), true, `intake UI fits ${width}px`);
    }

    await page.evaluate(() => clearPendingPhotos());
    assert.equal(await page.locator('#start-photo-recognition').isDisabled(), true);
    assert.match(await page.locator('#pending-photo-status').innerText(), /尚未添加|0\/3/);
    assert.equal(recognitionCalls, 0);
    assert.deepEqual(errors, [], 'no browser runtime errors');
    console.log('PASS: single/multi intake, 3-photo collection, validation, cancellation, order entry, responsive layout');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
