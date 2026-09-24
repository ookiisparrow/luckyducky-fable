// 坐席台与后台必须打同一个云函数 HTTP 入口（病根#5 复制漂移）。
// 2026-08-18 后台 VITE_ADMIN_API 已切到随机路径 ld-admin-7005914b，坐席台 .env 仍 bake 旧 /admin → 生产 POST 404 INVALID_PATH。
// 读 env 用 Vite ?raw（同 desk.test.ts），不引 node:fs——agent tsconfig types 只有 vite/client。
import { describe, expect, it } from 'vitest'
import adminProdEnv from '../../admin/.env.production?raw'
import adminDevEnv from '../../admin/.env.development?raw'
import agentProdEnv from '../.env.production?raw'
import agentDevEnv from '../.env.development?raw'
import agentVite from '../vite.config.ts?raw'
import agentAppSrc from '../src/App.vue?raw'
import loginSrc from '../src/Login.vue?raw'
import deskSrc from '../src/Desk.vue?raw'

function envValue(text: string, key: string): string {
  const line = text.split('\n').find((l) => l.startsWith(`${key}=`))
  if (!line) throw new Error(`missing ${key}`)
  return line.slice(key.length + 1).trim()
}

describe('坐席台 API 基址与后台对齐', () => {
  it('大白话：坐席台和生产后台必须打同一扇门，不能再各写各的旧路径', () => {
    const adminProd = envValue(adminProdEnv, 'VITE_ADMIN_API')
    const agentProd = envValue(agentProdEnv, 'VITE_AGENT_API')
    const adminDev = envValue(adminDevEnv, 'VITE_ADMIN_API')
    const agentDev = envValue(agentDevEnv, 'VITE_AGENT_API')
    expect(agentProd).toBe(adminProd)
    expect(agentDev).toBe(adminDev)
    expect(agentProd).toMatch(/^https:\/\//)
    expect(agentProd.endsWith('/admin')).toBe(false)
  })

  it('大白话：坐席台打包必须钉死 /agent/，相对路径在没斜杠的地址会去网站根目录找旧文件、页面空白', () => {
    // 对照 admin vite.config.ts：原 base: './' 在访问 /admin（无尾斜杠）时解析到站点根 → 旧 assets 白屏。
    expect(agentVite).toMatch(/base:\s*['"]\/agent\/['"]/)
    expect(agentVite).not.toMatch(/base:\s*['"]\.\/['"]/)
  })

  it('大白话：登录失败和警告色必须跟后台同一套红/黄，不许再手写另一套红', () => {
    expect(agentAppSrc).toMatch(/--ld-red:\s*#d54941/)
    expect(agentAppSrc).toMatch(/--ld-amber:\s*#b9770e/)
    expect(agentAppSrc).toMatch(/--ld-red-line:\s*#f0c0ba/)
    expect(loginSrc).toContain('var(--ld-red)')
    expect(deskSrc).toContain('var(--ld-red)')
    expect(deskSrc).toContain('var(--ld-amber)')
    expect(deskSrc).toContain('var(--ld-red-line)')
    expect(loginSrc).not.toMatch(/#c0392b/i)
    expect(deskSrc).not.toMatch(/#c0392b/i)
  })
})
