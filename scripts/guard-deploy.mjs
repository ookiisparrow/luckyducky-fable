#!/usr/bin/env node
/**
 * 部署闸（Claude Code PreToolUse hook，matcher: Bash）——生产仓模型（v0.9.1 起，用户拍板 A 2026-06-14）。
 *
 * 本仓 = 生产源（云环境 cloudbase-d4gcssqbv06865479 从本仓迭代），**接管 tcb**。策略：
 *   - 读类 tcb（fn invoke / fn log / env list …）：放行。
 *   - tcb 写部署（deploy/publish/delete/create/framework）命中**敏感函数**（钱/权限/状态），
 *     或批量/删除/认不出具体非敏感函数：`permissionDecision:'ask'` 二次确认。
 *   - 写单个非敏感读函数（getProducts 等）：放行。
 *   - `DEPLOY_ALLOWED=1 … deploy-fns`（批量部署全量、含敏感）：'ask'。
 *   - 仅在「真把 tcb / deploy-fns 当命令执行」时判（按 shell 分段、看段首）——提交信息 / echo 里
 *     **提到** "tcb"/"deploy" 字样不算，杜绝误拦 git commit。人在自己终端的命令不经本 hook。
 *
 * 自测：echo '{"tool_input":{"command":"tcb fn deploy createOrder"}}' | node scripts/guard-deploy.mjs  # → ask
 *       echo '{"tool_input":{"command":"git commit -m \"tcb deploy 记账\""}}' | node scripts/guard-deploy.mjs  # → 放行（无输出）
 */

// 敏感函数（钱/权限/状态/毁灭性删除）：tcb 写部署须二次确认
const SENSITIVE_FNS = [
  'createOrder', 'pay', 'payCallback', 'applyRefund', 'refundCallback', 'closeExpiredOrders',
  'adminApi', 'genQrcodes', 'activateCourse', 'confirmEnter', 'confirmReceive', 'submitReview',
  'login', 'updateProfile', 'trackEvent', 'seedProducts', 'seedCourses', 'initDb', 'cleanupEvents',
  'kfCallback', 'kfBind', 'kfSend', 'kfHealthProbe', // 微信客服：回调状态写 + 身份桥接映射写 + 主动发消息给顾客 + 活体探针（读密钥/调API/推告警·敏感·根因#3）
  'submitFeedback', // 用户写函数（写库·频控敏感·根因#13），同 trackEvent/updateProfile 二次确认
]
// 纯读函数：写部署放行（明确非敏感）
const READONLY_FNS = [
  'getProducts', 'getCourses', 'getContent', 'getReviews', 'getMyOrders', 'getMyCourses',
  'getMyProgress', 'getMyAfterSales', 'getOrderById', 'getPlaybackUrl',
]
const word = (w) => new RegExp('\\b' + w + '\\b')

let stdin = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) stdin += chunk

let command = ''
try {
  command = JSON.parse(stdin)?.tool_input?.command || ''
} catch {
  process.exit(0)
}

let needConfirm = false
for (const raw of command.split(/&&|\|\||;|\n|\|/)) {
  const seg = raw.trim()
  const envPrefix = (seg.match(/^(?:\w+=\S+\s+)*/) || [''])[0]
  const cmd = seg.slice(envPrefix.length) // 去掉前导 ENV=val 后的真命令

  // ① 批量部署脚本：DEPLOY_ALLOWED=1 … deploy-fns（部署全量、含敏感）→ 确认
  if (/\bDEPLOY_ALLOWED=1\b/.test(envPrefix) && /deploy-fns/.test(cmd)) needConfirm = true

  // ② 直接 tcb 命令：仅段首真为 tcb 才算（提交信息 / echo 里的字样不算）
  if (!/^(?:\S*\/)?tcb[\s:]/.test(cmd)) continue
  const isWrite = /\b(deploy|publish|delete|create)\b/.test(cmd) || /\bframework\b/.test(cmd)
  if (!isWrite) continue // 读类 tcb（invoke/log/list/detail…）→ 放行
  const sensitive = SENSITIVE_FNS.some((fn) => word(fn).test(cmd))
  const readonlyOnly = !sensitive && READONLY_FNS.some((fn) => word(fn).test(cmd))
  if (sensitive || !readonlyOnly) needConfirm = true // 敏感 / 批量 / 认不出非敏感 → 确认
}

if (needConfirm) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason:
          '生产部署确认：这条命令会向生产云环境 cloudbase-d4gcssqbv06865479 写入敏感函数' +
          '（钱/权限/状态）或为批量部署。确认无误再放行——读类与单个非敏感函数部署不弹此确认。',
      },
    })
  )
}
process.exit(0)
