#!/usr/bin/env node
/**
 * 部署闸（Claude Code PreToolUse hook，matcher: Bash）。本仓是生产源，云环境 cloudbase-d4gcssqbv06865479
 * 从本仓迭代，故接管 tcb 与 wechatide 两条通往生产的命令行通道，命中即 `permissionDecision:'ask'` 让人确认。
 *
 *   - tcb（含同一 CLI 的 `cloudbase` / `@cloudbase/cli` 入口）：只放行 TCB_READ 白名单里确知只读、不吐密钥的
 *     子命令，其余一律 ask。用白名单而非写动词黑名单：CLI 子命令几十个且随版本增长，黑名单天生漏
 *     （`fn code update` 改线上代码、`fn config update` 改环境变量、`api` 任意云 API 都曾被放行）。
 *     看似只读的也不进白名单：`fn invoke` 在云端拿不到 OPENID，isServerCall()/withAdminGate 视同服务端直接放行，
 *     等于绕过身份闸直调回调（能把订单翻成已付）和管理 action；`fn detail`、`secrets get` 明文打印函数环境变量
 *     和临时密钥；`db` 能读出 secureConfig 里的商户私钥。
 *   - 任何「真跑 deploy-fns.mjs」（批量部署）：ask。它无 DEPLOY_ALLOWED=1 即拒跑，故 --dry-run 一并确认不误伤。
 *   - wechatide 官方 CLI：同样白名单。只放行 WECHATIDE_READ 里的工具，其余 ask。它随开发者工具 Nightly 自动
 *     升级，新增的写工具（如 cloud_manage_msg_push）黑名单来不及登记。这条通道直接读写生产云环境，完全绕过本仓
 *     kit 写闸。白名单与 MCP 侧同源：取 .claude/settings.json allow 里的 mcp__wechat-devtools__*，同一个工具
 *     两条通道放行口径一致。
 *
 * 只在「真把这些程序当命令执行」时判：按 shell 分段（含 `$(`、反引号、`<(`、单个 `&`）、剥掉段首的
 * then/do/if 等关键字后看程序位——提交信息 / echo 里**提到**字样不算，杜绝误拦 git commit。段首的
 * env/sudo/timeout 等包装器会带自己的选项（运维手册的部署写法就是 `env -u http_proxy -u https_proxy tcb fn deploy …`），
 * 只看段首会认不出真程序，故包装段里取第一个受管程序名起算。
 * **不要把这些命令包成 npm script**：本 hook 只看到 `npm run <name>` 这行文本，看不进 package.json 里真正执行的命令。
 * 人在自己终端跑的命令不经本 hook。
 *
 * 自测：echo '{"tool_input":{"command":"tcb fn invoke payCallback"}}' | node scripts/guard-deploy.mjs  # → ask
 *       echo '{"tool_input":{"command":"tcb fn log payCallback"}}' | node scripts/guard-deploy.mjs     # → 放行（无输出）
 * 完整用例表见 check-structure.mjs 的 deploy-gated 守卫。
 */
import { readFileSync } from 'node:fs'

// 确知只读、不吐密钥的 tcb 子命令（匹配 tcb 之后的参数串开头）
const TCB_READ =
  /^(?:$|(?:-v|--version|-h|--help|help|login|logout|docs|env list|fn list|fn log|fn get-route|hosting list|permission get|logs search)(?:\s|$))/
// 任意位置的 -h/--help 只打印帮助；但 `--` 之后它是普通参数、引号里的也不是独立参数，这两种照常判
const isHelp = (args) => !/(?:^|\s)--(?:\s|$)|['"]/.test(args) && /(?:^|\s)(?:-h|--help)(?:\s|$)/.test(args)

// auto_preview 只推开发者手机预览，MCP 侧不常驻 allow 但 npm run preview:mp 要用
const WECHATIDE_READ = new Set(['auto_preview'])
try {
  const allow = JSON.parse(readFileSync(new URL('../.claude/settings.json', import.meta.url), 'utf8')).permissions?.allow ?? []
  for (const p of allow) if (/^mcp__wechat-devtools__\w+$/.test(p)) WECHATIDE_READ.add(p.slice('mcp__wechat-devtools__'.length))
} catch {
  /* 读不到就只剩 auto_preview：其余 wechatide 工具全部 ask，失败往严的方向 */
}

let stdin = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) stdin += chunk

let command = ''
try {
  command = JSON.parse(stdin)?.tool_input?.command || ''
} catch {
  process.exit(0)
}

const MANAGED = /(?:^|[\s"'])((?:\S*\/)?(?:tcb|cloudbase|@cloudbase\/cli(?:@\S*)?|node|wechatide|deploy-fns\.mjs)(?:\s|$)[\s\S]*)/
let needConfirm = false
for (const raw of command.split(/&&|\|\||[;\n|&`)]|[$<>]\(/)) {
  // 真程序：剥掉子 shell 括号/取反/反斜杠、流程关键字与前导 ENV=val；包装器开头的段取第一个受管程序名起算
  let cmd = raw
    .replace(/^(?:[\s({!\\]|(?:then|do|else|elif|if|while|until)\s)+/, '')
    .replace(/^(?:\w+=\S*\s+)*/, '')
  if (/^(?:env|sudo|time|timeout|gtimeout|stdbuf|caffeinate|nohup|nice|command|exec|eval|xargs|bash|sh|zsh)\s/.test(cmd)) {
    const m = cmd.match(MANAGED)
    if (m) cmd = m[1]
  }

  if (/^(?:node\s+)?(?:\S*\/)?deploy-fns\.mjs\b/.test(cmd)) needConfirm = true

  // runner 前缀是「command not found: tcb」时最自然的改写形态；中间的 -y/--yes/-- 等选项一并跳过
  const prog = cmd.replace(/^(?:npx|bunx|npm\s+(?:exec|x)|pnpm(?:\s+(?:dlx|exec))?|yarn(?:\s+(?:dlx|exec))?)\s+(?:-\S+\s+)*/, '')
  const tcb = prog.match(/^(?:\S*\/)?(?:tcb|cloudbase|@cloudbase\/cli(?:@\S*)?)(?=[\s:]|$)(.*)$/s)
  if (tcb) {
    const args = tcb[1].trim()
    if (!TCB_READ.test(args) && !isHelp(args)) needConfirm = true
    continue
  }

  const ide = prog.match(/^(?:\S*\/)?wechatide(?=\s|$)(.*)$/s)
  if (ide) {
    const args = ide[1].trim()
    // 工具名＝去掉 -c/--token 及其值后的第一个非选项词；认不出的选项会把值当工具名，落到 ask
    const tool = args
      .replace(/(?:^|\s)(?:-c|--token)\s+\S+/g, ' ')
      .split(/\s+/)
      .find((t) => t && !t.startsWith('-'))
    if (tool && !WECHATIDE_READ.has(tool) && !isHelp(args)) needConfirm = true
  }
}

if (needConfirm) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason:
          '生产环境确认：这条命令会写生产云环境 cloudbase-d4gcssqbv06865479（部署/改代码/改配置/直调函数/写库），' +
          '或可能明文打印密钥（fn detail / secrets / 读 secureConfig）。确认无误再放行——只有 fn log/fn list/env list 等白名单只读命令不弹此确认。',
      },
    })
  )
}
process.exit(0)
