# 家庭收纳 / Pantry（家用品余量）

这是一个**纯前端（单 HTML）**的小应用，用来记录家庭日用品的库存与使用区余量，并支持**拍照识别/订单截图识别**快速录入（当前通过 OpenRouter 多模态模型）。

> 本仓库同时存在 `pantry.html` 与 `pantry-v4_1.html` 两个主页面文件。通常以 **`pantry.html` 为最新**（文件时间更新更近，且包含近期 iPhone Safari 的保质期输入兼容修复）。

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

