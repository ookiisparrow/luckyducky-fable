/**
 * learning 域状态机声明单源（镜像旧线 learning.spec.ts·状态串不可改名——数据零迁移前提）。
 * 范式边界：只管「status 字符串状态机」；「进课确认」是 activations.enteredAt 的 null→时间戳
 * 条件抢占（并发开关闩·设计约束#1），不是 status 机、不在此声明——正确性由原子抢占保证。
 */
import type { SpecStates } from './status'

/** 激活码状态机声明（qrcodes 集合）。一码一用：生成写 unused、激活原子抢占翻 activated。 */
export const QRCODE_STATUS_SPEC = {
  collection: 'qrcodes',
  initial: ['unused'],
  terminal: ['activated'],
  transitions: [
    { from: ['unused'], to: 'activated', trigger: 'activateCourse 扫码激活（一码一用·原子抢占·翻成功者赢）' },
  ],
} as const

export type QrcodeStatus = SpecStates<typeof QRCODE_STATUS_SPEC>

/**
 * VOD FileId 判据单源（决策§29 转码管线批2·病根#5 防镜像漂移）：腾讯云点播 FileId＝纯数字长串
 * （如 5285890784246869296），云开发 fileID＝cloud:// 前缀——三处共用此判据分流新旧双线：
 * 云端 getPlaybackUrl 播放签名、cleanupEvents GC 删除、admin 课程编排「转码中」显示。判据分叉即三处口径漂移。
 */
export const isVodFileId = (id: string): boolean => /^\d{8,32}$/.test(id)
