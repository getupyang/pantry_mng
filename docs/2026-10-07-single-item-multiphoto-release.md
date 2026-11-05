# 2026-10-07 · 单件商品多图联合识别上线记录

- 记录时间：2026-10-07 18:12（Asia/Seoul）
- 分支：`codex/single-item-multiphoto`
- 关联实现 commit：`d091b8a Close multi-photo release blockers`
- 生产部署：`dpl_5ePYiV7swHXK9KXJ2L4ca6iUR6sA`
- 正式地址：`https://pantry-mng.vercel.app`

## 改了什么

- 新增“单件商品 / 多件商品”入口选择，默认单件商品；本期多件商品入口保留现有订单截图批量流程。
- 单件商品支持从相机或本地一次收集 1–3 张照片，预览、追加、删除后再明确点击“开始识别”。
- 1–3 张照片合并为一次模型请求；多图被判断为不同商品时，显示冲突并禁止生成确认表单或保存。
- 识别调试记录继续保存压缩后的图片：单图保持历史字符串格式，多图使用 JSON 数组；管理后台兼容展示 1–3 张图片。
- 没有数据库 schema 迁移；仍使用现有 `pantry_recognition_reviews.image_data_url` 字段。

## 涉及文件

- `pantry.html`
- `api/openrouter.js`
- `api/admin/recognition-reviews.js`
- `admin.html`
- `scripts/dev-server.cjs`
- `scripts/test-multiphoto-api.mjs`
- `scripts/test-multiphoto-request.cjs`
- `scripts/test-multiphoto.cjs`
- `scripts/test-photo-live-args.cjs`
- `scripts/test-photo-live.cjs`
- `README.md`

## 用户如何验收

1. 在 iPhone Safari 打开或刷新 `https://pantry-mng.vercel.app/pantry.html`。
2. 进入添加页，保持默认“单件商品”。
3. 选择“拍照识别”，同意已有图片使用说明后拍摄或选择 1–3 张同一商品照片。
4. 确认照片以缩略图形式保留，且选图后不会立即识别；点击“开始识别”后只出现一份确认表单。
5. 将两个不同商品的照片放在同一组再次测试；预期提示图片冲突，且不会保存商品。

## 已验证

- smoke + touched suites：
  - `node --test scripts/test-multiphoto-api.mjs scripts/test-multiphoto-request.cjs scripts/test-photo-live-args.cjs scripts/test-intake.cjs scripts/test-ios-expiry.cjs`：47/47 通过。
  - `node --check api/openrouter.js`
  - `node --check scripts/dev-server.cjs`
  - `node --check scripts/test-photo-live.cjs`
  - `git diff --check 04b830a..HEAD`
- 浏览器回归：
  - `PLAYWRIGHT_MODULE=... node scripts/test-multiphoto.cjs`：通过收集、明确开始、重试/冲突、review 生命周期、analytics、清理。
  - `PLAYWRIGHT_MODULE=... node scripts/test-package-type.cjs`：通过语法、保存、筛选、重载、旧数据、导出、空态及 320/390/1280 布局。
- 预览部署 `dpl_D4QTU3pEHSrWYj5eGNsBZ1dzxqFX`：Vercel 鉴权读取页面后确认多图入口、模式选择器和“开始识别”均已部署。预览匿名浏览器受 Vercel Authentication 保护。
- 生产真实模型 smoke（390×844 Chromium）：
  - 同一商品正面 + 到期日两图：只发出 1 次识别请求，识别为 `TEST SHAMPOO / PANTRY LAB / 12 ml / 2028-10-01`，只保存 1 件；云端、localStorage、重载回读均通过；review `9948961e-44cc-43c8-9079-d0c9ab807ee9`。
  - 洗发水 + 牙膏两图：只发出 1 次识别请求，出现冲突提示，0 次家庭 PUT，云端家庭与本地数据均为空；review `1aba5daa-a96c-4366-ba69-d7ac4f0ce606`。
- 正式页面与部署源文件 SHA-256 一致：`db782ece10574722a81861b329e63ab1c3c0745b29a686576870ea2bfd51472b`。
- `vercel inspect dpl_5ePYiV7swHXK9KXJ2L4ca6iUR6sA`：`target=production`、`status=Ready`、正式别名正确。

本次没有跑全量历史回归：改动范围集中在图片入口、识别 API 和 review 展示，smoke、相关功能 suite、响应式浏览器回归与两条生产真实模型路径已覆盖主要风险。剩余设备层风险是尚未在真实 iPhone Safari 上人工操作相机/相册选择器。

## 发布与运行说明

- 已发布到 Vercel 生产环境；不需要独立重启后端，Serverless Functions 随部署更新。
- 不需要数据库迁移或数据回滚。
- iPhone Safari 建议刷新页面或关闭后重新打开，以避免旧页面缓存。
- Vercel 当前未配置 `PANTRY_ADMIN_TOKEN`；因此生产真实 smoke 验证了用户流程和 review ID，图片数组持久化/后台归一化由 API 与管理后台自动化测试覆盖，未在生产 admin 页面读取密钥保护接口。
- 开发在独立 worktree 完成，未带入原共享工作区的 `.gitignore` 和 `growth_loop/*` 等无关未提交改动。

## 适用范围与过时风险

本文记录的是 2026-10-07 的代码、Vercel 部署和模型行为。模型识别结果、Vercel 环境配置、管理后台认证状态和浏览器相机/相册行为可能随之后的实现或平台更新而变化；后续上线若修改相关代码，应重新执行局部回归与两条冲突/成功 smoke。
