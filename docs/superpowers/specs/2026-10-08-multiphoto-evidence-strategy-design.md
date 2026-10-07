# 多图证据识别策略设计

记录时间：2026-10-08

## 目标

让单件商品的 2–3 张照片产生稳定的信息增益：联合识别的正确字段覆盖率不得低于最佳单图，且不得因为弱图、背景商品或模糊喷码增加错误字段。信息不足时留空，由用户补充；不强行生成完整答案。

单图现有流程本期保持不变，作为稳定对照组。新策略只作用于 2–3 张照片。

## 当前问题

当前实现把全部图片放进一次视觉模型请求，让模型直接输出唯一合并 JSON。OpenRouter 的 `models` 数组只是故障回退，不是多模型投票；生产记录实际全部由 `google/gemini-2.5-flash` 返回。前端只有商品冲突阻断，没有逐图证据、字段置信或确定性裁决，因此一张弱图可能污染整条结果。

生产复盘确认了四类问题：

1. 密集中文标签 OCR 错误，例如品牌字和完整品名误读。
2. 清晰日期被误读，随后本地日期解析器可能继续放大错误。
3. 英文正式名事实正确，但没有转换为中国用户易懂的中文商品名。
4. 用户修改字段同时包含真正识别错误、俗称偏好、图外日期和实际库存数量，不能把总编辑率直接视为模型错误率。

## 产品名称核实

复盘中的娇韵诗照片是 `CLARINS Soothing Toning Lotion 200ml`。娇韵诗香港官网使用该英文名称；中国市场通常将此类产品称为“舒缓爽肤水/化妆水”。因此原模型的品牌、英文品名和容量属于事实正确，但直接向中国用户展示英文正式名属于产品表达失败。

参考：

- https://www.clarins.com.hk/en/soothing-toning-lotion-80104514.html
- https://www.clarins.com.cn/face/extra-comfort-toning-lotion-200ml

## 方案选择

### 采用：一次 Qwen3-VL 联合观察 + 确定性字段裁决

多图只调用一次 `qwen/qwen3-vl-32b-instruct`。模型负责描述每张图中可见证据；程序负责决定最终保留哪些字段。该方案保留一次请求的延迟和成本，同时把最终决定从模型自由生成改为可测试规则。

### 暂不采用：双模型投票

成本和延迟翻倍，并且英文正式名、中文译名和商品俗称可能语义相同但字符串不一致，容易制造假冲突。

### 暂不采用：每图独立 OCR + 第二次模型合并

证据链最强，但 3 张图需要 4 次调用。先用一次联合观察验证收益；只有历史 case 仍无法通过时才升级。

## 模型请求与响应

请求按原顺序发送图片，并明确编号。模型输出严格 JSON。`sameProduct` 只是模型观察，最终主体判断由裁决器完成：

```json
{
  "sameProduct": "same",
  "conflictReason": "",
  "images": [
    {
      "index": 1,
      "targetMatch": "same",
      "role": "front",
      "quality": "clear",
      "observedText": ["CLARINS", "Soothing Toning Lotion", "200 ml"]
    }
  ],
  "fields": {
    "name": {
      "value": "Soothing Toning Lotion",
      "evidence": "Soothing Toning Lotion",
      "imageIndexes": [1],
      "status": "supported"
    },
    "brand": {
      "value": "CLARINS",
      "evidence": "CLARINS",
      "imageIndexes": [1],
      "status": "supported"
    },
    "packageSize": {
      "value": 200,
      "evidence": "200 ml",
      "imageIndexes": [1],
      "status": "supported"
    },
    "unit": {
      "value": "ml",
      "evidence": "200 ml",
      "imageIndexes": [1],
      "status": "supported"
    },
    "expiryDate": {
      "value": null,
      "evidence": "",
      "imageIndexes": [],
      "status": "missing"
    }
  }
}
```

枚举和值域固定如下，出现未知值即视为结构错误：

- `sameProduct` / `targetMatch`：`same`、`different`、`uncertain`
- `role`：`front`、`back`、`side`、`bottom`、`expiry`、`other`
- `quality`：`clear`、`partial`、`unreadable`
- 字段 `status`：`supported`、`missing`、`conflict`

响应必须为每个输入图片序号 `1..N` 恰好提供一条图片观察，不得缺号、重复或越界。字段证据必须能逐字对应到所引用图片的 `observedText` 条目（仅做 NFKC、大小写、空白和全半角归一化），且图片必须是 `targetMatch=same`。`clear` 可以支持完整字段；`partial` 只能支持逐字可见的信息，不能据残缺喷码推导日期；`unreadable` 和 `different` 不能支持任何字段。模型不得以包装颜色、产品常识或背景商品补全字段。

