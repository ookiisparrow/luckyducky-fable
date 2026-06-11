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
    status: p.status === 'onsale' ? 'onsale' : 'preparing',
    createdAt: Number(p.createdAt) || Date.now(),
    updatedAt: Date.now(),
  }
}

// base64 → 云存储 products/<pid>/，返回 fileID + 临时展示 URL
async function storeImage(b64, data) {
  const ext = data.ext === 'png' ? 'png' : 'jpg'
  const pid = String(data.pid || 'misc').slice(0, 40)
  const cloudPath = `products/${pid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
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
      if (!id || !(total > 0) || total > 40) return reply(400, { ok: false, error: 'BAD_FINISH' })
      const chunksColl = db.collection('uploadChunks')
      // limit(100) 覆盖 total ≤ 40；按 seq 拼回完整 base64
      const got = await chunksColl.where({ uploadId: id }).limit(100).get()
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

    return reply(400, { ok: false, error: 'UNKNOWN_ACTION' })
  } catch (e) {
    console.error('adminApi error', action, e)
    return reply(500, { ok: false, error: 'SERVER_ERROR' })
  }
}
