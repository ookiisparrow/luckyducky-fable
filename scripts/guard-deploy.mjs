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
 *   - 判「会不会读出/改动云端密钥与函数配置」，不认字面程序名：tccli 一律 ask（腾讯云全量 API，「只读」的
 *     scf GetFunction 也原样回显函数环境变量，scf Invoke 同 fn invoke；它是 pip 包，uvx/pipx run 前缀照认）；
 *     python / node 的程序位只是解释器：-c / -e / -p / heredoc / 管道喂的代码就在命令文本里，调了云 CLI、云 SDK
 *     或仓内凭证桥 cloud-manager 就 ask；脚本文件（含 `< 文件` 重定向）读出来扫，读不到也 ask。node 脚本只认
 *     真调用（exec 起云 CLI、getFunctionDetail 这类函数配置 API），注释和用例表里的 tcb 字样不算，否则
 *     npm run check 也要确认。shell 脚本就是一串命令，读出来按本闸逐段判。带 --include-secrets 的 node
 *     （db-export 连 secureConfig 一起导）ask。
 *     ponytail: 命令文本按整条扫（分段会切碎 -c 的代码），同一行别处提到 tcb 也会多问一次；脚本只扫它自己、
 *     不跟 import，把命令拼进变量再 exec 也认不出。真有这类脚本再加跟踪。
 *
 * 只在「真把这些程序当命令执行」时判：按 shell 分段（含 `$(`、反引号、`<(`、单个 `&`）、剥掉段首的
 * then/do/if 等关键字后看程序位——提交信息 / echo 里**提到**字样不算，杜绝误拦 git commit。段首的
 * env/sudo/timeout 等包装器会带自己的选项（运维手册的部署写法就是 `env -u http_proxy -u https_proxy tcb fn deploy …`），
 * 只看段首会认不出真程序，故包装段里取第一个受管程序名起算。
 * `npm/pnpm/yarn run <名>` 按仓根 package.json 展开成正文（连同 `--` 后的参数）再判，否则包一层就绕过。
 * 仍不要把受管命令包成 npm script：子包的 script 这里看不到，结构守卫也会拦。
 * 人在自己终端跑的命令不经本 hook。
 *
 * 自测：echo '{"tool_input":{"command":"tcb fn invoke payCallback"}}' | node scripts/guard-deploy.mjs  # → ask
 *       echo '{"tool_input":{"command":"tcb fn log payCallback"}}' | node scripts/guard-deploy.mjs     # → 放行（无输出）
 * 完整用例表见 check-structure.mjs 的 deploy-gated 守卫与 tests/scripts/r4-devgate-guard-deploy.test.js。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

let PKG_SCRIPTS = {}
try {
  PKG_SCRIPTS = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts ?? {}
} catch {
  /* 读不到就不展开：npm run 按字面判 */
}

// 命令文本 / python 脚本里的代码：云 CLI 前面常带 npx、env -u 等前缀，按词认不要求紧挨引号；
// cloud-manager 是仓内凭证桥，它给的 manager-node 能读函数详情（含环境变量）
const CLOUD_CALL =
  /\b(?:tccli|tcb|cloudbase|tencentcloud)\b|TENCENTCLOUD_SECRET|cloud-manager|manager-node|getFunctionDetail|updateFunctionConfig/
