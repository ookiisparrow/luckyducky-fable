/**
 * learning 域状态机声明单源（状态串不可改名）。
 * 范式边界：只管「status 字符串状态机」；「进课确认」是 activations.enteredAt 的 null→时间戳
 * 条件抢占（并发开关闩·设计约束#1），不是 status 机、不在此声明——正确性由原子抢占保证。
 */

/** 激活码状态机声明（qrcodes 集合）。一码一用：生成写 unused、激活原子抢占翻 activated。 */
export const QRCODE_STATUS_SPEC = {
  collection: 'qrcodes',
  initial: ['unused'],
  terminal: ['activated'],
  transitions: [
    { from: ['unused'], to: 'activated', trigger: 'activateCourse 扫码激活（一码一用·原子抢占·翻成功者赢）' },
  ],
} as const


/**
 * VOD FileId 判据单源（决策§31·病根#5 防镜像漂移）：腾讯云点播 FileId＝纯数字长串
 * （如 5285890784246869296），云开发 fileID＝cloud:// 前缀。三处共用此判据：
 * 云端 getPlaybackUrl 播放签名、cleanupEvents GC 删除、admin 课程编排「转码中」显示。判据分叉即三处口径漂移。
 */
export const isVodFileId = (id: string): boolean => /^\d{8,32}$/.test(id)

/**
 * 学习进度百分比单源（2026-07-25 进度条专项·病根#5 三处裸写同式 + 根因#14 界面说假话）。
 *
 * **0% 只表示真没学、100% 只表示真学完**——中间态一律夹到 [1,99]。
 * 病史：mp mapLearning / cloud customer360 / admin Courses 三处各自裸写
 * `Math.round((done/total)*100)`，边界上对用户撒谎：
 *   · `1/250` → `round(0.4)=0` → 学了第一段却显示「已学 1/250 段 · 0%」，与「一段没学过」无法区分；
 *   · `199/200` → `round(99.5)=100` → 还差一段没学完却显示 100%，用户以为结课了。
 * 段数越多越容易撞上（长课程正是最需要进度感的那批）。
 *
 * 脏数据一律 fail-safe 归 0（非有限数/无总数/负数），学过头（stale done 键）夹到 100。
 */
export function progressPercent(done: number, total: number): number {
  const d = Number(done)
  const t = Number(total)
  if (!Number.isFinite(d) || !Number.isFinite(t) || t <= 0 || d <= 0) return 0
  if (d >= t) return 100
  const raw = Math.round((d / t) * 100)
  return Math.min(99, Math.max(1, raw)) // 不说 0（已学过）、不说 100（没学完）
}