严格 required schema 为：顶层必须同时具有 `sameProduct`、`conflictReason`、`images`、`fields`；每个 `images[]` 必须同时具有 `index`、`targetMatch`、`role`、`quality`、`observedText`，且 `observedText` 为字符串数组；`fields` 必须恰好覆盖 `name`、`brand`、`packageSize`、`unit`、`expiryDate`，每个字段必须同时具有 `value`、`evidence`、`imageIndexes`、`status`。缺少任一 required key、类型错误、额外未知评分字段或未知枚举均使整次响应成为 `multi_strategy_invalid_response`。`missing/conflict` 状态仍必须显式返回这些 key，但 `value` 可为 null、`evidence` 可为空、`imageIndexes` 可为空数组。结构完整但 evidence 内容不合格时才是单字段留空。

模型只返回包装原文的 `name`、`brand` 及其证据，不返回可直接信任的中文派生字段。中文展示由裁决后的确定性本地化层完成：对规范化后的原文做完全匹配，先查冻结品牌表（例如 `CLARINS → 娇韵诗`），再查冻结商品短语表（例如 `Soothing Toning Lotion → 舒缓爽肤水`）。每条映射记录来源、核对日期和测试；没有完全匹配时保留原文。运行时不做模糊语义匹配，不接受模型自报的 `source`，也不凭模型知识生成音译、系列简称或消费者昵称。

## 确定性裁决规则

新增纯函数 `resolveMultiPhotoEvidence`，输入模型 JSON，输出现有表单结构。

- 主体级冲突与字段级冲突分开处理。清晰图片明确为不同目标商品，或目标图片间出现不相容的非空品牌/明确不同品名，属于主体级冲突，阻断整条自动填表。
- 已确认同一商品后，容量、单位或日期证据互相冲突，只清空对应字段，不阻断其他字段。
- 字段只有 `status=supported`、非空 evidence、有效图片序号时才保留。
- `missing` 和 `conflict` 字段一律清空，并加入 `missingFields`。
- 品牌、品名只能来自前景目标商品；背景商品文字不得成为 evidence。
- `qty` 在单件流程固定为 1，不根据背景盒子数量推断家庭库存。
- 中文名称优先级固定为：冻结的官方/品牌译名 → 字面商品类别翻译 → 原文。音译、系列简称、消费者昵称只有进入 case manifest 的 `allowedAliases` 才能用于评测，运行时不得自由扩写。
- 任一 evidence 无法回指 `observedText`、引用了无资格图片或状态和值不一致，只清空相关字段；响应整体结构不合法则整次识别失败，不回退到旧的直接填表逻辑。

主体判断在结构校验后按下列互斥、穷尽的决策表执行。顶层 `sameProduct` 只作为模型观察写入日志，不参与最终结果；它与逐图结论不一致时记录 `top_level_disagreement`，不会制造第二套裁决：

| 条件（从上到下首个命中） | 唯一结果 |
| --- | --- |
| 任一图片为 `quality=clear + targetMatch=different` | `blocked_product_conflict` |
| 两张及以上 `clear + same` 图片间存在不相容品牌或明确不同品名 | `blocked_product_conflict` |
| 至少一张图片为 `clear + same`，且未命中以上冲突 | 只使用 `same` 且合格的 clear/partial 证据继续字段裁决；所有 `different/uncertain/unreadable` 图片忽略 |
| 不存在 `clear + same`（无论其余合法组合是 partial/unreadable、same/different/uncertain） | 所有字段留空，结果为 `manual_blank_uncertain` |

因此 `partial/unreadable + different` 永远不会单独阻断商品；它们在已有 clear/same 目标时被忽略，没有 clear/same 目标时进入空表手填。所有合法枚举组合都唯一落入上表之一。

## 日期规则

- 仅接受明确的完整日期、年月或有清晰标签的月年格式。
- 三段短日期如 `8/01/08`，在无法确定排列顺序时留空。
- 日期 evidence 的解析结果只能在无歧义时采用。
- evidence 与模型结构化日期不一致时留空，不选择任意一个。
- 修复现有从三段日期尾部截取 `01/08` 并解析为 `2008-01-01` 的问题。
- 只有年月时继续按现有产品规则取当月第一天。

## 模型路由与故障处理

- 2–3 图：只请求 `qwen/qwen3-vl-32b-instruct`。
- 1 图：本期保持现有模型策略，避免扩大变更面。
- 删除不可用的 `qwen/qwen-vl-plus`。
- Qwen3-VL 请求失败时提示重试或手填；不静默降级到已在真实多图样本中产生错误的 Gemini。

### Fail-closed 明细

以下任一结构问题返回 `multi_strategy_invalid_response`，`parsedResult=null`，不显示旧识别值，也不自动保存：JSON 损坏、required key 缺失、字段类型错误、未知枚举、图片序号缺失/重复/越界、未覆盖全部输入图片、响应被截断。超时和 429 分别返回可区分的错误码，同样不降级。用户只能明确选择“重试”或进入全部字段为空的手填表单。

