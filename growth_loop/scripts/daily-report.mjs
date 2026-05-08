#!/usr/bin/env node
import fs from "fs";
import path from "path";

const root = process.cwd();
const baseUrl = process.env.PANTRY_ADMIN_BASE_URL || "https://pantry-mng.vercel.app";
const token = process.env.PANTRY_ADMIN_TOKEN;
const days = Number(process.argv.find((arg) => arg.startsWith("--days="))?.split("=")[1] || 7);
const date = process.argv.find((arg) => arg.startsWith("--date="))?.split("=")[1] || new Date().toISOString().slice(0, 10);
const printOnly = process.argv.includes("--print");

if (!token) {
  console.error("PANTRY_ADMIN_TOKEN is required");
  process.exit(1);
}

async function getJson(apiPath) {
  const resp = await fetch(`${baseUrl}${apiPath}`, {
    headers: { "X-Admin-Token": token },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`${apiPath} failed: ${resp.status} ${JSON.stringify(data)}`);
  }
  return data;
}

function table(rows, columns) {
  if (!rows?.length) return "暂无数据";
  const head = `| ${columns.map((c) => c.label).join(" |")} |`;
  const sep = `| ${columns.map(() => "---").join(" |")} |`;
  const body = rows
    .map((row) => `| ${columns.map((c) => String(c.value(row) ?? "").replace(/\n/g, " ")).join(" |")} |`)
    .join("\n");
  return [head, sep, body].join("\n");
}

function metricList(summary = {}) {
  return [
    `- 家庭数：${summary.totalFamilies ?? 0}`,
    `- 客户端数：${summary.totalClients ?? 0}`,
    `- 7 日活跃客户端：${summary.activeClients7d ?? 0}`,
    `- 区间活跃家庭：${summary.activeFamiliesInRange ?? 0}`,
    `- 区间活跃客户端：${summary.activeClientsInRange ?? 0}`,
    `- 区间事件数：${summary.eventCount ?? 0}`,
    `- 识别次数：${summary.recognitionCount ?? 0}`,
    `- 识别错误：${summary.scanErrors ?? 0}`,
  ].join("\n");
}

function summarizeReviews(reviews = []) {
  if (!reviews.length) return "暂无已授权识别样本。";
  return table(reviews.slice(0, 20), [
    { label: "时间", value: (r) => r.createdAt },
    { label: "类型", value: (r) => r.reqType },
    { label: "结果", value: (r) => r.outcome },
    { label: "模型", value: (r) => (r.models || []).join("/") },
    {
      label: "字段改动",
      value: (r) => {
        const items = Array.isArray(r.acceptedData?.items) ? r.acceptedData.items : [];
        const last = items[items.length - 1];
        return last?.editedFields?.join(",") || "";
      },
    },
  ]);
}

let usage;
let reviewData;
try {
  usage = await getJson(`/api/admin/usage?days=${encodeURIComponent(days)}`);
  reviewData = await getJson("/api/admin/recognition-reviews?limit=50");
} catch (error) {
  console.error(`Failed to fetch admin data from ${baseUrl}`);
  console.error(error?.message || error);
  console.error("Set PANTRY_ADMIN_BASE_URL to another reachable deployment or run again when DNS/network is healthy.");
  process.exit(1);
}

const markdown = `# Signals - ${date}

Generated at: ${new Date().toISOString()}  
Base URL: ${baseUrl}  
Window: ${days} days

## Summary

${metricList(usage.summary)}

## Channel Counts

${table(usage.channelCounts || [], [
  { label: "渠道", value: (r) => r.name },
  { label: "事件数", value: (r) => r.count },
])}

## Event Counts

${table(usage.eventCounts || [], [
  { label: "事件", value: (r) => r.name },
  { label: "次数", value: (r) => r.count },
])}

## Recognition Counts

${table(usage.recognitionCounts || [], [
  { label: "识别", value: (r) => r.name },
  { label: "次数", value: (r) => r.count },
])}

## Families

${table((usage.families || []).slice(0, 20), [
  { label: "家庭", value: (r) => r.id },
  { label: "物品", value: (r) => r.itemCount },
  { label: "开封", value: (r) => r.openCount },
  { label: "库存", value: (r) => r.stockCount },
  { label: "客户端", value: (r) => r.clientCount },
  { label: "更新时间", value: (r) => r.updatedAt },
])}

## Recent Events

${table((usage.recentEvents || []).slice(0, 30), [
  { label: "时间", value: (r) => r.createdAt },
  { label: "事件", value: (r) => r.eventName },
  { label: "渠道", value: (r) => r.properties?.from || r.properties?.firstFrom || "direct" },
  { label: "活动", value: (r) => r.properties?.campaign || r.properties?.firstCampaign || "" },
])}

## Recognition Reviews

${summarizeReviews(reviewData.reviews || [])}

## Human Notes

- 今日判断：
- 需要跟进的用户原声：
- 下一步实验：
`;

if (printOnly) {
  console.log(markdown);
} else {
  const out = path.join(root, "growth_loop", "signals", `${date}.md`);
  fs.writeFileSync(out, markdown);
  console.log(`Wrote ${out}`);
}
