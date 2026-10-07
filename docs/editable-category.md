## 2026-10-07 · 添加页分类可编辑

- 记录时间：2026-10-07（KST）。
- 实现 commit：`6131bf2`（`Add editable category to item intake`），涉及 `pantry.html`。
- 测试 commit：`e028023`（`test: cover editable add-page category`），涉及 `scripts/test-editable-category.cjs`。
- 测试稳定化 commit：`9ef7339`（`Stabilize editable category browser test`），仅调整 `scripts/test-editable-category.cjs` 的测试同步与断言，不改变生产行为。
- 分支：`codex/editable-category`。

### 改了什么，以及为什么

手动录入、照片识别确认和订单逐项录入表单现在会继续显示已有的自动分类，并允许用户在保存前修改；最终选择仍写入现有的 `cat` 字段。这样既保留自动建议的便利，也能在识别不符合实际时由用户纠正。

用户截图进一步暴露出第一版仍只提供“护发、护肤、口腔、清洁、纸品、其他”等宽泛分类。现已纠正为可直接盘点的扁平清单：面膜、面霜、眼霜、水、乳液、精华、洁面、护手霜、身体乳、防晒、香水、洗发水、护发精油、护发素、底妆、修容、口红、眼线笔、腮红、高光、假睫毛、散粉、定妆喷雾、口腔、清洁、纸品、其他。常见品名会自动建议对应细分类，用户仍可在保存前改选。

本次没有新增分类 ID、父子层级、筛选器或详情页编辑能力，也没有数据库或同步结构变更。已有物品的旧分类不会被批量改写，只有用户明确指出的“面霜-伊丽莎白雅顿眼部”会被定向改为“眼霜”；新录入或再次确认的物品保存所选细分类。

### 用户如何验收

1. 打开添加页，在手动录入中输入一个可识别品名，确认分类自动选中。
   分类下拉框开头应依次看到“面膜、面霜、眼霜、水、乳液、精华、洁面”；输入“补水面膜”“夜间保湿面霜”“紧致眼霜”或“安热沙防晒乳”时，应分别建议“面膜”“面霜”“眼霜”“防晒”。
2. 将分类改成另一个选项，选择包装类型并确认录入。
3. 在物品库查看该物品；预期它按改选后的分类分组。自动化测试另行断言手动录入品名保持为输入值，但没有据此概括所有其他录入字段均保持不变。
4. 在照片识别确认表单和多件订单逐项确认中重复分类改选；预期每件物品保存各自最终选择，下一件不会继承上一件的改选。

### 已验证

#### 本地启动与验收入口

在仓库 worktree 中启动静态服务器：

```bash
python3 -m http.server 8032
```

然后访问 `http://127.0.0.1:8032/pantry.html`，按“用户如何验收”操作。该地址只代表当前本地文件；远端与已部署版本由后续发布流程另行核对。

#### 浏览器检查

先把变量替换成当前机器的实际绝对路径；`PLAYWRIGHT_MODULE` 指向 Playwright Node 模块目录，`PANTRY_CHROMIUM_PATH` 指向可执行的 Chromium/headless-shell：

```bash
export PLAYWRIGHT_MODULE='/absolute/path/to/node_modules/playwright'
export PANTRY_CHROMIUM_PATH='/absolute/path/to/chromium-or-headless-shell'
export PANTRY_TEST_BASE_URL='http://127.0.0.1:8032/pantry.html'
node scripts/test-editable-category.cjs

perl -pe 's|http://127\.0\.0\.1:8031/pantry\.html|http://127.0.0.1:8032/pantry.html|; s|chromium\.launch\(\{headless:true\}\)|chromium.launch({headless:true,executablePath:process.env.PANTRY_CHROMIUM_PATH})|' scripts/test-package-type.cjs | node
```

2026-10-07（KST）的本机通过记录使用：

```bash
PLAYWRIGHT_MODULE='/Users/getupyang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright' PANTRY_CHROMIUM_PATH='/Users/getupyang/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell' PANTRY_TEST_BASE_URL='http://127.0.0.1:8032/pantry.html' node scripts/test-editable-category.cjs

perl -pe 's|http://127\.0\.0\.1:8031/pantry\.html|http://127.0.0.1:8032/pantry.html|; s|chromium\.launch\(\{headless:true\}\)|chromium.launch({headless:true,executablePath:process.env.PANTRY_CHROMIUM_PATH})|' scripts/test-package-type.cjs | PLAYWRIGHT_MODULE='/Users/getupyang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright' PANTRY_CHROMIUM_PATH='/Users/getupyang/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell' node
```