日期字段结构合法但内容歧义、无法解析或 evidence/value 不一致时，不判整次结构失败，只清空 `expiryDate` 并记录 `blanked_invalid_evidence`。

单个字段证据不合法但整体结构完整时，只将该字段标记为 `blanked_invalid_evidence`。主体冲突返回 `blocked_product_conflict`。所有这些结果都进入回归报告；仅在用户已有 review 授权且上游确有响应时保存完整响应，否则只记聚合事件。

## Case 库与标签边界

当前 review 表共有 16 条历史记录：11 条单图、5 条多图；其中 9 条有 `acceptedData`（6 条单图、3 条多图），7 条没有最终确认。历史图片不提交 GitHub。

- `acceptedData` 不是自动视觉金标。冻结 manifest 前，逐 case、逐字段标注为 `visible-supported`、`user-provided/non-visual`、`preference-only` 或 `unknown`，并记录 `expected`、`allowedAliases`、`evidenceImageIndexes`、`reviewer` 和 `reason`。
- 只有 `visible-supported` 字段进入准确率计算。用户库存数量、图外日期、包装类型、分类和单纯命名偏好不作为视觉识别错误。
- 本轮评分字段固定为 `name`、`brand`、`packageSize`、`unit`、`expiryDate`；不评分 `qty`、`category`、`packageType`。
- 无最终确认的 7 条仍用于结构健壮性、留空和冲突人工观察，但除非完成人工逐字段标注，否则不计准确率。
- 所有可接受中文/外文名称在运行前写入冻结的 `allowedAliases`；评测期间不得临时增加别名来让结果通过。

### 评分归一化与定义

- 文本：NFKC、转小写、去首尾空白、合并连续空白、统一常见中英文标点。
- 单位：只按冻结映射规范为 `ml`、`g` 等；数值必须精确相等。
- 日期：必须规范为同一个 `YYYY-MM-DD`，年月标签按产品既有规则取当月第一天；不允许宽松日期近似。
- 名称/品牌：规范化后必须等于 `expected` 或某个冻结的 `allowedAliases`，不调用模型做语义裁判。
- `correct`：非空且精确匹配；`wrong`：非空但不匹配；`abstain`：空值。
- coverage = `correct / visible-supported 字段数`；wrong rate = `wrong / visible-supported 字段数`。
- 灾难性错误定义为 name、brand、packageSize、expiryDate 任一字段非空且错误；每个 case、每次运行允许数为 0。

## 回归方法与上线门槛

全部 16 条历史记录都要重放。标签 manifest 在修改 prompt 或代码前冻结并记录哈希。对有标签 case 做 25% 分层 holdout：单图、多图分别按稳定哈希排序，holdout 至少包含 1 条经过审计的多图 case；候选策略冻结前只看开发集，holdout 只在最终候选上打开一次。若 holdout 失败，必须增加并冻结新的未见真实样本后才能继续调参和重新建立最终门槛，不能反复使用已打开的 holdout 证明上线。对每个多图 case，额外运行每张单图与全部图片联合识别：

1. “最佳单图”按 correct 数最多、wrong 数最少、coverage 最高、图片序号最小依次确定。
2. 每一个多图 case 的 wrong rate 都不得高于其最佳单图，coverage 都不得低于其最佳单图；aggregate 只作为附加报告，不能抵消单 case 退化。
3. 互补字段必须在运行前由 reviewer 标注：若两张及以上图片分别含有不同的 `visible-supported` 字段，联合识别至少比最佳单图多一个 correct。
4. 错误商品、错误品牌、错误容量、错误日期属于灾难性错误，任意一条即阻止上线。
5. 无法确认的字段留空算安全通过；错误填充算失败。
6. 不同商品混拍必须阻断。
7. 单图现有测试、包装类型、iOS 日期输入、保存和重载不得回归。

所有多图 case 在 `temperature=0`、固定模型 ID 和固定 provider 路由下运行两次。两次都必须零灾难性错误，且字段的保留/留空决定完全一致；实际模型或 provider 不一致直接阻止上线。新建的脱敏 success、ambiguous、conflict fixtures 作为历史集之外的 smoke，避免只对 16 条老 case 调参。

证据 gate 只能验证模型响应内部可追溯和一致，不能从像素层独立证明 `observedText` 没有幻觉。本期不引入第二 OCR/第二模型；“弱图不污染结果”是由保守留空规则、逐 case 真实回归和零灾难性错误门槛共同提供的经验性保障，不宣称为像素级形式验证。若真实 holdout 仍出现自洽幻觉，应停止上线并升级为独立 OCR/第二观察来源，而不是继续放宽纯函数。

