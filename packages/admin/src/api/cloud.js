/**
 * 云适配层（业务代码不直接碰后端，换后端只改这里）。双模式：
 *
 * - 云模式（生产）：admin/.env.local 配 VITE_ADMIN_API=https://<env>.service.tcloudbase.com/adminapi
 *   → 经 HTTP 访问服务调云函数 adminApi（管理口令校验，sha256 入库；首次登录即设置口令）。
 *   商品草稿存云端 productsDraft，图片传云存储（fileID 与小程序同一环境）。
 * - 本地模式（演示/无网开发）：不配 VITE_ADMIN_API 时数据存 localStorage、图片压成 dataURL。
 *
 * 规格：docs/设计规格-管理控制台.md §三/§七（登录方案 v1 = HTTP 服务 + 管理口令，
 * CloudBase Web SDK 账号体系留作升级）。
 */

const API_BASE = import.meta.env.VITE_ADMIN_API || ''
export const cloudMode = !!API_BASE

const AUTH_KEY = 'ld_admin_auth'
const DATA_KEY = 'ld_admin_products'

// ---------- 会话 ----------

export function isLoggedIn() {
  return !!localStorage.getItem(AUTH_KEY)
}
export function currentUser() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY))?.username || ''
  } catch {
    return ''
  }
}
export function logout() {
  localStorage.removeItem(AUTH_KEY)
}
function session() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY)) || {}
  } catch {
    return {}
  }
}

async function post(action, data = {}) {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, key: session().key || '', data }),
  })
  const r = await res.json()
  // 网关层错误（如请求体超限）没有 ok 字段，转成可读错误抛出
  if (r.ok === undefined && r.code) throw new Error(`网关拒绝（${r.code}）`)
  return r
}

export async function login(username, password) {
  if (!username || !password) return { ok: false, error: '请输入账号与密码' }
  if (!cloudMode) {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ username, at: Date.now() }))
    return { ok: true }
  }
  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', key: password }),
    })
    const r = await res.json()
    if (!r.ok) {
      const msg = { KEY_TOO_SHORT: '口令至少 6 位', BAD_KEY: '口令不正确' }[r.error] || '登录失败'
      return { ok: false, error: msg }
    }
    // 口令留在本机用于后续请求签发（单管理员 v1；升级账号体系后移除）
    localStorage.setItem(AUTH_KEY, JSON.stringify({ username, key: password, at: Date.now() }))
    return { ok: true, bootstrapped: r.bootstrapped }
  } catch {
    return { ok: false, error: '连不上服务，请检查网络' }
  }
}

// ---------- 商品草稿 ----------

