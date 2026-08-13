#!/usr/bin/env node
/**
 * 知识盘点脚本 (audit-knowledge.mjs) — 流水线 P4 自迭代·零模型成本
 * 定稿方案 §6: 定期盘点决策日志, 列出待验证/已失效条目提醒人工审计。
 *
 * 输出: 决策日志状态汇总 + 审查归档统计 + 待人工处理清单
 * 用法: node scripts/pipeline/audit-knowledge.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const KNOW = join(ROOT, ".agents", "knowledge");
const ARCHIVES = join(ROOT, ".agents", "archives");

function parseDecisions(file) {
  const text = readFileSync(file, "utf8");
  // 条目块: ## 条目 <ID> ... 到下一个 ## 或文件尾
  const blocks = text.split(/^## /m).filter((b) => b.trim());
  const entries = [];
  for (const b of blocks) {
    const idLine = b.split("\n")[0].trim();
    const m = (f) => {
      const re = new RegExp(`^-\\s*${f}:\\s*(.+)$`, "m");
      const hit = b.match(re);
      return hit ? hit[1].trim() : "";
    };
    if (!idLine.startsWith("条目")) continue;
    entries.push({
      id: idLine.replace("条目", "").trim(),
      time: m("时间"),
      operator: m("操作者"),
      conclusion: m("结论").slice(0, 80),
      verify: m("验证状态"),
      confidence: m("置信度"),
    });
  }
  return entries;
}

function audit() {
  const report = { generatedAt: new Date().toISOString(), entries: [], pending: [], stats: {} };
  const decFile = join(KNOW, "decisions.md");

  // 1. 决策日志
  if (statSync(decFile, { throwIfNoEntry: false })) {
    const entries = parseDecisions(decFile);
    report.entries = entries;
    const pending = entries.filter((e) => e.verify.includes("待验证"));
    const expired = entries.filter((e) => e.verify.includes("已失效"));
    const verified = entries.filter((e) => e.verify.includes("已验证"));
    report.stats = {
      total: entries.length,
      verified: verified.length,
      pending: pending.length,
      expired: expired.length,
    };
    report.pending = [
      ...pending.map((e) => `⚠️ 待验证: ${e.id} (${e.conclusion})`),
      ...expired.map((e) => `🕸️ 已失效: ${e.id} (${e.conclusion})`),
    ];
  }

  // 2. 审查归档统计
  if (statSync(ARCHIVES, { throwIfNoEntry: false })) {
    const files = readdirSync(ARCHIVES).filter((f) => f.endsWith(".md") && !f.endsWith(".sha256"));
    const reviews = files.filter((f) => /-(codex|kimi|w[0-9]p[0-9])/.test(f));
    report.stats.reviews = reviews.length;
    report.stats.archives = files.length;
    // 按 LD 前缀分组
    const byLd = {};
    for (const f of files) {
      const ld = f.match(/^(PL-[0-9]+|[A-Z]+-[0-9]+)/)?.[1] || "other";
      byLd[ld] = (byLd[ld] || 0) + 1;
    }
    report.stats.byLd = byLd;
  }

  // 3. 审计日志
  const auditLog = join(KNOW, "audit.log");
  if (statSync(auditLog, { throwIfNoEntry: false })) {
    const lines = readFileSync(auditLog, "utf8").trim().split("\n").filter(Boolean);
    report.stats.auditEntries = lines.length;
    const l0 = lines.filter((l) => l.includes(" L0 ")).length;
    report.stats.l0Ops = l0;
  }

  return report;
}

const r = audit();
console.log("══════ 流水线知识盘点 ══════");
console.log(`生成时间: ${r.generatedAt}`);
console.log("");
console.log(`决策日志: ${r.stats.total || 0} 条 (已验证 ${r.stats.verified || 0} / 待验证 ${r.stats.pending || 0} / 已失效 ${r.stats.expired || 0})`);
console.log(`审查归档: ${r.stats.archives || 0} 份 (双票审查 ${r.stats.reviews || 0} 份)`);
if (r.stats.byLd) console.log(`按批次: ${JSON.stringify(r.stats.byLd)}`);
if (r.stats.auditEntries) console.log(`审计日志: ${r.stats.auditEntries} 条 (L0 操作 ${r.stats.l0Ops || 0} 次)`);
console.log("");
if (r.pending.length > 0) {
  console.log("需要人工处理的条目:");
  for (const p of r.pending) console.log(`  ${p}`);
} else {
  console.log("✅ 无待验证/已失效条目, 知识库健康");
}
console.log("");
console.log("提示: 定期运行本脚本 (建议每周一次)。重大教训经人工确认后入 docs/判例索引.json (nofix 类) 形成闭环。");
