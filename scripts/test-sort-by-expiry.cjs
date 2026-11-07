// Run: PLAYWRIGHT_MODULE=/path/to/playwright PANTRY_CHROMIUM_PATH=/path/to/chromium node scripts/test-sort-by-expiry.cjs
// Serve the repository first. PANTRY_TEST_BASE_URL defaults to http://127.0.0.1:8031/pantry.html.
// 覆盖：物品库分类组内排序切换（到期顺序 / 添加顺序），默认到期、无保质期排最后、持久化。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('pantry.html', 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);

const baseURL = process.env.PANTRY_TEST_BASE_URL || 'http://127.0.0.1:8031/pantry.html';
const launchOptions = { headless: true };
if (process.env.PANTRY_CHROMIUM_PATH) launchOptions.executablePath = process.env.PANTRY_CHROMIUM_PATH;

async function waitForSettledScreen(page, targetId) {
  await page.waitForFunction(id => {
    const target = document.getElementById(id);
    return target?.classList.contains('active')
      && [...document.querySelectorAll('.screen')].every(s => s === target || !s.classList.contains('active'));
  }, targetId);
}

// 读「防晒」分类组内卡片的名称顺序
async function sunscreenOrder(page) {
  return page.evaluate(() => {
    const labels = [...document.querySelectorAll('#gallery-body .cat-label')];
    const label = labels.find(el => el.textContent.trim() === '防晒');
    if (!label) return null;
    const grid = label.nextElementSibling;
    return [...grid.querySelectorAll('.gcard-name, .gcard .gcard-name, .gcard [class*="name"]')]
      .map(el => el.textContent.trim())
      .filter(Boolean);
  });
}

(async () => {
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 204, body: '' }));
    await page.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 204, body: '' }));
    await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));

    await page.goto(baseURL);
    // 构造同类(防晒)三件 + 一件无保质期，按「添加顺序」故意乱序
    await page.evaluate(() => {
      localStorage.removeItem('pantry_sort_mode');
      localStorage.setItem('pantry_deduct_v4', String(Date.now()));
      trackEvent = () => {};
      const mk = (id, name, exp) => ({
        id, name, brand: '', cat: '防晒', packageType: 'regular', packageSize: 50, unit: 'ml',
        activePercent: 0, openCount: 0, stockCount: 1, dailyUse: 1, color: ['#f6e9b8', '#c7972e', '#75550d'],
        shape: 'facewashTube', expiryDate: exp, openedDate: null, logs: [], openItems: [], openedDates: [],
      });
      items.length = 0;
      items.push(mk('s-mid', '防晒B-中', '2027-06-01'));
      items.push(mk('s-none', '防晒D-无期', null));
      items.push(mk('s-soon', '防晒A-最快', '2026-12-01'));
      items.push(mk('s-late', '防晒C-最晚', '2028-06-01'));
      save();
    });

    await page.evaluate(() => { sortMode = 'expiry'; renderGallery(); nav('scr-home'); renderGallery(); });

    // 默认应为到期顺序：最快过期在前，无保质期最后
    const defaultOrder = await sunscreenOrder(page);
    assert.ok(defaultOrder && defaultOrder.length === 4, `防晒组应有4件，实际:${JSON.stringify(defaultOrder)}`);
    assert.deepEqual(defaultOrder, ['防晒A-最快', '防晒B-中', '防晒C-最晚', '防晒D-无期'],
      '默认到期顺序：最快过期在前，无保质期排最后');

    // 切到「添加顺序」→ 回到录入顺序
    await page.evaluate(() => setSortMode('added'));
    const addedOrder = await sunscreenOrder(page);
    assert.deepEqual(addedOrder, ['防晒B-中', '防晒D-无期', '防晒A-最快', '防晒C-最晚'],
      '添加顺序：保持录入顺序');

    // 持久化：刷新后仍是「添加顺序」
    await page.reload();
    await page.evaluate(() => { nav('scr-home'); renderGallery(); });
    const persisted = await page.evaluate(() => sortMode);
    assert.equal(persisted, 'added', '排序模式持久化到 localStorage，刷新后保留');

    // 切回到期
    await page.evaluate(() => setSortMode('expiry'));
    const backToExpiry = await sunscreenOrder(page);
    assert.deepEqual(backToExpiry, ['防晒A-最快', '防晒B-中', '防晒C-最晚', '防晒D-无期'],
      '切回到期顺序生效');

    assert.deepEqual(errors, [], 'no browser runtime errors');
    console.log('PASS: 分类组内排序默认到期(最快在前/无期在后)、可切换添加顺序、持久化、切回生效');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