上线最低标签条件为：至少 6 条经过字段审计的真实记录，其中至少 2 条多图、1 条冲突/歧义样本。若现有数据不满足，不把未审计 `acceptedData` 伪装成金标，而是停止上线并补审。

真实样本不能进入公开仓库；自动化单元测试使用脱敏结构化 fixture，真实图片重放由本地脚本从授权 review 数据读取。

## 日志与隐私

不新增数据库 schema。沿用 `model_response`、`parsed_result` 和 `accepted_data`，补充：

- `strategyVersion: "multi_evidence_v1"`
- 实际模型和 provider
- 每张图片的角色、质量和主体判断
- 每个字段的 evidence、图片序号和状态
- 确定性裁决结果：`kept`、`blanked_missing`、`blanked_conflict`、`blocked_product_conflict`
- 用户最终修改字段

这样后续可以分别衡量事实错误、合理留空、中文命名体验和用户补充信息。

- 用户同意 review 时，才沿用现有机制保存图片、完整模型响应、observedText、evidence 和裁决结果，供失败复盘。
- 未同意 review 时，不保存图片、文件名、OCR/observedText 或字段 evidence；只在用量记录中保存 strategy、model、imageCount、status、errorCode 和 cost 等聚合信息。
- base64、原始文件名、OCR/observedText 和 evidence 不写入普通服务 console 或第三方 analytics。
- 本地真实回归报告只放 `/private/tmp/pantry-*` 或 gitignored `.local/`；可提交文档仅保留 review ID、聚合指标和脱敏结论。发布结束清理临时图片/响应，真实数据不得进 GitHub。

## API 成本

OpenRouter 2026-10-08 页面标价：

- Qwen3-VL 32B Instruct：输入 `$0.104 / 1M tokens`，输出 `$0.416 / 1M tokens`。
- Gemini 2.5 Flash：输入 `$0.30 / 1M tokens`，输出 `$2.50 / 1M tokens`。

参考：

- https://openrouter.ai/qwen/qwen3-vl-32b-instruct/api
- https://openrouter.ai/google/gemini-2.5-flash/pricing

两个真实失败样本的实测：

- 原 Gemini：每次约 `$0.00077–0.00088`。
- Qwen3-VL 同图重放：每次约 `$0.00040–0.00052`。

新 JSON 证据结构会增加少量输出 token。生产预算按 `$0.0008/次` 上限估算，即约 `$0.80/1000 次多图识别`。正常实测更接近 `$0.40–0.60/1000 次`。

当前 5 条多图的图片数为 3、2、3、2、2，共 12 张。每轮回归为 5 次联合调用 + 12 次拆分单图调用，共 17 次；稳定性重复两轮为 34 次。再加 11 条单图兼容回放一次，基础共 45 次，预留 25% 重试/限流余量后约 57 次。按 `$0.0008/次` 上限，开发期真实模型回归预算不超过约 `$0.046`，按 `$0.05` 封顶；若加入新 holdout 或超出重试余量，必须单独在报告中列出。

生产用户流程仍是一组照片一次调用，不执行 N+1 重放，目标成本上限 `$0.0008/次`；生产 smoke 的硬阻断线为 `$0.001/次`。价格、图像 token 算法和 provider 可用性会变化，部署前必须重新核价并记录真实 generation cost。

价格和 provider 可用性会变化；发布记录必须写明实际调用成本和核对日期。

## 发布方式

1. 在独立 feature worktree 中按 TDD 实现。
2. 先跑脱敏单元测试与现有 touched suites。
3. 对全部历史 case 运行真实模型重放并生成本地报告。
4. 生成逐 case、逐字段报告；任一 case 退化、任一灾难性错误、aggregate multi coverage 低于最佳单图、wrong rate 高于最佳单图、重复运行不稳定或模型/provider 不符，立即停止发布。aggregate 是额外健康指标，不替代逐 case 门槛。
5. 只有达到门槛才部署预览，并运行成功、模糊留空、不同商品冲突三类 smoke。
6. 发布生产后用授权 smoke 确认实际模型为 Qwen3-VL、provider 与固定路由一致、`strategyVersion` 可查、日志符合 consent 分支、单次成本不超过 `$0.001`、页面构建哈希正确。
7. 任一生产 smoke、模型路由、日志隐私或成本检查失败，立即恢复上一生产 deployment，并记录失败时间、deployment ID 和回滚结果。

## 适用范围与过时风险

本设计适用于 2026-10-08 的 OpenRouter 模型、价格、Pantry review 结构和现有 1–3 图流程。模型 endpoint、价格、中文商品名习惯及历史 case 数量可能变化；每次发布前必须重新核对模型可用性、实测成本和最新用户 case。
