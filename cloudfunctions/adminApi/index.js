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
// 字段截断助手（白名单清洗时统一用）：非字符串归一为空串，字符串截到 cap 长度
const str = (v, cap) => (typeof v === 'string' ? v.slice(0, cap) : '')

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
    params: (Array.isArray(p.params) ? p.params : [])
      .slice(0, 8)
      .map((kv) => [str(kv?.[0], 10), str(kv?.[1], 40)]),
    detailSections: (Array.isArray(p.detailSections) ? p.detailSections : [])
      .slice(0, 4)
      .map((d) => ({ lead: str(d?.lead, 30), body: str(d?.body, 200) })),
    kit: (Array.isArray(p.kit) ? p.kit : [])
      .slice(0, 8)
      .map((k) => ({ icon: str(k?.icon, 24), name: str(k?.name, 14), qty: str(k?.qty, 14) })),
    courseId: str(p.courseId, 40),
    cardStatus: p.cardStatus === 'final' ? 'final' : p.cardStatus === 'draft' ? 'draft' : '',
    batchCount: Number(p.batchCount) || 0,
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
        params: d.params || [],
        detailSections: d.detailSections || [],
        kit: d.kit || [],
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

    // —— 小程序橱窗（规格 §八）：一比一首页预览的排序与上下架 ——
    if (action === 'listShowcase') {
      const res = await db.collection('products').orderBy('sort', 'asc').limit(100).get()
      const ids = res.data.map((p) => p.cover).filter((u) => u && u.startsWith('cloud://'))
      const urls = {}
      if (ids.length) {
        const r = await cloud.getTempFileURL({ fileList: [...new Set(ids)] })
        for (const f of r.fileList) if (f.tempFileURL) urls[f.fileID] = f.tempFileURL
      }
      return reply(200, { ok: true, list: res.data, urls })
    }

    if (action === 'saveShowcase') {
      const items = Array.isArray(data.items) ? data.items.slice(0, 100) : []
      if (!items.length) return reply(400, { ok: false, error: 'NO_ITEMS' })
      const productsColl = db.collection('products')
      for (const it of items) {
        const id = String(it?.id || '')
        if (!id) continue
        await productsColl
          .doc(id)
          .update({ data: { sort: Number(it.sort) || 0, featured: !!it.featured } })
          .catch(() => {})
      }
      return reply(200, { ok: true })
    }

    // —— 二维码卡片 + 码批次（规格 §六/§七 步骤⑤⑥）——
    if (action === 'getSettings') {
      const got = await db.collection('adminConfig').doc('settings').get().catch(() => null)
      return reply(200, { ok: true, settings: got?.data || {} })
    }

    if (action === 'saveSettings') {
      const urlPrefix = String(data.urlPrefix || '').slice(0, 200)
      await ensure('adminConfig')
      const coll = db.collection('adminConfig')
      await coll
        .doc('settings')
        .set({ data: { urlPrefix, updatedAt: Date.now() } })
        .catch(async () => {
          await coll.add({ data: { _id: 'settings', urlPrefix, updatedAt: Date.now() } })
        })
      return reply(200, { ok: true })
    }

    if (action === 'getCard') {
      const productId = String(data.productId || '')
      if (!productId) return reply(400, { ok: false, error: 'NO_PRODUCT' })
      await ensure('cards')
      const got = await db.collection('cards').doc(`card-${productId}`).get().catch(() => null)
      let card = got?.data || null
      // 旧单面结构 → 双面结构（兼容已存草稿）
      if (card && !card.front) {
        card = {
          ...card,
          front: { art: card.art || '', bg: card.bgColor || '#f6e9b8', showBrand: true },
          back: {
            bg: '#ffffff',
            texts: { ...(card.texts || {}), warning: '提示：激活课程后，该商品将不再支持退货' },
            brandText: 'Lucky Ducky · 幸运小鸭',
          },
        }
      }
      let artUrl = ''
      const art = card?.front?.art
      if (art && art.startsWith('cloud://')) {
        const r = await cloud.getTempFileURL({ fileList: [art] })
        artUrl = r.fileList[0]?.tempFileURL || ''
      }
      return reply(200, { ok: true, card, artUrl })
    }

    if (action === 'saveCard') {
      const c = data.card
      if (!c || !c.productId) return reply(400, { ok: false, error: 'BAD_CARD' })
      const hex = (v, dft) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : dft)
      const doc = {
        productId: str(c.productId, 40),
        courseId: str(c.courseId, 40),
        name: str(c.name, 60),
        status: c.status === 'final' ? 'final' : 'draft',
        // 双面（规格 §六 修订：插画一面 + 二维码一面）
        front: {
          art: str(c.front?.art, 300),
          bg: hex(c.front?.bg, '#f6e9b8'),
          showBrand: c.front?.showBrand !== false,
        },
        back: {
          bg: hex(c.back?.bg, '#ffffff'),
          texts: {
            title: str(c.back?.texts?.title, 40),
            sub: str(c.back?.texts?.sub, 60),
            scanHint: str(c.back?.texts?.scanHint, 30),
            warning: str(c.back?.texts?.warning, 50),
          },
          brandText: str(c.back?.brandText, 30),
        },
        sizeMM: {
          w: Math.min(300, Math.max(40, Number(c.sizeMM?.w) || 90)),
          h: Math.min(300, Math.max(40, Number(c.sizeMM?.h) || 54)),
        },
        updatedAt: Date.now(),
      }
      await ensure('cards')
      const coll = db.collection('cards')
      const id = `card-${doc.productId}`
      await coll
        .doc(id)
        .set({ data: doc })
        .catch(async () => {
          await coll.add({ data: { ...doc, _id: id } })
        })
      return reply(200, { ok: true })
    }

    if (action === 'listBatches') {
      const courseId = String(data.courseId || '')
      if (!courseId) return reply(400, { ok: false, error: 'NO_COURSE_ID' })
      // 聚合各批次的码数与已激活数（单课批次有限，内存聚合足够）
      const res = await db.collection('qrcodes').where({ courseId }).limit(1000).get()
      const map = {}
      for (const q of res.data) {
        const b = (map[q.batchId] = map[q.batchId] || { batchId: q.batchId, total: 0, activated: 0, createdAt: q.createdAt || 0 })
        b.total++
        if (q.status === 'activated') b.activated++
      }
      const list = Object.values(map).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      return reply(200, { ok: true, list })
    }

    if (action === 'createBatch') {
      const courseId = String(data.courseId || '')
      const count = Math.min(500, Math.max(1, parseInt(data.count, 10) || 0))
      if (!courseId || !count) return reply(400, { ok: false, error: 'BAD_ARGS' })
      // 服务端互调 genQrcodes（无 OPENID 即管理通道，复用既有生成与唯一性逻辑）
      const r = await cloud.callFunction({ name: 'genQrcodes', data: { courseId, count } })
      if (!r.result?.ok) return reply(400, { ok: false, error: r.result?.error || 'GEN_FAIL' })
      return reply(200, { ok: true, batchId: r.result.batchId, codes: r.result.codes })
    }

    if (action === 'listBatchCodes') {
      const batchId = String(data.batchId || '')
      if (!batchId) return reply(400, { ok: false, error: 'NO_BATCH' })
      const res = await db.collection('qrcodes').where({ batchId }).limit(1000).get()
      return reply(200, { ok: true, codes: res.data.map((q) => q._id) })
    }

    // —— 首页内容（橱窗逐块接入②③：hero 文案 / 信任条 / FAQ；规格 §八）——
    if (action === 'getHomeContent') {
      const got = await db.collection('content').doc('home').get().catch(() => null)
      return reply(200, { ok: true, home: got?.data || null })
    }

    if (action === 'saveHomeContent') {
      const c = data.home || {}
      const doc = {
        hero: { title: str(c.hero?.title, 20), tagline: str(c.hero?.tagline, 40) },
        trust: (Array.isArray(c.trust) ? c.trust : [])
          .slice(0, 4)
          .map((t) => ({ icon: str(t?.icon, 20), label: str(t?.label, 12) })),
        faq: (Array.isArray(c.faq) ? c.faq : [])
          .slice(0, 8)
          .map((f) => ({ title: str(f?.title, 40), body: str(f?.body, 150) })),
        updatedAt: Date.now(),
      }
      await ensure('content')
      const coll = db.collection('content')
      await coll
        .doc('home')
        .set({ data: doc })
        .catch(async () => {
          await coll.add({ data: { ...doc, _id: 'home' } })
        })
      return reply(200, { ok: true })
    }

    // —— 订单发货（P5 后台完善：状态流转 paid → shipped；金额/条目/地址只读不动）——
    if (action === 'listOrders') {
      const res = await db.collection('orders').orderBy('createdAt', 'desc').limit(200).get()
      return reply(200, { ok: true, list: res.data })
    }

    if (action === 'shipOrder') {
      const id = String(data.id || '')
      const company = String(data.company || '').trim().slice(0, 30)
      const trackingNo = String(data.trackingNo || '').trim().slice(0, 40)
      if (!id || !company || !trackingNo) return reply(400, { ok: false, error: 'BAD_ARGS' })
      const got = await db.collection('orders').doc(id).get().catch(() => null)
      if (!got || !got.data) return reply(400, { ok: false, error: 'NO_ORDER' })
      const cur = got.data.status
      // paid = 首次发货；shipped = 改单号（错填补救）。其余状态不允许动。
      if (cur !== 'paid' && cur !== 'shipped') {
        return reply(400, { ok: false, error: 'BAD_STATUS:' + cur })
      }
      // 金额异常单（支付回调 feeMismatch 留痕）须先在控制台「解除」后才能发货（审核批次A 折中方案）
      if (got.data.feeMismatch) return reply(400, { ok: false, error: 'FEE_MISMATCH_HOLD' })
      // 条件更新（审核批次A-6）：仍是 paid/shipped 才写——防与确认收货并发交错把 done 回滚成 shipped
      const upd = await db
        .collection('orders')
        .where({ _id: id, status: db.command.in(['paid', 'shipped']) })
        .update({
          data: {
            status: 'shipped',
            shipping: { company, trackingNo },
            shippedAt: got.data.shippedAt || Date.now(),
          },
        })
      if (!upd.stats || upd.stats.updated !== 1) {
        const fresh = await db.collection('orders').doc(id).get().catch(() => null)
        return reply(400, { ok: false, error: 'BAD_STATUS:' + ((fresh && fresh.data && fresh.data.status) || 'unknown') })
      }
      return reply(200, { ok: true })
    }

    // —— 售后退款（P4 Batch 2，链10：审核 + 触发退款工作流；金额在申请时已云端分摊算定）——
    if (action === 'listRefunds') {
      await ensure('afterSales')
      const res = await db.collection('afterSales').orderBy('appliedAt', 'desc').limit(200).get()
      return reply(200, { ok: true, list: res.data })
    }

    if (action === 'approveRefund') {
      const id = String(data.id || '')
      if (!id) return reply(400, { ok: false, error: 'BAD_ARGS' })
      const got = await db.collection('afterSales').doc(id).get().catch(() => null)
      if (!got || !got.data) return reply(400, { ok: false, error: 'NO_RECORD' })
      if (got.data.status !== 'applied') return reply(400, { ok: false, error: 'BAD_STATUS:' + got.data.status })

      const cfg = await db.collection('config').doc('pay').get().catch(() => null)
      const flowId = cfg && cfg.data && cfg.data.refundFlowId
      if (!flowId) return reply(400, { ok: false, error: 'REFUND_FLOW_NOT_CONFIGURED' })
      const order = await db.collection('orders').doc(got.data.orderId).get().catch(() => null)
      if (!order || !order.data) return reply(400, { ok: false, error: 'NO_ORDER' })

      // 原子抢占（审核批次A-2）：仍是 applied 才置 approved——双窗口/重复请求并发时只有
      // 一个请求能抢到，杜绝重复触发外部退款；工作流触发失败则回滚 applied 可重试。
      const grab = await db
        .collection('afterSales')
        .where({ _id: id, status: 'applied' })
        .update({ data: { status: 'approved', approvedAt: Date.now() } })
      if (!grab.stats || grab.stats.updated !== 1) {
        return reply(400, { ok: false, error: 'BAD_STATUS:concurrent' })
      }

      // 触发退款工作流：refund=售后单分摊额（申请时云端算定），total=订单实付，金额不收前端
      const res = await cloud
        .callFunction({
          name: 'cloudbase_module',
          data: {
            name: String(flowId),
            data: {
              out_trade_no: got.data.orderId,
              out_refund_no: id,
              reason: String(got.data.reason || '用户申请退款').slice(0, 80),
              amount: {
                refund: Math.round(got.data.refundAmount * 100),
                total: Math.round(order.data.amount * 100),
                currency: 'CNY',
              },
            },
          },
        })
        .catch((err) => {
          console.error('approveRefund 工作流调用异常', id, err && err.message)
          return null
        })
      const r = res && res.result && res.result.data
      if (!r || !(r.status || r.refund_id || r.out_refund_no)) {
        console.error('approveRefund 工作流未受理', id, res && JSON.stringify(res.result).slice(0, 300))
        // 回滚抢占，允许人工重试（审核批次A-2）
        await db.collection('afterSales').doc(id).update({ data: { status: 'applied' } }).catch(() => {})
        return reply(500, { ok: false, error: 'REFUND_TRIGGER_FAIL' })
      }
      return reply(200, { ok: true })
    }

    // 金额异常单人工复核解除（审核批次A 折中方案：feeMismatch 单禁发货，核实流水后在此解除）
    if (action === 'clearFeeMismatch') {
      const id = String(data.id || '')
      if (!id) return reply(400, { ok: false, error: 'BAD_ARGS' })
      const got = await db.collection('orders').doc(id).get().catch(() => null)
      if (!got || !got.data) return reply(400, { ok: false, error: 'NO_ORDER' })
      await db
        .collection('orders')
        .doc(id)
        .update({ data: { feeMismatch: false, feeMismatchClearedAt: Date.now() } })
      return reply(200, { ok: true })
    }

    if (action === 'rejectRefund') {
      const id = String(data.id || '')
      const reason = String(data.reason || '').trim().slice(0, 100)
      if (!id || !reason) return reply(400, { ok: false, error: 'BAD_ARGS' })
      const got = await db.collection('afterSales').doc(id).get().catch(() => null)
      if (!got || !got.data) return reply(400, { ok: false, error: 'NO_RECORD' })
      if (got.data.status !== 'applied') return reply(400, { ok: false, error: 'BAD_STATUS:' + got.data.status })
      await db
        .collection('afterSales')
        .doc(id)
        .update({ data: { status: 'rejected', rejectedAt: Date.now(), rejectReason: reason } })
      return reply(200, { ok: true })
    }

    // —— 数据看板（规格 §八 路线收官；小规模内存聚合，≤1000 条/表）——
    if (action === 'getDashboard') {
      const take = (coll, field) =>
        db.collection(coll).field(field).limit(1000).get().then((r) => r.data).catch(() => [])
      const [users, orders, codes, progress, courses] = await Promise.all([
        take('users', { _id: true }),
        take('orders', { amount: true, status: true, createdAt: true, id: true, items: true }),
        take('qrcodes', { status: true, courseId: true }),
        take('progress', { done: true, last: true, courseId: true }),
        take('courses', { id: true, title: true, chapters: true }),
      ])

      // segment id → 可读名（课程/课时/段名）
      const segName = {}
      for (const c of courses)
        for (const ch of c.chapters || [])
          for (const l of ch.lessons || [])
            for (const sg of l.segments || []) segName[sg.id] = `${l.name} · ${sg.name}`

      // 热点（看完次数最多的段）与卡点（最后停留次数最多的段）
      const doneCount = {}
      const stuckCount = {}
      let learners = 0
      for (const pr of progress) {
        learners++
        for (const k of Object.keys(pr.done || {})) doneCount[k] = (doneCount[k] || 0) + 1
        if (pr.last?.segmentId) stuckCount[pr.last.segmentId] = (stuckCount[pr.last.segmentId] || 0) + 1
      }
      const top = (m) =>
        Object.entries(m)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([segId, count]) => ({ segId, name: segName[segId] || segId, count }))

      const gmv = orders.reduce((n, o) => n + (Number(o.amount) || 0), 0)
      const activated = codes.filter((q) => q.status === 'activated').length
      const recentOrders = orders
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 5)
        .map((o) => ({
          id: o.id,
          amount: o.amount,
          createdAt: o.createdAt,
          summary: (o.items || []).map((it) => `${it.name}×${it.qty}`).join('、').slice(0, 40),
        }))

      return reply(200, {
        ok: true,
        stats: {
          users: users.length,
          orders: orders.length,
          gmv,
          codesTotal: codes.length,
          codesActivated: activated,
          learners,
        },
        hot: top(doneCount),
        stuck: top(stuckCount),
        recentOrders,
      })
    }

    return reply(400, { ok: false, error: 'UNKNOWN_ACTION' })
  } catch (e) {
    console.error('adminApi error', action, e)
    return reply(500, { ok: false, error: 'SERVER_ERROR' })
  }
}
