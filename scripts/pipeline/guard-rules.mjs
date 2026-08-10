// guard-rules.mjs — 权限守卫规则表（独立模块, 供 pipeline-guard.ts 引用与测试）
// 定稿方案 §4 最低约束: 工具白名单 + 关键操作人工确认
// 设计: 覆盖常见绕过变体; red 路径精确边界匹配 (消除 includes 误报)

// L0: 必须人工确认（herdr blocked 可见）
export const L0_RULES = [
  // 强制删除: 覆盖 -rf/-fr/-r -f/-fR/-RF/--force/--recursive 及大小写变体
  { name: "rm-force", pattern: /\brm\b[^;|&\n]*(?:\s+-[a-zA-Z]*[fF][a-zA-Z]*|\s+--force|\s+--recursive)/, desc: "强制删除" },
  // 非 rm 删除手段
  { name: "find-delete", pattern: /\bfind\b[^;|&\n]*\s-delete/, desc: "find -delete 批量删除" },
  { name: "py-rmtree", pattern: /\b(shutil\.rmtree|os\.remove|os\.unlink)\s*\(/, desc: "python 删除文件/目录" },
  // git 危险操作: 覆盖 git -C <dir> 变体
  { name: "git-reset-hard", pattern: /\bgit\b[^;|&\n]*reset[^;|&\n]*--hard/, desc: "git 硬重置 (丢失工作区)" },
  { name: "git-push", pattern: /\bgit\b[^;|&\n]*push\b/, desc: "推送远程" },
  // 数据库写
  { name: "db-write", pattern: /\b(mongo|mysql|sqlite|cloudbase|tcb|wx-server-sdk)\b.*\b(delete|drop|remove|update|insert|set)\b/i, desc: "数据库写操作" },
  // 部署/上传 (含 npx/脚本变体)
  { name: "deploy-prod", pattern: /((tcb|cloudbase|@cloudbase\/cli|miniprogram-ci|wechatide)[^;|&]*(deploy|upload|preview|functions|storage))|(deploy-fns)/i, desc: "云部署/上传" },
  // 发布/回滚
  { name: "publish", pattern: /(publish|release|提审|上线|rollback|回滚)/i, desc: "发布/回滚" },
];

// L1: 记录审计, 不阻断
export const L1_RULES = [
  { name: "npm-install", pattern: /\bnpm\s+(install|i|add|ci)\b/, desc: "安装依赖" },
  { name: "git-rewrite", pattern: /\bgit\b[^;|&\n]*(reset|rebase|cherry-pick|amend)/, desc: "git 改写历史" },
  { name: "chmod", pattern: /\bchmod\s+[0-7]{3}/, desc: "修改权限" },
  { name: "kill", pattern: /\bkill\s+(-9\s+)?\d+/, desc: "杀进程" },
];

// red 模块文件前缀（写操作需确认）: 与 scripts/git-hooks/commit-msg 的 RED_DIRS 同源 (orders/ops)
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

// 精确边界匹配: 消除 includes 误报 (gateway 不应命中 gate); 兼容相对/绝对路径
export function isRedFilePath(p) {
  const norm = p.replace(/^.*\/luckyducky-fable\//, ""); // 绝对路径 → 相对
  return RED_FILE_PREFIXES.some((prefix) => {
    if (norm === prefix) return true;
    if (norm.startsWith(prefix + "/")) return true; // 目录内
    if (norm.startsWith(prefix + ".")) return true; // 同名不同扩展名 gate.ts / gate.js
    return false;
  });
}

// bash 重定向写入 red 文件检测 (echo 'x' > rewrite/cloud/src/kit/wxpay.ts)
export function bashWritesRedFile(cmd) {
  // 匹配 > 或 >> 后跟 red 路径 (含引号/绝对路径变体)
  const m = cmd.match(/>>?\s*["']?([^"'\s;|&]+)/);
  return m ? isRedFilePath(m[1]) : false;
}

export function matchRules(cmd, rules) {
  return rules.find((r) => r.pattern.test(cmd)) || null;
}