// node 脚本文件只认真调用：exec 起云 CLI、函数配置 API、腾讯云 SDK。db-export / check-indexes 只用数据库 API，不命中
const FILE_CLOUD =
  /\b(?:getFunctionDetail|updateFunctionConfig|updateFunctionCode|invokeFunction)\s*\(|\b(?:exec|execFile|spawn|fork)(?:Sync)?\s*\(\s*[`'"](?:[^`'"]*[\s/])?(?:tccli|tcb|cloudbase)\b|\btencentcloud\b/

// 命令里的相对路径按 hook 的 cwd 解析，退一步按项目根；都读不到返回 null（调用方往严判）
const readScript = (file) => {
  for (const base of [process.cwd(), process.env.CLAUDE_PROJECT_DIR]) {
    if (!base) continue
    try {
      return readFileSync(resolve(base, file), 'utf8')
    } catch {
      /* 换下一个根再试 */
    }
  }
  return null
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

const MANAGED =
  /(?:^|[\s"'])((?:\S*\/)?(?:tcb|cloudbase|@cloudbase\/cli(?:@\S*)?|node|tsx|bun|wechatide|deploy-fns\.mjs|tccli|python[\d.]*|npm|pnpm|yarn|[^\s/]+\.(?:py|sh))(?:\s|$)[\s\S]*)/

function needsConfirm(command, depth = 0) {
  let needConfirm = false
  for (const raw of command.split(/&&|\|\||[;\n|&`)]|[$<>]\(/)) {
    // 真程序：剥掉子 shell 括号/取反/反斜杠、流程关键字与前导 ENV=val；包装器开头的段取第一个受管程序名起算
    let cmd = raw
      .replace(/^(?:[\s({!\\]|(?:then|do|else|elif|if|while|until)\s)+/, '')
      .replace(/^(?:\w+=\S*\s+)*/, '')
    if (/^(?:env|sudo|time|timeout|gtimeout|stdbuf|caffeinate|nohup|nice|command|exec|eval|xargs|bash|sh|zsh|source|\.)\s/.test(cmd)) {
      const m = cmd.match(MANAGED)
      if (m) cmd = m[1]
    }

    // run 前可带 npm 自己的选项（-s、--prefix .），选项值不会是 run 本身
    const script = cmd.match(
      /^(?:npm|pnpm|yarn)\s+(?:-\S+\s+(?:(?!run(?:-script)?\s)[^-\s]\S*\s+)?)*(?:run(?:-script)?\s+)?(?:-\S+\s+)*([\w:.-]+)(.*)$/s
    )
    if (script && Object.hasOwn(PKG_SCRIPTS, script[1])) {
      // 互相调用套太深当异常，往严判
      const expanded = `${PKG_SCRIPTS[script[1]]} ${script[2].replace(/^\s*--(?=\s|$)/, '')}`
      if (depth > 4 || needsConfirm(expanded, depth + 1)) needConfirm = true
      continue
    }

    if (/^(?:node\s+)?(?:\S*\/)?deploy-fns\.mjs\b/.test(cmd)) needConfirm = true

    // runner 前缀是「command not found」时最自然的改写形态（tccli 是 pip 包，走 uvx/pipx）；中间的 -y/--yes/-- 等选项一并跳过
    const prog = cmd.replace(
      /^(?:npx|bunx|uvx|npm\s+(?:exec|x)|pnpm(?:\s+(?:dlx|exec))?|yarn(?:\s+(?:dlx|exec))?|(?:uv|pipx|poetry)\s+run)\s+(?:-\S+\s+)*/,
      ''
    )
    const tcb = prog.match(/^(?:\S*\/)?(?:tcb|cloudbase|@cloudbase\/cli(?:@\S*)?)(?=[\s:]|$)(.*)$/s)
    if (tcb) {
      const args = tcb[1].trim()
      if (!TCB_READ.test(args) && !isHelp(args)) needConfirm = true
      continue
    }

    if (/^(?:\S*\/)?tccli(?=\s|$)/.test(prog)) {
      needConfirm = true
      continue
    }

    // 脚本文件＝python 之后第一个非选项词，没有就看 `< 文件` 重定向；-c/-m/heredoc 没有文件，代码就在命令文本里
    const py = prog.match(/^(?:\S*\/)?python[\d.]*(?=\s|$)(.*)$/s)
    const pyFile = py
      ? (py[1].trim().match(/^(?:-(?![cm](?:\s|$))\S*\s+)*([^\s<>-]\S*)/)?.[1] ?? py[1].match(/(?<!<)<(?!<)\s*([^\s<>]+)/)?.[1])
      : prog.match(/^\S+\.py(?=\s|$)/)?.[0]
    if (py || pyFile) {
      const src = pyFile ? readScript(pyFile.replace(/^['"]|['"]$/g, '')) : ''
      if (src === null || CLOUD_CALL.test(src) || CLOUD_CALL.test(command)) needConfirm = true
      continue
    }

    // 脚本文件＝第一个 .js/.mjs/.ts 等参数（含 `< 文件`）；-e/-p/heredoc 或没给文件（管道喂代码）就扫命令文本
    const node = prog.match(/^(?:\S*\/)?(?:node|tsx|bun)(?=\s|$)(.*)$/s)
    if (node) {
      const file = /(?:^|\s)(?:-[ep]{1,2}|--eval|--print)(?:[\s=]|$)|<</.test(node[1])
        ? null
        : node[1].match(/(?:^|[\s<])['"]?([^\s'"<>]+\.[mc]?[jt]s)['"]?(?=\s|$)/)?.[1]
      const src = file ? readScript(file) : null
      if ((file ? src === null || FILE_CLOUD.test(src) : CLOUD_CALL.test(command)) || /--include-secrets\b/.test(prog))
        needConfirm = true
      continue
    }

    // shell 脚本就是一串命令：读出来按本闸逐段判；套太深、读不到往严判
    const shFile = prog.match(/^\S+\.sh(?=\s|$)/)?.[0]
    if (shFile) {
      const src = readScript(shFile)
      if (src === null || depth > 4 || needsConfirm(src, depth + 1)) needConfirm = true
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
  return needConfirm
}

if (needsConfirm(command)) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason:
          '生产环境确认：这条命令会写生产云环境 cloudbase-d4gcssqbv06865479（部署/改代码/改配置/直调函数/写库），' +
          '或可能明文打印密钥（fn detail / secrets / tccli GetFunction / 读 secureConfig / db-export --include-secrets），' +
          '或是调了云 CLI / 凭证桥的脚本。确认无误再放行——只有 fn log/fn list/env list 等白名单只读命令不弹此确认。',
      },
    })
  )
}
process.exit(0)
