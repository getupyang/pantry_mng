## 2026-10-07 · iOS Safari 紧凑日期输入修复

- 记录时间：2026-10-07（KST）。
- 分支：`codex/ios-date-input`；功能 commit：`248dcf0`。
- 涉及文件：`pantry.html`、`scripts/test-ios-expiry.cjs`、本文档。
- 改了什么：iOS Safari 上保质期字段继续使用数字键盘，现在可直接输入 8 位 `YYYYMMDD`；例如 `20281124` 在失焦或点击确认时会归一化为 `2028-11-24`，不再被清空。占位提示改为 `YYYYMMDD（如 20281124）`。
- 根因：旧的 iOS 兼容逻辑将 `input[type=date]` 降级为文本并设置 `inputmode=numeric`，但失焦校验只接受带分隔符的日期。数字键盘输入的 `20281124` 被校验为无效后写回空字符串。
- 用户验收：在 iPhone Safari 刷新 `https://pantry-mng.vercel.app/pantry.html`，进入手动录入，在保质期输入 `20281124`，选择包装类型后点击“确认录入”。预期：数字不消失，物品保存的到期日为 `2028-11-24`。
- 已验证：回归测试在修复前稳定复现 `'' !== '2028-11-24'`；修复后 `node --test scripts/test-ios-expiry.cjs` 1/1 通过，`node --test scripts/test-intake.cjs` 7/7 通过，`git diff --check` 通过。
- 发布状态：Vercel 生产部署 `dpl_3djms55uMJwXEcjVyExmBG1mkbrA`，正式域名 `https://pantry-mng.vercel.app`。正式 HTML 返回 HTTP 200，与本地 `pantry.html` 的 SHA-256 均为 `79438a82fababf9d5a0b2fee5b049a9f2dc5e37353bd70cb8510b806d8048910`。
- 验证层级：本次跑了 smoke + 日期解析和 iOS 失焦路径的 touched suite，没有跑全产品回归，因为变更仅限日期解析与 iOS 占位文案。尚未在用户的真机 Safari 上执行最终触控验收。
- 适用范围与过时风险：适用于当前将 iOS 日期控件降级为文本输入的单 HTML 实现。若未来恢复原生日期选择器、更换表单组件或调整保存链路，需重新验证。
- 注意：第一次在未携带 `.vercel` 绑定的独立 worktree 执行部署时，Vercel 误新建了临时项目 `pantry-ios-date`；它未替换正式域名。重新绑定 `pantry-mng` 后才执行上述正式部署。临时项目未自动删除。
