# Growth Loop Release Checklist

## 代码检查

- `node --check api/admin/usage.js`
- `node --check api/openrouter.js`
- `node --check api/recognition-review.js`
- `node --check api/admin/recognition-reviews.js`
- HTML 内联脚本检查：

```bash
node -e "const fs=require('fs'); for (const f of ['pantry.html','admin.html']) { const html=fs.readFileSync(f,'utf8'); const scripts=[...html.matchAll(/<script(?: [^>]*)?>([\\s\\S]*?)<\\/script>/gi)].map(m=>m[1]).filter(s=>s.trim()); scripts.forEach((s,i)=>new Function(s)); console.log(f, scripts.length, 'inline scripts ok'); }"
```

## 渠道归因检查

1. 打开：
   `https://pantry-mng.vercel.app/pantry.html?from=qa&campaign=loop_smoke`
2. 后台事件里应出现：
   - `from: qa`
   - `campaign: loop_smoke`
3. Admin 看板 `渠道来源` 应出现 `qa/loop_smoke`。

## 行为检查

- 无参数打开仍然可用。
- 带参数打开不会重复创建家庭。
- `app_open`、`scan_start`、`item_add` 都带渠道参数。
- 不同链接只影响埋点，不影响用户数据。

## 隐私检查

- 不在仓库写入任何密钥。
- 识别样本仍然需要用户同意。
- 对外触达不承诺医疗建议。