- 专项分类测试通过自动建议、手动覆盖、识别回传、订单逐项重置、物品库分组及 320/390/1280 响应式检查。
- 原有 package-type 浏览器测试通过；命令只在 stdin 中临时把 8031 替换为 8032，并显式注入 Chromium 路径，未修改 `scripts/test-package-type.cjs`。
- 最终复跑曾暴露测试在应用 230ms 页面导航过渡尚未结束时点击，导致旧 screen 拦截指针事件。`9ef7339` 将测试 harness 改为基于页面状态条件等待 screen settled，不使用固定 sleep；同时补充“分类覆盖不改变检测器派生的 `shape`、`unit`、`dailyUse`、`color` 属性”和最终分类选择器重置断言。稳定化后，同一 focused browser test 连续运行三次均通过。这是测试同步与覆盖面的改进，不是产品行为变化。

#### 单元与源码检查

以下检查不访问 8032 页面：

```bash
node --test scripts/test-intake.cjs

git diff --check
```

- intake 测试结果为 7 项通过、0 项失败。
- 验证层级为 smoke + touched suite：改动只涉及现有添加表单中的分类选择与保存路径，专项浏览器回归覆盖三个入口，原有 package-type 和 intake 测试覆盖相邻流程，因此足以作为本次提交验证。未运行 full regression；剩余风险是未在真实手机 Safari 或真实照片上传路径上验收。

### 正式发布与线上验证

- 发布时间：2026-10-07（KST）。
- GitHub 分支：`codex/editable-category`，发布前已推送至 `origin/codex/editable-category`。
- Vercel 正式部署：`dpl_GkNwFT1pb2tSZKsrs83hUDDhhneq`，状态 `READY`。
- 正式入口：`https://pantry-mng.vercel.app/pantry.html`。
- 正式域名返回 HTTP 200；线上 `pantry.html` 与本地发布文件的 SHA-256 均为 `f91922e7be1b378a4cebf9504dcdbd5a164a6593a77cb2c79da2d91ba3b02f15`。
- 在正式入口运行 `scripts/test-editable-category.cjs` 通过：自动建议、手动覆盖、照片/订单确认表单、最终分类保存与回传、物品库分组、订单重置及 320/390/1280 布局均通过。该线上测试拦截全部 API，不调用真实模型，也不写入云库存。
- 正式页面源码已确认包含 `fi-category`、`mf-category`、`ITEM_CATEGORIES` 和保存最终选择的 `finalCategory` 路径。

### 后续部署覆盖与合并处理

- 上述 `dpl_GkNwFT1pb2tSZKsrs83hUDDhhneq` 在 2026-10-07 17:10（KST）完成分类功能发布；随后 `codex/single-item-multiphoto` 在 18:10 部署 `dpl_5ePYiV7swHXK9KXJ2L4ca6iUR6sA`，正式别名被后一次部署接管。
- 覆盖后的线上 `pantry.html` SHA-256 为 `db782ece10574722a81861b329e63ab1c3c0745b29a686576870ea2bfd51472b`，源码中不再包含 `mf-category` / `fi-category`。因此用户看不到手动分类并非浏览器缓存，而是两个并行分支先后部署造成的版本覆盖。
- 合并 commit：`3ad0100`（`Merge current multi-photo production baseline`），将当前生产多图分支 `origin/codex/single-item-multiphoto` 合入 `codex/editable-category`，保留两边功能。
- 合并后本地验证：
  - `scripts/test-editable-category.cjs`：通过；
  - `scripts/test-package-type.cjs`：通过；
  - `node --test scripts/test-multiphoto-api.mjs scripts/test-multiphoto-request.cjs scripts/test-photo-live-args.cjs scripts/test-intake.cjs scripts/test-ios-expiry.cjs`：47/47 通过；
  - `scripts/test-multiphoto.cjs`：通过收集、明确开始、重试/冲突、review 生命周期、analytics 与清理。
- 合并验证阶段没有调用真实模型或写入云库存；浏览器测试均使用 mock API。
- 合并版本于 2026-10-07 23:36（KST）重新部署到正式环境：`dpl_61CrKtnHco41F4JBLGiErRb7zRPw`，`vercel inspect pantry-mng.vercel.app` 显示 `target=production`、`status=Ready`，正式别名已指向该部署。
- 合并版本线上 `pantry.html` 与本地文件 SHA-256 均为 `0e23e760a88bb0235e97a738ae6fd15876a69f19817e2ca3bded0bd4b52aa0b1`；源码同时包含多图收集入口、“开始识别”按钮及 `mf-category` / `fi-category` 分类选择器。
- 在正式域名运行分类编辑浏览器回归与多图识别 UI 回归均通过；两项线上回归均拦截 API，没有调用真实模型或写入云库存。

### 适用范围与状态

