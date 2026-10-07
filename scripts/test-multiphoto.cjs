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
    const recognitionBodies = [];
    const usageEvents = [];
    const reviewUpdates = [];
    let recognitionMode = 'success';
    let recognitionDelayMs = 0;
    const recognitionQueue = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('pantry_deduct_v4', String(Date.now()));
      window.__createdObjectUrls = [];
      window.__revokedObjectUrls = [];
      const createObjectURL = URL.createObjectURL.bind(URL);
      const revokeObjectURL = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = object => {
        const url = createObjectURL(object);
        window.__createdObjectUrls.push(url);
        return url;
      };
      URL.revokeObjectURL = url => {
        window.__revokedObjectUrls.push(url);
        return revokeObjectURL(url);
      };
    });
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    await page.route('https://openrouter.ai/**', route => {
      recognitionCalls += 1;
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/openrouter') {
        recognitionCalls += 1;
        recognitionBodies.push(JSON.parse(route.request().postData() || '{}'));
        const plan = recognitionQueue.shift() || { mode: recognitionMode, delayMs: recognitionDelayMs };
        const mode = plan.mode || 'success';
        const reviewId = plan.reviewId || `review-${recognitionCalls}`;
        if (mode === 'network') return route.abort('failed');
        const success = {
          pantryReviewId: reviewId,
          choices: [{ message: { content: JSON.stringify(plan.type === 'order' ? [{
            name: plan.name || '订单商品',
            brand: '订单品牌',
            packageSize: 200,
            unit: 'ml',
            qty: 1,
            expiryDate: '2028-11-01',
            expiryEvidence: 'EXP 11/2028',
            missingFields: []
          }] : {
            sameProduct: true,
            conflictReason: '',
            name: plan.name || '测试洗发水',
            brand: '测试品牌',
            packageSize: 300,
            unit: 'ml',
            qty: 1,
            expiryDate: '2028-10-01',
            expiryEvidence: 'EXP 10/2028',
            missingFields: []
          }) } }]
        };
        const conflict = {
          pantryReviewId: reviewId,
          choices: [{ message: { content: 'sameProduct： "false"\nconflictReason：照片中是不同商品' } }]
        };
        const parseFailure = {
          pantryReviewId: reviewId,
          choices: [{ message: { content: mode === 'empty' ? '' : 'not valid recognition output' } }]
        };
        const response = mode === 'conflict'
          ? conflict
          : (mode === 'parse' || mode === 'empty') ? parseFailure : success;
        return new Promise(resolve => setTimeout(resolve, plan.delayMs || 0)).then(() => route.fulfill({
          status: mode === 'server' ? 503 : 200,
          contentType: 'application/json',
          body: mode === 'server' ? JSON.stringify({ error: { message: 'service unavailable' } }) : JSON.stringify(response)
        }));
      }
      if (url.pathname === '/api/usage-event') {
        const payload = JSON.parse(route.request().postData() || '{}');
        usageEvents.push(payload);
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      if (url.pathname === '/api/recognition-review') {
        reviewUpdates.push(JSON.parse(route.request().postData() || '{}'));
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
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

    await page.locator('#photo-intake-entry').click();
    assert.equal(await page.locator('#sheet').getAttribute('class'), 'sheet show', 'consent sheet appears first');
    assert.equal(await page.locator('#sh-title').innerText(), '识别样本授权');
    assert.equal(await page.evaluate(() => _fileInput === null && pendingPhotos.length === 0), true, 'no chooser or collection before consent');
    assert.equal(await page.evaluate(() => localStorage.getItem(RECOGNITION_REVIEW_CONSENT_KEY)), null);

    let chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.locator('#sh-ok').click();
    let chooser = await chooserPromise;
    assert.equal(await page.evaluate(() => localStorage.getItem(RECOGNITION_REVIEW_CONSENT_KEY)), 'yes');
    assert.equal(await page.locator('#sheet').getAttribute('class'), 'sheet');
    assert.equal(await page.locator('input[type=file]').getAttribute('multiple'), '', 'consented photo chooser accepts multiple files');
    await chooser.setFiles([image('front.png'), image('expiry.png')]);
    await page.waitForFunction(() => document.querySelectorAll('.pending-photo').length === 2);

    chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.locator('#photo-intake-entry').click();
    chooser = await chooserPromise;
    assert.equal(await page.locator('input[type=file]').getAttribute('multiple'), '', 'photo chooser accepts multiple files');
    await page.evaluate(() => _fileInput.oncancel());
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
    const firstGroupUrls = await page.evaluate(() => [...window.__createdObjectUrls]);
    assert.equal(firstGroupUrls.length, 3, 'one preview URL is created per accepted photo');
    await page.getByRole('button', { name: '移除照片 front.png' }).click();
    assert.equal(await page.locator('.pending-photo').count(), 2);
    assert.deepEqual(await page.evaluate(() => [...window.__revokedObjectUrls]), [firstGroupUrls[0]], 'removing one photo revokes only its preview');
    assert.equal(await page.locator('#add-pending-photo').isVisible(), true, 'deleting restores add action');

    await page.evaluate(() => clearPendingPhotos());
    assert.deepEqual(
      await page.evaluate(() => [...window.__revokedObjectUrls]),
      firstGroupUrls,
      'clearing revokes every remaining preview exactly once'
    );
    await page.evaluate(() => {
      window.__createdObjectUrls = [];
      window.__revokedObjectUrls = [];
    });

    await page.evaluate(() => {
      window.__originalPreviewLoader = loadPendingPhotoPreview;
      let resolvePreview;
      loadPendingPhotoPreview = file => new Promise(resolve => {
        const objectUrl = URL.createObjectURL(file);
        window.__stalePreviewUrl = objectUrl;
        resolvePreview = () => resolve(objectUrl);
      });
      window.__staleAddPromise = addPendingPhotos([
        new File(['stale'], 'stale.png', { type: 'image/png' })
      ]);
      window.__resolveStalePreview = () => resolvePreview();
      nav('scr-home');
    });
    await page.evaluate(async () => {
      window.__resolveStalePreview();
      await window.__staleAddPromise;
      loadPendingPhotoPreview = window.__originalPreviewLoader;
    });
    assert.equal(await page.evaluate(() => pendingPhotos.length), 0, 'late decode cannot restore a cleared photo');
    assert.equal(
      await page.evaluate(() => window.__revokedObjectUrls.filter(url => url === window.__stalePreviewUrl).length),
      1,
      'late decoded preview is revoked exactly once'
    );
    assert.equal(await page.evaluate(() => pendingPhotoReservations), 0, 'generation reset leaves no negative or stale reservation');
    await page.waitForTimeout(250);
    await page.evaluate(() => nav('scr-add'));

    const concurrentCount = await page.evaluate(async () => {
      const originalLoader = loadPendingPhotoPreview;
      loadPendingPhotoPreview = file => new Promise(resolve => {
        const objectUrl = URL.createObjectURL(file);
        setTimeout(() => resolve(objectUrl), 20);
      });
      const make = name => new File([name], name, { type: 'image/png' });
      await Promise.all([
        addPendingPhotos([make('concurrent-1.png'), make('concurrent-2.png')]),
        addPendingPhotos([make('concurrent-3.png'), make('concurrent-4.png')])
      ]);
      loadPendingPhotoPreview = originalLoader;
      return pendingPhotos.length;
    });
    assert.equal(concurrentCount, 3, 'concurrent additions synchronously share the three available slots');
    assert.equal(await page.evaluate(() => pendingPhotoReservations), 0, 'all current-generation reservations are released');
    await page.evaluate(() => clearPendingPhotos());

    await page.evaluate(async () => {
      const OriginalImage = window.Image;
      window.Image = class StubDecodedImage {
        set src(value) {
          this.currentSrc = value;
          queueMicrotask(() => this.onload());
        }
      };
      await addPendingPhotos([
        new File(['valid'], 'empty-mime.png', { type: '' }),
        new File(['bad'], 'explicit-text.txt', { type: 'text/plain' }),
        new File(['valid'], 'typed-image.png', { type: 'image/png' })
      ]);
      window.Image = OriginalImage;
    });
    assert.deepEqual(
      await page.locator('.pending-photo img').evaluateAll(images => images.map(image => image.alt)),
      ['预览 empty-mime.png', '预览 typed-image.png'],
      'empty MIME files may pass decoding while explicit non-image MIME is rejected'
    );
    assert.match(await page.locator('#pending-photo-error').innerText(), /explicit-text\.txt/);
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

    const pendingBeforeNavigation = await page.evaluate(() => pendingPhotos.map(photo => photo.objectUrl));
    assert.equal(pendingBeforeNavigation.length, 1);
    await page.evaluate(() => nav('scr-home'));
    assert.equal(await page.evaluate(() => pendingPhotos.length), 0, 'leaving intake clears collected photos');
    assert.equal(
      await page.evaluate(url => window.__revokedObjectUrls.filter(value => value === url).length, pendingBeforeNavigation[0]),
      1,
      'navigation cleanup revokes the remaining preview exactly once'
    );
    await page.evaluate(() => nav('scr-add'));
    assert.equal(await single.getAttribute('aria-pressed'), 'true', 'a genuinely fresh intake resets to single item');
    assert.equal(await multi.getAttribute('aria-pressed'), 'false');

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

    await page.evaluate(() => {
      imageToBase64 = async file => btoa(file.name);
    });
    chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.locator('#photo-intake-entry').click();
    chooser = await chooserPromise;
    await chooser.setFiles([image('front-success.png'), image('expiry-success.png')]);
    await page.waitForFunction(() => pendingPhotos.length === 2);
    assert.equal(recognitionCalls, 0, 'selecting two files still makes no recognition request');

    recognitionDelayMs = 150;
    await page.locator('#start-photo-recognition').click();
    await page.waitForFunction(() => photoRecognitionBusy === true);
    await page.evaluate(() => startPendingPhotoRecognition());
    assert.equal(await page.locator('#scan-ov').getAttribute('class'), 'scan-ov show', 'overlay appears only after explicit start');
    assert.match(await page.locator('#pending-photo-status').innerText(), /识别|处理中|准备/);
    assert.equal(await page.locator('#add-pending-photo').isDisabled(), true, 'add is locked while recognition is pending');
    assert.equal(await page.locator('#start-photo-recognition').isDisabled(), true, 'start is locked while recognition is pending');
    assert.equal(await page.locator('.pending-photo-remove:not([disabled])').count(), 0, 'remove controls are locked while recognition is pending');
    for (const selector of ['#photo-intake-entry', '#intake-mode-single', '#intake-mode-multi', '#order-intake-entry']) {
      assert.equal(await page.locator(selector).isDisabled(), true, `${selector} is locked while recognition is pending`);
    }
    assert.deepEqual(await page.evaluate(() => {
      let chooserCalls = 0;
      const originalCreateFileInput = createFileInput;
      createFileInput = () => { chooserCalls += 1; };
      setIntakeMode('multi');
      doScan('order');
      createFileInput = originalCreateFileInput;
      return { chooserCalls, single: document.getElementById('intake-mode-single').getAttribute('aria-pressed') };
    }), { chooserCalls: 0, single: 'true' }, 'programmatic competing intake paths are guarded while pending');
    await page.waitForFunction(() => photoRecognitionBusy === false);
    assert.equal(recognitionCalls, 1, 'double start produces one request');
    const imageEntries = recognitionBodies[0].messages[0].content.filter(entry => entry.type === 'image_url');
    assert.deepEqual(
      imageEntries.map(entry => entry.image_url.url),
      ['data:image/jpeg;base64,' + Buffer.from('front-success.png').toString('base64'), 'data:image/jpeg;base64,' + Buffer.from('expiry-success.png').toString('base64')],
      'both images are sent exactly once and in selection order'
    );
    assert.equal(await page.locator('#fi-name').inputValue(), '测试洗发水', 'successful recognition fills the existing confirmation form');
    assert.equal(await page.locator('#recog-result').isVisible(), true);
    assert.equal(await page.locator('.pending-photo').count(), 2, 'successful review keeps the thumbnail strip visible');
    assert.equal(await page.locator('.pending-photo-remove:not([disabled])').count(), 0, 'review thumbnails are read-only');
    assert.equal(await page.locator('#reselect-pending-photos').isVisible(), true, 'review offers reselect');
    for (const selector of ['#photo-intake-entry', '#intake-mode-single', '#intake-mode-multi', '#order-intake-entry']) {
      assert.equal(await page.locator(selector).isDisabled(), true, `${selector} is locked during read-only review`);
    }
    assert.deepEqual(await page.evaluate(() => {
      cloudReady = true;
      pantryFamilyId = 'test-family';
      let chooserCalls = 0;
      const reviewId = _currentRecognitionReviewId;
      const originalCreateFileInput = createFileInput;
      createFileInput = () => { chooserCalls += 1; };
      setIntakeMode('multi');
      doScan('order');
      createFileInput = originalCreateFileInput;
      return { chooserCalls, reviewId, currentReviewId: _currentRecognitionReviewId, single: document.getElementById('intake-mode-single').getAttribute('aria-pressed') };
    }), { chooserCalls: 0, reviewId: 'review-1', currentReviewId: 'review-1', single: 'true' }, 'read-only review cannot be overwritten by another intake path');

    await page.evaluate(() => reselectPendingPhotos());
    assert.equal(await page.evaluate(() => pendingPhotos.length), 0, 'reselect discards the current photo group');
    assert.equal(await page.locator('#recog-result').isHidden(), true);
    assert.equal(await page.locator('#add-pending-photo').isVisible(), true, 'reselect returns to editable collection');
    for (const selector of ['#photo-intake-entry', '#intake-mode-single', '#intake-mode-multi', '#order-intake-entry']) {
      assert.equal(await page.locator(selector).isDisabled(), false, `${selector} is restored after reselect`);
    }
    await page.waitForTimeout(30);
    assert.equal(reviewUpdates.some(update => update.reviewId === 'review-1' && update.outcome === 'discarded'), true, 'reselect marks an unaccepted review discarded');

    await page.evaluate(async encoded => {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      await addPendingPhotos([
        new File([bytes], 'retry-front.png', { type: 'image/png' }),
        new File([bytes], 'retry-expiry.png', { type: 'image/png' })
      ]);
    }, png.toString('base64'));
    const retryUrls = await page.evaluate(() => pendingPhotos.map(photo => photo.objectUrl));
    recognitionMode = 'server';
    recognitionDelayMs = 0;
    await page.locator('#start-photo-recognition').click();
    await page.waitForFunction(() => photoRecognitionBusy === false);
    assert.deepEqual(await page.evaluate(() => pendingPhotos.map(photo => photo.objectUrl)), retryUrls, 'retryable server failure preserves photos');
    assert.equal(await page.locator('#start-photo-recognition').isEnabled(), true, 'busy state resets after failure');
    assert.match(await page.locator('#pending-photo-error').innerText(), /service unavailable|失败|重试/);

    for (const mode of ['network', 'timeout', 'parse', 'empty']) {
      recognitionMode = mode;
      recognitionDelayMs = mode === 'timeout' ? 100 : 0;
      if (mode === 'timeout') await page.evaluate(() => {
        window.__recognitionFetch = window.fetch;
        window.fetch = (url, options) => String(url).includes('/api/openrouter')
          ? Promise.reject(new DOMException('timed out', 'AbortError'))
          : window.__recognitionFetch(url, options);
      });
      const before = await page.evaluate(() => pendingPhotos.map(photo => photo.objectUrl));
      await page.evaluate(() => startPendingPhotoRecognition());
      await page.waitForFunction(() => photoRecognitionBusy === false);
      assert.deepEqual(await page.evaluate(() => pendingPhotos.map(photo => photo.objectUrl)), before, `${mode} failure preserves photos`);
      assert.equal(await page.locator('#start-photo-recognition').isEnabled(), true, `${mode} failure permits retry`);
      if (mode === 'timeout') await page.evaluate(() => { window.fetch = window.__recognitionFetch; });
    }

    recognitionMode = 'conflict';
    recognitionDelayMs = 0;
    await page.locator('#start-photo-recognition').click();
    await page.waitForFunction(() => photoRecognitionBusy === false);
    assert.equal(await page.locator('#recog-result').isHidden(), true, 'conflicting photos do not populate a merged result');
    assert.equal(await page.locator('.pending-photo').count(), 2, 'conflict preserves thumbnails');
    assert.match(await page.locator('#pending-photo-error').innerText(), /不同商品|移除.*无关/);

    recognitionMode = 'success';
    await page.locator('#start-photo-recognition').click();
    await page.waitForFunction(() => photoRecognitionBusy === false && document.querySelector('#recog-result').style.display === 'block');
    await page.locator('#fi-package-type').selectOption('regular');
    const saveUrls = await page.evaluate(() => pendingPhotos.map(photo => photo.objectUrl));
    await page.getByRole('button', { name: '确认录入 →' }).click();
    assert.equal(await page.evaluate(() => pendingPhotos.length), 0, 'accepted save clears pending photos');
    assert.equal(await page.evaluate(urls => urls.every(url => window.__revokedObjectUrls.includes(url)), saveUrls), true, 'accepted save revokes every preview');
    await page.waitForTimeout(50);
    const acceptedReview = reviewUpdates.find(update => update.outcome === 'accepted');
    assert.equal(Boolean(acceptedReview), true, 'accepted save records accepted review data');
    assert.equal(reviewUpdates.some(update => update.reviewId === acceptedReview.reviewId && update.outcome === 'discarded'), false, 'accepted review is not later discarded');
    for (const selector of ['#photo-intake-entry', '#intake-mode-single', '#intake-mode-multi', '#order-intake-entry']) {
      assert.equal(await page.locator(selector).isDisabled(), false, `${selector} is restored after accepted save`);
    }

    await page.evaluate(() => nav('scr-add'));
    await page.evaluate(async encoded => {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      await addPendingPhotos([new File([bytes], 'abandon.png', { type: 'image/png' })]);
    }, png.toString('base64'));
    const abandonUrl = await page.evaluate(() => pendingPhotos[0].objectUrl);
    await page.evaluate(() => nav('scr-home'));
    assert.equal(await page.evaluate(() => pendingPhotos.length), 0, 'abandoning intake clears pending photos');
    assert.equal(await page.evaluate(url => window.__revokedObjectUrls.includes(url), abandonUrl), true, 'abandoning intake revokes its preview');
    for (const selector of ['#photo-intake-entry', '#intake-mode-single', '#intake-mode-multi', '#order-intake-entry']) {
      assert.equal(await page.locator(selector).isDisabled(), false, `${selector} is restored after abandonment`);
    }

    await page.evaluate(() => nav('scr-add'));
    await page.evaluate(async encoded => {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      await addPendingPhotos([new File([bytes], 'race-a.png', { type: 'image/png' })]);
    }, png.toString('base64'));
    await page.evaluate(() => {
      window.__raceOriginalFetch = window.fetch;
      window.__raceIgnoreSignalOnce = true;
      window.fetch = (url, options = {}) => {
        if (window.__raceIgnoreSignalOnce && String(url).includes('/api/openrouter')) {
          window.__raceIgnoreSignalOnce = false;
          const { signal, ...withoutSignal } = options;
          return window.__raceOriginalFetch(url, withoutSignal);
        }
        return window.__raceOriginalFetch(url, options);
      };
    });
    recognitionQueue.push({ mode: 'success', delayMs: 250, reviewId: 'review-race-a', name: '延迟商品A' });
    await page.evaluate(() => { window.__scanAPromise = startPendingPhotoRecognition(); });
    await page.waitForFunction(() => photoRecognitionBusy === true);
    await page.evaluate(() => nav('scr-home'));
    await page.evaluate(() => nav('scr-add'));
    await page.evaluate(async encoded => {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      await addPendingPhotos([new File([bytes], 'race-b.png', { type: 'image/png' })]);
    }, png.toString('base64'));
    recognitionQueue.push({ mode: 'success', delayMs: 0, reviewId: 'review-race-b', name: '新商品B' });
    await page.evaluate(() => startPendingPhotoRecognition());
    assert.deepEqual(await page.evaluate(() => ({
      reviewId: _currentRecognitionReviewId,
      name: _currentRecognitionParsedResult?.name,
      fieldName: document.getElementById('fi-name').value
    })), { reviewId: 'review-race-b', name: '新商品B', fieldName: '新商品B' }, 'fresh scan B owns the active review before A resolves');
    await page.evaluate(() => window.__scanAPromise);
    await page.evaluate(() => { window.fetch = window.__raceOriginalFetch; });
    assert.deepEqual(await page.evaluate(() => ({
      reviewId: _currentRecognitionReviewId,
      name: _currentRecognitionParsedResult?.name,
      fieldName: document.getElementById('fi-name').value
    })), { reviewId: 'review-race-b', name: '新商品B', fieldName: '新商品B' }, 'stale scan A cannot overwrite or reset scan B globals');
    await page.waitForTimeout(30);
    assert.equal(reviewUpdates.some(update => update.reviewId === 'review-race-a' && update.outcome === 'discarded'), true, 'stale scan A discards only its own review');
    await page.locator('#fi-package-type').selectOption('regular');
    await page.getByRole('button', { name: '确认录入 →' }).click();
    await page.waitForTimeout(30);
    assert.equal(reviewUpdates.some(update => update.reviewId === 'review-race-b' && update.outcome === 'accepted'), true, 'saving B accepts B review');
    assert.equal(reviewUpdates.some(update => update.reviewId === 'review-race-b' && update.outcome === 'discarded'), false, 'stale A never discards B review');

    await page.evaluate(() => nav('scr-add'));
    await page.evaluate(async encoded => {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      await addPendingPhotos([new File([bytes], 'cancel-photo.png', { type: 'image/png' })]);
    }, png.toString('base64'));
    await page.evaluate(() => {
      window.__cancelOriginalFetch = window.fetch;
      window.__cancelIgnoreSignalOnce = true;
      window.fetch = (url, options = {}) => {
        if (window.__cancelIgnoreSignalOnce && String(url).includes('/api/openrouter')) {
          window.__cancelIgnoreSignalOnce = false;
          const { signal, ...withoutSignal } = options;
          return window.__cancelOriginalFetch(url, withoutSignal);
        }
        return window.__cancelOriginalFetch(url, options);
      };
    });
    recognitionQueue.push({ mode: 'success', delayMs: 250, reviewId: 'review-cancel-photo', name: '不应出现的取消结果' });
    await page.evaluate(() => {
      window.__cancelPhotoPromise = startPendingPhotoRecognition();
      window.__cancelPhotoAttempt = activeRecognitionAttempt;
    });
    await page.waitForFunction(() => photoRecognitionBusy === true);
    const cancelPhotoUrls = await page.evaluate(() => pendingPhotos.map(photo => photo.objectUrl));
    await page.evaluate(() => cancelScan());
    assert.equal(await page.evaluate(() => window.__cancelPhotoAttempt.controller.signal.aborted), true, 'cancel aborts the active photo controller');
    assert.equal(await page.locator('#scan-ov').getAttribute('class'), 'scan-ov', 'cancel hides the photo overlay');
    assert.equal(await page.evaluate(() => photoRecognitionBusy), false, 'cancel resets photo busy state');
    assert.deepEqual(await page.evaluate(() => pendingPhotos.map(photo => photo.objectUrl)), cancelPhotoUrls, 'cancel preserves photos for retry');
    assert.equal(await page.locator('#start-photo-recognition').isEnabled(), true, 'cancel restores retry controls');
    await page.evaluate(() => window.__cancelPhotoPromise);
    await page.evaluate(() => { window.fetch = window.__cancelOriginalFetch; });
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => ({
      reviewId: _currentRecognitionReviewId,
      parsed: _currentRecognitionParsedResult,
      reviewActive: pendingPhotoReviewActive,
      formVisible: document.getElementById('recog-result').style.display === 'block'
    })), { reviewId: null, parsed: null, reviewActive: false, formVisible: false }, 'late cancelled photo response cannot activate a review');
    assert.equal(reviewUpdates.some(update => update.reviewId === 'review-cancel-photo' && update.outcome === 'discarded'), true, 'late cancelled photo review discards only itself');
    await page.evaluate(() => clearPendingPhotos());

    await page.evaluate(async encoded => {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      await addPendingPhotos([new File([bytes], 'direct-clear.png', { type: 'image/png' })]);
    }, png.toString('base64'));
    recognitionQueue.push({ mode: 'success', delayMs: 250, reviewId: 'review-direct-clear', name: '不应出现的直接清理结果' });
    await page.evaluate(() => { window.__directClearPromise = startPendingPhotoRecognition(); });
    await page.waitForFunction(() => photoRecognitionBusy === true);
    const directClearUrl = await page.evaluate(() => pendingPhotos[0].objectUrl);
    await page.evaluate(() => clearPendingPhotos());
    assert.deepEqual(await page.evaluate(() => ({
      activeAttempt: activeRecognitionAttempt,
      busy: photoRecognitionBusy,
      photos: pendingPhotos.length,
      overlay: document.getElementById('scan-ov').className,
      startDisabled: document.getElementById('start-photo-recognition').disabled
    })), { activeAttempt: null, busy: false, photos: 0, overlay: 'scan-ov', startDisabled: true }, 'direct clear cancels and fully unlocks an active photo attempt');
    assert.equal(await page.evaluate(url => window.__revokedObjectUrls.includes(url), directClearUrl), true, 'direct clear revokes the active photo preview');
    await page.evaluate(() => window.__directClearPromise);

    await page.evaluate(async encoded => {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      await addPendingPhotos([new File([bytes], 'abandon-review.png', { type: 'image/png' })]);
    }, png.toString('base64'));
    recognitionQueue.push({ mode: 'success', delayMs: 0, reviewId: 'review-abandon-active', name: '洗发水旧结果' });
    await page.evaluate(() => startPendingPhotoRecognition());
    assert.equal(await page.locator('#recog-result').isVisible(), true);
    await page.evaluate(() => {
      const location=document.getElementById('fi-location');
      location.append(new Option('浴室', 'bathroom'));
      location.value='bathroom';
    });
    await page.evaluate(() => nav('scr-home'));
    await page.evaluate(() => nav('scr-add'));
    assert.deepEqual(await page.evaluate(() => ({
      reviewId: _currentRecognitionReviewId,
      parsed: _currentRecognitionParsedResult,
      photos: pendingPhotos.length,
      orderItems: window._orderItems ?? null,
      formVisible: document.getElementById('recog-result').style.display === 'block',
      fieldName: document.getElementById('fi-name').value,
      location: document.getElementById('fi-location').value,
      lastDetected: _lastDetected
    })), { reviewId: null, parsed: null, photos: 0, orderItems: null, formVisible: false, fieldName: '', location: '', lastDetected: null }, 'abandoning an active review returns to a fresh intake');

    await page.evaluate(async encoded => {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      await addPendingPhotos([new File([bytes], 'abandon-pending.png', { type: 'image/png' })]);
    }, png.toString('base64'));
    recognitionQueue.push({ mode: 'success', delayMs: 250, reviewId: 'review-abandon-pending', name: '不应回填的离开结果' });
    await page.evaluate(() => { window.__abandonPendingPromise = startPendingPhotoRecognition(); });
    await page.waitForFunction(() => photoRecognitionBusy === true);
    await page.evaluate(() => nav('scr-home'));
    await page.evaluate(() => nav('scr-add'));
    assert.deepEqual(await page.evaluate(() => ({
      overlay: document.getElementById('scan-ov').className,
      timer: _scanTmr
    })), { overlay: 'scan-ov', timer: null }, 'leaving during pending photo clears overlay and scan timer');
    await page.evaluate(() => window.__abandonPendingPromise);
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => ({
      reviewId: _currentRecognitionReviewId,
      parsed: _currentRecognitionParsedResult,
      photos: pendingPhotos.length,
      reviewActive: pendingPhotoReviewActive,
      formVisible: document.getElementById('recog-result').style.display === 'block',
      fieldName: document.getElementById('fi-name').value,
      controlsEnabled: ['photo-intake-entry','intake-mode-single','intake-mode-multi','order-intake-entry'].every(id => !document.getElementById(id).disabled)
    })), { reviewId: null, parsed: null, photos: 0, reviewActive: false, formVisible: false, fieldName: '', controlsEnabled: true }, 'leaving during pending ignores the late response and restores a fresh intake');

    await page.evaluate(() => {
      cloudReady = true;
      pantryFamilyId = 'test-family';
      setIntakeMode('multi');
    });
    recognitionQueue.push({ mode: 'success', type: 'order', delayMs: 250, reviewId: 'review-cancel-order', name: '不应出现的订单结果' });
    await page.evaluate(encoded => {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      window.__cancelOrderPromise = startOrderRecognition(new File([bytes], 'order-delayed.png', { type: 'image/png' }));
    }, png.toString('base64'));
    await page.waitForFunction(() => orderRecognitionBusy === true);
    assert.equal(await page.locator('#photo-intake-entry').isDisabled(), true, 'pending order locks photo intake');
    assert.equal(await page.locator('#intake-mode-single').isDisabled(), true, 'pending order locks mode switching');
    await page.evaluate(() => cancelScan());
    assert.equal(await page.evaluate(() => orderRecognitionBusy), false, 'cancel resets order busy state');
    assert.equal(await page.locator('#scan-ov').getAttribute('class'), 'scan-ov');
    assert.equal(await page.locator('#photo-intake-entry').isEnabled(), true, 'cancelled order restores photo intake');
    await page.evaluate(() => setIntakeMode('single'));
    await page.evaluate(async encoded => {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      await addPendingPhotos([new File([bytes], 'after-order-cancel.png', { type: 'image/png' })]);
    }, png.toString('base64'));
    recognitionQueue.push({ mode: 'success', delayMs: 0, reviewId: 'review-photo-after-order', name: '取消订单后的照片商品' });
    await page.evaluate(() => startPendingPhotoRecognition());
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => ({
      reviewId: _currentRecognitionReviewId,
      reviewType: _currentRecognitionReviewType,
      name: document.getElementById('fi-name').value,
      orderItems: window._orderItems ?? null
    })), { reviewId: 'review-photo-after-order', reviewType: 'photo', name: '取消订单后的照片商品', orderItems: null }, 'late cancelled order cannot overwrite the later photo review');
    await page.locator('#fi-package-type').selectOption('regular');
    await page.getByRole('button', { name: '确认录入 →' }).click();
    await page.waitForTimeout(30);
    assert.equal(usageEvents.some(event => event.eventName === 'item_add' && event.properties.reviewId === 'review-photo-after-order' && event.properties.source === 'photo'), true, 'photo after cancelled order keeps photo source attribution');
    assert.equal(reviewUpdates.some(update => update.reviewId === 'review-photo-after-order' && update.outcome === 'accepted'), true, 'photo review is accepted after cancelled order');

    await page.evaluate(() => nav('scr-add'));
    await page.evaluate(() => {
      cloudReady = true;
      pantryFamilyId = 'test-family';
      setIntakeMode('multi');
    });
    recognitionQueue.push({ mode: 'success', type: 'order', delayMs: 250, reviewId: 'review-abandon-order', name: '不应出现的离开订单' });
    await page.evaluate(encoded => {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      window.__abandonOrderPromise = startOrderRecognition(new File([bytes], 'order-abandon.png', { type: 'image/png' }));
    }, png.toString('base64'));
    await page.waitForFunction(() => orderRecognitionBusy === true);
    await page.evaluate(() => nav('scr-home'));
    await page.evaluate(() => nav('scr-add'));
    assert.deepEqual(await page.evaluate(() => ({
      overlay: document.getElementById('scan-ov').className,
      timer: _scanTmr,
      busy: orderRecognitionBusy,
      orderItems: window._orderItems ?? null,
      controlsEnabled: ['photo-intake-entry','intake-mode-single','intake-mode-multi','order-intake-entry'].every(id => !document.getElementById(id).disabled)
    })), { overlay: 'scan-ov', timer: null, busy: false, orderItems: null, controlsEnabled: true }, 'leaving during pending order clears overlay, timer, state, and locks');
    await page.evaluate(() => window.__abandonOrderPromise);

    await page.waitForTimeout(100);
    const photoEvents = usageEvents.filter(event => ['scan_start', 'scan_success', 'scan_error'].includes(event.eventName));
    assert.equal(photoEvents.some(event => JSON.stringify(event).includes('.png') || JSON.stringify(event).includes('data:image')), false, 'analytics never contain filenames or image content');
    const startEvent = photoEvents.find(event => event.eventName === 'scan_start');
    assert.deepEqual(
      { reqType: startEvent.properties.reqType, imageCount: startEvent.properties.imageCount, fileSize: startEvent.properties.fileSize, selectionMode: startEvent.properties.selectionMode },
      { reqType: 'photo', imageCount: 2, fileSize: png.length * 2, selectionMode: 'multiple' }
    );
    const successEvent = photoEvents.find(event => event.eventName === 'scan_success');
    assert.equal(successEvent.properties.imageCount, 2);
    assert.equal(successEvent.properties.encodedBytes > 0, true);
    const errorEvents = photoEvents.filter(event => event.eventName === 'scan_error');
    assert.equal(errorEvents.some(event => event.properties.failureCategory === 'unknown'), true);
    assert.equal(errorEvents.some(event => event.properties.failureCategory === 'mixed_product'), true);
    assert.equal(errorEvents.some(event => event.properties.failureCategory === 'network'), true);
    assert.equal(errorEvents.some(event => event.properties.failureCategory === 'timeout'), true, JSON.stringify(errorEvents.map(event => event.properties.failureCategory)));
    assert.equal(errorEvents.some(event => event.properties.failureCategory === 'parse'), true);
    assert.deepEqual(errors, [], 'no browser runtime errors');
    console.log('PASS: collection, explicit recognition, retry/conflict handling, review lifecycle, analytics, cleanup');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
