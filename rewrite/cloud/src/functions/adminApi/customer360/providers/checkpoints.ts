import type { CustomerPanelProvider } from '../types'

// 节点照片轨迹板块（B2.2·后台360工作站·铁律三）：坐席查某客人在各关键节点上传的成果/卡点照片（join 节点定义取标题），
// 配合学习位置精准指导。数据＝checkpoints 集合（def 节点定义 by admin·sub 用户提交 by submitCheckpointPhoto·imgSecCheck 过后才入库）。
//
// bounded（防大客户拖垮·capacity·根因#7）：本人提交、节点定义两读均带 .limit()。返回 fileId（admin Customer360 UI
// 按需经临时 URL 显图·与图片显示同 cloud:// 公开读思路）；不在 provider 内逐张换临时 URL（避免每次 360 加载 N 次云调用）。
const SUB_LIMIT = 100
const DEF_LIMIT = 200

export const checkpointsProvider: CustomerPanelProvider = {
  key: 'checkpoints',
  label: '节点照片',
  enabled: true,
  order: 40,
  async fetch(db: any, openid: string) {
    const sr = await db
      .collection('checkpoints')
      .where({ type: 'sub', _openid: openid })
      .limit(SUB_LIMIT)
      .get()
      .catch(() => ({ data: [] }))
    const subs: any[] = (sr && sr.data) || []
    if (!subs.length) return { count: 0, capped: false, photos: [] }
    // join 节点定义取标题（数门课的节点·全量 bounded·建 courseId:nodeId → title 映射）
    const dr = await db.collection('checkpoints').where({ type: 'def' }).limit(DEF_LIMIT).get().catch(() => ({ data: [] }))
    const titleByNode: Record<string, string> = {}
    for (const d of (dr && dr.data) || []) titleByNode[d.courseId + ':' + d.nodeId] = d.title || ''
    const photos = subs.map((s: any) => ({
      courseId: s.courseId,
      nodeId: s.nodeId,
      title: titleByNode[s.courseId + ':' + s.nodeId] || s.nodeId,
      fileId: s.fileId,
      createdAt: s.createdAt || null,
    }))
    return { count: photos.length, capped: subs.length >= SUB_LIMIT, photos }
  },
}
