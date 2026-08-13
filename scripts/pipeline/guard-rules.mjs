// guard-rules.mjs — 权限守卫规则表（独立模块, 供 pipeline-guard.ts 引用与测试）
// 定稿方案 §4 最低约束: 工具白名单 + 关键操作人工确认
// 设计: 覆盖常见绕过变体; red 路径精确边界匹配 (消除 includes 误报)
//
// 全局约定（老板 2026-08-11 令）: 每条 L0 规则必须带三要素白话文案——
//   human  = 是什么权限（一句话大白话）
//   why    = 为什么需要你确认
//   effect = 通过会怎么样（同意后的后果）
// 危险等级（老板 2026-08-11 追加令）: critical: true = 最危险/不可撤回/影响巨大——
//   弹窗必须用 🚨 警告标志醒目标注；其余 L0 用 ⚠️。

// L0: 必须人工确认（herdr blocked 可见）— 弹窗文案 = 三要素
export const L0_RULES = [
  { name: "rm-force", pattern: /\brm\b[^;|&\n]*(?:\s+-[a-zA-Z]*[fF][a-zA-Z]*|\s+--force|\s+--recursive)/,
    desc: "强制删除", critical: true,
    human: "强制删除文件或目录（rm -rf 类命令）",
    why: "删除不可恢复。AI 可能误删代码、订单数据等重要文件",
    effect: "命令立即执行，被删的东西永久消失，无法找回" },
  { name: "find-delete", pattern: /\bfind\b[^;|&\n]*\s-delete/,
    desc: "批量删除", critical: true,
    human: "用 find 命令批量删除文件",
    why: "批量删除范围大，一条命令可能删掉成百上千个文件",
    effect: "匹配到的文件全部被删除，不可恢复" },
  { name: "py-rmtree", pattern: /\b(shutil\.rmtree|os\.remove|os\.unlink)\s*\(/,
    desc: "Python 删除", critical: true,
    human: "用 Python 脚本删除文件或整棵目录",
    why: "这是绕过 rm 的另一种删除方式，AI 可能用它删目录树",
    effect: "指定文件/目录整体删除，不可恢复" },
  { name: "git-reset-hard", pattern: /\bgit\b[^;|&\n]*reset[^;|&\n]*--hard/,
    desc: "Git 硬重置", critical: true,
    human: "Git 硬重置（丢弃工作区所有改动）",
    why: "会丢掉所有未提交的修改，包括刚写好的代码",
    effect: "工作区回到指定版本，未提交的改动全部丢失" },
  { name: "git-push", pattern: /\bgit\b[^;|&\n]*push\b/,
    desc: "推送远程",
    human: "把本地代码推送到远程仓库（git push）",
    why: "代码一旦推上去就进入共享历史，改错会影响整个项目；红区代码推送尤其危险",
    effect: "本地提交推送到 GitHub，远程历史改变，不易撤回" },
  { name: "db-write", pattern: /\b(mongo|mysql|sqlite|cloudbase|tcb|wx-server-sdk)\b.*\b(delete|drop|remove|update|insert|set)\b/i,
    desc: "数据库写操作", critical: true,
    human: "修改数据库里的数据（增、删、改）",
    why: "线上数据（订单、用户）改错无法轻易恢复，可能造成真实经济损失",
    effect: "数据库数据被改动，直接影响线上用户" },
  { name: "deploy-prod", pattern: /((tcb|cloudbase|@cloudbase\/cli|miniprogram-ci|wechatide)[^;|&]*(deploy|upload|preview|functions|storage))|(deploy-fns)/i,
    desc: "云部署/上传", critical: true,
    human: "把云函数部署/上传到云端",
    why: "部署后云端立刻运行新代码，出问题影响所有用户",
    effect: "云端函数更新，线上行为立即改变" },
  { name: "publish", pattern: /(publish|release|提审|上线|rollback|回滚)/i,
    desc: "发布/回滚", critical: true,
    human: "发布、回滚、提审相关操作",
    why: "发布是面向全体用户的动作，提审被拒或发布事故代价很高",
    effect: "版本发布/回滚生效，用户能立即看到变化" },
];

// L1: 记录审计, 不阻断（无弹窗, 不需白话文案）
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
  "rewrite/shared/src/money",
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
