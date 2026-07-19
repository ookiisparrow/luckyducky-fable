import { reply, ensure, str, type Ctx } from '../lib'
import { notifyAlert } from '../../../kit'

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
  // 元档 rev 供前端做 baseRev（乐观并发基线·课程级 CAS 元档 defmeta:<courseId>）：单课查时读该课元档 rev；
  // 无 courseId（全部课·customer360 不走此形状）时无单一元档、rev 省 0。where type:'def' 天然排除 defmeta。
  let rev = 0
  if (courseId) {
    const m = await db.collection('checkpoints').doc('defmeta:' + courseId).get().catch(() => null)
    rev = m && m.data ? Number((m.data as any).rev) || 0 : 0
  }
  return reply(200, { ok: true, list, rev })
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
    // 空 nodeId 整批拒（D3·bug 清除批D·fail-closed）：主循环原先对空 nodeId 静默 continue，该行不进
    // keepIds，随后「删不在 keepIds 的旧 def」会把原有节点当「已移除」真删——整课覆盖时误删旧节点且前端
    // 只报成功。宁拒不删：任何空 nodeId 都到不了删除步骤（同预检位置·不写半份数据）。
    if (!nodeId) return reply(400, { ok: false, error: 'BAD_ARGS:EMPTY_NODE_ID' })
  }
  await ensure(db, 'checkpoints')
  // 课程级元档 CAS 乐观并发（批A·内容域并发安全·根因#1/#2）：集合原本是逐节点 def 文档、无课程级档，
  // 整课覆盖式保存（逐节点 upsert + 删本课不在列表里的旧节点）＝两处并发编辑后保存者静默吃掉先保存者的
  // 整册策展。立元档 `defmeta:<courseId>`（确定性 _id·courseId 已过防冒号校验·段界安全）承 rev：客户端带
  // 拉取时的 baseRev，不符即拒（DRAFT_CONFLICT·前端提示重载不静默覆盖）。抢占用 CAS——元档存在则条件
  // update（rev 不符即并发方先行、updated!==1）、缺档则 add（撞 _id＝并发方已建·病根#2 房式）；抢占成功
  // 才进 upsert+GC。不带 baseRev 的旧调用跳过比对但仍走 CAS 抢占——抢失败也返 DRAFT_CONFLICT（诚实拒绝
  // 优于静默互吃；courses 的「旧版覆盖」兼容是文档级 set 无法区分并发，这里 CAS 天然可区分，取更强语义）。
  const metaId = 'defmeta:' + courseId
  const metaGot = await db.collection('checkpoints').doc(metaId).get().catch(() => null)
  const curRev = metaGot && metaGot.data ? Number((metaGot.data as any).rev) || 0 : 0
  const baseRev = Number(data.baseRev)
  if (Number.isFinite(baseRev) && curRev !== baseRev) return reply(200, { ok: false, error: 'DRAFT_CONFLICT', rev: curRev })
  const nextRev = curRev + 1
  if (metaGot && metaGot.data) {
    const upd = await db
      .collection('checkpoints')
      .where({ _id: metaId, rev: curRev })
      .update({ data: { rev: nextRev, updatedAt: Date.now() } })
      .catch(() => ({ stats: { updated: 0 } }))
    if (!upd.stats || upd.stats.updated !== 1) return reply(200, { ok: false, error: 'DRAFT_CONFLICT', rev: curRev })
  } else {
    const created = await db
      .collection('checkpoints')
      .add({ data: { _id: metaId, type: 'defmeta', courseId, rev: nextRev, updatedAt: Date.now() } })
      .then(() => true)
      .catch(() => false)
    if (!created) return reply(200, { ok: false, error: 'DRAFT_CONFLICT', rev: curRev }) // 撞 _id＝并发方已建
  }
  const keepIds = new Set<string>()
  let i = 0
  for (const n of nodes) {
    const nodeId = str(n && n.nodeId, 64)
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
  // GC 删除失败不再吞（H2·同批F F1 判例）：原 .catch(()=>{}) 全吞、恒 ok:true——旧节点删不掉时坐席仍按「已整课覆盖」
  // 的错觉工作，残留的旧节点定义继续被读到（可能已改名/合并，误导挽回话术）。upsert 已成功的部分保留（数据是新
  // 的、只是旧条目残留，重存一次即可收敛）；GC 失败经 notifyAlert 留痕 + 如实回 ok:false，别静默过关。
  const old = await db
    .collection('checkpoints')
    .where({ type: 'def', courseId })
    .limit(DEF_SCAN)
    .get()
    .catch(() => ({ data: [] }))
  const failedIds: string[] = []
  for (const d of (old && old.data) || []) {
    if (!keepIds.has(d._id)) {
      const err = await db
        .collection('checkpoints')
        .doc(d._id)
        .remove()
        .then(() => null)
        .catch((e: any) => e || new Error('REMOVE_FAIL'))
      if (err) failedIds.push(d._id)
    }
  }
  if (failedIds.length) {
    await notifyAlert('anomaly', 'saveCheckpoints', 'GC_REMOVE_FAIL', { failedIds, courseId })
    // rev 已递增（CAS 抢占成功·节点已 upsert）——回给前端刷新 baseRev，否则「重存收敛」会撞自己刚 bump 的 rev → DRAFT_CONFLICT
    return reply(200, { ok: false, error: 'GC_REMOVE_FAIL', failedIds, rev: nextRev })
  }
  return reply(200, { ok: true, count: keepIds.size, rev: nextRev })
}
