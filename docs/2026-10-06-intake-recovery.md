# 2026-10-06 · Restore photo intake after database pause

- 记录时间：2026-10-06（Asia/Seoul）。
- 分支：`fix/pantry-availability-20261006`。关联实现 commit：见本文件后续发布记录。
- 涉及文件：`pantry.html`、`vercel.json`、`scripts/test-intake.cjs`。
- 问题：云数据库暂停后初始化失败，拍照入口提前返回，而错误消息放在隐藏首页；初始化只在加载时执行，没有重试入口。生产/到期日期混合证据还会把正确到期日覆盖成生产日期。
- 改动：录入页显示云端连接状态和重试按钮，初始化请求 15 秒超时；错误消息跨页面可见；网络恢复可重试。首页拍照入口保持同步用户手势。首次本机数据上传在 cloudReady 后执行。EXP 明确标签优先，生产日期不作为到期日。根路径映射到主页面。
- 数据安全：未更改数据库 schema、权限或历史业务记录。恢复现有项目，未创建替代数据库。恢复后先只读备份 Pantry 表到用户本地，私有备份及凭证不进入仓库。
- 用户验收：刷新主页面，拍照入口能出现样本授权及图片选择。断网/初始化失败时录入页能看到错误和重试入口。连接恢复后重试、再次点击拍照。混合 MFG/EXP 照片的到期日应来自 EXP。
- 已验证：`node --test scripts/test-intake.cjs`（7/7）；HTML 内联 JS 编译检查；`git diff --check`；预览部署根路径 200；预览和生产初始化接口恢复 200，并读回暂停前原测试记录。Chrome 预览可打开，首页拍照点击进入样本授权。
- 验证层级：smoke + touched suite。未改 schema 或共享后端逻辑，因此未做无关功能全量回归。真实 iPhone Safari 拍照弹窗仍需用户设备验收。
- 适用范围：此版本的单 HTML 应用和现有 Vercel/Supabase 部署。
- 可能过时：平台状态、网络可达性和免费计划政策为当时状态；免费项目仍可能因低活跃自动暂停。官方说明：https://supabase.com/docs/guides/platform/free-project-pausing 。未添加伪造活动或付费升级。

## 发布记录

- 实现 commit：`f81bb38`，分支 `fix/pantry-availability-20261006`。
- 预览部署：`dpl_CjACJ3Q458tu4Z56nVWNJacXEa6n`，Ready，根路径已返回应用内容。
- 正式发布采用此分支工作树；保留原 main 工作区无关差异。
