import { withOpenId, withRateLimit, ok, err, str, COLLECTIONS, imgSecCheck } from '../../kit'

// 节点诊断·用户拍照上传（后台360工作站 B2.2·节点诊断 MVP）：学员在关键节点拍照上传成果/卡点，坐席据此精准指导。
//
// 信任边界（根因#3 fail-closed）：① withOpenId 闸（公网写函数防伪·不信前端 openid）；② withRateLimit 防刷库；
// ③ 须本人已确认进课（activations.enteredAt 非空·与 trackEvent/getPlaybackUrl 同闸·防未购用户造数）；
// ④ **UGC 图片入库前必过 imgSecCheck 内容安全**（守卫 ugc-imgsecchecked·校不过/校不了一律拒、不入库·fail-closed）。
// 确定性 _id=`sub:<openid>:<courseId>:<nodeId>`（幂等·并发/重传撞号即覆盖最新·根因#1）；data 不带 _id（真 sdk 约束·no-id-in-set-data）。
export const main = withOpenId(
  withRateLimit('submitCheckpointPhoto', { max: 20, windowMs: 60_000 }, async ({ db, OPENID, event }) => {
    const e: any = event
    const courseId = str(e.courseId, 64)
    const nodeId = str(e.nodeId, 64)
    const fileId = str(e.fileId, 256)
    if (!courseId || !nodeId || !fileId) return err('BAD_ARGS')

    // 须本人已确认进课（enteredAt 非空）——与 trackEvent/getPlaybackUrl 同闸，防未购/未进课用户造数
    const _ = db.command
    const owns = await db
      .collection('activations')
      .where({ _openid: OPENID, courseId, enteredAt: _.neq(null) })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))
    if (!owns.data.length) return err('NOT_ENTITLED')

    // UGC 内容安全（fail-closed·根因#3）：校不过/校不了一律拒、不入库（守卫 ugc-imgsecchecked）
    const sec = await imgSecCheck(fileId)
    if (!sec.ok) return err(sec.error === 'IMG_RISKY' ? 'IMG_RISKY' : 'SEC_CHECK_FAIL')

    // 确定性 _id（幂等·重传覆盖最新；set data 不带 _id·no-id-in-set-data）
    const id = 'sub:' + OPENID + ':' + courseId + ':' + nodeId
    await db
      .collection(COLLECTIONS.checkpoints)
      .doc(id)
      .set({ data: { type: 'sub', _openid: OPENID, courseId, nodeId, fileId, secPassed: true, createdAt: Date.now() } })
    return ok()
  })
)
