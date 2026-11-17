# 家庭收纳更新 Implementation Plan

**Goal:** 分类汇总并分开台面/收纳展示，支持开封日期补录和备注名。
**Architecture:** 保持单 HTML 与 items JSON；派生统计/展示，不迁移数量；按件修改 openedDates。
**Tech Stack:** Vanilla JS/CSS、Node test、Playwright、Vercel/Supabase。

1. `pantry.html`：增加展示名/件数/状态投影函数、日期读取与校验；分类分区卡片和仪表盘分类统计，字段采用转义文本。
2. `pantry.html`：手动/识别确认与编辑加入 nickname；已开封录入及开封弹窗日期控件；详情当前件日期编辑，重置/校验/保存/到期联动。
3. `scripts/test-home-storage.cjs`：纯逻辑验证统计、状态到期隔离、日期校验、名称转义。
4. `scripts/test-home-storage-ui.cjs`：mock 家庭/识别验证真实 UI、表单重置、多件独立日期、手机布局及云回读。调整旧排序测试的容器定位。
5. smoke：`git diff --check`、脚本语法与新逻辑测试；touched：新 UI/开封 UI/排序/编辑；发布前执行全部现有 Node 和浏览器测试。
6. `scripts/test-home-storage-live.cjs`：仅显式 opt-in 创建隔离家庭，真实保存/GET/导出/清除本地/恢复，finally 清空测试库存，模型调用为零。
7. `docs/2026-11-17-home-storage.md`：记录日期、commit、分支、验证命令/结果及适用边界。提交限定本次文件，推 feature branch，PR 合并 main，核对 Vercel Ready/正式域名哈希和线上 smoke。
