## 2026-11-07 · 物品库分类组内排序切换（到期顺序 / 添加顺序）

- 记录时间：2026-11-07
- 关联分支：`codex/sort-by-expiry`（基于 main `46b5659`）
- 涉及文件：`pantry.html`、`scripts/test-sort-by-expiry.cjs`（新增）

### 改了什么（用户可见行为变化）

来源：线上活跃用户需求——「想在一个分类下按保质期快到期排序，知道先用什么后用什么」（例：所有防晒放一起，最快过期的排最前）。

- 物品库（gallery）保持按分类分组不变；在每个分类组**内部**新增排序。
- 筛选区新增「排序」切换（复用包装类型筛选的 pill 样式与持久化机制）：
  - **到期顺序（默认）**：最快过期的排最前；无保质期（null/空/非法日期）的排最后。
  - **添加顺序**：保持录入顺序。
- 选择持久化到 `localStorage`（`pantry_sort_mode`），刷新/重开保留。

### 实现要点

- 新增比较器 `compareByExpiry(a,b)`：按 `Date.parse(expiryDate)` 升序，无保质期视为 `Infinity` 排最后。
- `renderGallery` 组内：`sortMode==='expiry'` 时 `list.sort(compareByExpiry)`，否则保持数组顺序。
- `sortMode` 状态 + `setSortMode()` 完全镜像既有 `packageFilter` 的持久化写法。
- 排序切换与包装类型筛选合并进**同一个** `.package-filters` sticky 容器（两行 `.filter-row`），避免两个 sticky-top 块重叠；narrow-screen 布局由 `test-package-type` 的 320/390/1280 视口断言守住。

### 为什么默认到期

用户主诉求就是「最快过期排最前，先用快过期的」，故默认即到期顺序；想看录入顺序可一键切「添加顺序」。

### 用户如何验收

- 打开物品库，同一分类（如防晒）内，最快过期的物品排在最前；没有保质期的排在最后。
- 点「排序 → 添加顺序」→ 恢复录入顺序；刷新页面后排序选择保留。

### 已验证

- node-logic：`test-intake`(7)/`test-ios-expiry`(1)/`test-rate-limits`(1) 全 pass
- 浏览器端到端（Playwright + 真实 Chromium，dev-server :8031）：
  - `test-sort-by-expiry`（新增）PASS —— 默认到期、无保质期排最后、切换添加顺序、持久化、切回生效
  - `test-package-type` PASS —— 含 320/390/1280 视口布局（排序行不溢出）
  - `test-editable-category` / `test-stage2-edit-fields` PASS —— 无回归

### 适用范围与可能过时

- 描述的是 `codex/sort-by-expiry` 分支 2026-11-07 的实现，依赖当前 `renderGallery` 的分类分组结构与 `.package-filters` DOM。
- 仅做组内排序，未做跨分类的总临期清单（首页已有临期提醒）。
