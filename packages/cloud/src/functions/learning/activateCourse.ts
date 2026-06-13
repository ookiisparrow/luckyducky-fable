import { withOpenId, ok, err, transition } from '../../kit'

// 扫码激活课程（规格 §四-2）。一码一用：kit.transition 条件更新抢占（qrcode _id===code）——
// unused→activated 只一个请求改得到（moved 即赢），并发安全无需事务。
// state：'activated'=刚激活/本人未确认（走两页确认）；'mine'=本人已确认（继续学习）。
export const main = withOpenId(async ({ db, OPENID, event }) => {
  const code = String(event.code || '').trim()
  if (!code) return err('INVALID_CODE')
  const now = Date.now()

  const { moved, doc: qr } = await transition('qrcodes', code, ['unused'], 'activated', {
    activatedBy: OPENID,
    activatedAt: now,
  })
  if (moved) {
    // 云函数写库必须显式写 _openid（调试日志 login 教训）；qr 为抢占前文档，_id===code
    await db.collection('activations').add({
      data: { _openid: OPENID, courseId: qr.courseId, qrcodeId: qr._id, code, enteredAt: null, createdAt: now },
    })
    return ok({ state: 'activated', courseId: qr.courseId })
  }

  // 没抢到：码不存在 / 已被激活（本人或他人）
  if (!qr) return err('INVALID_CODE')
  if (qr.activatedBy !== OPENID) return err('CODE_TAKEN')
  const act = (await db.collection('activations').where({ code, _openid: OPENID }).get()).data[0]
  return ok({ state: act && act.enteredAt ? 'mine' : 'activated', courseId: qr.courseId })
})
