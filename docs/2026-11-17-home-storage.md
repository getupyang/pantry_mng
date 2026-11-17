# 2026-11-17 · 台面与收纳、开封日期和备注名

- 记录/验证时间：2026-11-17（Asia/Tokyo）。
- 功能 commit：`d2be286e36f8d5a4b7ec25a4b67b01bda571d542`。
- 分支：`codex/home-storage`；独立 worktree，基线 `origin/main 8231b8319f4ea398e2620162bd76b98a87be5ee5`。
- 开发前正式域名与基线 `pantry.html` SHA-256 完全一致：`df55a60717632ea9e58d15318ea172aabd4b3ad220fcd203620850c28daf2d95`。
- 文件：`pantry.html`、`scripts/test-home-storage{,-ui,-live}.cjs`、旧分类/排序浏览器测试的容器定位、`docs/superpowers/` 中对应设计与计划。

## 用户可见变化

物品库按类显示「共几件 / 已开封 / 未开封」，同类中以台面与收纳容器分开陈列；同一商品有使用中及备用时出现在两区，但不重复计算数量。空件不计可用总数，单独保留整理入口。洗衣液/洗洁精等历史粗分类细分显示，人工跨分类覆盖保持不变。仪表盘的所有物品也按类连续排列并汇总。

录入已开封、从库存开封时可选择实际日期；详情可修改/补填当前件日期，也可清空表示未知。未来/非法日期不能保存。多件日期独立、余量和数量不因日期编辑变化；到期仍取包装期限与开封期限较早者（1 月 30 天，1 年 365 天）。库存卡片不显示已开封件的期限，点击后明确进入未开封详情。

手动、照片和订单确认新增可选备注名，已有物品可以编辑/清空。卡片、详情、仪表盘、提醒和操作弹窗优先用备注名，原商品名在详情保留；下一件和订单下一项自动清空备注名与开封日期。日期编辑、名称和展示均不调用模型。

## 用户如何验收

1. 刷新正式站点，进入「物品库」。同类组应显示总数，组内区分台面与收纳；总数 = 仍有余量的已开封件 + 未开封库存，空件另列。
2. 录入数量 3 的防晒，备注名「通勤防晒」，标记已开封，日期选择两周前，开封保质期 1 月。应显示已开封 1 件、未开封 2 件，主标题为备注名。
3. 打开台面卡片，修改开封日期；该件到期日/倒计时立即变化。再开一件并指定不同日期，各件分别保留。
4. 点击收纳卡片，应显示未开封及包装到期日。包装类型筛选后的数量仅统计匹配库存；旧式补充装归入补充装筛选。
5. 编辑备注名后刷新，信息仍在；清空备注名恢复商品名。刷新后第一次编辑也应保留库存地点。

## 实际验证

本次层级：smoke + touched suite + 发布前全量现有自动回归。纯展示和字段变更涉及录入、详情、排序、云同步，因此发布前覆盖全流程；修复复查问题后只重跑受影响的新增 UI、包装筛选、编辑和逻辑测试。

```sh
git diff --check
node --test scripts/test-intake.cjs scripts/test-ios-expiry.cjs scripts/test-multiphoto-request.cjs scripts/test-multiphoto-api.mjs scripts/test-photo-live-args.cjs scripts/test-rate-limits.mjs scripts/test-opened-expiry.cjs scripts/test-home-storage.cjs
TZ=America/New_York node --test scripts/test-opened-expiry.cjs scripts/test-home-storage.cjs
```

结果：65 项 Node 测试通过；纽约时区 17 项通过；HTML 内联 JavaScript 语法检查通过。

浏览器命令使用 `PLAYWRIGHT_MODULE=<本机 Playwright 安装位置>`、`PANTRY_TEST_BASE_URL=http://127.0.0.1:8031/pantry.html`；服务器来自本分支独立 worktree。以下 7 套通过（全部 API mock）：

```sh
node scripts/test-home-storage-ui.cjs
node scripts/test-opened-expiry-ui.cjs
node scripts/test-stage2-edit-fields.cjs
node scripts/test-sort-by-expiry.cjs
node scripts/test-editable-category.cjs
node scripts/test-package-type.cjs
node scripts/test-multiphoto.cjs
```

新增 UI 覆盖：分类件数/两种状态、当前件日期原索引、空件排除、备注名转义及回退、提醒、订单重置、mock 云回读、刷新后编辑不清空地点、补充装筛选/规格/详情操作；320/390 像素及大字号截图已检查。旧浏览器回归还覆盖 1280 像素。模拟 iPhone UA 验证数字日期输入，但没有操作真实 iPhone Safari。

真实 API 验收（新 UUID 的隔离家庭，候选 HTML 使用正式 API，显式 opt-in）：

```sh
PANTRY_LIVE_TEST=yes PANTRY_LIVE_LOCAL_HTML=yes node scripts/test-home-storage-live.cjs
```

通过：录入备注名/过去开封日 → 再开一件不同日期 → 修改第一件日期 → PUT/独立 GET → JSON 导出 → 删除本地库存缓存 → 云端恢复 → 分类件数和未开封期限。家庭请求全部 HTTP 200，模型调用 0 次。`finally` 清空且回读确认隔离家庭库存为空；没有读取/修改真实用户家庭。服务既有备份可能仍保留测试历史。

## 发布状态和边界

记录提交时：实现与发布前验证已完成；推送/PR 合并及生产 Ready 状态必须以随后远端与正式域名验证为准。上线后执行同一 live 命令但不设置 `PANTRY_LIVE_LOCAL_HTML`，并运行正式域名 mock UI、核对正式 HTML 与功能提交文件哈希。

无需 API/schema 迁移，无需用户手动重启后端；浏览器刷新即可获取新页面。所有用户字段继续保存在原 items JSON / localStorage / family data_json，不迁移真实库存数据。

适用当前单 HTML、逐件 openedDates 与 legacy supplement 模型。UI、部署版本、家庭 API 状态属于当时验证，可能随实现变化而过时。本次没有验证真实照片识别质量，也没有改旧式补充装「倒入」算法；新补充装卡片提供明确的正装使用区导航，避免误开正装库存。生产回滚可恢复上一版本页面，但旧客户端再次整批保存可能丢掉新字段，使用者应刷新至统一版本。
