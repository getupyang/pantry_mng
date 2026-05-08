#!/usr/bin/env node
import fs from "fs";
import path from "path";

const root = process.cwd();
const campaign = process.argv[2] || `campaign_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
const channels = process.argv.slice(3);
const list = channels.length ? channels : ["xhs_comment", "wechat_moments", "friend_a", "friend_b", "friend_c", "friend_d"];
const baseUrl = process.env.PANTRY_APP_URL || "https://pantry-mng.vercel.app/pantry.html";
const date = new Date().toISOString().slice(0, 10);

const lines = [
  `# Campaign Links - ${date}`,
  "",
  `Campaign: \`${campaign}\``,
  "",
  "| 渠道 | 链接 |",
  "|---|---|",
  ...list.map((from) => {
    const url = new URL(baseUrl);
    url.searchParams.set("from", from);
    url.searchParams.set("campaign", campaign);
    return `| ${from} | ${url.toString()} |`;
  }),
  "",
];

const out = path.join(root, "growth_loop", "outreach", `campaign-links-${date}.md`);
fs.writeFileSync(out, lines.join("\n"));
console.log(`Wrote ${out}`);
