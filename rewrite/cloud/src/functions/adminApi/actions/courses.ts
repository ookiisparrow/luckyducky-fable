import { reply, ensure, cleanCourse, storeImage, manager, type Ctx } from '../lib'

// 视频直传凭证（主路径）：manager-node 签发 COS 上传元数据，浏览器 PUT 直传
export async function getVideoUploadMeta({ data }: Ctx) {
  // 与 name 同款消毒（深审 P3）：客户端串直接拼对象键，'../' 类字符不入路径
  const courseId = String(data.courseId || 'misc').replace(/[^\w-]/g, '').slice(0, 40) || 'misc'
  const name = String(data.name || 'seg').replace(/[^\w-]/g, '').slice(0, 40) || 'seg'
  const ext = data.ext === 'mov' ? 'mov' : 'mp4'
  const cloudPath = `videos/${courseId}/${name}-${Date.now()}.${ext}`
  try {
    const meta = await manager().storage.getUploadMetadata(cloudPath)
    return reply(200, {
      ok: true,
      url: meta.url,
      token: meta.token,
      authorization: meta.authorization,
      fileId: meta.fileId,
      cosFileId: meta.cosFileId,
    })
  } catch (e) {
    console.error('getVideoUploadMeta fail', e)
    return reply(200, { ok: false, error: 'META_UNAVAILABLE' })
  }
}

// —— 课程草稿（步骤④ 视频编排；与小程序 courses 同形，发布前学员不可见）——
export async function getCourseDraft({ db, data }: Ctx) {
  const courseId = String(data.courseId || '')
  if (!courseId) return reply(400, { ok: false, error: 'NO_COURSE_ID' })
  await ensure(db, 'coursesDraft')
  const got = await db.collection('coursesDraft').doc(courseId).get().catch(() => null)
  if (got && got.data) return reply(200, { ok: true, course: got.data })
  const pub = await db.collection('courses').doc(courseId).get().catch(() => null)
  if (pub && pub.data) return reply(200, { ok: true, course: pub.data, fromPublished: true })
  return reply(200, { ok: true, course: null })
}

export async function saveCourseDraft({ db, data }: Ctx) {
  const c = cleanCourse(data.course)
  if (!c) return reply(400, { ok: false, error: 'BAD_COURSE' })
  await ensure(db, 'coursesDraft')
  const drafts2 = db.collection('coursesDraft')
  // 乐观并发（课程链路审计 2026-07-17·根因#1）：整份覆盖 + 无版本比对＝两处并发编辑（双页签/双管理员）
  // 后保存者静默吃掉先保存者的改动。客户端带上拉草稿时的 rev，不符即拒（前端提示重新载入，不静默覆盖）；
  // 不带 baseRev 的调用（旧版前端/脚本）按原语义覆盖——部署窗口内前后端版本错开不卡死保存。
  // get→set 间仍有毫秒级 TOCTOU 窗（真实冲突场景是人差几分钟的编辑，非毫秒并发；同实例内已有 serialSave 串行）。
  const got = await drafts2.doc(c.id).get().catch(() => null)
  const curRev = got && got.data ? Number(got.data.rev) || 0 : 0
  const baseRev = Number(data.baseRev)
  if (Number.isFinite(baseRev) && curRev !== baseRev) return reply(200, { ok: false, error: 'DRAFT_CONFLICT', rev: curRev })
  const next = { ...c, rev: curRev + 1 }
  await drafts2
    .doc(c.id)
    .set({ data: next })
    .catch(async () => {
      await drafts2.add({ data: { ...next, _id: c.id } })
    })
  return reply(200, { ok: true, rev: next.rev })
}

// 收集课程文档引用的全部 videoFileId（发布时孤儿视频 GC 用）
function collectVideoIds(course: any): string[] {
  const out: string[] = []
  for (const ch of course?.chapters || [])
    for (const l of ch.lessons || [])
      for (const sg of l.segments || []) if (sg && sg.videoFileId) out.push(String(sg.videoFileId))
  return out
}

