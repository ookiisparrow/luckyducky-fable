#!/usr/bin/env node
/**
 * 部署硬闸（Claude Code PreToolUse hook，matcher: Bash）。
 *
 * 本仓 = 生产源（v0.9.1 起，云环境 cloudbase-d4gcssqbv06865479 从本仓迭代）。
 * 部署到生产是 deliberate 的人工动作（DEPLOY_ALLOWED=1 deploy-fns，人在终端跑）；
 * 本闸拦截**经 Claude 工具/自动化**发出的一切 tcb 部署/发布类命令，一律 deny——
 * 防 Claude 手滑、防脚本误部署到生产（人在自己终端的命令不经本 hook、不受限）。
 *
 * deploy-fns 要求 DEPLOY_ALLOWED=1（Claude 永不设置，只人工设）；敏感名单（迁移核对）：
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
