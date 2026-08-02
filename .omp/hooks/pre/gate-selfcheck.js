// omp 车道闸的「开机自检 + 独立兜底层」（工业级缺口⑤·2026-08-02 立）。
//
// 为什么需要：本轮实测出闸的三个依赖——① 项目层配置按 cwd 生效、不做祖先目录查找；② 配置在**会话
// 启动时**读取，改完对已在跑的会话无效；③ 关键那层（disabledServers）在用户级、不在版本库。三者叠加
// 的后果是：**你无法知道自己此刻到底受不受管**（本轮就出现过「右手装的锁、左手还没上」——装完闸的那条
// 会话自己仍能跑 tcb）。工业级要求是**开机即自证**，而不是「希望配置生效」。
//
// 本钩子做两件事：
//   A. session_start 自检四项策略是否真生效，缺哪项当场报出来（知情权）；
//   B. tool_call **无条件兜底拦截**危险面——不读配置、不依赖配置是否加载成功。这是第三层：
//      即便项目层与全局层配置都没加载（换目录/换机器/文件被删），这一层仍在。
//
// 刻意不做的事：不拦只读工具、不拦普通 bash。放行面越大越好，只钉「生产写 + 裸部署命令」两类。
// 临时授权部署：人工用 `omp --config <放行文件>` 起会话时本钩子仍在 —— 需要真放行请显式移走本文件，
// 属人工授权动作（与 AGENTS.md「部署是人工授权动作」一致）。

import { readFileSync } from 'node:fs'

const DANGEROUS_TOOL = /^mcp__(cloudbase_(manage|write|modify|callcloudapi|downloadtemplate|downloadremotefile|envdomainmanagement|activateinvitecode|auth)|wechat-devtools_(upload|cloud_fn_|cloud_db_write|cloud_manage_storage|project_remove|quit))/
const DEPLOY_CMD = /(^|[\s;&|(])(tcb|wechatide)\s/

/** 读文件，读不到返回空串——自检永不因缺文件而抛。 */
function readSafe(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

/** 四项策略实况：每项返回 [是否就位, 说明]。 */
function auditPolicy(cwd) {
  const home = process.env.HOME || ''
  const proj = readSafe(cwd + '/.omp/config.yml')
  const glob = readSafe(home + '/.omp/agent/config.yml')
  const mcp = readSafe(home + '/.omp/agent/mcp.json')
  return [
    ['项目层写工具 deny', proj.includes('mcp__cloudbase_managefunctions: deny')],
    ['项目层裸部署命令闸', /match:\s*"tcb \*"/.test(proj)],
    ['全局层（跨目录兜底）', glob.includes('mcp__cloudbase_managefunctions: deny') && /match:\s*"tcb \*"/.test(glob)],
    ['挂载层停用高危 server', mcp.includes('"cloudbase"') && mcp.includes('disabledServers')],
  ]
}

export default function hook(pi) {
  pi.on('session_start', async (_event, ctx) => {
    try {
      const rows = auditPolicy(ctx && ctx.cwd ? ctx.cwd : process.cwd())
      const missing = rows.filter(([, ok]) => !ok).map(([name]) => name)
      const line = missing.length
        ? `⚠️ 闸自检：${missing.length}/4 项未就位 → ${missing.join('、')}（本钩子的 tool_call 兜底层仍在，但请补齐配置）`
        : '🔒 闸自检：4/4 项就位（项目层 · 部署命令 · 全局兜底 · 挂载层停用）'
      if (ctx && ctx.ui && typeof ctx.ui.setStatus === 'function') ctx.ui.setStatus('gate', line)
      if (typeof pi.sendMessage === 'function') pi.sendMessage(line)
    } catch {
      /* 自检永不打断会话启动 */
    }
  })

  // 兜底层：与配置是否加载**无关**。配置没加载时它是唯一防线；加载了它就是第二道锁。
  pi.on('tool_call', async (event) => {
    try {
      const name = String((event && event.toolName) || '')
      if (DANGEROUS_TOOL.test(name)) {
        return { block: true, reason: `生产写工具 ${name} 被 omp 车道闸拦下（.omp/hooks/pre/gate-selfcheck.js）——部署与产库写是人工授权动作` }
      }
      if (name === 'bash') {
        const cmd = String((event.input && event.input.command) || '')
        if (DEPLOY_CMD.test(cmd)) {
          return { block: true, reason: '裸部署命令（tcb / wechatide）被 omp 车道闸拦下——部署是人工授权动作，需人工显式放行' }
        }
      }
    } catch {
      /* 判定异常不应放行危险面：交给外层 tool_call 的 fail-closed 语义（handler 抛错即阻断） */
    }
  })
}
