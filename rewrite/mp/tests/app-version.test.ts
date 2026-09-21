// 小程序版本行：数字跟 package.json（LD-004）；四条线（开发/测试/发布/实验）；「我」页底部接线。
import { describe, it, expect, afterEach } from 'vitest'
import {
  APP_VERSION,
  BUILD_CHANNEL,
  PUBLIC_RELEASE_NAME,
  DEV_UPDATE_DATE,
  resolveAppChannel,
  channelLabel,
  formatAppVersionLine,
  formatAppVersionDetail,
  currentAppVersionLine,
  currentAppVersionDetail,
} from '../lib/appVersion'
import pkgRaw from '../../../package.json?raw'
import meWxml from '../pages/me/me.wxml?raw'
import meTs from '../pages/me/me.ts?raw'
import releaseSrc from '../../../scripts/release.mjs?raw'
import stampSrc from '../../../scripts/stamp-mp-version-date.mjs?raw'
import appVersionSrc from '../lib/appVersion.ts?raw'

describe('版本号单源（LD-004）', () => {
  it('大白话：小程序上屏的数字必须跟仓根 package.json 同一个，不能各写各的', () => {
    expect(APP_VERSION).toBe(JSON.parse(pkgRaw).version)
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('大白话：定版脚本升号时必须顺手改小程序这一处，不然「我」页会停在旧数字', () => {
    expect(releaseSrc).toContain('rewrite/mp/lib/appVersion.ts')
    expect(releaseSrc).toContain('APP_VERSION')
  })

  it('大白话：发版、上传相关脚本、提交钩子都会把日期戳成上海当天，不能人为忘改', () => {
    const pkg = JSON.parse(pkgRaw)
    expect(pkg.scripts['mp:stamp-version-date']).toContain('stamp-mp-version-date.mjs')
    expect(stampSrc).toContain('Asia/Shanghai')
    expect(stampSrc).toContain('DEV_UPDATE_DATE')
    expect(stampSrc).toContain('resolveStampChannel')
    expect(releaseSrc).toContain('stampMpVersionDate')
  })
})

describe('版本行文案（内部预览·开发/测试/发布/实验）', () => {
  it('大白话：开发写「内部预览版 · 开发」加数字；测试换「测试」；正式包没公开名时写「发布候选」；实验写「实验」；绝不自称公开版', () => {
    expect(PUBLIC_RELEASE_NAME).toBe('')
    expect(formatAppVersionLine('develop')).toBe('内部预览版 · 开发 ' + APP_VERSION)
    expect(formatAppVersionLine('trial')).toBe('内部预览版 · 测试 ' + APP_VERSION)
    expect(formatAppVersionLine('release')).toBe('内部预览版 · 发布候选 ' + APP_VERSION)
    expect(formatAppVersionLine('experimental')).toBe('内部预览版 · 实验 ' + APP_VERSION)
    expect(formatAppVersionLine('develop')).not.toContain('公开版')
    expect(formatAppVersionLine('trial')).not.toContain('公开版')
    expect(formatAppVersionLine('release')).not.toContain('公开版')
    expect(channelLabel('experimental')).toBe('实验')
  })

  it('大白话：只有对外名配成「公开版」且是正式包，才写「公开版」加数字；开发/测试/实验仍写内部预览', () => {
    expect(formatAppVersionLine('release', '1.2.3', '公开版')).toBe('公开版 1.2.3')
    expect(formatAppVersionLine('develop', '1.2.3', '公开版')).toBe('内部预览版 · 开发 1.2.3')
    expect(formatAppVersionLine('trial', '1.2.3', '公开版')).toBe('内部预览版 · 测试 1.2.3')
    expect(formatAppVersionLine('experimental', '1.2.3', '公开版')).toBe('内部预览版 · 实验 1.2.3')
  })
})

describe('通道对齐（本仓 main＝开发 / test＝测试 / 发布 / 实验仓）', () => {
  it('大白话：编译期钉了通道就听它的，不跟微信运行时抢；没钉才跟微信', () => {
    expect(resolveAppChannel('trial', 'develop')).toBe('develop')
    expect(resolveAppChannel('develop', 'trial')).toBe('trial')
    expect(resolveAppChannel('develop', 'release')).toBe('release')
    expect(resolveAppChannel('release', 'experimental')).toBe('experimental')
    expect(resolveAppChannel('trial', '')).toBe('trial')
    expect(resolveAppChannel('release', '')).toBe('release')
    expect(resolveAppChannel('develop', '')).toBe('develop')
  })

  it('大白话：本仓主线钉开发，实验仓自己写 experimental，文案用码点拼（E33）', () => {
    expect(BUILD_CHANNEL).toBe('develop')
    expect(appVersionSrc).toMatch(/'experimental'/)
    expect(appVersionSrc).toContain('0x5b9e')
    expect(appVersionSrc).toContain('0x9a8c')
    expect(appVersionSrc).toContain('luckyducky-fable-ablation')
  })
})

describe('运行时通道（编译期钉了就听钉的）', () => {
  afterEach(() => {
    delete (globalThis as unknown as { wx?: unknown }).wx
  })

  it('大白话：本仓主线钉了开发，微信读到体验版也仍写开发；简介是「更新」加日期', () => {
    const g = globalThis as unknown as { wx?: { getAccountInfoSync: () => { miniProgram: { envVersion: string } } } }
    g.wx = { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'trial' } }) }
    expect(currentAppVersionLine()).toBe('内部预览版 · 开发 ' + APP_VERSION)
    expect(currentAppVersionDetail()).toBe('更新 ' + DEV_UPDATE_DATE)
    g.wx = { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }) }
    expect(currentAppVersionLine()).toBe('内部预览版 · 开发 ' + APP_VERSION)
    delete g.wx
    expect(currentAppVersionLine()).toBe('内部预览版 · 开发 ' + APP_VERSION)
    expect(currentAppVersionDetail()).toBe('更新 ' + DEV_UPDATE_DATE)
  })
})

describe('版本简介（更新时间一眼能看见）', () => {
  it('大白话：日期是上海日历的年月日；第二行写「更新」加日期，不是退款说明也不是占位稿', () => {
    expect(DEV_UPDATE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(formatAppVersionDetail('develop')).toBe('更新 ' + DEV_UPDATE_DATE)
    expect(formatAppVersionDetail('trial')).toBe('更新 ' + DEV_UPDATE_DATE)
    expect(formatAppVersionDetail('release')).toBe('更新 ' + DEV_UPDATE_DATE)
    expect(formatAppVersionDetail('experimental')).toBe('更新 ' + DEV_UPDATE_DATE)
    expect(formatAppVersionDetail('develop')).not.toContain('退款')
    expect(formatAppVersionDetail('develop')).not.toContain('版本脚')
  })

  it('大白话：四条线都在版本号下面多一行「更新 哪天」；空日期或空备注不上屏', () => {
    expect(formatAppVersionDetail('trial', '2020-01-02')).toBe('更新 2020-01-02')
    expect(formatAppVersionDetail('develop', '', '开发')).toBe('')
    expect(formatAppVersionDetail('develop', DEV_UPDATE_DATE, '')).toBe('')
    expect(formatAppVersionDetail('develop', '2020-01-02', '开发')).toBe('2020-01-02 · 开发')
  })
})

describe('我页底部版本行', () => {
  it('大白话：「我」页最底下先写版本线+数字，再写更新时间，字从 lib/appVersion 来', () => {
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
