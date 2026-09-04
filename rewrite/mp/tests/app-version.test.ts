// 小程序版本行：数字跟 package.json（LD-004）；文案按开发/测试/正式切；「我」页底部接线。
import { describe, it, expect, afterEach } from 'vitest'
import {
  APP_VERSION,
  PUBLIC_RELEASE_NAME,
  DEV_UPDATE_DATE,
  formatAppVersionLine,
  formatAppVersionDetail,
  currentAppVersionLine,
  currentAppVersionDetail,
} from '../lib/appVersion'
import pkgRaw from '../../../package.json?raw'
import meWxml from '../pages/me/me.wxml?raw'
import meTs from '../pages/me/me.ts?raw'
import releaseSrc from '../../../scripts/release.mjs?raw'

describe('版本号单源（LD-004）', () => {
  it('大白话：小程序上屏的数字必须跟仓根 package.json 同一个，不能各写各的', () => {
    expect(APP_VERSION).toBe(JSON.parse(pkgRaw).version)
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('大白话：定版脚本升号时必须顺手改小程序这一处，不然「我」页会停在旧数字', () => {
    expect(releaseSrc).toContain('rewrite/mp/lib/appVersion.ts')
    expect(releaseSrc).toContain('APP_VERSION')
  })
})

describe('版本行文案（内部预览·按开发/测试/发布切）', () => {
  it('大白话：开发版写「内部预览版 · 开发」加数字；测试版换「测试」；正式包在没有公开版之前写「发布候选」，绝不自称公开版', () => {
    expect(PUBLIC_RELEASE_NAME).toBe('')
    expect(formatAppVersionLine('develop')).toBe('内部预览版 · 开发 ' + APP_VERSION)
    expect(formatAppVersionLine('trial')).toBe('内部预览版 · 测试 ' + APP_VERSION)
    expect(formatAppVersionLine('release')).toBe('内部预览版 · 发布候选 ' + APP_VERSION)
    expect(formatAppVersionLine('develop')).not.toContain('公开版')
    expect(formatAppVersionLine('trial')).not.toContain('公开版')
    expect(formatAppVersionLine('release')).not.toContain('公开版')
  })

  it('大白话：只有对外名配成「公开版」且是正式包，才写「公开版」加数字；开发/测试包仍写内部预览', () => {
    expect(formatAppVersionLine('release', '1.2.3', '公开版')).toBe('公开版 1.2.3')
    expect(formatAppVersionLine('develop', '1.2.3', '公开版')).toBe('内部预览版 · 开发 1.2.3')
    expect(formatAppVersionLine('trial', '1.2.3', '公开版')).toBe('内部预览版 · 测试 1.2.3')
  })
})

describe('运行时通道（微信开发版/体验版/正式版）', () => {
  afterEach(() => {
    delete (globalThis as unknown as { wx?: unknown }).wx
  })

  it('大白话：读到体验版就出测试行，读到正式包就出发布候选行，拿不到就按开发版；简介跟着通道走', () => {
    const g = globalThis as unknown as { wx?: { getAccountInfoSync: () => { miniProgram: { envVersion: string } } } }
    g.wx = { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'trial' } }) }
    expect(currentAppVersionLine()).toBe('内部预览版 · 测试 ' + APP_VERSION)
    expect(currentAppVersionDetail()).toBe(DEV_UPDATE_DATE + ' · 测试')
    g.wx = { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }) }
    expect(currentAppVersionLine()).toBe('内部预览版 · 发布候选 ' + APP_VERSION)
    expect(currentAppVersionDetail()).toBe(DEV_UPDATE_DATE + ' · 发布候选')
    delete g.wx
    expect(currentAppVersionLine()).toBe('内部预览版 · 开发 ' + APP_VERSION)
    expect(currentAppVersionDetail()).toBe(DEV_UPDATE_DATE + ' · 开发')
  })
})

describe('版本简介（三通道都上屏·简介＝通道名）', () => {
  it('大白话：日期是上海日历的年月日；简介就是通道名，不是退款说明也不是占位稿', () => {
    expect(DEV_UPDATE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(DEV_UPDATE_DATE).toBe('2026-09-04')
    expect(formatAppVersionDetail('develop')).not.toContain('退款')
    expect(formatAppVersionDetail('trial')).not.toContain('退款')
    expect(formatAppVersionDetail('release')).not.toContain('退款')
    expect(formatAppVersionDetail('develop')).not.toContain('版本脚')
  })

  it('大白话：开发/测试/正式三通道都在版本号下面多一行「哪天 · 通道名」', () => {
    expect(formatAppVersionDetail('develop')).toBe('2026-09-04 · 开发')
    expect(formatAppVersionDetail('trial')).toBe('2026-09-04 · 测试')
    expect(formatAppVersionDetail('release')).toBe('2026-09-04 · 发布候选')
    expect(formatAppVersionDetail('develop', '', '开发')).toBe('')
    expect(formatAppVersionDetail('develop', DEV_UPDATE_DATE, '')).toBe('')
  })
})

describe('我页底部版本行', () => {
  it('大白话：「我」页最底下有一行 versionLine，字从 lib/appVersion 来，不是页面自己编的', () => {
    const live = meWxml.replace(/<!--[\s\S]*?-->/g, '')
    expect(live).toContain('{{versionLine}}')
    expect(live.indexOf('ld-me-ver')).toBeGreaterThan(live.lastIndexOf('ld-me-logout'))
    expect(live.indexOf('ld-me-ver')).toBeLessThan(live.indexOf('ld-me-pad-bottom'))
    expect(meTs).toMatch(/currentAppVersionLine/)
    expect(meTs).toMatch(/currentAppVersionDetail/)
    expect(meTs).toMatch(/from ['"]\.\.\/\.\.\/lib\/appVersion['"]/)
    expect(live).toContain('{{versionDetail}}')
    expect(live.indexOf('{{versionLine}}')).toBeLessThan(live.indexOf('{{versionDetail}}'))
    expect(live.indexOf('{{versionDetail}}')).toBeLessThan(live.indexOf('ld-me-pad-bottom'))
    expect(live).toMatch(/wx:if="\{\{versionDetail\}\}"/)
    expect(meTs).not.toMatch(/仅开发版/)
  })
})
