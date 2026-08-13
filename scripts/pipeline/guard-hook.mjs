#!/usr/bin/env node
/**
 * guard-hook.mjs — 共享权限守卫 hook(codex / kimi 通用)
 *
 * 与 pi 的 pipeline-guard.ts 共用同一套规则表 guard-rules.mjs,实现三端统一策略:
 *   pi   → pipeline-guard.ts(交互式: T2 倒计时+信任缓存, T3 必审)
 *   codex/kimi → 本脚本(PreToolUse hook, 返回 permissionDecision)
 *
 * 分级映射(与 pi 端一致):
 *   T1 (L1_RULES)            → allow + 审计
 *   T2 (L0_RULES 非 critical) → allow + 审计  (codex/kimi 无倒计时 UX, 直接默认放行)
 *   T3 (L0_RULES critical + red 文件写) → ask + 审计 (红线必审, 由代理自身的审批 UI 处理)
 *   未命中规则 → 不干预(不输出)
 *
 * 调用契约(Claude Code 系 hook):
 *   stdin:  {"tool_name": "...", "tool_input": {...}}
 *   stdout: {"hookSpecificOutput":{"hookEventName":"PreToolUse",
 *            "permissionDecision":"allow|deny|ask","permissionDecisionReason":"..."}}
 *   agent 参数: argv[2] = codex | kimi(写审计日志用)
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { L0_RULES, L1_RULES, matchRules, isRedFilePath, bashWritesRedFile } from "./guard-rules.mjs";

const PIPELINE_ROOT = process.env.PIPELINE_ROOT || join(homedir(), "luckyducky-fable");
const AUDIT_DIR = join(PIPELINE_ROOT, ".agents", "knowledge");
const AGENT = process.argv[2] || "agent";

function audit(entry) {
  try {
    mkdirSync(AUDIT_DIR, { recursive: true });
    appendFileSync(join(AUDIT_DIR, "audit.log"), entry + "\n");
  } catch {
    /* 审计失败不阻断 */
  }
}

function readInput() {
  try {
    const stdin = readFileSync(0, "utf8").trim();
    if (stdin) return JSON.parse(stdin);
  } catch {
    /* fallthrough */
  }
  try {
    const arg = process.argv[3];
    if (arg) return JSON.parse(arg);
  } catch {
    /* fallthrough */
  }
  return null;
}

function extractCommand(toolName, input) {
  if ((toolName === "Bash" || toolName === "Shell") && input?.command) return input.command;
  return "";
}

function extractPath(toolName, input) {
  if ((toolName === "Write" || toolName === "Edit") && input?.file_path) return input.file_path;
  if (toolName === "EditMultipleTools" && Array.isArray(input?.edits) && input.edits[0]?.file_path) {
    return input.edits[0].file_path;
  }
  return "";
}

function decide(toolName, input) {
  const ts = new Date().toISOString();
  const cmd = extractCommand(toolName, input);
  const path = extractPath(toolName, input);

  if (path && isRedFilePath(path)) {
    audit(`${ts} [${AGENT}] T3 red-file-write decision=ask path="${path}"`);
    return { decision: "ask", reason: "T3 红区文件写入需人工确认" };
  }

  if (cmd) {
    if (bashWritesRedFile(cmd)) {
      audit(`${ts} [${AGENT}] T3 bash-red-write decision=ask cmd="${cmd.slice(0, 200)}"`);
      return { decision: "ask", reason: "T3 bash 重定向写红区需人工确认" };
    }
    const l0 = matchRules(cmd, L0_RULES);
    if (l0) {
      const decision = l0.critical ? "ask" : "allow";
      audit(`${ts} [${AGENT}] ${l0.critical ? "T3" : "T2"} ${l0.name} decision=${decision} cmd="${cmd.slice(0, 200)}"`);
      return { decision, reason: l0.critical ? `T3 ${l0.name} 红线需人工确认` : `T2 ${l0.name} 自动放行` };
    }
    const l1 = matchRules(cmd, L1_RULES);
    if (l1) {
      audit(`${ts} [${AGENT}] T1 ${l1.name} decision=allow cmd="${cmd.slice(0, 200)}"`);
      return { decision: "allow", reason: `T1 ${l1.name} 自动放行` };
    }
  }

  return null; // 未命中规则,不干预
}

const input = readInput();
if (input) {
  const result = decide(input.tool_name, input.tool_input || {});
  if (result) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: result.decision,
          permissionDecisionReason: result.reason,
        },
      }),
    );
  }
}
