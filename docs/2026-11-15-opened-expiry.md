# 2026-11-15 · 开封后保质期

- 记录与验证时间：2026-11-15（Asia/Tokyo）。
- 功能 commit：`66b6e5ccee6e9827cbbb2c02a663c3a0463c18dc`；开发分支：`codex/opened-expiry`。
- 基线：`origin/main cfa2476f3fec7a5a171769b28374a0731514a56f`，开发前已核对正式域名 HTML 与该提交完全一致；使用独立 worktree，不合入历史功能分支。

## 改了什么、为什么

录入和编辑可选填开封后保质期，默认单位月，支持天/年；月固定 30 天、年固定 365 天。点击开封当天开始计时，每件独立计算，与包装到期日取较早者。详情、物品库排序和首页预警共用此计算，空件不参与。未填写则沿用包装期限。

拍照、多图、订单识别仅在录入时提取有明确开封说明/PAO 依据的时长，允许人工修改。无依据、未开封期限、泛泛的保存提示或数值/单位不符的证据都留空。开封/查看/编辑不调用模型。

已开封录入沿用当天起算，提示文案明确说明。已有记录未知的逐件开封日保持未知，不借用另一件日期。日期保存采用本地年月日，日期加减使用整数天数，避开 UTC 跨日及 DST 偏差。拖动余量至零后立即刷新期限，快速松手也先完成最后一帧再保存。

涉及文件：`pantry.html`；新增 `scripts/test-opened-expiry.cjs`、`scripts/test-opened-expiry-ui.cjs`、`scripts/test-opened-expiry-live.cjs`；`scripts/test-package-type.cjs` 增加导航动画结束后的布局等待；对应设计和实现计划位于 `docs/superpowers/`。

## 用户如何验收

1. 刷新正式站点，手动录入一个测试物品，包装到期日设在一年后，开封后保质期填 `1 月`，选择未开封入库并保存。
2. 打开详情并点击「开封使用」：当前件到期日为当天 + 30 天，剩余 30 天，计算依据为开封期限。
3. 编辑为 `7 天`：到期日立即改为原开封日 + 7 天；改 `1 年` 则 + 365 天。清空时长则恢复包装期限；若包装日期较早，始终以包装日期为准。
4. 刷新页面确认信息保留。多件分别开封时，各件使用自己的日期；空件不再产生到期提醒。

## 已验证

采用 smoke + touched suite + 发布前全量现有自动回归。模型默认 mock，仅额外 1 次合成标签真实识别。

```sh
node --test scripts/test-intake.cjs scripts/test-ios-expiry.cjs scripts/test-multiphoto-request.cjs scripts/test-multiphoto-api.mjs scripts/test-photo-live-args.cjs scripts/test-rate-limits.mjs scripts/test-opened-expiry.cjs
TZ=America/New_York node --test scripts/test-opened-expiry.cjs
git diff --check
```

结果：60 项 Node 测试通过；纽约时区额外 12 项通过。新测试在实现前明确失败，并对错误证据、快速松手和非法单位执行 red→green 验证。

浏览器使用 `PLAYWRIGHT_MODULE=<Playwright 安装目录>`；测试服务器从该 worktree 启动。旧多图/包装脚本使用 8031（需可访问 admin.html）；其余测试用 `PANTRY_TEST_BASE_URL=http://127.0.0.1:8039/pantry.html`：

```sh
node scripts/test-opened-expiry-ui.cjs
node scripts/test-stage2-edit-fields.cjs
node scripts/test-sort-by-expiry.cjs
node scripts/test-editable-category.cjs
node scripts/test-package-type.cjs
node scripts/test-multiphoto.cjs
```

6 套均通过：手动录入、单位切换、编辑、开封/撤销、日期未知与多件选择、空件排除、快拖动、排序/提醒、照片/订单确认、连续录入重置、mock 云同步回读；保留既有分类/包装类型/多图/审查流程。检查 320/390 像素、大字号布局，并查看截图，新增字段和期限区无溢出。

真实链路（显式 opt-in，产生测试家庭与一次付费模型请求）：

```sh
PANTRY_LIVE_TEST=yes PANTRY_LIVE_RECOGNITION=yes PANTRY_LIVE_LOCAL_HTML=yes node scripts/test-opened-expiry-live.cjs
```

在正式域名的隔离浏览器中加载候选 HTML，实际调用线上 API。合成标签 `After opening, use within 6 months.` 正确识别为 `{value:6,unit:'month'}`，包装到期日 `2028-12-31` 正确。新建家庭的保存→开封→独立 GET→导出→删除本地缓存→云端回读通过，剩余 180 天，实际模型调用 1 次，API 全部 200。最后清空该隔离家庭测试库存并回读确认为空；服务按既有机制可能保留测试家庭、版本备份及调用日志。没有使用用户照片或既有家庭数据。

## 范围、发布与过时风险

- 不涉及 API/数据库 schema 变更，不迁移用户库存；新增 `openedShelfLife` 随 items JSON 正常同步和导出，无需手动重启服务。
- 截至本记录提交时：功能及发布前验证已完成，生产发布需以合并后的 Vercel Ready、正式域名源码哈希和上线后 smoke 为准；不能把 feature branch / preview 当作正式上线。
- 上线后命令：`PANTRY_LIVE_TEST=yes node scripts/test-opened-expiry-live.cjs`（不设置 `PANTRY_LIVE_LOCAL_HTML`，使用实际生产页面；默认不再调用模型），并对正式域名运行 API 全 mock 的 UI smoke、核对源码哈希。
- 适用于当前单 HTML、逐件 openedDates 和 family data_json 同步结构。这些 UI、运行版本、模型返回格式与部署状态是当时状态，可能随实现变化过时。
- 真机 iPhone Safari 未操作；已覆盖 iOS 日期解析单元测试和 Chromium 移动布局。一次合成标签识别不代表所有真实包装、语言、模糊照片的识别质量。旧版本客户端须刷新以显示新字段。
