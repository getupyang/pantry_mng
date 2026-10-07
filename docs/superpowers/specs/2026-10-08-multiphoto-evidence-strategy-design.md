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

请求按原顺序发送图片，并明确编号。模型输出严格 JSON：

```json
{
  "sameProduct": true,
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
      "value": "娇韵诗舒缓爽肤水",
      "evidence": "Soothing Toning Lotion",
      "imageIndexes": [1],
      "status": "supported"
    },
    "brand": {
      "value": "娇韵诗",
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

`status` 只允许 `supported`、`missing`、`conflict`。模型不得以包装颜色、产品常识或背景商品补全字段。

## 确定性裁决规则

新增纯函数 `resolveMultiPhotoEvidence`，输入模型 JSON，输出现有表单结构。

- 任一图片明确属于不同主体，或字段出现不可消解冲突：`sameProduct=false`，阻断确认表单。
- 字段只有 `status=supported`、非空 evidence、有效图片序号时才保留。
- `missing` 和 `conflict` 字段一律清空，并加入 `missingFields`。
- 品牌、品名只能来自前景目标商品；背景商品文字不得成为 evidence。
- `qty` 在单件流程固定为 1，不根据背景盒子数量推断家庭库存。
- 中文名称允许对包装英文/日文做忠实翻译，格式为“中文品牌 + 可验证的商品类型/名称”；不得凭产品知识生成包装上没有依据的系列昵称。
- 模型响应缺少证据结构、字段状态或图片索引时 fail closed，不回退到旧的直接填表逻辑。

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

## Case 库与标签边界

当前 review 表共有 16 条历史记录：9 条有 `acceptedData`，7 条没有最终确认。历史图片不提交 GitHub。

- 强标签：review 与 `acceptedData` 直接关联。
- 人工标签：用户明确指出失败并给出正确结果，但必须确认图片和结果属于同一商品。
- 无标签：只用于人工观察、解析健壮性和“不得崩溃”检查，不计算准确率。
- 英文正式名与中文译名允许语义等价；不同商品、品牌、容量和日期必须精确。
- 用户库存数量、图外日期、包装类型等不作为视觉识别错误。

## 回归方法与上线门槛

全部 16 条历史记录都要重放。对每个多图 case，额外运行每张单图与全部图片联合识别：

1. 联合识别错误字段数不得高于最佳单图。
2. 联合识别正确字段覆盖率不得低于最佳单图。
3. 有互补证据时，联合识别至少多得到一个正确字段。
4. 错误商品、错误品牌、错误容量、错误日期属于灾难性错误，任意一条即阻止上线。
5. 无法确认的字段留空算安全通过；错误填充算失败。
6. 不同商品混拍必须阻断。
7. 单图现有测试、包装类型、iOS 日期输入、保存和重载不得回归。

真实样本不能进入公开仓库；自动化单元测试使用脱敏结构化 fixture，真实图片重放由本地脚本从授权 review 数据读取。

## 日志

不新增数据库 schema。沿用 `model_response`、`parsed_result` 和 `accepted_data`，补充：

- `strategyVersion: "multi_evidence_v1"`
- 实际模型和 provider
- 每张图片的角色、质量和主体判断
- 每个字段的 evidence、图片序号和状态
- 确定性裁决结果：`kept`、`blanked_missing`、`blanked_conflict`、`blocked_product_conflict`
- 用户最终修改字段

这样后续可以分别衡量事实错误、合理留空、中文命名体验和用户补充信息。

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

历史全量回归只在开发期执行单图拆分：预计 25–35 次调用，总成本低于 `$0.02`。生产用户流程仍是一组照片一次调用，不执行 N+1 重放。

价格和 provider 可用性会变化；发布记录必须写明实际调用成本和核对日期。

## 发布方式

1. 在独立 feature worktree 中按 TDD 实现。
2. 先跑脱敏单元测试与现有 touched suites。
3. 对全部历史 case 运行真实模型重放并生成本地报告。
4. 只有达到上述门槛才部署预览。
5. 预览运行成功、模糊留空、不同商品冲突三类 smoke。
6. 发布生产并复核运行模型、成本、review 日志和正式页面哈希。

## 适用范围与过时风险

本设计适用于 2026-10-08 的 OpenRouter 模型、价格、Pantry review 结构和现有 1–3 图流程。模型 endpoint、价格、中文商品名习惯及历史 case 数量可能变化；每次发布前必须重新核对模型可用性、实测成本和最新用户 case。
