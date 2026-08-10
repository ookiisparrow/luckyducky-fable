// guard-rules.mjs — 权限守卫规则表（独立模块, 供 pipeline-guard.ts 引用与测试）
// 定稿方案 §4 最低约束: 工具白名单 + 关键操作人工确认
// 设计原则: 覆盖常见绕过变体 (rm -rf/-fr/-r -f/--recursive --force, git reset --hard)

// L0: 必须人工确认（herdr blocked 可见）
export const L0_RULES = [
  { name: "rm-force", pattern: /\brm\b[^;|&\n]*(?:\s+-[a-z]*f[a-z]*|\s+--force|\s+--recursive)/, desc: "强制删除 (含 -rf/-fr/-r -f/--force/--recursive 变体)" },
  { name: "git-reset-hard", pattern: /\bgit\s+reset\b[^;|&]*--hard/, desc: "git 硬重置 (丢失工作区)" },
  { name: "db-write", pattern: /\b(mongo|mysql|sqlite|cloudbase|tcb|wx-server-sdk)\b.*\b(delete|drop|remove|update|insert|set)\b/i, desc: "数据库写操作" },
  { name: "deploy-prod", pattern: /(tcb|cloudbase|cloudbase-functions).*(deploy|functions|storage)|deploy-fns|wechatide.*(upload|preview)/i, desc: "云部署/上传" },
  { name: "git-push", pattern: /\bgit\s+push\b/, desc: "推送远程" },
  { name: "publish", pattern: /(publish|release|提审|上线|rollback|回滚)/i, desc: "发布/回滚" },
];

// L1: 记录审计, 不阻断
export const L1_RULES = [
  { name: "npm-install", pattern: /\bnpm\s+(install|i|add|ci)\b/, desc: "安装依赖" },
  { name: "git-rewrite", pattern: /\bgit\s+(reset|rebase|cherry-pick|amend)\b/, desc: "git 改写历史" },
  { name: "chmod", pattern: /\bchmod\s+[0-7]{3}/, desc: "修改权限" },
  { name: "kill", pattern: /\bkill\s+(-9\s+)?\d+/, desc: "杀进程" },
];

// red 模块文件前缀（写操作需确认）: 与模块分级同源 (orders/ops)
export const RED_FILE_PREFIXES = [
  "rewrite/cloud/src/functions/app/actions/orders",
  "rewrite/cloud/src/functions/adminApi/actions/orders",
  "rewrite/cloud/src/functions/adminApi/actions/refunds",
  "rewrite/cloud/src/functions/adminApi/actions/reconciliation",
  "rewrite/cloud/src/functions/adminApi/actions/wxbill",
  "rewrite/cloud/src/functions/adminApi/actions/ops",
  "rewrite/cloud/src/functions/adminApi/actions/configChecklist",
  "rewrite/cloud/src/functions/adminApi/actions/secureConfig",
  "rewrite/cloud/src/functions/adminApi/actions/dashboard",
  "rewrite/cloud/src/kit/gate",
  "rewrite/cloud/src/kit/wxpay",
  "rewrite/cloud/src/kit/transition",
  "rewrite/shared/src/fen",
];

export function isRedFilePath(p) {
  return RED_FILE_PREFIXES.some((prefix) => p.startsWith(prefix) || p.includes(prefix));
}

export function matchRules(cmd, rules) {
  return rules.find((r) => r.pattern.test(cmd)) || null;
}
