import { withOpenId, ok, err, getTempUrl } from '../../kit'

// 取分段视频播放地址（审计 P1：付费内容服务端保护）。
// fileID 不出公开接口；此处服务端定位分段 → 鉴权 → 换短时效临时 URL 下发。
// 鉴权：一律须本人已「确认进课」（activations.enteredAt 非空，与 getMyCourses 同闸）。
// 段级免费预览通道已整条撤除（用户拍板 2026-07-03·守卫 free-trial-extinct）：旧库文档残留的
// 预览标记不构成授权。素材未剪（videoFileId 为空）→ url:null（前端回退占位）。
export const main = withOpenId(async ({ db, OPENID, event }) => {
  const courseId = String(event.courseId || '')
  const segmentId = String(event.segmentId || '')
  if (!courseId || !segmentId) return err('BAD_ARGS')

  const got = await db.collection('courses').doc(courseId).get().catch(() => null)
  if (!got || !got.data) return err('NO_COURSE')

  // 定位分段（chapter → lesson → segment）
  let seg: any = null
  for (const ch of got.data.chapters || []) {
    for (const l of ch.lessons || []) {
      const f = (l.segments || []).find((s: any) => s.id === segmentId)
      if (f) {
        seg = f
        break
      }
    }
    if (seg) break
  }
  if (!seg) return err('NO_SEGMENT')
  if (!seg.videoFileId) return ok({ url: null }) // 素材未剪：无视频

  // 鉴权：本人已确认进课才发地址（全段一律·免费预览通道已撤）。
  // 退款后观看权（审计 #5·有意设计·灰色靠人工，非 bug 故不自动收回）：闸只看 enteredAt 非空、不查订单是否已退。
  // 但「确认进课」本身就会失效退货权（confirmEnter 把对应订单项 refundable=false + admin 退款审核以 activations
  // 为「已激活=退货权失」判据）——所以正常路径走不到「退款后仍在看」。唯一能到该状态的是管理员**强行批退**（无视
  // 失效的退货权），那种情况下要不要连观看权一起收回是一单一议的人工判断（实体材料包 + 一次性扫码激活·收回不干净）。
  // 故此处不据退款自动失效 activations；若将来定「退款即收回观看权」，在退款链回写 activations、别在这里加。
  const _ = db.command
  const acts = await db
    .collection('activations')
    .where({ _openid: OPENID, courseId, enteredAt: _.neq(null) })
    .get()
  if (!acts.data.length) return err('NOT_ENTITLED')

  return ok({ url: await getTempUrl(String(seg.videoFileId)) })
})
