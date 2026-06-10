// 扫码激活课程（规格 §四-2，2026-06-10 修订版）。
// 一码一用：用「条件更新抢占」保证并发安全——where(status:'unused') 的 update
// 只会有一个请求改到（updated===1 即赢得激活），无需事务。
// 返回 state：
//   'activated' = 刚激活 或 本人已激活但未确认 → 前端走两页式确认页（确认是进课唯一闸门）
//   'mine'      = 本人已激活且已确认（enteredAt 非空）→ 前端显示「继续学习」直接进课
// 错误：INVALID_CODE 码不存在；CODE_TAKEN 已被他人激活。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'NO_OPENID' }
  const code = String(event.code || '').trim()
  if (!code) return { ok: false, error: 'INVALID_CODE' }

  const now = Date.now()
  // 抢占激活：只有码还是 unused 时这条 update 才会生效
  const upd = await db
    .collection('qrcodes')
    .where({ code, status: 'unused' })
    .update({ data: { status: 'activated', activatedBy: OPENID, activatedAt: now } })

  if (upd.stats.updated === 1) {
    const qr = (await db.collection('qrcodes').where({ code }).get()).data[0]
    // 云函数写库必须显式写 _openid（见 调试日志 login 教训）
    await db.collection('activations').add({
      data: { _openid: OPENID, courseId: qr.courseId, qrcodeId: qr._id, code, enteredAt: null, createdAt: now },
    })
    return { ok: true, state: 'activated', courseId: qr.courseId }
  }

  // 没抢到：码不存在 / 已被激活（本人或他人）
  const got = await db.collection('qrcodes').where({ code }).get()
  if (!got.data.length) return { ok: false, error: 'INVALID_CODE' }
  const qr = got.data[0]
  if (qr.activatedBy !== OPENID) return { ok: false, error: 'CODE_TAKEN' }
  const act = (await db.collection('activations').where({ code, _openid: OPENID }).get()).data[0]
  return { ok: true, state: act && act.enteredAt ? 'mine' : 'activated', courseId: qr.courseId }
}
