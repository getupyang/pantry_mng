// Run: PLAYWRIGHT_MODULE=/path/to/playwright PANTRY_CHROMIUM_PATH=/path/to/chromium node scripts/test-stage2-edit-fields.cjs
// Serve the repository first. PANTRY_TEST_BASE_URL defaults to http://127.0.0.1:8031/pantry.html.
// 覆盖阶段2三项新行为：单位可编辑(克/毫升不被吞)、连续录入清空、已存物品可编辑。
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
    await page.evaluate(() => {
      items.length = 0;
      save();
      localStorage.setItem('pantry_deduct_v4', String(Date.now()));
      trackEvent = () => {};
    });

    // ───────── 1. 单位可编辑：用户填的单位不被规则覆盖 ─────────
    await page.evaluate(() => nav('scr-add'));
    await waitForSettledScreen(page, 'scr-add');

    // 洗面奶的关键词规则默认单位是 g；用户改成 ml 后必须保留 ml
    await page.locator('#mf-name').fill('洗面奶');
    assert.equal(await page.locator('#mf-unit').inputValue(), 'g', '规则默认把洗面奶单位设为 g');
    await page.locator('#mf-unit').selectOption('ml');
    await page.locator('#mf-size').fill('150');
    await page.locator('#mf-category').selectOption('洁面');
    await page.locator('#mf-package-type').selectOption('regular');
    await page.locator('#confirm-btn').click();
    await waitForSettledScreen(page, 'scr-home');
    assert.deepEqual(
      await page.evaluate(() => ({ unit: items[0].unit, size: items[0].packageSize })),
      { unit: 'ml', size: 150 },
      '用户把单位从 g 改成 ml 后，保存的是 ml 150，而不是被规则吞回 g',
    );

    // 「其他」单位可手输
    await page.evaluate(() => nav('scr-add'));
    await waitForSettledScreen(page, 'scr-add');
    await page.locator('#mf-name').fill('自制分装瓶');
    await page.locator('#mf-unit').selectOption('__other__');
    await page.locator('#mf-unit-custom').fill('滴');
    await page.locator('#mf-size').fill('30');
    await page.locator('#mf-package-type').selectOption('regular');
    await page.locator('#confirm-btn').click();
    await waitForSettledScreen(page, 'scr-home');
    assert.equal(await page.evaluate(() => items.at(-1).unit), '滴', '「其他」单位手输「滴」被保存');

    // ───────── 2. 连续录入：开始下一件时彻底清空 ─────────
    await page.evaluate(() => nav('scr-add'));
    await waitForSettledScreen(page, 'scr-add');
    assert.deepEqual(
      await page.evaluate(() => ({
        name: document.getElementById('mf-name').value,
        brand: document.getElementById('mf-brand').value,
        size: document.getElementById('mf-size').value,
        exp: document.getElementById('mf-exp').value,
        cat: document.getElementById('mf-category').value,
        unit: document.getElementById('mf-unit').value,
      })),
      { name: '', brand: '', size: '', exp: '', cat: '其他', unit: 'ml' },
      '开始下一件时 品名/品牌/容量/日期 全部清空，分类回其他、单位回 ml',
    );

    // ───────── 3. 已存物品可编辑：详情页编辑后全字段生效，库存不动 ─────────
    const firstId = await page.evaluate(() => items[0].id);
    const beforeStock = await page.evaluate(id => {
      const it = items.find(x => x.id === id);
      return { stockCount: it.stockCount, logsLen: it.logs.length };
    }, firstId);

    await page.evaluate(id => openDetail(id), firstId);
    await waitForSettledScreen(page, 'scr-detail');
    await page.locator('.d-edit-btn').first().click();
    await waitForSettledScreen(page, 'scr-add');
    assert.equal(await page.locator('#confirm-btn').textContent(), '保存修改 →', '编辑模式按钮文案变为「保存修改」');
    assert.equal(await page.locator('#mf-name').inputValue(), '洗面奶', '编辑表单预填当前品名');
    assert.equal(await page.locator('#mf-unit').inputValue(), 'ml', '编辑表单预填当前单位 ml');

    // 改名称、品牌、容量、单位、分类
    await page.locator('#mf-name').fill('氨基酸洁面');
    await page.locator('#mf-brand').fill('珂润');
    await page.locator('#mf-size').fill('200');
    await page.locator('#mf-unit').selectOption('g');
    await page.locator('#mf-category').selectOption('洁面');
    await page.locator('#confirm-btn').click();
    await waitForSettledScreen(page, 'scr-detail');

    const afterEdit = await page.evaluate(id => {
      const it = items.find(x => x.id === id);
      return { name: it.name, brand: it.brand, size: it.packageSize, unit: it.unit, cat: it.cat, stockCount: it.stockCount, logsLen: it.logs.length };
    }, firstId);
    assert.deepEqual(
      afterEdit,
      { name: '氨基酸洁面', brand: '珂润', size: 200, unit: 'g', cat: '洁面', stockCount: beforeStock.stockCount, logsLen: beforeStock.logsLen },
      '编辑保存后基础字段全部更新，且库存数量与日志条数不变',
    );

    // 编辑模式退出后不应污染下一次普通录入（不会再更新旧物品）
    await page.evaluate(() => nav('scr-add'));
    await waitForSettledScreen(page, 'scr-add');
    assert.equal(await page.locator('#confirm-btn').textContent(), '确认录入 →', '离开编辑后按钮文案恢复');
    const countBefore = await page.evaluate(() => items.length);
    await page.locator('#mf-name').fill('牙膏');
    await page.locator('#mf-package-type').selectOption('regular');
    await page.locator('#confirm-btn').click();
    await waitForSettledScreen(page, 'scr-home');
    assert.equal(await page.evaluate(() => items.length), countBefore + 1, '编辑后再录入是新增一件，不是改旧物品');

    assert.deepEqual(errors, [], 'no browser runtime errors');
    console.log('PASS: 单位可编辑(克/毫升不被吞)、其他单位手输、连续录入清空、已存物品编辑保留库存、编辑态不污染后续录入');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
