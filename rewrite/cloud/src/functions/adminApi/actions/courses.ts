import { reply, ensure, cleanCourse, storeImage, manager, type Ctx } from '../lib'
import { isVodFileId, makeVodUploadSignature, callVodApi } from '../../../kit'

// —— VOD 转码管线（决策§31 批2）——课程视频主路径升级为「admin 直传 VOD + 任务流自动转码」；
// 帮助视频线（HelpVideos）恒走下方云存储直传老路，不迁。

/** VOD 直传签名（UGC 签名·kit/vod.ts 纯本地 HMAC）：未配置回 VOD_NOT_CONFIGURED——admin 借此
 *  回退云存储直传老路（迁移期不断档），secureConfig/vod 填入即自动切换、零部署。 */
export async function getVodUploadSignature({ db }: Ctx) {
  const sig = await makeVodUploadSignature(db)
  if (!sig) return reply(200, { ok: false, error: 'VOD_NOT_CONFIGURED' })
  return reply(200, { ok: true, signature: sig })
}

const fmtDur = (sec: number) => {
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// 首选普通转码非源画质产物（Definition 0 = 源文件非转码产物）；模板若配自适应码流则取其输出
function pickVodPlayUrl(mi: any): string {
  const ts = mi?.TranscodeInfo?.TranscodeSet
  for (const t of Array.isArray(ts) ? ts : []) if (t && Number(t.Definition) !== 0 && t.Url) return String(t.Url)
  const ad = mi?.AdaptiveDynamicStreamingInfo?.AdaptiveDynamicStreamingSet
  for (const a of Array.isArray(ad) ? ad : []) if (a && a.Url) return String(a.Url)
  return ''
}

/**
 * 转码状态同步（on-demand·admin 点「同步转码状态」触发）：查草稿里「VOD FileId 已回填、vodUrl 未
 * 就绪」的段，批量 DescribeMediaInfos（≤20/次官方上限），就绪段回写 vodUrl/vodPoster（封面缺口）/
 * vodSpriteVtt（R36 雪碧图·批3 预览窗消费）/dur（转码元数据回填空时长·手填不覆盖，顺修 mm:ss 口径）。
 * 选择拉模式而非事件回调：云函数无公网回调入口、开 HTTP 访问服务只为此不值当；admin 发布前本就要
 * 打开本页，点一下同步即拿最新（VOD 任务记录保留 72h，远大于运营节奏）。rev 递增走乐观并发既有轨——
 * admin 同步后须重载草稿（前端 syncVod() 已自动 load()），否则下次自动保存撞 DRAFT_CONFLICT（诚实拒绝）。
 */
export async function syncVodMedia({ db, data }: Ctx) {
  const courseId = String(data.courseId || '')
  if (!courseId) return reply(400, { ok: false, error: 'NO_COURSE_ID' })
  const got = await db.collection('coursesDraft').doc(courseId).get().catch(() => null)
  if (!got || !got.data) return reply(400, { ok: false, error: 'NO_DRAFT' })
  const course: Record<string, any> = { ...got.data }
  delete course._id
  const pending: any[] = []
  for (const ch of course.chapters || [])
    for (const l of ch.lessons || [])
      for (const sg of l.segments || []) if (sg && isVodFileId(String(sg.videoFileId || '')) && !sg.vodUrl) pending.push(sg)
  if (!pending.length) return reply(200, { ok: true, ready: 0, processing: 0, rev: Number(course.rev) || 0 })
  const ids = [...new Set(pending.map((sg) => String(sg.videoFileId)))]
  const byId: Record<string, any> = {}
  for (let i = 0; i < ids.length; i += 20) {
    const resp = await callVodApi(db, 'DescribeMediaInfos', { FileIds: ids.slice(i, i + 20) })
    for (const mi of (resp && resp.MediaInfoSet) || []) byId[String(mi.FileId)] = mi
  }
  let ready = 0
  let processing = 0
  for (const sg of pending) {
    const mi = byId[String(sg.videoFileId)]
    const url = pickVodPlayUrl(mi)
    if (url) {
      sg.vodUrl = url.slice(0, 500)
      ready++
    } else processing++
    const cover = mi?.BasicInfo?.CoverUrl
    if (cover && !sg.vodPoster) sg.vodPoster = String(cover).slice(0, 500)
    const vtt = mi?.ImageSpriteInfo?.ImageSpriteSet?.[0]?.WebVttUrl
    if (vtt && !sg.vodSpriteVtt) sg.vodSpriteVtt = String(vtt).slice(0, 500)
    const durSec = Number(mi?.MetaData?.Duration)
    if (durSec > 0 && !sg.dur) sg.dur = fmtDur(durSec)
  }
  const next = { ...course, rev: (Number(course.rev) || 0) + 1 }
  const drafts = db.collection('coursesDraft')
  await drafts
    .doc(courseId)
    .set({ data: next })
    .catch(async () => {
      await drafts.add({ data: { ...next, _id: courseId } })
    })
  return reply(200, { ok: true, ready, processing, rev: next.rev })
}

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
  // 发布闸（决策§31 批2）：VOD 段转码未就绪（vodUrl 未回写）不放行——「传完 ≠ 可播」，放行了学员端
  // 该段只会 url:null 显示成「素材未剪」假象（伪成功·病根#14）。admin 点「同步转码状态」全就绪再发布。
  let pendingVod = 0
  for (const ch of course.chapters || [])
    for (const l of ch.lessons || [])
      for (const sg of l.segments || []) if (sg && isVodFileId(String(sg.videoFileId || '')) && !sg.vodUrl) pendingVod++
  if (pendingVod) return reply(200, { ok: false, error: 'VOD_PROCESSING', pending: pendingVod })
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
