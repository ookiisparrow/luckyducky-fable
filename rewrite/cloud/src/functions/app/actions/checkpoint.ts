import {
  deleteFiles,
  withOpenId,
  withRateLimit,
  ok,
  err,
  str,
  imgSecCheck,
  enteredActs,
  isCollectionMissing,
  notifyAlert,
} from '../../../kit'
import { COLLECTIONS } from '@ldrw/shared'

// 节点诊断·用户拍照上传（后台360工作站 B2.2·节点诊断 MVP）：学员在关键节点拍照上传成果/卡点，坐席据此精准指导。
//
// 信任边界（根因#3 fail-closed）：① withOpenId 闸（公网写函数防伪·不信前端 openid）；② withRateLimit 防刷库；
// ③ 须本人已确认进课（activations.enteredAt 非空·与 trackEvent/getPlaybackUrl 同闸·防未购用户造数）；
// ④ **UGC 图片入库前必过 imgSecCheck 内容安全**（守卫 ugc-imgsecchecked·校不过/校不了一律拒、不入库·fail-closed）。
// 确定性 _id=`sub:<openid>:<courseId>:<nodeId>`（幂等·并发/重传撞号即覆盖最新·根因#1）；data 不带 _id（真 sdk 约束，测试桩同样拒）。

/**
 * 照片必须在 `checkpoints/<本人openid>/<文件名>` 下：删资料时服务端会用管理权限删这些文件，
 * 不限目录的话填一张商品图或别人的图进来，删资料就等于借刀删掉别人的文件。
 */
export function isOwnCheckpointFile(fileId: string, openid: string): boolean {
  const m = /^cloud:\/\/[^/]+\/checkpoints\/([^/]+)\/[^/]+$/.exec(fileId)
  return !!m && m[1] === openid
}

/**
 * 删本人目录下的节点照片（≤50 张＝deleteFile 单次上限），返回确认已经没了的 fileID（口径见 kit deleteFiles）。
 * 不在本人目录的直接跳过。
 */
export async function deleteOwnCheckpointFiles(fileIds: string[], openid: string): Promise<Set<string>> {
  const files = [...new Set(fileIds)].filter((f) => isOwnCheckpointFile(f, openid))
  if (!files.length) return new Set()
  return new Set((await deleteFiles(files)).filter((r) => r.deleted).map((r) => r.fileID))
}

// 没有档引用的照片删资料时找不到，只能当场删；删不掉留告警（ctx 不带 fileId：路径里有 openid）
async function dropOrphan(fileId: string, openid: string, ctx: Record<string, unknown>): Promise<void> {
  const gone = await deleteOwnCheckpointFiles([fileId], openid).catch(() => null)
  if (!gone?.has(fileId)) await notifyAlert('anomaly', 'submitCheckpointPhoto', 'CHECKPOINT_ORPHAN_FILE', ctx)
}

export const submitCheckpointPhoto = withOpenId(
  withRateLimit('submitCheckpointPhoto', { max: 20, windowMs: 60_000 }, async ({ db, OPENID, event }) => {
    const e: any = event
    const courseId = str(e.courseId, 64)
    const nodeId = str(e.nodeId, 64)
    const fileId = str(e.fileId, 256)
    if (!courseId || !nodeId || !fileId) return err('BAD_ARGS')
    // 冒号入参拒（fail-closed·同 adminApi/saveCheckpoints 先例）：_id 拼接 'sub:'+OPENID+':'+courseId+':'+nodeId，
    // courseId/nodeId 含 ':' 会打乱段界，跨课/跨节点撞出同一个 _id 互相覆盖（openid 来自云端身份、不受此影响）。
    if (courseId.includes(':') || nodeId.includes(':')) return err('BAD_ARGS:COLON_IN_ID')
    if (!isOwnCheckpointFile(fileId, OPENID)) return err('BAD_ARGS:FILE_NOT_OWNED')

    // 须本人已确认进课（enteredAt 非空）——与 trackEvent/getPlaybackUrl 同闸，防未购/未进课用户造数
    const owns = await enteredActs(db, OPENID, courseId).catch(() => null)
    if (!owns) return err('INTERNAL') // 库挂 ≠ 没资格（根因#14）
    if (!owns.data.length) return err('NOT_ENTITLED')

    // UGC 内容安全（fail-closed·根因#3）：校不过/校不了一律拒、不入库（守卫 ugc-imgsecchecked）
    // 拒掉的图不入库，前端重试须重新上传
    const sec = await imgSecCheck(fileId)
    if (!sec.ok) {
      await dropOrphan(fileId, OPENID, { courseId, nodeId, why: 'rejected' })
      return err(sec.error === 'IMG_RISKY' ? 'IMG_RISKY' : 'SEC_CHECK_FAIL')
    }

    // 确定性 _id（幂等·重传覆盖最新；set data 不带 _id）。覆盖前记下旧 fileId：set 之后旧照片就没档引用了
    const id = 'sub:' + OPENID + ':' + courseId + ':' + nodeId
    const coll = db.collection(COLLECTIONS.checkpoints)
    const prev = await coll
      .where({ _id: id })
      .limit(1)
      .get()
      .catch((e: unknown) => {
        if (!isCollectionMissing(e)) throw e
        return { data: [] }
      })
    await coll
      .doc(id)
      .set({ data: { type: 'sub', _openid: OPENID, courseId, nodeId, fileId, secPassed: true, createdAt: Date.now() } })
    // ponytail: 同节点两次重拍并发时两边读到同一张旧图，输的那次的新图会成孤儿；限频 + 真人操作下不值得加锁
    const old = String(prev.data[0]?.fileId || '')
    if (old && old !== fileId && isOwnCheckpointFile(old, OPENID)) {
      await dropOrphan(old, OPENID, { courseId, nodeId, why: 'replaced' })
    }
    return ok()
  })
)
