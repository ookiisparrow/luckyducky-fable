// MCP 写工具拒绝名单完整性（fail-closed 的机器半边）。
// deny 名单天生 fail-open：未列名＝放行，server 升级多出一个写工具就自动不受管且没有任何提示。
// 补法＝全量工具册 + 本组断言：册里每个非只读工具都必须在 .claude/settings.json 有显式 deny，未分类即红。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const reg = JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures/cloudbase-mcp-tools.json'), 'utf8'))
const deny = JSON.parse(readFileSync(resolve(ROOT, '.claude/settings.json'), 'utf8'))?.permissions?.deny ?? []

describe('cloudbase MCP 写工具全部显式 deny', () => {
  it('工具册自洽：无重复、read/write 不交叉、条目数等于钉版实测总数（防整条删掉来缩小受检集合）', () => {
    expect(reg.read.filter((t) => reg.write.includes(t))).toEqual([])
    expect(reg.read.length + reg.write.length).toBe(reg._totalTools)
    expect(new Set([...reg.read, ...reg.write]).size).toBe(reg._totalTools)
  })

  it('册里每个非只读工具在 .claude/settings.json 都有 deny——未分类即红', () => {
    const denied = new Set(
      deny.filter((d) => d.startsWith('mcp__cloudbase__')).map((d) => d.slice('mcp__cloudbase__'.length).toLowerCase())
    )
    const missing = reg.write.filter((t) => !denied.has(t.toLowerCase()))
    expect(missing, `这些非只读工具没有 deny（fail-open 缺口）：${missing.join(', ')}`).toEqual([])
  })

  it('工具册与 .mcp.json 的钉版一致——server 升版即红，逼人重新枚举再分类', () => {
    const mcp = readFileSync(resolve(ROOT, '.mcp.json'), 'utf8')
    expect(mcp.includes(`@cloudbase/cloudbase-mcp@${reg._pinnedVersion}`)).toBe(true)
  })
})

// MCP 调用不经 Bash，部署闸 guard-deploy 看不见它；settings.json 的 deny 是 MCP 面唯一的闸。
describe('wechat-devtools MCP 写/危险工具全部显式 deny', () => {
  it('.mcp.json 挂着 wechat-devtools，且上传/云函数部署/云库写/云存储管理/删项目/退出全在 deny', () => {
    const servers = JSON.parse(readFileSync(resolve(ROOT, '.mcp.json'), 'utf8')).mcpServers ?? {}
    expect(servers['wechat-devtools']).toBeTruthy()
    const required = ['upload', 'cloud_fn_deploy', 'cloud_fn_inc_deploy', 'cloud_db_write_doc', 'cloud_db_write_struct', 'cloud_manage_storage', 'project_remove', 'quit']
    const missing = required.filter((t) => !deny.includes(`mcp__wechat-devtools__${t}`))
    expect(missing, `这些写/危险工具没有 deny：${missing.join(', ')}`).toEqual([])
  })
})
