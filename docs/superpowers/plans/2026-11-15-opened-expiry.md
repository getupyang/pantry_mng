# 开封后保质期 Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. User already authorized implementation, tests, and production release.

**Goal:** 选填开封期限，开封后按固定天数计算，统一展示、预警和排序。

**Architecture:** 保留单 HTML 主入口，在 utils 内集中有效到期计算；识别规范化在原 parser 区域实现，表单保存到 items JSON。所有调用复用计算函数，不改 API/数据库 schema。

**Tech Stack:** Vanilla JS/HTML/CSS, Node test runner, Playwright, GitHub/Vercel.

---

记录时间：2026-11-15。分支 codex/opened-expiry，worktree /private/tmp/pantry-opened-expiry-20261115。仅修改 pantry.html、新测试及本需求文档，不带入其他分支。

### Task 1: 基线与计算测试

- [x] Fetch origin，检查工作区干净，验证生产源码和 origin/main 一致。
- [x] 建立独立 worktree，运行现有 intake/multiphoto Node 测试：35 passed。
- [x] 新增 scripts/test-opened-expiry.cjs；先在现有 getExpInfo/compareByExpiry 上验证开封后 30 天和多件排序失败。
- [x] pantry.html 添加 normalizeOpenedShelfLife、日期序号、单件和聚合到期函数；getExpInfo、getStatus、compareByExpiry 复用。
- [x] 修改 ensureOpenState：只有原本没有 openedDates 数组的旧记录允许回退 openedDate；已有数组中的 null 保持未知。去掉 openDetail 当前件日期的跨件回退，测试 normalize→详情→保存都保留 null。
- [x] today() 改为本地年月日，统一覆盖 confirmAdd/openTake 的日期生成；在东京 UTC 午夜前后及纽约 DST 边界测试实际保存日期。
- [x] 验证 day/month/year、跨月/年、包装较早、未开封、缺失日期、空件、旧记录回退、非法值和本地日期；运行 node --test scripts/test-opened-expiry.cjs。

### Task 2: 录入、识别与详情

- [x] 新增 scripts/test-opened-expiry-ui.cjs，确认新字段缺失时测试失败。
- [x] 两表单增加可选时长和单位，默认月；confirmAdd/openEditItem/clearIntakeForms/fillFormFields 接入，订单切换清空，编辑不改变库存/开封记录。
- [x] recognizePhoto/recognizeOrder 提示词增加 openedShelfLife 和原文依据；postProcessRecognitionResult 只接受明确依据且规范化的期限，recognition accepted payload 保存新值。
- [x] 详情围绕当前件展示开封记录、原包装日期、当前件最终日期、依据和剩余天数。卡片/仪表盘/排序统一聚合期限；开封对话框提示时长和预计期限。
- [x] 浏览器（隔离 context，API mock）操作录入→开封→查看→编辑→刷新，验证持久化、批量订单不串值、无开封后模型调用；390px/320px 和大字号布局截图。

### Task 3: 回归、审查、发布

- [x] 使用 test-driven-development 和 verification-before-completion 流程，完成 smoke/touched suite；发布前跑现有所有 Node 与浏览器回归（mock，不真实调用模型）。
- [x] git diff --check；审核 diff，确认既有分类/单位/排序/多图能力保留，文档不含私有数据。
- [ ] 添加 docs/2026-11-15-opened-expiry.md，含日期、范围、commit/branch、验证命令、用户验收与时效限制。
- [ ] 明确 stage 本次文件并提交，更新文档关联代码 commit；push feature branch，再次 fetch 检查 main 是否前进，若前进先合并重测。
- [ ] 用户已授权上线：通过 GitHub PR 合并到 main（或受检的快进合并），等待 Vercel 生产部署；必要时使用已链接的 Vercel CLI 发布相同 main 内容。
- [ ] 验证生产 Ready、域名 HTML 哈希、线上隔离浏览器 smoke、API 健康；记录最终发布 commit，不把 preview 当生产。

预期全程不覆盖已有库存、不清理其他 worktree。无需 DB 迁移或服务手动重启；上线后刷新页面。线上浏览器测试只使用受控测试数据和隔离存储。真机 Safari 与真实标签识别质量须如实说明覆盖范围。
