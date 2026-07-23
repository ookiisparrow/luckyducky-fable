#!/usr/bin/env node
/**
 * 部署闸（Claude Code PreToolUse hook，matcher: Bash）——生产仓模型（v0.9.1 起，用户拍板 A 2026-06-14）。
 *
 * 本仓 = 生产源（云环境 cloudbase-d4gcssqbv06865479 从本仓迭代），**接管 tcb**。策略：
 *   - 读类 tcb（fn invoke / fn log / env list …）：放行。
 *   - tcb 写部署（deploy/publish/delete/create/framework）命中**敏感函数**（钱/权限/状态），
 *     或批量/删除/认不出具体非敏感函数：`permissionDecision:'ask'` 二次确认。
 *   - 新线（rewrite/cloud·17 部署单元·以 build.mjs 产物为准）无独立纯读函数（读 action 收在 app 内）；旧线纯读函数
 *     2026-07-09 已清退，部署同名＝静默新建孤儿函数——故任何具名函数写部署一律 ask，READONLY_FNS 空册。
 *   - `DEPLOY_ALLOWED=1 … deploy-fns`（批量部署全量、含敏感）：'ask'。
 *   - 仅在「真把 tcb / deploy-fns 当命令执行」时判（按 shell 分段、看段首）——提交信息 / echo 里
 *     **提到** "tcb"/"deploy" 字样不算，杜绝误拦 git commit。人在自己终端的命令不经本 hook。
 *
 * 自测：echo '{"tool_input":{"command":"tcb fn deploy createOrder"}}' | node scripts/guard-deploy.mjs  # → ask
 *       echo '{"tool_input":{"command":"npx tcb fn deploy adminApi"}}' | node scripts/guard-deploy.mjs  # → ask（runner 前缀绕过·深审 P1）
 *       echo '{"tool_input":{"command":"export DEPLOY_ALLOWED=1; node scripts/deploy-fns.mjs"}}' | node scripts/guard-deploy.mjs  # → ask（export 分段绕过·深审 P1）
 *       echo '{"tool_input":{"command":"git commit -m \"tcb deploy 记账\""}}' | node scripts/guard-deploy.mjs  # → 放行（无输出）
 */

// 敏感函数（钱/权限/状态/毁灭性删除）：tcb 写部署须二次确认
const SENSITIVE_FNS = [
  'createOrder', 'pay', 'payCallback', 'applyRefund', 'refundCallback', 'closeExpiredOrders',
  'adminApi', 'genQrcodes', 'activateCourse', 'confirmEnter', 'confirmReceive', 'submitReview',
  'login', 'updateProfile', 'trackEvent', 'seedProducts', 'seedCourses', 'initDb', 'cleanupEvents',
  'kfCallback', 'kfBind', 'kfSend', 'kfHealthProbe', // 微信客服：回调状态写 + 身份桥接映射写 + 主动发消息给顾客 + 活体探针（读密钥/调API/推告警·敏感·根因#3）
  'submitFeedback', // 用户写函数（写库·频控敏感·根因#13），同 trackEvent/updateProfile 二次确认
  'app', 'adminApiV2', // 重写线并行期部署面（M2/M3）：app 含钱链用户 action、adminApiV2 含审批退款/改库存——重部署二次确认
  // 新线（rewrite/cloud）函数拓扑刷新（批I·以 build.mjs collect() 产物为准，非记忆）：新线部署单元全部纳入敏感面，
  // 部署任一即二次确认。多数已在上方（app/adminApi/payCallback/refundCallback/kfCallback/kfSend/kfHealthProbe/
  // closeExpiredOrders/cleanupEvents/genQrcodes/seedProducts/seedCourses/initDb），补齐尚缺的三个新线单元：
  'recallScan', // timers/recallScan：招回扫描（写库·bot 告警接缝·根因#14）
  'inspect', // timers/inspect：巡检机（读密钥/连接器活体/写 inspectRuns + recordAnomaly·根因#14）
  'kfMedia', // cs/kfMedia：微信客服媒体（拉取/落库 UGC·PII·内容安全面·根因#3）
  'billReconcile', // 每日对账 timer（批B2·第17个部署单元）：读商户私钥（secureConfig/env）+写 wxBills+钱链告警——重部署二次确认
]
// 纯读函数：写部署放行（明确非敏感）——新线**无独立纯读函数**（读 action 收在 app 内、非独立部署单元），
// 旧线纯读函数（getProducts/getCourses…）2026-07-09 已随旧线清退、云端不复存在；此时部署同名 = 新建孤儿函数
// （唯一真放行洞·会静默造函数不弹确认），故清空为 []：任何 tcb 写部署一律走 ask（fail-safe·收紧不放松）。
const READONLY_FNS = []
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

  // ① 批量部署脚本：任何「真跑 deploy-fns.mjs」都确认（深审 P1·env/export 绕过）。deploy-fns 无 DEPLOY_ALLOWED=1
  //    即 exit(1) 拒跑，故对无害的 --dry-run/未授权跑一并 ask 不误伤（确认后照样只报告）；而 `env DEPLOY_ALLOWED=1 …`
  //    的 env 不进 envPrefix、`export DEPLOY_ALLOWED=1; …` 又被 ';' 拆成两段——旧版只认 envPrefix 里的 DEPLOY_ALLOWED
  //    会双双漏网。改判「被执行的程序是不是 deploy-fns.mjs」：剥掉 env/前导赋值取真正的程序，锚在程序位判定
  //    （node/路径/裸跑皆认；提交信息里提字样处于参数位、锚不住 → 不误拦）。
  const prog = seg.replace(/^(?:env\s+)?(?:\w+=\S+\s+)*/, '')
  if (/^(?:node\s+)?(?:\S*\/)?deploy-fns\.mjs\b/.test(prog)) needConfirm = true

  // ② 直接 tcb 命令：段首真为 tcb 才算（提交信息 / echo 里的字样不算）。深审 P1：runner 前缀（npx/pnpm dlx/
  //    yarn dlx/bunx）+ tcb 或 @cloudbase/cli（其 bin=tcb）是「command not found: tcb」时最自然的改写形态，
  //    旧版段首正则认不出而全放行——先剥 runner 前缀、把 @cloudbase/cli 归一成 tcb，再走原判定。
  const runnerStripped = cmd.replace(/^(?:npx|pnpm\s+dlx|pnpm\s+exec|yarn\s+dlx|bunx)\s+/, '')
  const asTcb = runnerStripped.replace(/^@cloudbase\/cli\b/, 'tcb')
  if (!/^(?:\S*\/)?tcb[\s:]/.test(asTcb)) continue
  const isWrite = /\b(deploy|publish|delete|create)\b/.test(asTcb) || /\bframework\b/.test(asTcb)
  if (!isWrite) continue // 读类 tcb（invoke/log/list/detail…）→ 放行
  const sensitive = SENSITIVE_FNS.some((fn) => word(fn).test(asTcb))
  const readonlyOnly = !sensitive && READONLY_FNS.some((fn) => word(fn).test(asTcb))
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
          '（钱/权限/状态）或为批量部署。确认无误再放行——读类 tcb（invoke/log/list）不弹此确认；新线无独立纯读函数，任何具名函数写部署一律确认。',
      },
    })
  )
}
process.exit(0)
