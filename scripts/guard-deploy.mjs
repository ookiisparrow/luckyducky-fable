#!/usr/bin/env node
/**
 * 部署硬闸——样板房版（Claude Code PreToolUse hook，matcher: Bash）。
 *
 * 本仓是重构样板房（平行仓），与生产仓 /Users/sparrow/luckyducky-miniprogram
 * 共用同一云环境 cloudbase-d4gcssqbv06865479。为防误部署污染生产，
 * 本闸拦截**一切** tcb 部署/发布类命令，一律 deny（生产仓的同名闸只拦敏感名单）。
 * 唯一例外（B1 回灌点验证 getProducts）按总计划在生产仓执行，与本仓无关。
 *
 * B5 衔接备忘：deploy-fns 脚本落地时要求 DEPLOY_ALLOWED=1 环境变量（本仓永不设置），
 * 敏感名单恢复为单一来源 scripts/sensitive-fns；生产仓现行名单（迁移时核对）：
 * createOrder / pay / payCallback / applyRefund / refundCallback / closeExpiredOrders /
 * adminApi / genQrcodes / activateCourse / confirmEnter / confirmReceive / submitReview /
 * seedProducts / seedCourses / initDb
 *
 * 自测：echo '{"tool_input":{"command":"tcb fn deploy getProducts"}}' | node scripts/guard-deploy.mjs
 */

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

// 一切「会改云端」的 tcb 形态：函数部署/代码更新/删除、托管发布/删除、framework、env 配置写
const isMutating =
  /\bdeploy\b/.test(command) ||
  /\bcode\s+update\b/.test(command) ||
  /\bpublish\b/.test(command) ||
  /\b(fn|functions?|hosting)\b.*\b(delete|create)\b/.test(command) ||
  /\bframework\b/.test(command)

if (isMutating) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          '样板房禁部署：本仓为重构平行仓，与生产共用云环境 cloudbase-d4gcssqbv06865479，' +
          '任何 tcb 部署/发布/删除一律拒绝。需要触云请到生产仓按部署闸流程操作。',
      },
    })
  )
}
process.exit(0)