function localList() {
  try {
    const list = JSON.parse(localStorage.getItem(DATA_KEY))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}
function localSave(list) {
  localStorage.setItem(DATA_KEY, JSON.stringify(list))
}

// 返回 { list, urls, listed }：urls 为 fileID → 可显示 URL 的映射（本地模式恒为空，dataURL 直接可显）；
// listed 为 productId → 是否在售（S11·债#12 软下架显形，本地模式恒为空）。
export async function loadProducts() {
  if (!cloudMode) return { list: localList(), urls: {}, listed: {} }
  const r = await post('listDrafts')
  if (!r.ok) throw new Error(r.error || 'LOAD_FAIL')
  return { list: r.list, urls: r.urls || {}, listed: r.listed || {} }
}

export async function saveProduct(product) {
  if (!cloudMode) {
    const list = localList()
    const i = list.findIndex((p) => p.id === product.id)
    if (i >= 0) list[i] = product
    else list.unshift(product)
    localSave(list)
    return true
  }
  const r = await post('saveDraft', { product })
  return !!r.ok
}

export async function deleteProduct(id) {
  if (!cloudMode) {
    localSave(localList().filter((p) => p.id !== id))
    return true
  }
  const r = await post('deleteDraft', { id })
  return !!r.ok
}

// ---------- 图片 ----------

// 压缩重绘：本地模式压小（≤480，省 localStorage）；云模式保细节（≤1280）再上传
function resize(file, max, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

// 返回 { ref, url }：ref 入库（云模式为 fileID，本地为 dataURL），url 用于立即展示。
// HTTP 访问服务请求体上限约 100KB（调试日志 F）：小图单发，大图切 ~80K 字符分片逐个发、
// 云端拼回后入云存储。
const CHUNK = 80_000

export async function uploadImage(file, pid) {
  if (!cloudMode) {
    const dataURL = await resize(file, 480, 0.82)
    return { ref: dataURL, url: dataURL }
  }
  const dataURL = await resize(file, 1280, 0.85)
  const b64 = dataURL.split(',')[1]

  let r
  if (b64.length <= CHUNK) {
    r = await post('uploadImage', { b64, ext: 'jpg', pid })
  } else {
    const uploadId = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const total = Math.ceil(b64.length / CHUNK)
    for (let i = 0; i < total; i++) {
      const cr = await post('uploadChunk', {
        uploadId,
        seq: i,
        b64: b64.slice(i * CHUNK, (i + 1) * CHUNK),
      })
      if (!cr.ok) throw new Error(cr.error || `分片 ${i + 1}/${total} 上传失败`)
    }
    r = await post('uploadFinish', { uploadId, total, ext: 'jpg', pid })
  }
  if (!r.ok) throw new Error(r.error || 'UPLOAD_FAIL')
  return { ref: r.fileID, url: r.url }
}

// ---------- 课程草稿（步骤④ 视频编排；仅云模式） ----------

export async function getCourseDraft(courseId) {
  const r = await post('getCourseDraft', { courseId })
  if (!r.ok) throw new Error(r.error || 'LOAD_COURSE_FAIL')
  return r.course // null = 还没有草稿
}

export async function saveCourseDraft(course) {
  const r = await post('saveCourseDraft', { course })
  return !!r.ok
}

export async function publishCourse(courseId) {
  const r = await post('publishCourse', { courseId })
  if (!r.ok) throw new Error(r.error || 'PUBLISH_FAIL')
  return true
}

// ---------- 视频上传 ----------

// getUploadMetadata 签发的凭证只认「POST 表单上传」（微信云开发 HTTP API 约定：
// key/Signature/x-cos-security-token/x-cos-meta-fileid + file），签名含请求方法，
// 改用 PUT 会被云存储以 403 拒绝（调试日志 G）。
function postFormWithProgress(url, fields, file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.append(k, v)
    fd.append('file', file)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    if (xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total)
      }
    }
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error('直传失败 HTTP ' + xhr.status)))
    xhr.onerror = () => reject(new Error('直传网络错误'))
    xhr.send(fd)
  })
}

function fileToB64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result).split(',')[1])
    fr.onerror = () => reject(new Error('文件读取失败'))
    fr.readAsDataURL(file)
  })
}

