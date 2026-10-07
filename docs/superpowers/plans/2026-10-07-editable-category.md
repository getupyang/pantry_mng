# Editable Add-Page Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app's existing automatic `cat` classification editable in both add-item forms, while continuing to save the user's final choice in the existing item JSON.

**Architecture:** Keep the existing string `cat` field. Build both selectors from one explicit flat `ITEM_CATEGORIES` catalog, use `DETECT_MAP` only to suggest a detailed category from the name, and separate the selected category from the detected rule so category edits do not alter shape, unit, daily use, or color.

**Tech Stack:** Single-file HTML/CSS/vanilla JavaScript app, Node.js `node:test`/assertions, Playwright browser tests, local static HTTP server.

---

## File map

- Modify `pantry.html`: add the two category selectors, populate them from the explicit flat catalog, keep automatic selection in sync with detailed name rules/recognition, and save the selected value.
- Create `scripts/test-editable-category.cjs`: browser regression covering automatic selection, manual override, photo/order form behavior, fallback, persistence, gallery grouping, and responsive layout.
- Create `docs/editable-category.md`: dated implementation and verification record linked to the feature commit.

### Task 1: Add a failing browser test for editable classification

**Files:**
- Create: `scripts/test-editable-category.cjs`
- Reference: `scripts/test-package-type.cjs`
- Reference: `pantry.html:689-725`
- Reference: `pantry.html:1055-1096`
- Reference: `pantry.html:3269-3362`

- [ ] **Step 1: Create the browser test using the existing test harness**

Use the same syntax compilation and mocked API setup as `scripts/test-package-type.cjs`. Clear the in-memory inventory before assertions, enter the add screen, and assert that `#mf-category` and `#fi-category` exist.

The corrected test must assert the product vocabulary explicitly rather than derive it from detection rules:

```js
const expectedCategories = [
  '面膜', '面霜', '水', '乳液', '精华', '洁面', '护手霜', '身体乳', '防晒', '香水',
  '洗发水', '护发精油', '护发素',
  '底妆', '修容', '口红', '眼线笔', '腮红', '高光', '假睫毛', '散粉', '定妆喷雾',
  '口腔', '清洁', '纸品', '其他',
];
assert.deepEqual(
  await page.locator('#mf-category option').evaluateAll(options => options.map(option => option.value)),
  expectedCategories
);
```

Cover these behaviors in order:

```js
await page.locator('#mf-name').fill('洗发水');
assert.equal(await page.locator('#mf-category').inputValue(), '洗发水');
await page.locator('#mf-category').selectOption('其他');
await page.locator('#mf-package-type').selectOption('regular');
await page.getByRole('button', {name:'确认录入 →', exact:true}).click();
assert.equal(await page.evaluate(() => items.at(-1).cat), '其他');
```

Also assert:

- A second recognized manual name saves the unchanged detected category.
- An unmatched manual name selects and saves `其他`.
- `fillFormFields()` selects the detected category in `#fi-category`.
- A photo/recognized-form manual override is saved.
- The next order item replaces the previous item's manual category with its own detected category.
- `trackEvent('item_add')` and the accepted recognition payload use the final saved category.
- The gallery group heading matches the final chosen category.
- Both selectors fit inside 320, 390, and 1280 pixel viewports.
- There are no browser `pageerror` events.

- [ ] **Step 2: Start the local static server**

Run:

```bash
python3 -m http.server 8031
```

Expected: the server listens on `127.0.0.1:8031` or `0.0.0.0:8031` and serves `pantry.html`. Keep it running for the following browser-test steps.

- [ ] **Step 3: Run the new test and confirm the expected failure**

Run:

```bash
PLAYWRIGHT_MODULE=/Users/getupyang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node scripts/test-editable-category.cjs
```

Expected: FAIL because `#mf-category` and `#fi-category` do not exist yet. A syntax error or unrelated runtime failure is not the expected failure and must be fixed before continuing.

- [ ] **Step 4: Commit the failing test**

```bash
git add scripts/test-editable-category.cjs
git commit -m "test: cover editable add-page category"
```

### Task 2: Implement editable category selection in the existing add flow

**Files:**
- Modify: `pantry.html:689-725`
- Modify: `pantry.html:1055-1096`
- Modify: `pantry.html:3269-3362`
- Modify: `pantry.html:3378-3390`
- Test: `scripts/test-editable-category.cjs`

- [ ] **Step 1: Add category selectors to both add forms**

Add a `<select class="package-select">` row immediately after the name row in each form:

```html
<div class="frow">
  <label class="flabel" for="fi-category">分类</label>
  <select class="package-select" id="fi-category"></select>
</div>
```

Add the corresponding `mf-category` row to the manual form. Add an `oninput` handler to `#fi-name` so editing a recognized name reruns the same category suggestion behavior as manual entry.

- [ ] **Step 2: Populate category selectors from existing detection rules**

After `DETECT_MAP`, add one shared option source and initializer:

