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
  await drafts2
    .doc(c.id)
    .set({ data: c })
    .catch(async () => {
      await drafts2.add({ data: { ...c, _id: c.id } })
    })
  return reply(200, { ok: true })
}

// 收集课程文档引用的全部 videoFileId（发布时孤儿视频 GC 用）
function collectVideoIds(course: any): string[] {
  const out: string[] = []
  for (const ch of course?.chapters || [])
    for (const l of ch.lessons || [])
      for (const sg of l.segments || []) if (sg && sg.videoFileId) out.push(String(sg.videoFileId))
  return out
}

// 发布：草稿整体覆盖 courses（引用模型，老学员自动生效）+ 孤儿视频 GC（深审 P3：每次替换视频都生成
// 新 cloudPath、旧文件无人删 → 云存储只增不减）。GC 基线取「旧发布 − 新发布」：发布那刻旧发布不再引用
// 的文件才删（草稿期替换不删——已发布课程可能仍在引用旧文件，删了学员播放即断）。fail-soft 不反噬发布。
export async function publishCourse({ db, cloud, data }: Ctx) {
  const courseId = String(data.courseId || '')
  if (!courseId) return reply(400, { ok: false, error: 'NO_COURSE_ID' })
  const got = await db.collection('coursesDraft').doc(courseId).get().catch(() => null)
  if (!got || !got.data) return reply(400, { ok: false, error: 'NO_DRAFT' })
  const course = { ...got.data }
  delete course._id
  const coursesColl = db.collection('courses')
  const prev = await coursesColl.doc(courseId).get().catch(() => null) // GC 基线：读旧发布
  await coursesColl
    .doc(courseId)
    .set({ data: course })
    .catch(async () => {
      await coursesColl.add({ data: { ...course, _id: courseId } })
    })
  const keep = new Set(collectVideoIds(course))
  const orphans = [...new Set(collectVideoIds(prev && prev.data))].filter((id) => !keep.has(id))
  if (orphans.length) await cloud.deleteFile({ fileList: orphans }).catch(() => {})
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
