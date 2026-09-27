// db-export --include-secrets（#400-6 续）：默认拒绝，显式确认后也只落字段名不落值。
// 子进程跑在没有 tcb、没有云密钥的环境里：即便拒绝逻辑坏了，也只会拿不到凭证退出，碰不到云端。
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = resolve(ROOT, 'scripts/db-export.mjs')

const runOffline = (args, extraEnv = {}) => {
  const home = mkdtempSync(join(tmpdir(), 'r4-devgate-dbx-'))
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: home,
    env: { PATH: join(home, 'no-bin'), HOME: home, ...extraEnv },
    encoding: 'utf8',
  })
}

describe('--include-secrets 默认拒绝', () => {
  it('没设 SECRETS_EXPORT_ALLOWED=1 → 连凭证都不去取就退出 1，并说明怎么显式确认', () => {
    const r = runOffline(['--collections=secureConfig', '--include-secrets'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('SECRETS_EXPORT_ALLOWED=1')
    expect(r.stderr).not.toContain('拿不到云开发生产凭证')
  })

  it('设了 SECRETS_EXPORT_ALLOWED=1 → 放过拒绝，走到取凭证（离线环境取不到，退出 2）', () => {
    const r = runOffline(['--collections=secureConfig', '--include-secrets'], { SECRETS_EXPORT_ALLOWED: '1' })
    expect(r.status).toBe(2)
  })

  it('不带 --include-secrets 不受影响（离线取不到凭证，退出 2）', () => {
    expect(runOffline(['--collections=orders']).status).toBe(2)
  })
})

describe('secureConfig 只落字段名、不落值', () => {
  const load = async () => {
    // 万一脚本入口判定失效、导入即跑导出，也只会离线取不到凭证
    const saved = { PATH: process.env.PATH, ID: process.env.TENCENTCLOUD_SECRETID, KEY: process.env.TENCENTCLOUD_SECRETKEY }
    process.env.PATH = '/nonexistent-r4-devgate'
    delete process.env.TENCENTCLOUD_SECRETID
    delete process.env.TENCENTCLOUD_SECRETKEY
    try {
      return await import('../../scripts/db-export.mjs')
    } finally {
      process.env.PATH = saved.PATH
      if (saved.ID !== undefined) process.env.TENCENTCLOUD_SECRETID = saved.ID
      if (saved.KEY !== undefined) process.env.TENCENTCLOUD_SECRETKEY = saved.KEY
    }
  }

  it('一行一条（官方导出格式）与数组两种都只留 _id + 字段名', async () => {
    const { secretFieldNames } = await load()
    const lines = [
      JSON.stringify({ _id: 'wxpay', mchPrivateKey: 'SENTINEL_PRIV_r4', mchSerial: 'SENTINEL_SERIAL_r4' }),
      JSON.stringify({ _id: 'wxkf', secret: 'SENTINEL_KF_r4' }),
    ].join('\n')
    const want = [
      { _id: 'wxpay', fields: ['mchPrivateKey', 'mchSerial'] },
      { _id: 'wxkf', fields: ['secret'] },
    ]
    expect(secretFieldNames(lines)).toEqual(want)
    expect(secretFieldNames(`[${lines.split('\n').join(',')}]`)).toEqual(want)
    expect(JSON.stringify(secretFieldNames(lines))).not.toMatch(/SENTINEL/)
  })

  it('main 的落盘路由：secureConfig 只写 .fields.json 且不含值；普通集合原样写 .json', async () => {
    const { saveExport } = await load()
    const out = mkdtempSync(join(tmpdir(), 'r4-devgate-dbx-out-'))
    const secretBody = JSON.stringify({ _id: 'wxpay', mchPrivateKey: 'SENTINEL_ROUTE_r4' })
    const secretFile = await saveExport('secureConfig', new Response(secretBody), out)
    expect(secretFile.endsWith('secureConfig.fields.json')).toBe(true)
    expect(readFileSync(secretFile, 'utf8')).not.toContain('SENTINEL_ROUTE_r4')
    expect(readdirSync(out)).toEqual(['secureConfig.fields.json'])

    const ordersFile = await saveExport('orders', new Response('{"_id":"o1"}\n'), out)
    expect(ordersFile.endsWith('orders.json')).toBe(true)
    expect(readFileSync(ordersFile, 'utf8')).toBe('{"_id":"o1"}\n')
  })

  it('解析失败 → 抛固定文案，不带原文片段', async () => {
    const { secretFieldNames } = await load()
    let msg = ''
    try {
      secretFieldNames('{"_id":"wxpay","mchPrivateKey":"SENTINEL_BROKEN_r4"')
    } catch (e) {
      msg = e.message
    }
    expect(msg).toBe('导出文件解析失败，未落盘')
  })
})