```js
const ITEM_CATEGORIES=[...new Set(DETECT_MAP.map(rule=>rule.cat)),'其他'];

function initCategorySelects(){
  const html=ITEM_CATEGORIES.map(cat=>`<option value="${cat}">${cat}</option>`).join('');
  ['mf-category','fi-category'].forEach(id=>{
    const select=document.getElementById(id);
    if(select)select.innerHTML=html;
  });
}
```

Call `initCategorySelects()` during app initialization before the user can open the add screen. Do not add new category values or keyword rules.

- [ ] **Step 3: Share automatic suggestion without coupling it to item rendering properties**

Add a focused helper:

```js
function suggestCategory(name,selectId){
  const detected=detectItem(name);
  const select=document.getElementById(selectId);
  if(select)select.value=detected?.cat||'其他';
  return detected;
}
```

Update `autoDetect()` so manual name input calls `suggestCategory(val,'mf-category')` while retaining the current badge, unit, `_lastDetected`, and daily-use behavior. Update recognized-name input/fill behavior to call `suggestCategory(name,'fi-category')`. Every name change reruns the suggestion; merely changing another field must not overwrite the user's category selection.

- [ ] **Step 4: Save the user's final category**

In `confirmAdd()`, read the category from the currently visible form:

```js
const categorySelect=document.getElementById(isManual?'mf-category':'fi-category');
const finalCategory=categorySelect?.value||'其他';
const d=detectItem(name)||_lastDetected||{
  cat:'其他',shape:'generic',unit:'ml',daily:1,
  color:['#c8d8e8','#5878a0','#284060']
};
```

Set `newItem.cat` to `finalCategory`. Use `newItem.cat` rather than `d.cat` in `trackEvent('item_add')` and keep the accepted recognition payload sourced from `newItem.cat`. Leave `shape`, `unit`, `dailyUse`, and `color` sourced from `d`.

Reset both category selectors to `其他` after a completed single-item or final order save. Do not reset before `fillOrderRecognitionResult()` populates the next order item, because that function must select the next detected category.

- [ ] **Step 5: Run the focused browser test**

Run:

```bash
PLAYWRIGHT_MODULE=/Users/getupyang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node scripts/test-editable-category.cjs
```

Expected: PASS for option derivation, manual automatic selection, override, unmatched fallback, recognized form, order reset, saved payload, gallery grouping, responsive layout, and runtime errors.

- [ ] **Step 6: Run existing touched regression tests**

Run:

```bash
PLAYWRIGHT_MODULE=/Users/getupyang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node scripts/test-package-type.cjs
node --test scripts/test-intake.cjs
git diff --check
```

Expected: package-type browser regression passes, intake suite reports 7 passing tests, and `git diff --check` emits no errors. Do not run the live photo script because it calls the real model and writes to a cloud test family; this change can be verified with mocked recognition form data.

- [ ] **Step 7: Commit the implementation**

```bash
git add pantry.html scripts/test-editable-category.cjs
git commit -m "Add editable category to item intake"
```

### Task 3: Record verification and perform final branch checks

**Files:**
- Create: `docs/editable-category.md`
- Reference: `docs/package-type.md`

- [ ] **Step 1: Capture the feature commit and verification evidence**

Run:

```bash
git log -1 --oneline
git status --short --branch
```

Expected: the feature commit is at `HEAD` and only the new documentation file remains to be created.

- [ ] **Step 2: Write the dated implementation note**

Create `docs/editable-category.md` with:

```markdown
## 2026-10-07 · 添加页分类可编辑

- 记录时间：2026-10-07（KST）。
- 关联 commit：`<Task 2 feature commit hash>`；分支 `codex/editable-category`。
- 涉及文件：`pantry.html`、`scripts/test-editable-category.cjs`。
- 用户可见变化：现有自动分类在手动、照片和订单添加表单中可修改，最终选择保存到 `cat`。
- 用户如何验收：输入一个可识别品名，确认分类自动选中；改选后录入，物品库应按改选分类分组。
- 已验证：列出 Task 2 实际运行且通过的命令。
- 适用范围：当前单 HTML 页面及 `items` JSON 同步。
- 可能过时的地方：`DETECT_MAP`、添加表单结构或同步方式变化后需重新核对。
```

Do not include private inventory contents, credentials, API keys, or screenshots.

- [ ] **Step 3: Commit the documentation**

```bash
git add docs/editable-category.md
git commit -m "Document editable category verification"
```

- [ ] **Step 4: Run final smoke checks and inspect only this branch's changes**

Run:

```bash
PLAYWRIGHT_MODULE=/Users/getupyang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright node scripts/test-editable-category.cjs
git diff --check origin/codex/package-type-filter...HEAD
git status --short --branch
git log --oneline -4
```

Expected: the focused test passes; diff check is clean; the worktree has no uncommitted files; history contains the design, plan, test, implementation, and verification documentation commits. Do not push or deploy unless the user separately authorizes publication.
