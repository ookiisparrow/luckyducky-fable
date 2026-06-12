#!/usr/bin/env node
/**
 * 敏感部署闸（Claude Code PreToolUse hook，matcher: Bash）。
 *
 * 固化项目惯例：「钱/权限」类云函数与静态托管的部署，须用户亲自确认——
 * 之前靠权限弹窗碰运气，现在变成确定规则。命中时返回 permissionDecision=ask，
 * 无论允许清单怎么配都强制弹确认框；其余命令一律放行（exit 0 无输出）。
 *
 * 自测：echo '{"tool_input":{"command":"tcb fn deploy createOrder"}}' | node scripts/guard-deploy.mjs
 */

// 「钱/权限」闸门云函数（与 tests/cloud 覆盖的闸门一致 + seed/init 管理闸）
const SENSITIVE_FNS = [
  'createOrder', // 云端定价
  'pay', // 发起微信支付
  'payCallback', // 支付回调（pending→paid）
  'closeExpiredOrders', // 超时关单（批量改订单状态）
  'adminApi', // 管理后台总入口（发货/上新）
  'genQrcodes', // 一码一用批次生成
  'activateCourse', // 激活闸门
  'confirmEnter', // 进课留证 + 退货权失效
  'confirmReceive', // 订单状态流转
  'submitReview', // 评价写入
  'seedProducts', // 种子（带管理闸）
  'seedCourses',
  'initDb',
]

let stdin = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) stdin += chunk

let command = ''
try {
  command = JSON.parse(stdin)?.tool_input?.command || ''
} catch {
  process.exit(0) // 解析不了就放行，闸门只管认得出的部署命令
}

if (!/\btcb\b/.test(command)) process.exit(0)

// 云函数部署形态：fn/functions + deploy，或 code update（等效更新线上代码）
const isFnDeploy =
  (/\b(fn|functions?)\b/.test(command) && /\bdeploy\b/.test(command)) ||
  /\bcode\s+update\b/.test(command)
const hitFns = SENSITIVE_FNS.filter((name) => command.includes(name))
const isHostingDeploy = /\bhosting\b/.test(command) && /\bdeploy\b/.test(command)

if ((isFnDeploy && hitFns.length) || isHostingDeploy) {
  const what =
    isHostingDeploy && !hitFns.length ? '静态托管发布' : `敏感云函数部署（${hitFns.join('、')}）`
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: `部署闸：${what}涉及「钱/权限」闸门或线上发布，按项目惯例须用户亲自确认（确认框放行，或由用户自行运行 ! 命令）。`,
      },
    })
  )
}
process.exit(0)
