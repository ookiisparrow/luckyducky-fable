// 冒烟层 launch 路径 RPC 就绪探活+重试（工单#4·根因#8「构建过≠真机能用」的工具面）：
// 工具「完全未启动」冷开时 automator.launch() 返回 ≠ RPC 就绪，紧接的第一个 RPC 撞 timeout 会让
// 整跑硬崩（2026-08-02 实测 1/5）。实测取证：launch 返回 @17.2s → 信息道第 1 次 5s 超时 → 第 2 次
// @24.7s 通 → 导航道 @28.9s 通；「探不过就 cli quit 再冷启」实测无用（新实例一样要 ~25s 才就绪），
// 故解法是原地重试等它醒。本守卫钉三件事：探活是单源 helper（connect/launch 共用、不各写一份走形）、
// launch 路径也探、且探活自带重试预算（launch 侧 attempts>1）。
// 文本级守卫（脚本要真实 devtools 才跑得起来，行为层测不了）——判定前按 E1 剥注释，防注释假绿。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripComments, setupFnBody } from '../../scripts/check-structure.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const src = stripComments(readFileSync(resolve(ROOT, 'scripts/mp-smoke.cjs'), 'utf8'))

const count = (re) => (src.match(re) || []).length

describe('mp-smoke launch 路径 RPC 就绪探活+重试', () => {
  it('双道探活收敛成单源 helper probeChannels（定义一处·两道都在）', () => {
    expect(count(/function\s+probeChannels\s*\(/g)).toBe(1)
    expect(src).toMatch(/systemInfo\s*\(/)
    expect(src).toMatch(/reLaunch\s*\(/)
  })

  it('connect 与 launch 两条路径都调探活（定义 1 处 + 调用 ≥2 处）', () => {
    expect(count(/probeChannels\s*\(/g)).toBeGreaterThanOrEqual(3)
  })

  it('launch 路径带重试预算——探活调用给了 >1 次的 attempts', () => {
    const withAttempts = src.match(/probeChannels\s*\([^)]*,\s*(\d+)\s*\)/)
    expect(withAttempts, 'launch 路径须以 probeChannels(mp, N) 形式给出重试次数').not.toBeNull()
    expect(Number(withAttempts[1])).toBeGreaterThan(1)
    // 重试须是「原地等」：helper 自身的循环里有间隔 sleep，不是 quit 掉重开（实测重开无用）。
    // 断言钉在 probeChannels 函数体内（走 setupFnBody 花括号配平单源 helper）——在全文匹配
    // `for(){…sleep(}` 会被 main() 的逐页大循环喂假绿（本批反向自检 D 当场逮到）。
    const body = setupFnBody(src, 'probeChannels')
    expect(body, 'probeChannels 函数体截取失败').not.toBe('')
    expect(body).toMatch(/for\s*\([\s\S]*?sleep\s*\(/)
  })
})
