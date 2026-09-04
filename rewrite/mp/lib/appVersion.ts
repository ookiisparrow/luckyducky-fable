// 小程序版本展示单源。数字跟仓根 package.json（LD-004·release.mjs 升号时同步本文件）；
// 对外名在 PUBLIC_RELEASE_NAME（空＝还没有公开版，正式包只写「发布候选」）。
// 通道看运行时 envVersion：同一份代码上传成开发版 / 体验版 / 正式版，文案跟着变。
// BUILD_CHANNEL 空＝跟微信运行时。测试线钉 'trial'：开发者工具 / 开发版上传测试代码时 envVersion 仍是 develop。

export const APP_VERSION = '1.0.0'

/** 编译期通道戳。空＝跟微信 envVersion。测试线写成 'trial'。 */
export const BUILD_CHANNEL: '' | 'develop' | 'trial' | 'release' = ''

/** 对外发布名。空＝仍是内部预览。写成「公开版」后，正式包才自称公开版。 */
export const PUBLIC_RELEASE_NAME = ''

const han = (...cp: number[]) => String.fromCharCode(...cp)
// 约定文案用码点拼：预/览/测/布/候/公 不在 tab 首屏品牌子集，「候」连二层都没有；
// 仓内无源 OTF，不能只改 txt 假装字库有（E33）。版本行走系统字体，不抢品牌标题。
const PREVIEW = han(0x5185, 0x90e8, 0x9884, 0x89c8, 0x7248) // 内部预览版
const DEV = han(0x5f00, 0x53d1) // 开发
const TRIAL = han(0x6d4b, 0x8bd5) // 测试
const RC = han(0x53d1, 0x5e03, 0x5019, 0x9009) // 发布候选

export function formatAppVersionLine(
  envVersion: string,
  version = APP_VERSION,
  publicName = PUBLIC_RELEASE_NAME,
): string {
  if (envVersion === 'release' && publicName) return publicName + ' ' + version
  const channel = envVersion === 'trial' ? TRIAL : envVersion === 'release' ? RC : DEV
  return PREVIEW + ' · ' + channel + ' ' + version
}

function runtimeEnvVersion(): 'develop' | 'trial' | 'release' {
  if (BUILD_CHANNEL === 'develop' || BUILD_CHANNEL === 'trial' || BUILD_CHANNEL === 'release') {
    return BUILD_CHANNEL
  }
  try {
    if (typeof wx === 'undefined' || typeof wx.getAccountInfoSync !== 'function') return 'develop'
    const v = wx.getAccountInfoSync().miniProgram.envVersion
    if (v === 'trial' || v === 'release') return v
  } catch {
    /* 拿不到当开发版 */
  }
  return 'develop'
}

export function currentAppVersionLine(): string {
  return formatAppVersionLine(runtimeEnvVersion())
}

// 日期＝上海日历当天（YYYY-MM-DD）；简介＝通道名（开发/测试/发布候选），三通道都上屏。
// 每次上传前改 DEV_UPDATE_DATE。简介用码点拼：走系统字体，不把字拖进 tab 首屏品牌子集（E33·无源 OTF）。
export const DEV_UPDATE_DATE = '2026-09-04'

function channelNote(envVersion: string): string {
  if (envVersion === 'trial') return TRIAL
  if (envVersion === 'release') return RC
  return DEV
}

export function formatAppVersionDetail(
  envVersion: string,
  date = DEV_UPDATE_DATE,
  note?: string,
): string {
  const d = String(date || '').trim()
  const n = String((note ?? channelNote(envVersion)) || '').trim()
  if (!d || !n) return ''
  return d + ' · ' + n
}

export function currentAppVersionDetail(): string {
  return formatAppVersionDetail(runtimeEnvVersion())
}
