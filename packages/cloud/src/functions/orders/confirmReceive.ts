import { withOpenId, ok, err, transition } from '../../kit'

// 确认收货（敏感：状态流转一律走云）。openid + 本人订单 + 仅 shipped→done（防越状态/重复确认）。
// 先查（归属 + 准确错误码）→ kit.transition 条件原子流转（防与后台改单号并发交错回滚状态）。
export const main = withOpenId(async ({ db, OPENID, event }) => {
  const id = String(event.id || '')
  if (!id) return err('NO_ID')

  const got = await db.collection('orders').doc(id).get().catch(() => null)
  if (!got || !got.data || got.data._openid !== OPENID) return err('NOT_FOUND')
  if (got.data.status !== 'shipped') return err('BAD_STATUS:' + got.data.status)

  const doneAt = Date.now()
  const { moved } = await transition('orders', id, ['shipped'], 'done', { doneAt })
  if (!moved) {
    const fresh = await db.collection('orders').doc(id).get().catch(() => null)
    return err('BAD_STATUS:' + ((fresh && fresh.data && fresh.data.status) || 'unknown'))
  }
  return ok({ doneAt })
})
