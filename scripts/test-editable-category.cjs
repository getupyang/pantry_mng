// Run: PLAYWRIGHT_MODULE=/path/to/playwright PANTRY_CHROMIUM_PATH=/path/to/chromium node scripts/test-editable-category.cjs
// Serve the repository first. PANTRY_TEST_BASE_URL defaults to http://127.0.0.1:8031/pantry.html.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('pantry.html', 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
  new vm.Script(match[1]);
}

const baseURL = process.env.PANTRY_TEST_BASE_URL || 'http://127.0.0.1:8031/pantry.html';
const launchOptions = { headless: true };
if (process.env.PANTRY_CHROMIUM_PATH) launchOptions.executablePath = process.env.PANTRY_CHROMIUM_PATH;

async function chooseRequiredPackageType(page, prefix, value = 'regular') {
  await page.locator(`#${prefix}-package-type`).selectOption(value);
}

async function showRecognizedForm(page, result) {
  await page.evaluate(value => {
    document.getElementById('manual-form').style.display = 'none';
    document.getElementById('recog-result').style.display = 'block';
    fillFormFields(value);
  }, result);
}

(async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 204, body: '' }));
    await page.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 204, body: '' }));
    await page.route('**/api/**', route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{}',
    }));

    await page.goto(baseURL);
    await page.evaluate(() => {
      items.length = 0;
      save();
      localStorage.setItem('pantry_deduct_v4', String(Date.now()));
      window.__categoryEvents = [];
      window.__recognitionUpdates = [];
      trackEvent = (eventName, properties = {}) => window.__categoryEvents.push({ eventName, properties });
      updateRecognitionReview = payload => {
        window.__recognitionUpdates.push(payload);
        return Promise.resolve();
      };
      nav('scr-add');
    });

    assert.equal(await page.locator('#mf-category').count(), 1, 'missing #mf-category category selector');
    assert.equal(await page.locator('#fi-category').count(), 1, 'missing #fi-category category selector');

    const expectedCategories = await page.evaluate(() => [...new Set([...DETECT_MAP.map(rule => rule.cat), '其他'])]);
    for (const selector of ['#mf-category', '#fi-category']) {
      const options = await page.locator(`${selector} option`).evaluateAll(nodes => nodes.map(node => ({
        value: node.value,
        text: node.textContent.trim(),
      })));
      assert.deepEqual(options.map(option => option.value), expectedCategories, `${selector} exposes DETECT_MAP categories plus 其他`);
      assert.deepEqual(options.map(option => option.text), expectedCategories, `${selector} labels match category values`);
    }

    // A recognized manual name selects its rule category, but a user override is authoritative.
    await page.locator('#mf-name').fill('旅行洗发水 原味');
    assert.equal(await page.locator('#mf-category').inputValue(), '护发');
    await page.locator('#mf-category').selectOption('清洁');
    await page.locator('#mf-name').fill('清新薄荷牙膏');
    assert.equal(await page.locator('#mf-category').inputValue(), '口腔', 'editing a manual name re-suggests its newly detected category');
    await page.locator('#mf-category').selectOption('清洁');
    await page.locator('#mf-size').fill('30');
    await chooseRequiredPackageType(page, 'mf', 'travel');
    await page.getByRole('button', { name: '确认录入 →', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => ({ name: items[0].name, cat: items[0].cat })), {
      name: '清新薄荷牙膏',
      cat: '清洁',
    }, 'recognized manual name is unchanged and its category override is saved');

    // Without an override, a second recognized manual item keeps its detected category.
    await page.evaluate(() => nav('scr-add'));
    await page.locator('#mf-name').fill('夜间保湿面霜');
    assert.equal(await page.locator('#mf-category').inputValue(), '护肤');
    await chooseRequiredPackageType(page, 'mf');
    await page.getByRole('button', { name: '确认录入 →', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => ({ name: items.at(-1).name, cat: items.at(-1).cat })), {
      name: '夜间保湿面霜',
      cat: '护肤',
    }, 'recognized manual name and detected category are saved unchanged');

    // Unmatched names should make the fallback explicit rather than inherit the prior override.
    await page.evaluate(() => nav('scr-add'));
    await page.locator('#mf-name').fill('神秘日用品');
    assert.equal(await page.locator('#mf-category').inputValue(), '其他');
    await chooseRequiredPackageType(page, 'mf');
    await page.getByRole('button', { name: '确认录入 →', exact: true }).click();
    assert.equal(await page.evaluate(() => items.at(-1).cat), '其他');

    // Recognized/photo form uses the same detection and persists an explicit override.
    await page.evaluate(() => nav('scr-add'));
    await showRecognizedForm(page, { name: '薄荷牙膏', brand: '测试品牌', packageSize: 90, qty: 1 });
    assert.equal(await page.locator('#fi-category').inputValue(), '口腔');
    await page.locator('#fi-category').selectOption('纸品');
    await page.locator('#fi-name').fill('补充洗衣液');
    assert.equal(await page.locator('#fi-category').inputValue(), '清洁', 'editing a recognized-form name re-suggests its newly detected category');
    await page.locator('#fi-category').selectOption('纸品');
    await chooseRequiredPackageType(page, 'fi');
    await page.evaluate(() => {
      _currentRecognitionReviewId = 'review-category-test';
      _currentRecognitionReviewType = 'photo';
      _currentRecognitionParsedResult = { name: '薄荷牙膏', brand: '测试品牌', packageSize: 90, qty: 1 };
    });
    await page.getByRole('button', { name: '确认录入 →', exact: true }).click();
    assert.equal(await page.evaluate(() => items.at(-1).cat), '纸品');
    const observedPayloads = await page.evaluate(() => ({
      itemAdd: window.__categoryEvents.find(event => event.eventName === 'item_add' && event.properties.reviewId === 'review-category-test'),
      recognition: window.__recognitionUpdates.find(update => update.outcome === 'accepted'),
    }));
    assert.equal(observedPayloads.itemAdd.properties.cat, '纸品', 'final category reaches item-add analytics');
    assert.equal(observedPayloads.recognition.acceptedData.items.at(-1).cat, '纸品', 'final category reaches accepted-recognition payload');

    // Each order row must detect afresh; the next row cannot inherit a previous override.
    await page.evaluate(() => {
      nav('scr-add');
      document.getElementById('manual-form').style.display = 'none';
      document.getElementById('recog-result').style.display = 'block';
      window._orderItems = [
        { name: '订单洗发水', packageSize: 50, qty: 1 },
        { name: '订单抽纸', packageSize: 100, qty: 1 },
      ];
      window._currentOrderIndex = 0;
      _currentRecognitionReviewId = null;
      fillOrderRecognitionResult(window._orderItems[0], window._orderItems.length);
    });
    assert.equal(await page.locator('#fi-category').inputValue(), '护发');
    await page.locator('#fi-category').selectOption('口腔');
    await chooseRequiredPackageType(page, 'fi');
    await page.getByRole('button', { name: '确认录入 →', exact: true }).click();
    assert.equal(await page.locator('#fi-category').inputValue(), '纸品', 'next order item replaces the previous category with its own detection');
    await chooseRequiredPackageType(page, 'fi', 'refill');
    await page.getByRole('button', { name: '确认录入 →', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => items.slice(-2).map(item => item.cat)), ['口腔', '纸品']);

    await page.evaluate(() => {
      nav('scr-home');
      switchTab(1);
      setPackageFilter('all');
    });
    const overriddenItemGroup = await page.evaluate(itemName => {
      for (const label of document.querySelectorAll('#gallery-body .cat-label')) {
        const names = [...(label.nextElementSibling?.querySelectorAll('.gcard-name') || [])]
          .map(node => node.textContent.trim());
        if (names.includes(itemName)) return label.textContent.trim();
      }
      return null;
    }, '清新薄荷牙膏');
    assert.equal(overriddenItemGroup, '清洁', 'gallery places the specifically overridden item under its saved category');

    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => {
        nav('scr-add');
        document.getElementById('manual-form').style.display = 'block';
        document.getElementById('recog-result').style.display = 'block';
      });
      assert.ok(await page.evaluate(() => ['mf-category', 'fi-category'].every(id => {
        const rect = document.getElementById(id).getBoundingClientRect();
        return rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth;
      })), `category selectors fit ${width}px viewport`);
    }

    assert.deepEqual(errors, [], 'no browser runtime errors');
    console.log('PASS: editable category options, detection, overrides, recognition hooks, order reset, gallery grouping, and responsive layout');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
