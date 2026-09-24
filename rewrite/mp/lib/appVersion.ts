// 小程序版本展示单源。数字跟仓根 package.json（LD-004·release.mjs 升号时同步本文件）；
// 对外名在 PUBLIC_RELEASE_NAME（空＝还没有公开版，正式包只写「发布候选」）。
// 通道跟老板 2026-09-18 四条线：本仓 main＝开发、本仓 test＝测试、
// 发布＝BUILD_CHANNEL/envVersion release（现有「发布候选」/公开名）、
// 实验＝BUILD_CHANNEL experimental（给 luckyducky-fable-ablation，本仓不自动写、不回收）。
// 日期由 stamp-mp-version-date.mjs 自动戳，人不用改 DEV_UPDATE_DATE。

export const APP_VERSION = '1.0.0'

/** 编译期通道戳。本仓 main 钉 develop。空＝跟微信 envVersion（兼容旧包）。 */
export const BUILD_CHANNEL: '' | 'develop' | 'trial' | 'release' | 'experimental' = 'develop'

/** 对外发布名。空＝仍是内部预览。写成「公开版」后，正式包才自称公开版。 */
export const PUBLIC_RELEASE_NAME = ''

const han = (...cp: number[]) => String.fromCharCode(...cp)
// 约定文案用码点拼：预/览/测/布/候/公/实/验/更/新 不在 tab 首屏品牌子集；
// 仓内无源 OTF，不能只改 txt 假装字库有（E33）。版本行走系统字体，不抢品牌标题。
const PREVIEW = han(0x5185, 0x90e8, 0x9884, 0x89c8, 0x7248) // 内部预览版
const DEV = han(0x5f00, 0x53d1) // 开发
const TRIAL = han(0x6d4b, 0x8bd5) // 测试
const RC = han(0x53d1, 0x5e03, 0x5019, 0x9009) // 发布候选
const EXPERIMENTAL = han(0x5b9e, 0x9a8c) // 实验
const UPDATED = han(0x66f4, 0x65b0) // 更新

type AppChannel = 'develop' | 'trial' | 'release' | 'experimental'

/** 通道优先级：编译期 BUILD_CHANNEL > 微信 envVersion > 开发。 */
export function resolveAppChannel(
  envVersion: string,
  buildChannel: typeof BUILD_CHANNEL = BUILD_CHANNEL,
): AppChannel {
  if (buildChannel === 'develop' || buildChannel === 'trial' || buildChannel === 'release' || buildChannel === 'experimental') {
    return buildChannel
  }
  if (envVersion === 'trial' || envVersion === 'release' || envVersion === 'experimental') return envVersion
  return 'develop'
}

export function channelLabel(channel: string): string {
  if (channel === 'trial') return TRIAL
  if (channel === 'release') return RC
  if (channel === 'experimental') return EXPERIMENTAL
  return DEV
}

export function formatAppVersionLine(
  envVersion: string,
  version = APP_VERSION,
  publicName = PUBLIC_RELEASE_NAME,
): string {
  if (envVersion === 'release' && publicName) return publicName + ' ' + version
  return PREVIEW + ' · ' + channelLabel(envVersion) + ' ' + version
}

function runtimeEnvVersion(): AppChannel {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getAccountInfoSync === 'function') {
      const v = wx.getAccountInfoSync().miniProgram.envVersion
      return resolveAppChannel(typeof v === 'string' ? v : 'develop')
    }
  } catch {
    /* 拿不到当开发版 */
  }
  return resolveAppChannel('develop')
}

export function currentAppVersionLine(): string {
  return formatAppVersionLine(runtimeEnvVersion())
}

// 日期＝上海日历当天（YYYY-MM-DD）；第二行＝「更新 YYYY-MM-DD」，一眼能看见更新时间。
// 自动戳：pre-commit / CI 合入 main|test / preview:mp / release.mjs / mac-sync-ends。
export const DEV_UPDATE_DATE = '2026-09-25'

export function formatAppVersionDetail(
  _envVersion: string,
  date = DEV_UPDATE_DATE,
  note?: string,
): string {
  const d = String(date || '').trim()
  const n = String((note ?? UPDATED) || '').trim()
  if (!d || !n) return ''
  if (note === undefined) return n + ' ' + d
  return d + ' · ' + n
}

export function currentAppVersionDetail(): string {
  return formatAppVersionDetail(runtimeEnvVersion())
}
