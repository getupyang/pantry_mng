## 2026-11-05 · 已存物品可编辑 + 单位可编辑 + 连续录入清空 + 底妆拆分

- 记录时间：2026-11-05
- 关联分支：`codex/stage2-editable-fields`（基于 main `fd2148b` 统一发布基线）
- 涉及文件：`pantry.html`、`scripts/test-editable-category.cjs`、`scripts/test-stage2-edit-fields.cjs`（新增）

### 改了什么（用户可见行为变化）

来源：线上唯一活跃用户录音反馈（《用品盘点产品讨论》2026-11-02）。本批修复四项：

1. **单位可编辑（修「克/毫升被吞」）** —— 录入表单的单位从不可编辑 `<span>` 改为「下拉 + 其他可手输」(`#mf-unit`/`#fi-unit` + `#mf-unit-custom`/`#fi-unit-custom`)。AI 仍给建议默认值，但用户改了就保留，`confirmAdd` 从 `getFormUnit()` 读取而非 span 的 textContent。
2. **已保存物品可编辑** —— 详情页「物品信息」区新增「编辑」按钮 → `openEditItem(id)` 复用手动录入表单并预填当前值；`confirmAdd` 在 `_editingItemId` 分支里更新现有 item 的 名称/品牌/分类/包装类型/容量/单位/保质期，**保留库存、开封状态、日志、用量等运行时字段**。编辑态在离开录入页或保存后由 `exitEditMode()` 清除，不污染后续普通录入。
3. **连续录入彻底清空** —— 新增 `clearIntakeForms()`，保存后把 品名/品牌/容量/日期/数量/单位/分类/包装类型/识别徽标/录入状态全部重置（旧逻辑只清了部分字段，导致继承上一件的品牌/容量/日期）。
4. **底妆拆成「气垫 / 粉底液」互为替代** —— `DETECT_MAP` 里原 `底妆` 规则拆成两条，加 `substitutes` 字段（为后续 P2 购买决策的替代关系判断预留）；`ITEM_CATEGORIES` 同步。

### 为什么改

用户录音原话："只要我一填完，就完全没有办法改" / "我写了毫升，他背后是克，他把我的改省略了"。核查确认：详情页原本只有包装类型/地点可改，单位是规则写死的 span。属功能缺口 + 交互 bug。

### 用户如何验收

- 录入「洗面奶」（规则默认单位 g）→ 把单位下拉改成 ml → 保存 → 详情页单件容量显示 ml。
- 任一物品详情页点「编辑」→ 改名称/容量/单位/分类 → 保存 → 变化生效，库存余量和历史记录不变。
- 连续录入第二件时，表单为空（不残留上一件）。

### 已验证

- node-logic：`test-intake`(7) / `test-ios-expiry`(1) / `test-rate-limits`(1) 全 pass
- 浏览器端到端（Playwright + 真实 Chromium，本地 dev-server :8031）：
  - `test-editable-category` PASS（含底妆拆分新断言）
  - `test-package-type` PASS（无回归）
  - `test-stage2-edit-fields`（新增）PASS —— 覆盖单位可编辑、其他单位手输、连续录入清空、编辑保留库存、编辑态不污染后续录入

### 适用范围与可能过时

- 本文件描述的是 `codex/stage2-editable-fields` 分支在 2026-11-05 的实现状态，依赖当前 `pantry.html` 的表单 DOM 结构（`mf-*`/`fi-*` id）。
- 浏览器测试需本地装 `playwright` 并用已有 chromium（`PANTRY_CHROMIUM_PATH`），仓库未提交 `node_modules`。
- 单位下拉选项集（`UNIT_OPTIONS`）为当前预设，未来品类扩展可能需要补充。