本文记录适用于当前单 HTML 实现、明确维护的 `ITEM_CATEGORIES` 扁平清单、用于自动建议的 `DETECT_MAP`、现有 `items` JSON 中的 `cat` 字段，以及当前浏览器加载方式。若添加表单、分类映射、同步数据结构、浏览器版本或部署版本变化，本文命令与结论可能过时，需要重新核对。

当前状态：分类功能与当前生产多图功能已经合并，功能分支已推送 GitHub，合并版本已重新部署到 Vercel 正式环境并通过线上 UI 回归。以上状态对应 2026-10-07 23:36（KST）的验证时刻，后续部署仍可能替换正式别名。本文不包含私有库存、截图、密钥、token 或凭据。

### 细分类纠正与正式发布

- 记录与验证时间：2026-10-07 23:58（KST）。
- 功能 commit：`2aedd71`（`Add detailed flat inventory categories`），分支 `codex/editable-category`；涉及 `pantry.html`、`scripts/test-editable-category.cjs` 及本功能的设计、计划和发布记录。
- 用户可见变化：分类下拉框不再只显示“护肤/护发”等宽泛项，而是显示面膜、面霜、防晒、口红、洗发水等完整扁平清单；自动识别直接建议对应细分类，用户可以继续手动覆盖。
- Vercel 正式部署：`dpl_H44dpnSAzJpCgngoGNv4ResmRPnp`，`target=production`、`status=Ready`，别名为 `https://pantry-mng.vercel.app`。
- 正式入口：`https://pantry-mng.vercel.app/pantry.html?v=2aedd71`。
- 本地与正式域名返回的 `pantry.html` SHA-256 均为 `bf0f1f361c9790710d9d44f3f7292e8a22051a1604b31b2d450047b4e74a9e1f`；线上源码包含两个分类选择器、明确的扁平清单及面膜、面霜、口红等细分类自动建议规则。
- 本地 focused 浏览器测试通过；相邻 Node touched suite 为 47/47 通过。正式域名再次运行分类浏览器回归通过，覆盖完整选项、自动建议、人工覆盖、照片/订单确认、保存分组和 320/390/1280 布局；正式域名多图录入浏览器回归也通过。浏览器回归拦截 API，不调用真实模型、不写入云库存。
- 验证层级为 smoke + touched suite，没有运行全量回归；本次未改数据库、后端接口和库存计算，共享多图流程已用相邻回归覆盖。剩余风险是未在用户的真实 iPhone Safari 上点击验收，若浏览器仍持有旧页面需强制刷新或使用上述带版本号入口。
- 已有库存中保存为“护肤/护发”的旧物品保持原值，没有数据迁移；这是兼容选择，不影响新物品选择和保存细分类。

### 2026-10-08 · 补齐眼霜并修正现有物品

- 记录时间：2026-10-08（KST）。
- 功能 commit：`c31a790`（`Add eye cream category and migrate target item`），分支 `codex/editable-category`。
- 改了什么：逐字复核固定清单，只新增独立分类“眼霜”；“眼霜/眼部精华”自动建议“眼霜”。加载本机或云端库存时，仅将当前分类为“面霜”、且名称或品牌同时包含“伊丽莎白雅顿”和“眼部/眼霜”的目标物品改为“眼霜”，然后按现有同步机制回写云端。
- 为什么改：前一次细分类清单遗漏“眼霜”，且用户指出现有“面霜-伊丽莎白雅顿眼部”被错误放在“面霜”。用户澄清“卫生健康”为误输入，因此没有加入该分类。
- 本地验证：先确认旧实现因缺少“眼霜”而按预期失败，再运行 `scripts/test-editable-category.cjs` 通过；测试覆盖固定清单、眼霜自动建议、只迁移目标物品、本机存储更新以及现有云同步路径回写。`scripts/test-intake.cjs` 与 `scripts/test-ios-expiry.cjs` 共 8/8 通过。
- 正式部署与验证：Vercel 部署 `dpl_AnzhaNdEfYNSSou8UqSP7bDLx2XZ` 于 2026-10-08 00:24（KST）发布到 `https://pantry-mng.vercel.app`，状态 `Ready`。线上与本地 `pantry.html` SHA-256 均为 `a2f395dfa07a65951c54fefc0c5f7faa7af5a112efb255c368da0bb21b2009cb`；正式入口浏览器回归通过，源码与选择框均不包含“卫生健康”。浏览器回归使用模拟家庭数据，不写入用户真实库存；用户家庭中的目标物品会在其设备刷新、成功读取云数据后执行定向迁移并沿现有同步路径回写。
- 适用范围：新增物品的自动建议和手动分类选择，以及上述唯一目标物品的兼容迁移；不改数据库结构。分类清单、目标物品文字或同步实现以后变化时，本记录可能过时。
