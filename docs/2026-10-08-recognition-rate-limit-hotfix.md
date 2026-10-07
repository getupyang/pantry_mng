# 2026-10-08 · 批量录入识别限额热修

- 记录时间：2026-10-08（Asia/Seoul）
- 关联 commit：`043c159`（`codex/raise-recognition-limits`）
- 涉及文件：`api/openrouter.js`、`scripts/test-rate-limits.mjs`
- 改了什么：保留滚动窗口限流，将单客户端上限提高到 30 次/小时、120 次/24 小时；家庭提高到 300 次/24 小时；IP 提高到 90 次/小时、240 次/24 小时。
- 为什么改：批量录入用户触发原有 12 次/小时等限制，生产日志确认 `/api/openrouter` 返回 429。
- 用户如何验收：原先收到“识别次数过多”的用户刷新 Pantry 后继续拍照或订单识别；在未达到新上限时应正常进入识别结果确认页。
- 已验证：`node --test scripts/test-rate-limits.mjs scripts/test-multiphoto-api.mjs scripts/test-intake.cjs`，23 项通过。
- 适用范围：Pantry 生产环境的 `/api/openrouter` 图片和订单识别请求。
- 可能过时的地方：限额依赖当前 OpenRouter 成本、当前滚动窗口实现和生产流量；如果请求成本或滥用模式变化，需要重新评估。本文只记录 2026-10-08 的实现状态。
