import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const agent = readFileSync(resolve(ROOT, 'scripts/wechat-agent.mjs'), 'utf8')
const flow = readFileSync(resolve(ROOT, 'scripts/automation-flow.mjs'), 'utf8')
const guide = readFileSync(resolve(ROOT, 'docs/wechat-agent-api.md'), 'utf8')

const fallback = /process\.env\.WECHAT_AGENT_CLIENT \|\| 'ldrw-cli'/

describe('微信自动化客户端默认名', () => {
  it('大白话：不设环境变量时走 ldrw-cli，设了 WECHAT_AGENT_CLIENT 仍听环境变量', () => {
    expect(agent).toMatch(fallback)
    expect(flow).toMatch(fallback)
    expect(agent).not.toContain('pi-agent')
    expect(flow).not.toContain('pi-agent')
  })

  it('大白话：业务流截图进临时目录，不写到某人桌面', () => {
    expect(flow).toContain('os.tmpdir()')
    expect(flow).not.toContain('Desktop')
    expect(flow).not.toContain('/Users/sparrow')
  })

  it('大白话：调用示例跟运维手册同一个客户端，路径不写死某台电脑', () => {
    expect(guide).toContain('ldrw-cli')
    expect(guide).toContain('<仓根>/rewrite/mp')
    expect(guide).not.toContain('pi-agent')
    expect(guide).not.toContain('/Users/sparrow')
  })
})
