// pipeline-guard.ts — 多模型流水线权限守卫（主控 pi 扩展）
// 定稿方案 §4 最低约束: 工具白名单 + 关键操作人工确认 + 审计日志
// 规则表独立于 scripts/pipeline/guard-rules.mjs（项目内受版本控制, 可测试）
// 路径: 环境变量 PIPELINE_ROOT 覆盖, 默认 ~/luckyducky-fable（可移植）
// 生效: /reload 或重启 pi

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PIPELINE_ROOT = process.env.PIPELINE_ROOT || join(homedir(), "luckyducky-fable");
const AUDIT_DIR = join(PIPELINE_ROOT, ".agents", "knowledge");

function audit(entry) {
  try {
    mkdirSync(AUDIT_DIR, { recursive: true });
    appendFileSync(join(AUDIT_DIR, "audit.log"), entry + "\n");
    return true;
  } catch (e) {
    return false;
  }
}

export default async function (pi) {
  // 动态加载规则表（ESM 静态 import 不支持变量路径）
  // fail-closed: 加载失败时告警并降级, 绝不静默失效
  const rules = await import(`${PIPELINE_ROOT}/scripts/pipeline/guard-rules.mjs`).catch(() => null);
  if (!rules) {
    console.error("[pipeline-guard] 规则表加载失败, 守卫 fail-closed 告警");
    if (pi && pi.events) pi.events.emit("herdr:blocked", { active: true, label: "pipeline-guard 规则加载失败" });
    return; // 无规则可用时不再挂载拦截（已告警 blocked, 不会静默）
  }
  const { L0_RULES, L1_RULES, matchRules, isRedFilePath, bashWritesRedFile } = rules;

  pi.on("tool_call", async (event, ctx) => {
    const ts = new Date().toISOString();

    // ---- 写类工具: edit/write 到 red 模块文件 → 必须确认 ----
    if (event.toolName === "edit" || event.toolName === "write") {
      const target = event.input?.path || "";
      if (isRedFilePath(target)) {
        const ok = ctx.hasUI
          ? await ctx.ui.confirm("[L0·red 文件写操作]", `修改红区文件需确认:\n\n${target}`)
          : false;
        const logged = audit(`${ts} L0 red-file-write allow=${ok} path="${target}"`);
        if (!ok) {
          return { block: true, reason: "red 模块文件写操作被权限守卫拦截" };
        }
        if (!logged && ctx.hasUI) ctx.ui.notify("⚠️ 审计日志写入失败", "warning");
        return;
      }
    }

    // ---- bash 命令: L0 确认 / L1 审计 ----

    if (event.toolName === "bash") {
      const cmd = event.input?.command || "";
      // bash 重定向写 red 文件 → 拦截
      if (bashWritesRedFile(cmd)) {
        const ok = ctx.hasUI
          ? await ctx.ui.confirm("[L0·bash 写 red 文件]", `重定向写入红区文件需确认:\n\n${cmd.slice(0, 400)}`)
          : false;
        audit(`${ts} L0 bash-red-write allow=${ok} cmd="${cmd.slice(0, 200)}"`);
        if (!ok) {
          return { block: true, reason: "bash 重定向写 red 模块文件被权限守卫拦截" };
        }
        return;
      }

      const l0 = matchRules(cmd, L0_RULES);
      if (l0) {
        const ok = ctx.hasUI
          ? await ctx.ui.confirm(`[L0·${l0.desc}]`, `执行?\n\n${cmd.slice(0, 400)}`)
          : false;
        const logged = audit(`${ts} L0 ${l0.name} allow=${ok} cmd="${cmd.slice(0, 200)}"`);
        if (!ok) {
          return { block: true, reason: `L0 ${l0.name}: ${l0.desc} 被权限守卫拦截` };
        }
        if (!logged && ctx.hasUI) ctx.ui.notify("⚠️ 审计日志写入失败", "warning");
        return;
      }

      const l1 = matchRules(cmd, L1_RULES);
      if (l1) {
        const logged = audit(`${ts} L1 ${l1.name} cmd="${cmd.slice(0, 200)}"`);
        if (!logged && ctx.hasUI) ctx.ui.notify("⚠️ 审计日志写入失败", "warning");
      }
    }
  });
}
