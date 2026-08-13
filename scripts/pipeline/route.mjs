#!/usr/bin/env node
/**
 * 路由分类器 (route.mjs)
 * 定稿方案 §1 最低约束: 任务路由不得由模型自我判定。
 * 代码化规则分类: 输入工单描述 → {level, models, reason}
 * 多标签取最高风险标签优先; 未知任务 fail-closed (默认人工确认)。
 *
 * 用法: node scripts/pipeline/route.mjs "<任务描述>"   (CLI)
 *       import { classify } from "./route.mjs"         (测试/编排)
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

// 1. 读取 modules.json 分级
const mods = JSON.parse(readFileSync(resolve(repoRoot, "modules.json"), "utf8")).modules;
const redModules = Object.entries(mods)
  .filter(([, v]) => v.tier === "red")
  .map(([k]) => k);
const yellowModules = Object.entries(mods)
  .filter(([, v]) => v.tier === "yellow")
  .map(([k]) => k);

// 2. 代码化规则表 (严重度从高到低, 命中即取)
const RULES = [
  // L0: red 面模块 / 钱链 / 运维 / 生产发布 / 数据库不可逆
  { level: "L0", match: /(订单|支付|退款|对账|账单|钱|ops|运维|配置|部署|发布|提审|上线|回滚|数据库|清空|删除.*数据|生产)/i, reason: "触及 red 面/发布/数据不可逆", models: ["kimi", "codex"], human: true },
  // L0: 安全/隐私/合规
  { level: "L0", match: /(安全|隐私|合规|漏洞|注入|越权|权限|敏感|token|密钥|凭据|审核|类目|资质)/i, reason: "安全/隐私/合规类", models: ["codex", "kimi"], human: true },
  // L1: 大范围 / 重构 / 长 diff
  { level: "L1", match: /(重构|大规模|大范围|全面|长diff|架构|迁移|升级|依赖.*升级)/i, reason: "大范围改动", models: ["kimi"] },
  // L2: 普通功能/修复
  { level: "L2", match: /(修复|实现|功能|新增|调整|修改|样式|页面|接口|bug|优化)/i, reason: "普通迭代", models: [] },
  // L3: 机械/文档/脚本
  { level: "L3", match: /(文档|脚本|格式|lint|拼写|文案|注释|日志|统计)/i, reason: "机械/文档任务", models: [] },
];

// 3. 模块关键词命中 (模块名进上下文)
const moduleHit = (text) => {
  const t = text.toLowerCase();
  if (redModules.some((m) => t.includes(m))) return "red";
  if (yellowModules.some((m) => t.includes(m))) return "yellow";
  return null;
};

export function classify(input) {
  const hits = [];
  const tier = moduleHit(input);
  if (tier === "red") {
    hits.push({ level: "L0", reason: `命中 red 模块`, models: ["kimi", "codex"], human: true });
  }
  for (const rule of RULES) {
    if (rule.match.test(input)) {
      hits.push({ level: rule.level, reason: rule.reason, models: rule.models, human: rule.human });
    }
  }
  // 未知任务 fail-closed: 无任何命中 → 默认人工确认 (L0 + human), 防止含糊描述绕过
  if (hits.length === 0) {
    return {
      level: "L0", models: ["kimi", "codex"], human: true,
      reason: "无规则命中, fail-closed 默认人工确认", allHits: ["L0"],
    };
  }
  const order = { L0: 0, L1: 1, L2: 2, L3: 3 };
  hits.sort((a, b) => order[a.level] - order[b.level]);
  const top = hits[0];
  return {
    level: top.level,
    models: top.models,
    human: top.human || hits.some((h) => h.human),
    reason: hits.map((h) => h.reason).join("; "),
    allHits: hits.map((h) => h.level),
  };
}

// CLI 入口 (仅直接运行时)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = process.argv.slice(2).join(" ") || "";
  if (!input) {
    console.error('用法: node scripts/pipeline/route.mjs "<任务描述>"');
    process.exit(2);
  }
  console.log(JSON.stringify({ input, ...classify(input) }, null, 2));
}
