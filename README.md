# 家庭收纳 / Pantry（家用品余量）

这是一个**纯前端（单 HTML）**的小应用，用来记录家庭日用品的库存与使用区余量，并支持**拍照识别/订单截图识别**快速录入（当前通过 OpenRouter 多模态模型）。

> 本仓库同时存在 `pantry.html` 与 `pantry-v4_1.html` 两个主页面文件。通常以 **`pantry.html` 为最新**（文件时间更新更近，且包含近期 iPhone Safari 的保质期输入兼容修复）。`pantry-v4_1.html`文件可以废弃。

---

## 后端化方案入口（新增）

- 已新增完整方案文档：`后端化产品技术方案.md`
- 文档内容覆盖：
  - 完全不登录（匿名 `clientId`）的产品路径
  - v1（浏览器级家庭）与 v2（多设备/多人共享，全员可编辑）演进方案
  - 后端 API 设计、数据表设计、同步冲突策略、AI 限流与成本控制
  - 里程碑与验收标准（便于后续 coding agent 直接接手）

### 存档与产品体验

- **`当前状态存档.md`**：联调通过后的技术快照（API、`pantry_*` 表、环境变量、注意点）。
- **`产品体验与新用户旅程.md`**：新用户旅程与产品亮点（打动用户的表达与 60 秒内路径）。
- **`空状态与行为日志方案.md`**：首屏无物品时的引导文案/入口，以及补库存、识别失败与手动纠错等**行为日志**事件设计。

---

## 后端化实现状态（当前）

- 主入口：`pantry.html`
- 已新增后端目录：`api/`
  - `api/families/ensure.js`
  - `api/families/[familyId].js`
  - `api/families/[familyId]/join-token.js`
  - `api/families/join.js`
  - `api/openrouter.js`
- 已新增 Supabase SQL：`supabase/schema.sql`
- 前端（`pantry.html`）已接入 v1 云同步：
  - 浏览器首次打开自动创建/绑定匿名 `clientId`
  - 自动关联一个 `family`
  - 本地保存后防抖同步到云端
  - 版本冲突时自动拉取最新数据并提示

---

## 已实现能力（以代码为准）

- **物品管理**
  - 物品库 / 仪表盘浏览
  - 详情页展示：余量、库存、保质期预警、操作日志
  - 手动录入：品名/品牌/容量/数量/保质期/库存地点

- **双层库存模型（使用区 + 库存货架）**
  - 使用区：已开封的“件”，支持每件独立余量
  - 库存：未开封新品计数（取出加入使用区时按 100% 初始化）

- **多件（多瓶）独立管理**
  - 数据结构：`openItems: number[]`（每件的百分比，如 `[60, 80]`）
  - 详情页：chip 选择当前件；拖拽只影响选中件
  - 向后兼容：若旧数据只有 `activePercent`，会在运行时初始化 `openItems`

- **AI 识别录入（OpenRouter）**
  - `recognizePhoto(imageFile)`：单张商品照片识别（name/brand/packageSize/unit/qty/expiryDate）
  - `recognizeOrder(imageFile)`：订单截图识别（返回数组，逐个填充录入）
  - 图片预处理：压缩、格式处理（含 HEIC 兼容）
  - 解析策略：JSON 解析 + 文本 fallback

- **数据导出**
  - 导出为 JSON 文件（文件名形如 `pantry-export-YYYYMMDD-*.json`）

- **移动端体验**
  - iPhone：左侧边缘右滑返回首页
  - iPhone Safari：保质期输入框兼容（把 `type="date"` 降级为文本输入，仍支持 `YYYY-MM-DD`）

---

## 关键文件

- **主页面（推荐）**：`pantry.html`
- **另一份主页面**：`pantry-v4_1.html`（同样可运行，但可能不含最新修复/改动）
- **配置**：`config.js`
  - OpenRouter API Key 存在浏览器 `localStorage`：`pantry_openrouter_key`
  - OpenRouter 请求配置：`OPENROUTER_CONFIG`（url/model/timeout）

---

## 本地运行

### 方式 1：直接打开（电脑）

- 直接双击打开 `pantry.html`

### 方式 2：起本地静态服务器（推荐，手机也能访问）

```bash
cd "/Users/getupyang/Documents/ai/coding/家庭收纳"
python3 -m http.server 8000
```

- 电脑访问：`http://localhost:8000/pantry.html`
- 手机访问：`http://你的电脑IP:8000/pantry.html`

---

## 如何配置 OpenRouter Key

应用内“设置”页提供 Key 配置入口，Key 会存到浏览器本机的 `localStorage`（key 名：`pantry_openrouter_key`）。

> 说明：当前实现是**前端直连 OpenRouter**，因此 key 会存在本地浏览器。若要线上化，需要改为后端代理（Vercel/Serverless）以避免 key 暴露。

> 更新：`pantry.html` 已接入后端代理 `api/openrouter.js`（推荐线上使用后端环境变量 `OPENROUTER_API_KEY`）。设置页中的本地 Key 配置可作为临时/兼容入口，后续可下线。

---

## Vercel 环境变量（后端）

请在 Vercel 项目中配置：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENROUTER_API_KEY`

> 注意：`SUPABASE_SERVICE_ROLE_KEY` 与 `OPENROUTER_API_KEY` 只能用于后端，不可暴露到前端。

---

## 数据结构速览（items）

核心数据保存在浏览器 `localStorage`（应用内部维护一个 `items` 数组）。单个 item 的常见字段：

- `id: string`
- `name: string`
- `brand: string`
- `cat: string`
- `packageSize: number`
- `unit: string`
- `openItems: number[]`（每件百分比）
- `openCount: number`（通常等于 `openItems.length`）
- `activePercent: number`（兼容字段，常用于卡片显示的“平均值”）
- `stockCount: number`
- `dailyUse: number`（存在于数据结构中）
- `expiryDate: string | null`（`YYYY-MM-DD`）
- `openedDate: string | null`
- `logs: { type, desc, delta, date }[]`

---

## 现有文档与代码的差异（已确认）

这部分是为了让后续 agent **不要被旧文档误导**：

- **`测试指南.md`**
  - 写的是主文件 `pantry-v4_1.html`：目前仓库里同时存在 `pantry.html` 与 `pantry-v4_1.html`，且 `pantry.html` 通常更新更近。
  - 写“照片识别功能还未实现”：目前 `pantry.html` 已实现 `recognizePhoto/recognizeOrder` 与 UI 入口。

- **`实施计划.md`**
  - 写“每日扣减：完全不做，移除相关代码”：当前 `pantry.html` 仍存在每日扣减相关逻辑（如 `runDeduction()`），并非完全移除。
  - 其余关于多件（openItems）与 OpenRouter 集成的描述与现有代码总体一致。

---

## 给后续开发 agent 的注意事项

- 本项目是“单 HTML 大文件”，改动前请先确认要改的是 `pantry.html` 还是 `pantry-v4_1.html`。
- 当前代码里对旧数据有兼容初始化逻辑，避免在运行时覆盖已有 `openItems`。
- 若做线上化：
  - 不要把 OpenRouter Key 放在前端；应改为服务端代理。
  - localStorage 数据迁移到云端时，要考虑首次导入、冲突策略与离线体验。

