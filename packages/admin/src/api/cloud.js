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
// 登录回包的能力位（RBAC·与后端 ACTION_CAPS 同源）：侧边栏/路由按此隐藏无权面（后端仍 fail-closed 兜底）
export function currentCaps() {
  try {
    const c = JSON.parse(localStorage.getItem(AUTH_KEY))?.caps
    return Array.isArray(c) ? c : []
  } catch {
    return []
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
      const msg = { KEY_TOO_SHORT: '口令至少 6 位', BAD_KEY: '口令不正确', ACCOUNT_DISABLED: '账号已停用' }[r.error] || '登录失败'
      return { ok: false, error: msg }
    }
    // 只存服务端签发的会话令牌（深审 P1·守卫 admin-session-token-not-password）：口令原文不落 localStorage
    // ——口令是可复用主凭证，落盘即被同源脚本/共用机器读走；令牌 12h 自灭、停号即拒。无令牌＝后端过旧，拒登。
    if (!r.sessionToken) return { ok: false, error: '后端未签发会话令牌（版本过旧），请先部署 adminApi' }
    localStorage.setItem(
      AUTH_KEY,
      JSON.stringify({ username, key: r.sessionToken, caps: r.caps || [], operator: r.operator || username, at: Date.now() })
    )
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

// ---------- 进销存 SCM（SCM-0 地基·物料/供应商主档 + 期初盘点/调整·蓝图 docs/进销存ERP/） ----------

export async function listMaterials() {
  if (!cloudMode) return []
  const r = await post('listMaterials')
  if (!r.ok) throw new Error(r.error || 'LOAD_MATERIALS_FAIL')
  return r.list || []
}

const SCM_ERR = {
  UOM_LOCKED: '计量方式建档后不可改（改了会两种单位混账）',
  KNOT_ONLY_L: '带结形态只有最大团有（业务定稿）',
  BAD_UOM: '计量方式只能选 按件 或 按克',
  BAD_COLOR: '颜色请用小写英文（如 red / light-blue）',
  BAD_SLUG: '料号名请用小写英文（如 marker / eyes）',
  NO_REASON: '请填写调整原因（留痕审计用）',
  BAD_DELTA: '数量必须是非零整数（克/件全链整数）',
  INSUFFICIENT: '库存不够扣（余额不允许为负）',
  NO_MATERIAL: '料号不存在，请先建档',
}
const scmErr = (e) => new Error(SCM_ERR[e] || e || 'SCM_FAIL')

export async function saveMaterial(payload) {
  const r = await post('saveMaterial', payload)
  if (!r.ok) throw scmErr(r.error)
  return r.materialId
}

export async function listSuppliers() {
  if (!cloudMode) return []
  const r = await post('listSuppliers')
  if (!r.ok) throw new Error(r.error || 'LOAD_SUPPLIERS_FAIL')
  return r.list || []
}

export async function saveSupplier(payload) {
  const r = await post('saveSupplier', payload)
  if (!r.ok) throw scmErr(r.error)
  return r.supplierId
}

// 期初盘点/人工调整：delta ± 非零整数（克或件·随主档计量）；adjustId 每次提交生成一次、重试复用＝幂等
export async function adjustMaterialStock(materialId, delta, reason, adjustId) {
  const r = await post('adjustStock', { materialId, delta, reason, adjustId })
  if (!r.ok) throw scmErr(r.error)
  return r
}

export async function listLedger(materialId, limit) {
  const r = await post('listLedger', { materialId, limit })
  if (!r.ok) throw new Error(r.error || 'LOAD_LEDGER_FAIL')
  return r.list || []
}

// —— 采购线（进销存车道 A·蓝图 docs/进销存ERP/ §4）——
// 错误映射独立成块（不改上方共享 SCM_ERR 行·车道文件级隔离·master 整合取并集）；金额传输/存储全是分。

const PURCHASE_ERR = {
  BAD_SUPPLIER: '供应商不存在或不是厂家（织女外协走外协单）',
  BAD_LINES: '至少要有一行、且每行选好物料（单张上限 50 行）',
  BAD_QTY: '数量必须是正整数（克/件全链整数）',
  BAD_PRICE: '单价必须是非负金额（分整数）',
  DUP_LINE: '同一物料只能一行（同料合并数量后再提交）',
  NO_PURCHASE: '采购单不存在',
  NOT_DRAFT: '只有草稿单可以修改（已下单/入库/取消的单不可改）',
  BAD_STATUS: '当前状态不允许该操作（入库后不可取消，走「调整」入账）',
  STOCK_APPLY_FAIL: '入库记账失败，请查流水后用「调整」补账',
}
const purchaseErr = (e) => new Error(PURCHASE_ERR[e] || SCM_ERR[e] || e || 'SCM_FAIL')

export async function listPurchases(status, limit) {
  if (!cloudMode) return []
  const r = await post('listPurchases', { status, limit })
  if (!r.ok) throw new Error(r.error || 'LOAD_PURCHASES_FAIL')
  return r.list || []
}

// payload：{ purchaseId?, supplierId, lines:[{materialId,qty,unitPriceFen}] }；totalFen 云端算、不传也不信
export async function savePurchase(payload) {
  const r = await post('savePurchase', payload)
  if (!r.ok) throw purchaseErr(r.error)
  return r // { purchaseId, totalFen }
}

export async function markPurchaseOrdered(purchaseId) {
  const r = await post('markOrdered', { purchaseId })
  if (!r.ok) throw purchaseErr(r.error)
  return r
}

export async function receivePurchase(purchaseId) {
  const r = await post('receivePurchase', { purchaseId })
  if (!r.ok) throw purchaseErr(r.error)
  return r // { moved, applied? }
}

export async function cancelPurchase(purchaseId) {
  const r = await post('cancelPurchase', { purchaseId })
  if (!r.ok) throw purchaseErr(r.error)
  return r
}

// ---------- 进销存车道 B·外协加工（发最大团原团→收带结→计件工钱·蓝图 docs/进销存ERP/ §4B） ----------

const OUTWORK_ERR = {
  NO_WORKER: '请先在「物料与供应商」建织女档（类型选织女）',
  NOT_OUTWORKER: '发料对象必须是织女档（厂家走采购线）',
  BAD_LINES: '发料/收货行不完整：每行要有料号和正整数团数、料号不重复',
  BAD_QTY: '数量必须是正整数（按团计）',
  BAD_RATE: '计件单价必须是非负整数分（页面按元填、自动转分）',
  ISSUE_L_RAW_ONLY: '发出的只能是最大团·原团（业务定稿：起手结只做在最大团上）',
  RECEIVE_L_KNOTTED_ONLY: '收回的只能是最大团·带结',
  COLOR_NOT_ISSUED: '这个颜色本单没发过料，收不了',
  RECEIVE_EXCEEDS_ISSUE: '收回数不能超过发出数（防收比发多）',
  NO_OUTWORK: '外协单不存在',
  NOT_DRAFT: '只有草稿单能改/发料/取消（已发料的异常走物料页调整单）',
  NOT_ISSUED: '只有已发料的单能收货（可能已收过）',
  NOT_DELIVERED: '只有已收货的单能结算（可能已结清）',
}
const outworkErr = (e, hint) => new Error(hint || OUTWORK_ERR[e] || SCM_ERR[e] || e || 'OUTWORK_FAIL')

export async function listOutworks(filter) {
  if (!cloudMode) return []
  const r = await post('listOutworks', filter || {})
  if (!r.ok) throw new Error(r.error || 'LOAD_OUTWORKS_FAIL')
  return r.list || []
}

// payload：{ outworkId?, workerId, issueLines:[{materialId,qty}], pieceRateFen }（金额整数分·元转分在调用侧一次）
export async function saveOutwork(payload) {
  const r = await post('saveOutwork', payload)
  if (!r.ok) throw outworkErr(r.error)
  return r.outworkId
}

export async function issueOutwork(outworkId) {
  const r = await post('issueOutwork', { outworkId })
  if (!r.ok) throw outworkErr(r.error === 'INSUFFICIENT' ? 'INSUFFICIENT' : r.error)
  return r
}

// receiveLines：[{materialId:'yarn:<color>:L:knotted', qty}]；返 { payableFen, lossQty }
export async function receiveOutwork(outworkId, receiveLines) {
  const r = await post('receiveOutwork', { outworkId, receiveLines })
  if (!r.ok) throw outworkErr(r.error, r.hint)
  return r
}

export async function settleOutwork(outworkId) {
  const r = await post('settleOutwork', { outworkId })
  if (!r.ok) throw outworkErr(r.error)
  return r
}

export async function cancelOutwork(outworkId) {
  const r = await post('cancelOutwork', { outworkId })
  if (!r.ok) throw outworkErr(r.error)
  return r
}

// ---------- 进销存车道 C·配方组装（全局一张模板+每产品差异位→打包执行·蓝图 docs/进销存ERP/ §4C） ----------
// 错误映射独立成块（车道文件级隔离·master 整合取并集）；组装执行 assemblyId 每次提交生成一次、重试复用＝幂等。

const BOM_ERR = {
  BAD_TEMPLATE: '模板不合法：每行选好料号、数量为正整数；带结槽只能配在大团',
  NO_PRODUCT: '请选产品',
  BAD_COLOR: '三档颜色都要填（小写英文，如 red / light-blue）',
  NO_SPECIFIC: '专属包装和专属卡片料号都要选（先在物料页建档）',
  NO_TEMPLATE: '还没保存全局配方模板——先去「配方模板」页配一张',
  NO_PROFILE: '这个产品还没填差异位（三档颜色+专属包装/卡片）',
  BAD_SETS: '套数必须是正整数',
  DUPLICATE: '这单已经执行过了（重复提交被幂等挡下）',
  PRODUCE_FAIL: '原料已扣但成品入账遇到争用：去物料页查流水核对，勿直接重试',
}
const bomErr = (e) => new Error(BOM_ERR[e] || SCM_ERR[e] || e || 'SCM_FAIL')

export async function getBomSetup() {
  if (!cloudMode) return { template: null, profiles: [] }
  const r = await post('getBomSetup')
  if (!r.ok) throw new Error(r.error || 'LOAD_BOM_FAIL')
  return { template: r.template, profiles: r.profiles || [] }
}

// template：{ commonLines:[{materialId,qtyPerSet}], yarnSlots:[{tier,form,qtyPerSet}] }（数值全是正整数）
export async function saveBomTemplate(template) {
  const r = await post('saveBomTemplate', { template })
  if (!r.ok) throw bomErr(r.error)
  return true
}

// profile：{ productId, yarnColors:{L,M,S}, packagingMaterialId, cardMaterialId }
export async function saveBomProfile(profile) {
  const r = await post('saveBomProfile', { profile })
  if (!r.ok) throw bomErr(r.error)
  return r.productId
}

export async function previewAssembly(productId, sets) {
  const r = await post('previewAssembly', { productId, sets })
  if (!r.ok) throw bomErr(r.error)
  return r.lines || []
}

export async function runAssembly(assemblyId, productId, spec, sets) {
  const r = await post('runAssembly', { assemblyId, productId, spec, sets })
  if (!r.ok) {
    const err = bomErr(r.error)
    err.materialId = r.materialId // INSUFFICIENT 时带短缺料号，页面标红
    throw err
  }
  return r
}

export async function listAssemblies(limit) {
  if (!cloudMode) return []
  const r = await post('listAssemblies', limit ? { limit } : {})
  if (!r.ok) throw new Error(r.error || 'LOAD_ASSEMBLIES_FAIL')
  return r.list || []
}

// ---------- 进销存车道 D·备货计算器（只读·目标套数→外协/采购缺口·蓝图 docs/进销存ERP/ §4D） ----------

// targets：[{productId, sets}]；返 { outworkGaps, purchaseGroups, missingMaterials }
export async function getRestockPlan(targets) {
  const r = await post('getRestockPlan', { targets })
  if (!r.ok) {
    const PLANNER_ERR = { BAD_TARGETS: '每行都要选产品、套数为正整数（最多 50 行）' }
    const err = new Error(PLANNER_ERR[r.error] || BOM_ERR[r.error] || r.error || 'PLAN_FAIL')
    err.productId = r.productId // NO_PROFILE 时带产品·页面点名
    throw err
  }
  return r
}

// 产销统计（同车道 D·只读）：stockLedger fg 流水按产品汇总，返 { packed, shipped }（各为 [{productId,spec,qty}]）
export async function getFgSummary() {
  if (!cloudMode) return { packed: [], shipped: [] }
  const r = await post('getFgSummary', {})
  if (!r.ok) throw new Error(r.error || 'FG_SUMMARY_FAIL')
  return { packed: r.packed || [], shipped: r.shipped || [] }
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

// ---------- 节点诊断（后台360工作站 B2.2·关键节点 + 挽回办法策展；学员节点拍照 + 坐席 360 看轨迹） ----------

export async function listCheckpoints(courseId) {
  const r = await post('listCheckpoints', courseId ? { courseId } : {})
  if (!r.ok) throw new Error(r.error || 'LOAD_CHECKPOINTS_FAIL')
  return r.list || []
}

export async function saveCheckpoints(courseId, nodes) {
  const r = await post('saveCheckpoints', { courseId, nodes })
  return !!r.ok
}

// ---------- 知识库（后台360工作站 B4.1·FAQ/知识条目维护；客服 bot 与坐席共用同一份答案·整体覆盖式保存） ----------

export async function listKb() {
  const r = await post('listKb')
  if (!r.ok) throw new Error(r.error || 'LOAD_KB_FAIL')
  return r.list || []
}

export async function saveKb(entries) {
  const r = await post('saveKb', { entries })
  return !!r.ok
}

// ---------- 客服满意度报表（后台360工作站 B4.3·只读·均分/分布） ----------

export async function getCsatReport() {
  const r = await post('getCsatReport')
  if (!r.ok) throw new Error(r.error || 'LOAD_CSAT_FAIL')
  return r // { total, avg, dist, withNote, approx }
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

// ---------- 客户360（后台360工作站·只读·越权面经 customer:view 闸 + 审计留痕） ----------

// 检索客户（B1.2）：按 openid/手机/订单号/昵称命中，返 [{openid,nickname,phone,avatar,createdAt,matchedBy}]。
export async function searchCustomer(q) {
  if (!cloudMode) return [] // 客户数据只存在于云端
  const r = await post('searchCustomer', { q })
  if (!r.ok) throw new Error(r.error || 'SEARCH_FAIL')
  return r.customers || []
}

// 客户360 全貌（B1.1/1.3）：返 { openid, panels:[{key,label,order,data,error?}] }——
// 通用渲染由页面遍历 panels（铁律三 admin 同构·后端给什么面板渲什么·不硬编码面板类型）。
export async function getCustomer360(openid) {
  const r = await post('getCustomer360', { openid })
  if (!r.ok) throw new Error(r.error || 'LOAD_360_FAIL')
  return { openid: r.openid, panels: r.panels || [] }
}

// 单客户画像（B1.2）：返回白名单 user（身份头·nickname/avatar/phone/bio）；无档回 null。
export async function getUser(openid) {
  const r = await post('getUser', { openid })
  if (!r.ok) throw new Error(r.error || 'LOAD_USER_FAIL')
  return r.user // 可能为 null
}

// ---------- 客服会话（后台360工作站 B5.1·检索归档会话·外包管控底座·只读·越权读经 customer:view 闸 + 留痕） ----------

// 检索会话（按客户 openid/externalUserId + 渠道 + keyword·cursor 分页 bounded）。返回 { messages, count, nextCursor, hasMore }。
export async function searchConversations({ openid, externalUserId, channel, keyword, cursor, limit } = {}) {
  if (!cloudMode) return { messages: [], count: 0, nextCursor: null, hasMore: false } // 会话只存在于云端
  const payload = {}
  if (openid) payload.openid = openid
  if (externalUserId) payload.externalUserId = externalUserId
  if (channel) payload.channel = channel
  if (keyword) payload.keyword = keyword
  if (cursor != null) payload.cursor = cursor
  if (limit != null) payload.limit = limit
  const r = await post('searchConversations', payload)
  if (!r.ok) throw new Error(r.error || 'SEARCH_CONVERSATIONS_FAIL')
  return { messages: r.messages || [], count: r.count || 0, nextCursor: r.nextCursor ?? null, hasMore: !!r.hasMore }
}

// 客服质检报表（B5.3·会话量/首次响应时长/SLA 达标/答复率·bounded 聚合）。返回 { sampleSize, approx, slaMs, volume, response, sla }。
export async function conversationsReport({ slaMs, channel } = {}) {
  if (!cloudMode) return null // 报表只存在于云端
  const payload = {}
  if (slaMs != null) payload.slaMs = slaMs
  if (channel) payload.channel = channel
  const r = await post('conversationsReport', payload)
  if (!r.ok) throw new Error(r.error || 'CONVERSATIONS_REPORT_FAIL')
  return r
}

// ---------- 外包账号管理（后台360工作站 B5.2·承面C 车道 C·商户超管建/停/列外包坐席账号·adminConfig 多账号） ----------

// 列外包账号（白名单·不含口令）：[{ id, name, role, disabled, createdAt }]。
export async function listAgents() {
  if (!cloudMode) return [] // 账号只存在于云端
  const r = await post('listAgents')
  if (!r.ok) throw new Error(r.error || 'LOAD_AGENTS_FAIL')
  return r.agents || []
}

// 建外包账号：name（显示名）+ key（登录口令·≥6 位·不入明文·撞既有口令拒）+ wecomUserId?（企微 userid·可空·免登用）。
// 返回 { id, name, role, disabled, wecomUserId }。
export async function createAgent(name, key, wecomUserId = '') {
  const r = await post('createAgent', { name, key, wecomUserId })
  if (!r.ok) {
    const msg =
      {
        BAD_NAME: '请填写账号名称',
        KEY_TOO_SHORT: '登录口令至少 6 位',
        KEY_TAKEN: '该口令已被占用，请换一个',
        WECOM_ID_TAKEN: '该企微 userid 已绑定其他账号',
      }[r.error] ||
      r.error ||
      '创建失败'
    throw new Error(msg)
  }
  return r.agent
}

// 回填/改绑企微 userid（免登用·M⑦）：空串=解绑。唯一性冲突 WECOM_ID_TAKEN。
export async function setAgentWecomUserId(id, wecomUserId) {
  const r = await post('setAgentWecomUserId', { id, wecomUserId })
  if (!r.ok) {
    const msg =
      { AGENT_NOT_FOUND: '账号不存在', WECOM_ID_TAKEN: '该企微 userid 已绑定其他账号', BAD_ID: '账号 ID 无效' }[r.error] ||
      r.error ||
      '操作失败'
    throw new Error(msg)
  }
  return r.wecomUserId
}

// 停用 / 恢复外包账号：disabled=true 停（该账号即刻无法登录）·false 恢复。
export async function setAgentDisabled(id, disabled) {
  const r = await post('disableAgent', { id, disabled })
  if (!r.ok) throw new Error(r.error === 'AGENT_NOT_FOUND' ? '账号不存在' : r.error || '操作失败')
  return true
}