// 发布：草稿整体覆盖 courses（引用模型，老学员自动生效）+ 孤儿视频缓期 GC（深审 P3：每次替换视频都生成
// 新 cloudPath、旧文件无人删 → 云存储只增不减）。GC 基线取「旧发布 − 新发布」：发布那刻旧发布不再引用
// 的文件才进回收队列（草稿期替换不删——已发布课程可能仍在引用旧文件，删了学员播放即断）。
// 缓期而非立删（课程链路审计 2026-07-17·根因#1）：正在观看被替换段的学员手里持有旧文件的临时签名 URL
// （有效期 ≤2h），发布同步物理删除会让其播放中途 404。待删清单记在已发布课程文档 pendingGc 字段
// （getCourses 逐层白名单天然不外泄；不建新集合免控制台锁权限人工步），cleanupEvents 每日删已过缓期项；
// 重新引用回来的文件自动出队（keep 过滤）。
const GC_GRACE_MS = 24 * 3600 * 1000

export async function publishCourse({ db, data }: Ctx) {
  const courseId = String(data.courseId || '')
  if (!courseId) return reply(400, { ok: false, error: 'NO_COURSE_ID' })
  const got = await db.collection('coursesDraft').doc(courseId).get().catch(() => null)
  if (!got || !got.data) return reply(400, { ok: false, error: 'NO_DRAFT' })
  const course: Record<string, any> = { ...got.data }
  delete course._id
  const coursesColl = db.collection('courses')
  const prev = await coursesColl.doc(courseId).get().catch(() => null) // GC 基线：读旧发布
  const prevDoc = (prev && prev.data) || null
  const keep = new Set(collectVideoIds(course))
  // 承接旧队列（过滤重新被引用的）+ 本次新孤儿入队（去重）
  const carried = (Array.isArray(prevDoc?.pendingGc) ? prevDoc.pendingGc : []).filter(
    (en: any) => en && en.fileId && !keep.has(String(en.fileId))
  )
  const queued = new Set(carried.map((en: any) => String(en.fileId)))
  const fresh = [...new Set(collectVideoIds(prevDoc))].filter((id) => !keep.has(id) && !queued.has(id))
  course.pendingGc = [...carried, ...fresh.map((fileId) => ({ fileId, deleteAfter: Date.now() + GC_GRACE_MS }))]
  await coursesColl
    .doc(courseId)
    .set({ data: course })
    .catch(async () => {
      await coursesColl.add({ data: { ...course, _id: courseId } })
    })
  return reply(200, { ok: true })
}

export async function uploadChunk({ db, data }: Ctx) {
  const { uploadId, seq, b64 } = data
  const id = String(uploadId || '').slice(0, 40)
  const n = parseInt(seq, 10)
  if (!id || !(n >= 0) || typeof b64 !== 'string' || !b64 || b64.length > 90_000) {
    return reply(400, { ok: false, error: 'BAD_CHUNK' })
  }
  await ensure(db, 'uploadChunks')
  await db
    .collection('uploadChunks')
    .doc(`${id}-${n}`)
    .set({ data: { uploadId: id, seq: n, b64, createdAt: Date.now() } })
  return reply(200, { ok: true })
}

export async function uploadFinish({ db, cloud, data }: Ctx) {
  const id = String(data.uploadId || '').slice(0, 40)
  const total = parseInt(data.total, 10)
  // 片数上限须覆盖 admin 体积闸（uploadVideo 放行 ≤15MB·~80KB/片 b64 → 15MB≈263 片）+ 余量，
  // 否则 12~15MB 视频走回落分片必 BAD_FINISH（P2·回落容量 vs 体积闸不一致）。300 片≈17MB，封顶防无界回落。
  // 任一片数变动同步 tests/cloud/adminMisc.test.js「视频回落分片」用例。
  if (!id || !(total > 0) || total > 300) return reply(400, { ok: false, error: 'BAD_FINISH' })
  const chunksColl = db.collection('uploadChunks')
  const got = await chunksColl.where({ uploadId: id }).limit(1000).get()
  // seq 必须正好 0..total-1（审核批次B：只数数量「0,2 共 2 片」也能过 → 拼出损坏文件）
  const seqs = new Set(got.data.map((c: any) => c.seq))
  const complete =
    got.data.length === total &&
    seqs.size === total &&
    Array.from({ length: total }, (_, i) => i).every((i) => seqs.has(i))
  if (!complete) {
    return reply(400, { ok: false, error: 'CHUNKS_MISSING', have: got.data.length })
  }
  const b64 = got.data
    .sort((a: any, b: any) => a.seq - b.seq)
    .map((c: any) => c.b64)
    .join('')
  const res = await storeImage(cloud, b64, data)
  await chunksColl.where({ uploadId: id }).remove()
  await chunksColl
    .where({ createdAt: db.command.lt(Date.now() - 3600_000) })
    .remove()
    .catch(() => {})
  return reply(200, res)
}
