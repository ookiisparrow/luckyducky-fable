// 坐席台与后台必须打同一个云函数 HTTP 入口（病根#5 复制漂移）。
// 2026-08-18 后台 VITE_ADMIN_API 已切到随机路径 ld-admin-7005914b，坐席台 .env 仍 bake 旧 /admin → 生产 POST 404 INVALID_PATH。
// 读 env 用 Vite ?raw（同 desk.test.ts），不引 node:fs——agent tsconfig types 只有 vite/client。
import { describe, expect, it } from 'vitest'
import adminProdEnv from '../../admin/.env.production?raw'
import adminDevEnv from '../../admin/.env.development?raw'
import agentProdEnv from '../.env.production?raw'
import agentDevEnv from '../.env.development?raw'

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
})