// 上传分段视频（≤10MB 约定）。主路径：云端签凭证 → 浏览器 PUT 直传云存储（秒级）；
// 凭证不可用时自动回落分片通道（~80KB/片，10MB 约 1 分钟）。返回 { ref }（fileID）。
export async function uploadVideo(file, courseId, segName, onProgress) {
  if (!cloudMode) throw new Error('视频上传需云端模式（配置 VITE_ADMIN_API）')
  if (file.size > 15 * 1024 * 1024) throw new Error('单个视频请控制在 10MB 左右（当前超过 15MB）')
  const ext = /\.mov$/i.test(file.name) ? 'mov' : 'mp4'

  const meta = await post('getVideoUploadMeta', { courseId, name: segName, ext })
  if (meta.ok) {
    try {
      // 表单 key = 对象路径，从 fileId（cloud://<env>.<bucket>/<路径>）截取
      const key = String(meta.fileId).replace(/^cloud:\/\/[^/]+\//, '')
      await postFormWithProgress(
        meta.url,
        {
          key,
          Signature: meta.authorization,
          'x-cos-security-token': meta.token,
          'x-cos-meta-fileid': meta.cosFileId,
        },
        file,
        onProgress,
      )
      return { ref: meta.fileId }
    } catch (e) {
      // 直传失败不终止：回落分片通道（慢但可达），原因留控制台便于排查
      console.warn('[uploadVideo] 直传失败，回落分片通道：', e.message)
    }
  }

  // 回落：分片 base64（与图片同通道，kind=video 落 videos/ 前缀）
  const b64 = await fileToB64(file)
  const uploadId = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const total = Math.ceil(b64.length / CHUNK)
  for (let i = 0; i < total; i++) {
    const cr = await post('uploadChunk', {
      uploadId,
      seq: i,
      b64: b64.slice(i * CHUNK, (i + 1) * CHUNK),
    })
    if (!cr.ok) throw new Error(cr.error || `分片 ${i + 1}/${total} 上传失败`)
    if (onProgress) onProgress((i + 1) / total)
  }
  const r = await post('uploadFinish', { uploadId, total, ext, pid: courseId, kind: 'video' })
  if (!r.ok) throw new Error(r.error || 'UPLOAD_FAIL')
  return { ref: r.fileID }
}

// 上架小程序：商品草稿发布到 products（首页/详情即刻可见）
export async function publishProduct(id) {
  const r = await post('publishProduct', { id })
  if (!r.ok) {
    const msg =
      { NEED_COVER: '请先在第 1 步上传封面图', NEED_INFO: '请先在第 2 步填好名称和价格', NEED_SKUS: '请先在第 3 步配置规格' }[
        r.error
      ] || r.error || '上架失败'
    throw new Error(msg)
  }
  return true
}

// 停售（软下架·债#12）：商品从顾客端列表消失（详情直达/历史订单不受影响），可恢复
export async function unpublishProduct(id) {
  const r = await post('unpublishProduct', { id })
  if (!r.ok) throw new Error(r.error || '停售失败')
  return true
}

// 恢复销售（债#12）
export async function republishProduct(id) {
  const r = await post('republishProduct', { id })
  if (!r.ok) throw new Error(r.error || '恢复销售失败')
  return true
}

// ---------- 小程序橱窗（规格 §八：排序 + 上下架） ----------

export async function listShowcase() {
  const r = await post('listShowcase')
  if (!r.ok) throw new Error(r.error || 'LOAD_SHOWCASE_FAIL')
  return { list: r.list, urls: r.urls || {} }
}

export async function saveShowcase(items) {
  const r = await post('saveShowcase', { items })
  return !!r.ok
}

// ---------- 二维码卡片 + 码批次（步骤⑤⑥） ----------

export async function getCard(productId) {
  const r = await post('getCard', { productId })
  if (!r.ok) throw new Error(r.error || 'LOAD_CARD_FAIL')
  return { card: r.card, artUrl: r.artUrl }
}

export async function saveCard(card) {
  const r = await post('saveCard', { card })
  return !!r.ok
}

export async function listBatches(courseId) {
  const r = await post('listBatches', { courseId })
  if (!r.ok) throw new Error(r.error || 'LOAD_BATCH_FAIL')
  return r.list
}

export async function createBatch(courseId, count) {
  const r = await post('createBatch', { courseId, count })
  if (!r.ok) throw new Error(r.error || 'GEN_FAIL')
  return r // { batchId, codes }
}

export async function listBatchCodes(batchId) {
  const r = await post('listBatchCodes', { batchId })
  if (!r.ok) throw new Error(r.error || 'LOAD_CODES_FAIL')
  return r.codes
}

export async function getSettings() {
  const r = await post('getSettings')
  return r.settings || {}
}

export async function saveSettings(settings) {
  const r = await post('saveSettings', settings)
  return !!r.ok
}

// ---------- 库存（库存#1·下单即预留·乐观 CAS；写库存收口云端 kit/inventory） ----------

export async function listInventory(productIds) {
  if (!cloudMode) return [] // 库存只存在于云端
  const r = await post('listInventory', productIds && productIds.length ? { productIds } : {})
  if (!r.ok) throw new Error(r.error || 'LOAD_INVENTORY_FAIL')
  return r.list || []
}

// stock：number≥0 或 null（不限量）；threshold 低库存阈值（可选）
// expectedUpdatedAt：加载时该 SKU 的 updatedAt，回传给云端 CAS——库存自加载已被并发预留/他人改动则冲突（外审 P1.8）
export async function saveStock(productId, spec, stock, threshold, expectedUpdatedAt) {
  const r = await post('saveStock', { productId, spec, stock, threshold, expectedUpdatedAt })
  if (!r.ok)
    throw new Error(
      r.error === 'BAD_STOCK'
        ? '库存须为非负整数或留空（不限量）'
        : r.error === 'STOCK_CONFLICT'
          ? '库存已变动（可能刚有下单预留），请刷新后重试'
          : r.error || 'SAVE_STOCK_FAIL'
    )
  return true
}

// ---------- 首页内容（橱窗逐块接入：hero 文案 / 信任条 / FAQ） ----------

export async function getHomeContent() {
  const r = await post('getHomeContent')
  if (!r.ok) throw new Error(r.error || 'LOAD_CONTENT_FAIL')
  return r.home // null = 还没编辑过（小程序用默认文案）
}

export async function saveHomeContent(home) {
  const r = await post('saveHomeContent', { home })
  return !!r.ok
}

// ---------- 求助面板「辅助视频」（全局共用·所有课程同一份；小程序播放页求助→「遇到问题了」） ----------

export async function listHelpVideos() {
  const r = await post('listHelpVideos')
  if (!r.ok) throw new Error(r.error || 'LOAD_HELP_FAIL')
  return r.items || []
}

export async function saveHelpVideos(items) {
  const r = await post('saveHelpVideos', { items })
  return !!r.ok
}

// ---------- 订单发货（P5 后台完善：paid → shipped，物流公司 + 运单号） ----------

// 游标分页（根因#7）：cursor 传上一页 nextCursor；status 服务端筛选、q 按单号搜索（都在云端做、
// 不靠已加载页过滤——防分页后漏单/计数失真）。返回 { list, nextCursor, hasMore }。
export async function listOrders({ cursor, status, q } = {}) {
  if (!cloudMode) return { list: [], nextCursor: null, hasMore: false } // 订单只存在于云端
  const payload = {}
  if (cursor != null) payload.cursor = cursor
  if (status && status !== 'all') payload.status = status
  if (q) payload.q = q
  const r = await post('listOrders', payload)
  if (!r.ok) throw new Error(r.error || 'LOAD_ORDERS_FAIL')
  return { list: r.list, nextCursor: r.nextCursor ?? null, hasMore: !!r.hasMore }
}

// 按状态服务端精确计数（标签计数单源·根因#7）：{ all, pending, paid, shipped, done, closed }
export async function orderCounts() {
  if (!cloudMode) return {}
  const r = await post('orderCounts')
  if (!r.ok) throw new Error(r.error || 'LOAD_COUNTS_FAIL')
  return r.counts || {}
}

// 订单详情补充（VMlhp）：逐商品激活码状态（{ productId: {courseId,activated,entered,code} }）
export async function getOrderDetail(id) {
  const r = await post('getOrderDetail', { id })
  if (!r.ok) throw new Error(r.error || 'LOAD_ORDER_DETAIL_FAIL')
  return r.activations || {}
}

export async function shipOrder(id, company, trackingNo) {
  const r = await post('shipOrder', { id, company, trackingNo })
  if (!r.ok) throw new Error(r.error || 'SHIP_FAIL')
  return true
}

// 批量发货（P1）：items=[{id,trackingNo,company?}]，company=整批共用快递公司；返回 { okCount, failCount, results }
export async function shipOrders(items, company) {
  const r = await post('shipOrders', { items, company })
  if (!r.ok) throw new Error(r.error || 'SHIP_BATCH_FAIL')
  return r
}

// 金额异常单解除（feeMismatch 复核通过后允许发货）
export async function clearFeeMismatch(id) {
  const r = await post('clearFeeMismatch', { id })
  if (!r.ok) throw new Error(r.error || 'CLEAR_FAIL')
  return true
}

// ---------- 售后退款（链10：审核 + 触发退款工作流；金额申请时已云端算定） ----------

// 游标分页（根因#7）：status 服务端筛选、q 按订单号搜索（都在云端做·不靠已加载页过滤）。
export async function listRefunds({ cursor, status, q } = {}) {
  if (!cloudMode) return { list: [], nextCursor: null, hasMore: false } // 售后单只存在于云端
  const payload = {}
  if (cursor != null) payload.cursor = cursor
  if (status && status !== 'all') payload.status = status
  if (q) payload.q = q
  const r = await post('listRefunds', payload)
  if (!r.ok) throw new Error(r.error || 'LOAD_REFUNDS_FAIL')
  return { list: r.list, nextCursor: r.nextCursor ?? null, hasMore: !!r.hasMore }
}

// 按状态服务端精确计数（标签计数单源·根因#7）：{ all, applied, approved, refunded, rejected }
export async function refundCounts() {
  if (!cloudMode) return {}
  const r = await post('refundCounts')
  if (!r.ok) throw new Error(r.error || 'LOAD_REFUND_COUNTS_FAIL')
  return r.counts || {}
}

// 退款决策判据（激活码状态数据链）：买家是否已激活/已进课该课程，供审核员判断退货权
export async function getRefundDetail(id) {
  const r = await post('getRefundDetail', { id })
  if (!r.ok) throw new Error(r.error || 'LOAD_DETAIL_FAIL')
  return r.activation || {}
}

export async function approveRefund(id) {
  const r = await post('approveRefund', { id })
  if (!r.ok) throw new Error(r.error || 'APPROVE_FAIL')
  return true
}

export async function rejectRefund(id, reason) {
  const r = await post('rejectRefund', { id, reason })
  if (!r.ok) throw new Error(r.error || 'REJECT_FAIL')
  return true
}

// ---------- 数据看板 ----------

export async function getDashboard() {
  const r = await post('getDashboard')
  if (!r.ok) throw new Error(r.error || 'LOAD_DASHBOARD_FAIL')
  return r
}

// ---------- 财务对账（S16·内部账：收支汇总 + 每日流水 + 内部异常） ----------

// from/to 为 'YYYY-MM-DD'（不传则后端默认近 30 天）。返回 { range, cumulative, summary, daily, approx, exceptions }。
export async function getReconciliation({ from, to } = {}) {
  if (!cloudMode) return null // 财务数据只存在于云端
  const payload = {}
  if (from) payload.from = from
  if (to) payload.to = to
  const r = await post('getReconciliation', payload)
  if (!r.ok) throw new Error(r.error || 'LOAD_RECONCILIATION_FAIL')
  return r
}

// 外部对账（S16·Batch 2/3）：拉一天微信交易账单落 wxBills。返回 { date, count }。
// 失败（缺凭证/微信错误）抛出含微信错误码的 error 供 UI 显示诊断。
export async function downloadBill(date) {
  if (!cloudMode) return null
  const r = await post('downloadBill', { date })
  if (!r.ok) throw new Error(r.error || 'DOWNLOAD_BILL_FAIL')
  return r
}

// 逐笔对账：我方付款单 ⋈ wxBills → { summary, discrepancies, billDays }。
export async function getBillMatch({ from, to } = {}) {
  if (!cloudMode) return null
  const payload = {}
  if (from) payload.from = from
  if (to) payload.to = to
  const r = await post('getBillMatch', payload)
  if (!r.ok) throw new Error(r.error || 'BILL_MATCH_FAIL')
  return r
}
