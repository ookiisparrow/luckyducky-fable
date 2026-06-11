// 管理控制台后端（HTTP 访问服务触发，网页端 fetch 调用；规格 §三 登录方案 v1）。
// 鉴权：管理口令（adminConfig 集合，sha256 存储）——首次 login 即设置口令（bootstrap），
//   之后所有写操作必须带对口令；HTTPS 传输。Web SDK 账号体系留作后续升级。
// 数据：productsDraft 集合（商品上新流水线草稿，发布到 products 为后续批次）。
// 图片：base64 经本函数转存云存储（products/ 前缀），返回 fileID + 临时 URL。
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}
const reply = (statusCode, data) => ({ statusCode, headers: CORS, body: JSON.stringify(data) })
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

async function ensure(coll) {
  try {
    await db.createCollection(coll)
  } catch {
    /* 已存在 */
  }
}

// 口令校验；首次调用（无记录）时把本次口令设为管理员口令（部署后立即登录即占位）
async function checkKey(key, bootstrap) {
  if (!key || String(key).length < 6) return { ok: false, error: 'KEY_TOO_SHORT' }
  await ensure('adminConfig')
  const got = await db.collection('adminConfig').doc('auth').get().catch(() => null)
  if (!got || !got.data) {
    if (!bootstrap) return { ok: false, error: 'BAD_KEY' }
    await db
      .collection('adminConfig')
      .add({ data: { _id: 'auth', keyHash: sha(key), createdAt: Date.now() } })
    return { ok: true, bootstrapped: true }
  }
  return got.data.keyHash === sha(key) ? { ok: true } : { ok: false, error: 'BAD_KEY' }
}

// 草稿白名单字段（防杂字段入库）
function cleanProduct(p) {
  if (!p || typeof p !== 'object' || !p.id) return null
  const str = (v, cap) => (typeof v === 'string' ? v.slice(0, cap) : '')
  return {
    id: String(p.id).slice(0, 40),
    cover: str(p.cover, 300),
    images: (Array.isArray(p.images) ? p.images : []).slice(0, 20).map((u) => str(u, 300)),
    name: str(p.name, 60),
    price: str(String(p.price ?? ''), 12),
    was: str(String(p.was ?? ''), 12),
    tag: str(p.tag, 20),
    brief: str(p.brief, 120),
    skus: (Array.isArray(p.skus) ? p.skus : [])
      .slice(0, 30)
      .map((s) => ({ name: str(s?.name, 30), price: str(String(s?.price ?? ''), 12) })),
    courseId: str(p.courseId, 40),
    videoStats:
      p.videoStats && typeof p.videoStats === 'object'
        ? { total: Number(p.videoStats.total) || 0, done: Number(p.videoStats.done) || 0 }
        : null,
    status: p.status === 'onsale' ? 'onsale' : 'preparing',
    createdAt: Number(p.createdAt) || Date.now(),
    updatedAt: Date.now(),
  }
}

// manager-node：用函数运行时临时密钥初始化（签发直传凭证用）
let _manager = null
function manager() {
  if (_manager) return _manager
  const Manager = require('@cloudbase/manager-node')
  _manager = new Manager({
    secretId: process.env.TENCENTCLOUD_SECRETID,
    secretKey: process.env.TENCENTCLOUD_SECRETKEY,
    token: process.env.TENCENTCLOUD_SESSIONTOKEN,
    envId: process.env.TCB_ENV || process.env.SCF_NAMESPACE,
  })
  return _manager
}

// 课程草稿白名单（三层结构，与小程序 courses 同形；字段截断防杂数据）
function cleanCourse(c) {
  if (!c || typeof c !== 'object' || !c.id) return null
  const str = (v, cap) => (typeof v === 'string' ? v.slice(0, cap) : '')
  return {
    id: String(c.id).slice(0, 40),
    title: str(c.title, 60),
    sort: Number(c.sort) || 0,
    chapters: (Array.isArray(c.chapters) ? c.chapters : []).slice(0, 30).map((ch) => ({
      id: str(ch?.id, 40) || 'c' + Math.random().toString(36).slice(2, 8),
      title: str(ch?.title, 60),
      lessons: (Array.isArray(ch?.lessons) ? ch.lessons : []).slice(0, 50).map((l) => ({
        id: str(l?.id, 40) || 'l' + Math.random().toString(36).slice(2, 8),
        name: str(l?.name, 60),
        dur: str(l?.dur, 10),
        segments: (Array.isArray(l?.segments) ? l.segments : []).slice(0, 30).map((sg) => ({
          id: str(sg?.id, 40) || 's' + Math.random().toString(36).slice(2, 8),
          name: str(sg?.name, 60),
          dur: str(sg?.dur, 10),
          videoFileId: str(sg?.videoFileId, 300),
          free: !!sg?.free,
        })),
      })),
    })),
    updatedAt: Date.now(),
  }
}

