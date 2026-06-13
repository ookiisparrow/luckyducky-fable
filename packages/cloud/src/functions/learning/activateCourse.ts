import { withOpenId, ok, err, transition } from '../../kit'

// 扫码激活课程（规格 §四-2）。一码一用：kit.transition 条件更新抢占（qrcode _id===code）——
// unused→activated 只一个请求改得到（moved 即赢），并发安全无需事务。
// 激活记录幂等自愈（审计 P2「半步失败」：码已抢、activation 没写成 → 顾客卡住）：抢到 / 本人
// 重扫一律 ensureActivation——确定性 _id=code 原子创建，撞重即并发方已写、幂等不重复；老数据
// （随机 _id）命中即用、不重建（惰性迁移，根因#1）。
// state：'activated'=刚激活/本人未确认（走两页确认）；'mine'=本人已确认（继续学习）。

// 确保本人激活记录存在（幂等自愈）。老随机 _id 命中即用；否则确定性 _id=code 原子创建。
async function ensureActivation(db: any, code: string, courseId: string, OPENID: string, now: number) {
  const legacy = await db
    .collection('activations')
    .where({ code, _openid: OPENID })
    .get()
    .catch(() => ({ data: [] }))
  if (legacy.data.length) return legacy.data[0]
  // 云函数写库必须显式写 _openid（调试日志 login 教训）；qrcodeId===code
  const doc = { _openid: OPENID, courseId, qrcodeId: code, code, enteredAt: null, createdAt: now }
  try {
    await db.collection('activations').add({ data: { _id: code, ...doc } })
  } catch {
    /* 已存在（并发/重试/半步失败重入）→ 幂等 */
  }
  const got = await db.collection('activations').doc(code).get().catch(() => null)
  return (got && got.data) || { _id: code, ...doc }
}

export const main = withOpenId(async ({ db, OPENID, event }) => {
  const code = String(event.code || '').trim()
  if (!code) return err('INVALID_CODE')
  const now = Date.now()

  const { moved, doc: qr } = await transition('qrcodes', code, ['unused'], 'activated', {
    activatedBy: OPENID,
    activatedAt: now,
  })

  if (!qr) return err('INVALID_CODE') // 码不存在
  // 抢到（首次）或本人重扫（含半步失败重入）→ 确保激活记录存在（幂等自愈）
  if (moved || qr.activatedBy === OPENID) {
    const act = await ensureActivation(db, code, qr.courseId, OPENID, now)
    return ok({ state: act && act.enteredAt ? 'mine' : 'activated', courseId: qr.courseId })
  }
  return err('CODE_TAKEN') // 被他人激活
})
