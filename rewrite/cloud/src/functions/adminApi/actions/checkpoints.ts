import { reply, ensure, str, type Ctx } from '../lib'

// 节点诊断·关键节点定义策展（后台360工作站 B2.2·admin 侧）：管理端为某门课维护「关键节点 + 挽回办法」内容，
// 学员在节点拍照、坐席据此 + 节点定义精准指导。一集合两形状：def 节点定义（本文件写）/ sub 用户拍照提交
// （submitCheckpointPhoto 写·见 learning 域）。def 确定性 _id=`def:<courseId>:<nodeId>`（幂等 upsert·set data 不带 _id）。
const NODE_LIMIT = 50
const DEF_SCAN = 200

// 列出某门课（或全部）的关键节点定义（bounded·读类·shouldAudit 跳过降噪）
export async function listCheckpoints({ db, data }: Ctx) {
  const courseId = str(data && data.courseId, 64)
  const where: any = { type: 'def' }
  if (courseId) where.courseId = courseId
  const r = await db.collection('checkpoints').where(where).limit(DEF_SCAN).get().catch(() => ({ data: [] }))
  const list = ((r && r.data) || [])
    .map((d: any) => ({
      courseId: d.courseId,
      nodeId: d.nodeId,
      title: d.title || '',
      remedy: d.remedy || '',
      order: Number(d.order) || 0,
    }))
    .sort((a: any, b: any) => a.order - b.order)
  return reply(200, { ok: true, list })
}

// 保存某门课的关键节点定义（整课覆盖式：upsert 传入节点 + 删本课不在列表里的旧节点·保持策展集同步；只动 def·不碰用户 sub 提交）
export async function saveCheckpoints({ db, data }: Ctx) {
  const courseId = str(data && data.courseId, 64)
  if (!courseId) return reply(400, { ok: false, error: 'BAD_ARGS' })
  // 冒号入参拒（P3·item11）：_id 拼接 'def:'+courseId+':'+nodeId，courseId/nodeId 含 ':' 会打乱段界、
  // 跨课/跨节点撞出同一个 _id 互相覆盖。fail-closed：先整体校验完（不写任何一条）再落库，避免半途拒绝
  // 留下部分节点已写、部分未写的半份数据。错误码沿用仓内既有「冒号后缀带因」形状（同 BAD_STATUS:/UNKNOWN_SKU: 先例）。
  if (courseId.includes(':')) return reply(400, { ok: false, error: 'BAD_ARGS:COLON_IN_ID' })
  const nodes = (Array.isArray(data && data.nodes) ? data.nodes : []).slice(0, NODE_LIMIT)
  for (const n of nodes) {
    const nodeId = str(n && n.nodeId, 64)
    if (nodeId.includes(':')) return reply(400, { ok: false, error: 'BAD_ARGS:COLON_IN_ID' })
  }
  await ensure(db, 'checkpoints')
  const keepIds = new Set<string>()
  let i = 0
  for (const n of nodes) {
    const nodeId = str(n && n.nodeId, 64)
    if (!nodeId) continue
    const id = 'def:' + courseId + ':' + nodeId
    keepIds.add(id)
    await db
      .collection('checkpoints')
      .doc(id)
      .set({
        data: {
          type: 'def',
          courseId,
          nodeId,
          title: str(n.title, 100),
          remedy: str(n.remedy, 2000),
          order: Number(n.order) || i,
          updatedAt: Date.now(),
        },
      })
    i++
  }
  // 删本课不在新列表里的旧节点定义（策展集同步·只删 type:'def'·用户 sub 拍照提交不受影响）
  const old = await db
    .collection('checkpoints')
    .where({ type: 'def', courseId })
    .limit(DEF_SCAN)
    .get()
    .catch(() => ({ data: [] }))
  for (const d of (old && old.data) || []) {
    if (!keepIds.has(d._id)) await db.collection('checkpoints').doc(d._id).remove().catch(() => {})
  }
  return reply(200, { ok: true, count: keepIds.size })
}
