## 2026-10-06 · 包装类型与物品库筛选

- 记录时间：2026-10-06。
- 分支：`codex/package-type-filter`；基线 commit：`993b9c6`。当前为本地未提交实现，发布时补充发布 commit。
- 涉及文件：`pantry.html`、`scripts/test-package-type.cjs`、本文档。
- 用户可见变化：手动、照片确认、订单逐件确认均须手动选择旅行装、正装或补充装；不根据容量、品名或模型结果自动选择包装类型。
- 物品库顶部常驻包装筛选，卡片显示类型，详情支持修改；筛选保存在当前浏览器，返回详情、切换页签和刷新均保留。仪表盘仍展示整体库存。
- 旧数据没有字段时显示“未设置”，只在“全部”中出现；不批量推断或修改旧记录。订单下一件和成功录入后的表单清空选择。
- 数据字段：`packageType: travel | regular | refill`。沿用 items 的本地保存、JSON 导入导出和家庭云同步，不新增数据库列。既有 `supplement` 倒入关系不受标签控制。
- 同时修复 `PANTRY_ITEMS_KEY` 定义晚于 `loadItems()` 调用导致本地读取失败的问题，保证刷新后的本地数据可恢复。
- 验收：录入一件旅行装 → 物品库点击旅行装 → 打开详情返回 → 刷新并回到物品库；应保留该筛选。旧物品可在详情中补类型。未选类型时确认录入应被阻止。
- 验证命令：先 `python3 -m http.server 8031`，再 `PLAYWRIGHT_MODULE=/path/to/playwright node scripts/test-package-type.cjs`；`git diff --check -- pantry.html`。
- 验证范围：语法 smoke + 浏览器局部回归，覆盖必选、手动录入、筛选持久化、旧物品修改、导出、空结果、订单切换和 320/390/1280 宽度下的可见列表布局。所有 API 请求 mock，不调用真实模型或修改云数据。
- 实测时间：2026-10-06 01:04 KST。用户提供图片的真实上传识别、手动选择旅行装、PUT 保存、独立 GET 回读和刷新筛选均通过；测试家庭版本 1 → 2，服务端返回 `packageType: travel`。测试使用独立家庭，不混入已有库存。私有测试图片、具体库存内容和家庭凭据仅留在本机临时证据中，不纳入仓库。
- 本地完整服务：`node --use-env-proxy scripts/dev-server.cjs`，访问 `http://localhost:8031/pantry.html`。该服务仅监听回环地址、仅提供页面及配置，并将 API 转发到本项目真实线上后端；录入会写入对应云端家庭。静态 `python3 -m http.server` 不支持真实识别。
- 真实测试命令：`PLAYWRIGHT_MODULE=/path/to/playwright node scripts/test-photo-live.cjs /path/to/image`。该脚本会真实上传并在新测试家庭留下一件库存，应仅在明确需要实测时运行。
- 发布前发现线上运行 `fix/pantry-availability-20261006` 的修复（`67a813c`），已确认该分支 HTML 与线上一致；需合并保留云端重试、全局错误提示和到期解析修复后再发布。
- 适用范围与过时风险：以上描述对应本分支的单 HTML 页面实现；页面结构、存储流程或部署方式变化后需重新核对。无需服务端迁移；正式发布后刷新网页加载新前端。