// base64 → 云存储 products/<pid>/，返回 fileID + 临时展示 URL
async function storeImage(b64, data) {
  const ext = ['png', 'jpg', 'mp4', 'mov'].includes(data.ext) ? data.ext : 'jpg'
  const pid = String(data.pid || 'misc').slice(0, 40)
  const prefix = data.kind === 'video' ? 'videos' : 'products'
  const cloudPath = `${prefix}/${pid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const up = await cloud.uploadFile({ cloudPath, fileContent: Buffer.from(b64, 'base64') })
  const r = await cloud.getTempFileURL({ fileList: [up.fileID] })
  return { ok: true, fileID: up.fileID, url: r.fileList[0]?.tempFileURL || '' }
}

exports.main = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, {})
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'POST_ONLY' })

  let req
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body
    req = JSON.parse(raw || '{}')
  } catch {
    return reply(400, { ok: false, error: 'BAD_JSON' })
  }
  const { action, key, data = {} } = req

  if (action === 'ping') return reply(200, { ok: true, ts: Date.now() })

  // 登录（首次即设置口令）
  if (action === 'login') {
    const res = await checkKey(key, true)
    return reply(res.ok ? 200 : 401, res)
  }

  // 其余 action 一律先验口令
  const auth = await checkKey(key, false)
  if (!auth.ok) return reply(401, auth)
  await ensure('productsDraft')
  const drafts = db.collection('productsDraft')

  try {
    if (action === 'listDrafts') {
      const res = await drafts.orderBy('createdAt', 'desc').limit(100).get()
      // 给所有 fileID 换临时 URL（网页端展示用，有效期内自动续取）
      const ids = new Set()
      for (const p of res.data) {
        if (p.cover && p.cover.startsWith('cloud://')) ids.add(p.cover)
        for (const u of p.images || []) if (u.startsWith('cloud://')) ids.add(u)
      }
      const urls = {}
      if (ids.size) {
        const r = await cloud.getTempFileURL({ fileList: [...ids] })
        for (const f of r.fileList) if (f.tempFileURL) urls[f.fileID] = f.tempFileURL
      }
      return reply(200, { ok: true, list: res.data, urls })
    }

    if (action === 'saveDraft') {
      const p = cleanProduct(data.product)
      if (!p) return reply(400, { ok: false, error: 'BAD_PRODUCT' })
      await drafts
        .doc(p.id)
        .set({ data: p })
        .catch(async () => {
          await drafts.add({ data: { ...p, _id: p.id } })
        })
      return reply(200, { ok: true })
    }

    if (action === 'deleteDraft') {
      const id = String(data.id || '')
      if (!id) return reply(400, { ok: false, error: 'NO_ID' })
      await drafts.doc(id).remove()
      return reply(200, { ok: true })
    }

    // 小图单发（b64 ≤ 80K 字符）；大图走分片（HTTP 访问服务请求体上限约 100KB，
    // 真实照片必超 —— 调试日志 F）
    if (action === 'uploadImage') {
      const b64 = String(data.b64 || '')
      if (!b64 || b64.length > 90_000) return reply(400, { ok: false, error: 'BAD_IMAGE' })
      return reply(200, await storeImage(b64, data))
    }

    // 视频直传凭证（主路径）：manager-node 签发 COS 上传元数据，浏览器 PUT 直传云存储
    // （≤10MB 视频 3–10s；不可用时前端自动回落分片通道）
    if (action === 'getVideoUploadMeta') {
      const courseId = String(data.courseId || 'misc').slice(0, 40)
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
    if (action === 'getCourseDraft') {
      const courseId = String(data.courseId || '')
      if (!courseId) return reply(400, { ok: false, error: 'NO_COURSE_ID' })
      await ensure('coursesDraft')
      const got = await db.collection('coursesDraft').doc(courseId).get().catch(() => null)
      if (got && got.data) return reply(200, { ok: true, course: got.data })
      // 无草稿：若已有已发布课程（如存量 course-duck），以现网内容为底稿
      const pub = await db.collection('courses').doc(courseId).get().catch(() => null)
      if (pub && pub.data) return reply(200, { ok: true, course: pub.data, fromPublished: true })
      return reply(200, { ok: true, course: null })
    }

    if (action === 'saveCourseDraft') {
      const c = cleanCourse(data.course)
      if (!c) return reply(400, { ok: false, error: 'BAD_COURSE' })
      await ensure('coursesDraft')
      const drafts2 = db.collection('coursesDraft')
      await drafts2
        .doc(c.id)
        .set({ data: c })
        .catch(async () => {
          await drafts2.add({ data: { ...c, _id: c.id } })
        })
      return reply(200, { ok: true })
    }

    // 发布：草稿整体覆盖 courses（小程序 getCourses 即刻可见；引用模型，老学员自动生效）
    if (action === 'publishCourse') {
      const courseId = String(data.courseId || '')
      if (!courseId) return reply(400, { ok: false, error: 'NO_COURSE_ID' })
      const got = await db.collection('coursesDraft').doc(courseId).get().catch(() => null)
      if (!got || !got.data) return reply(400, { ok: false, error: 'NO_DRAFT' })
      const course = { ...got.data }
      delete course._id
      const coursesColl = db.collection('courses')
      await coursesColl
        .doc(courseId)
        .set({ data: course })
        .catch(async () => {
          await coursesColl.add({ data: { ...course, _id: courseId } })
        })
      return reply(200, { ok: true })
    }

    if (action === 'uploadChunk') {
      const { uploadId, seq, b64 } = data
      const id = String(uploadId || '').slice(0, 40)
      const n = parseInt(seq, 10)
      if (!id || !(n >= 0) || typeof b64 !== 'string' || !b64 || b64.length > 90_000) {
        return reply(400, { ok: false, error: 'BAD_CHUNK' })
      }
      await ensure('uploadChunks')
      await db
        .collection('uploadChunks')
        .doc(`${id}-${n}`)
        .set({ data: { uploadId: id, seq: n, b64, createdAt: Date.now() } })
      return reply(200, { ok: true })
    }

    if (action === 'uploadFinish') {
      const id = String(data.uploadId || '').slice(0, 40)
      const total = parseInt(data.total, 10)
      // total 上限 200：覆盖 ≤10MB 视频的分片回落通道（b64 ≈ 13.7MB / 80K ≈ 172 片）
      if (!id || !(total > 0) || total > 200) return reply(400, { ok: false, error: 'BAD_FINISH' })
      const chunksColl = db.collection('uploadChunks')
      const got = await chunksColl.where({ uploadId: id }).limit(1000).get()
      if (got.data.length !== total) {
        return reply(400, { ok: false, error: 'CHUNKS_MISSING', have: got.data.length })
      }
      const b64 = got.data
        .sort((a, b) => a.seq - b.seq)
        .map((c) => c.b64)
        .join('')
      const res = await storeImage(b64, data)
      await chunksColl.where({ uploadId: id }).remove()
      // 顺手清理 1 小时前的孤儿分片（中断的上传）
      await chunksColl
        .where({ createdAt: db.command.lt(Date.now() - 3600_000) })
        .remove()
        .catch(() => {})
      return reply(200, res)
    }

    // 上架小程序：商品草稿 → products（首页/详情即刻可见；价格转数字，重复上架保留原 sort/featured）
    if (action === 'publishProduct') {
      const id = String(data.id || '')
      if (!id) return reply(400, { ok: false, error: 'NO_ID' })
      const got = await drafts.doc(id).get().catch(() => null)
      if (!got || !got.data) return reply(400, { ok: false, error: 'NO_DRAFT' })
      const d = got.data
      if (!d.cover) return reply(400, { ok: false, error: 'NEED_COVER' })
      if (!d.name || !Number(d.price)) return reply(400, { ok: false, error: 'NEED_INFO' })
      if (!Array.isArray(d.skus) || !d.skus.length || d.skus.some((x) => !x.name || !Number(x.price))) {
        return reply(400, { ok: false, error: 'NEED_SKUS' })
      }
      const productsColl = db.collection('products')
      const exist = await productsColl.doc(id).get().catch(() => null)
      let sort = exist?.data?.sort
      let featured = exist?.data?.featured
      if (sort === undefined) {
        const top = await productsColl.orderBy('sort', 'desc').limit(1).get()
        sort = (top.data[0]?.sort ?? 0) + 1
        featured = true
      }
      const doc = {
        id,
        name: d.name,
        tag: d.tag || '',
        price: Number(d.price),
        was: Number(d.was) || null,
        brief: d.brief || '',
        cover: d.cover,
        images: d.images || [],
        skus: d.skus.map((x) => ({ name: x.name, price: Number(x.price) })),
        courseId: d.courseId || '',
        featured: !!featured,
        sort,
        updatedAt: Date.now(),
      }
      await productsColl
        .doc(id)
        .set({ data: doc })
        .catch(async () => {
          await productsColl.add({ data: { ...doc, _id: id } })
        })
      await drafts.doc(id).update({ data: { status: 'onsale' } })
      return reply(200, { ok: true })
    }

    return reply(400, { ok: false, error: 'UNKNOWN_ACTION' })
  } catch (e) {
    console.error('adminApi error', action, e)
    return reply(500, { ok: false, error: 'SERVER_ERROR' })
  }
}
