// 内存版 wx-server-sdk（测试桩）。经 package.json 的 file: 依赖装入 node_modules，
// 云函数 require('wx-server-sdk') 与测试 require 都命中这里。
//
// 状态挂在 globalThis.__cloudMock 上：即便 vitest 给测试与云函数各发一份模块实例，
// 也读写同一份内存库（绕过「双实例不共享」的坑）。
//
// 只实现云函数实际用到的 API（逐函数核对）。语义对齐真 sdk 关键处：
//   - doc(id).get() 缺失即 reject（源码大量 .catch(()=>null) 依赖此）；
//   - where(...).update() 返回 { stats:{updated} }（activateCourse 一码一用抢占）；
//   - add({data:{_id}}) 撞已存在 _id 抛错（genQrcodes/submitReview 库级唯一约束）。

const G = (globalThis.__cloudMock = globalThis.__cloudMock || {
  store: {},
  openid: 'openid-default',
  cloudPayCalls: [],
  cloudPayFail: false,
  callFunctionCalls: [],
  callFunctionResult: null,
  callFunctionFail: false,
  openapiCalls: [],
  openapiResult: null,
  openapiFail: false,
  openapiErrCode: null,
  deletedFiles: [],
  tempUrlCalls: [],
})

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

const command = {
  in: (val) => ({ __op: 'in', val }),
  neq: (val) => ({ __op: 'neq', val }),
  lt: (val) => ({ __op: 'lt', val }),
  gt: (val) => ({ __op: 'gt', val }), // 大于（承面C 坐席台 cursor 增量：listQueue FIFO / getThread 轮询取新消息）
  exists: (val) => ({ __op: 'exists', val }), // 字段存在/缺失（CAS 初始化窗口前置条件，债#21）
  aggregate: { sum: (expr) => ({ __aggOp: 'sum', expr }) }, // 聚合算子（GMV 求和·债#18续）
}

function matchOne(docVal, cond) {
  if (cond && typeof cond === 'object' && cond.__op) {
    if (cond.__op === 'in') return Array.isArray(cond.val) && cond.val.includes(docVal)
    if (cond.__op === 'neq') return docVal !== cond.val
    if (cond.__op === 'lt') return docVal < cond.val
    if (cond.__op === 'gt') return docVal > cond.val
    if (cond.__op === 'exists') return cond.val ? docVal !== undefined : docVal === undefined
    return false
  }
  return docVal === cond
}
function matchDoc(doc, filter) {
  if (!filter) return true
  return Object.keys(filter).every((k) => matchOne(doc[k], filter[k]))
}

// 点路径 / 普通字段写入：'done.segId' → doc.done.segId
function applyPatch(doc, data) {
  for (const [k, v] of Object.entries(data)) {
    if (k.includes('.')) {
      const parts = k.split('.')
      let cur = doc
      for (let i = 0; i < parts.length - 1; i++) {
        if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] == null) cur[parts[i]] = {}
        cur = cur[parts[i]]
      }
      cur[parts[parts.length - 1]] = v
    } else {
      doc[k] = v
    }
  }
}

const genId = () => 'mock_' + Math.random().toString(36).slice(2, 12)
const rows = (name) => (G.store[name] = G.store[name] || [])

class DocRef {
  constructor(coll, id) {
    this.coll = coll
    this.id = id
  }
  async get() {
    const found = rows(this.coll).find((d) => d._id === this.id)
    if (!found) throw new Error('DOCUMENT_NOT_FOUND') // 真 sdk：缺失即 reject
    return { data: clone(found) }
  }
  async set({ data }) {
    // 真 sdk：doc().set({data}) 的 data 不得含 _id（_id 由 doc(id) 指定），含则 reject。
    // 桩对齐此约束——否则「get().data(含_id) 原样 set 回」的 bug 在桩里假绿、真机 500（根因#8·saveSettings 实测踩中）。
    if (data && Object.prototype.hasOwnProperty.call(data, '_id'))
      throw new Error('INVALID_PARAM: set data 不能含 _id（真 sdk 约束）')
    const arr = rows(this.coll)
    const i = arr.findIndex((d) => d._id === this.id)
    const doc = { ...clone(data), _id: this.id }
    if (i >= 0) arr[i] = doc
    else arr.push(doc)
    return { _id: this.id }
  }
  async update({ data }) {
    // 写前注入（测试并发：读-改-写窗口里让「并发方」先落库·同 setCallFunctionImpl 范式）。默认无。
    if (typeof G.beforeUpdate === 'function') await G.beforeUpdate({ coll: this.coll, data })
    const found = rows(this.coll).find((d) => d._id === this.id)
    if (!found) return { stats: { updated: 0 } }
    applyPatch(found, clone(data))
    return { stats: { updated: 1 } }
  }
  async remove() {
    const arr = rows(this.coll)
    const i = arr.findIndex((d) => d._id === this.id)
    if (i >= 0) arr.splice(i, 1)
    return { stats: { removed: i >= 0 ? 1 : 0 } }
  }
}

class Query {
  constructor(coll) {
    this.coll = coll
    this._filter = null
    this._order = null
    this._limit = null
    this._skip = null
  }
  where(cond) {
    this._filter = cond
    return this
  }
  orderBy(field, dir = 'asc') {
    this._order = { field, dir }
    return this
  }
  limit(n) {
    this._limit = n
    return this
  }
  skip(n) {
    this._skip = n
    return this
  }
  field() {
    return this // 投影在测试里忽略
  }
  doc(id) {
    return new DocRef(this.coll, id)
  }
  _rows() {
    let out = rows(this.coll).filter((d) => matchDoc(d, this._filter))
    if (this._order) {
      const { field, dir } = this._order
      out = [...out].sort((a, b) => {
        const av = a[field],
          bv = b[field]
        const c = av < bv ? -1 : av > bv ? 1 : 0
        return dir === 'desc' ? -c : c
      })
    }
    if (this._skip != null) out = out.slice(this._skip)
    out = out.slice(0, this._limit != null ? this._limit : 100) // 对齐真 SDK：服务端裸 .get() 默认 100 条封顶（根因#8 桩≠真藏无界读）
    return out
  }
  async get() {
    return { data: this._rows().map(clone) }
  }
  async count() {
    return { total: rows(this.coll).filter((d) => matchDoc(d, this._filter)).length }
  }
  async update({ data }) {
    // 写前注入（测试并发：条件更新 where 求值前让「并发方」先改库·验 CAS 真在咬）。默认无。
    if (typeof G.beforeUpdate === 'function') await G.beforeUpdate({ coll: this.coll, data })
    const hit = this._rows()
    hit.forEach((d) => applyPatch(d, clone(data)))
    return { stats: { updated: hit.length } }
  }
  async remove() {
    const arr = rows(this.coll)
    const before = arr.length
    G.store[this.coll] = arr.filter((d) => !matchDoc(d, this._filter))
    return { stats: { removed: before - G.store[this.coll].length } }
  }
  async add({ data }) {
    const arr = rows(this.coll)
    const doc = clone(data)
    if (doc._id != null) {
      if (arr.some((d) => d._id === doc._id)) throw new Error('DUPLICATE_ID') // 库级唯一约束
    } else {
      doc._id = genId()
    }
    arr.push(doc)
    return { _id: doc._id }
  }
  aggregate() {
    return new Aggregate(this.coll)
  }
}

// 聚合管线（最小实现·债#18续 + SCM 产销统计续）：支持 .match(filter).group({_id, key:$.sum('$field')}).end()。
// _id 为 '$field' 时真按该字段值分桶（真实 wx-server-sdk 语义）；_id:null 仍是单桶（GMV/评分求和等既有用法不变）。
class Aggregate {
  constructor(coll) {
    this.coll = coll
    this._match = null
    this._group = null
  }
  match(filter) {
    this._match = filter
    return this
  }
  group(spec) {
    this._group = spec
    return this
  }
  async end() {
    const docs = rows(this.coll).filter((d) => matchDoc(d, this._match))
    if (!this._group) return { list: docs.map(clone) }
    const idExpr = this._group._id
    const keyOf = (d) => (typeof idExpr === 'string' && idExpr.startsWith('$') ? d[idExpr.slice(1)] : idExpr ?? null)
    const buckets = new Map() // 分桶键需 JSON 化（对象/undefined 也能落桶），值存 {_id, docs}
    for (const d of docs) {
      const key = keyOf(d)
      const bk = JSON.stringify(key)
      if (!buckets.has(bk)) buckets.set(bk, { _id: key, docs: [] })
      buckets.get(bk).docs.push(d)
    }
    const list = [...buckets.values()].map((b) => {
      const out = { _id: b._id }
      for (const [k, v] of Object.entries(this._group)) {
        if (k === '_id') continue
        if (v && v.__aggOp === 'sum') {
          const f = String(v.expr).replace(/^\$/, '')
          out[k] = b.docs.reduce((n, d) => n + (Number(d[f]) || 0), 0)
        }
      }
      return out
    })
    return { list }
  }
}

const db = {
  collection: (name) => new Query(name),
  command,
  serverDate: () => new Date(),
  createCollection: async () => {
    /* 集合按需自建，空操作 */
  },
}

const cloud = {
  init: () => {},
  DYNAMIC_CURRENT_ENV: 'test-env',
  database: () => db,
  getWXContext: () => ({ OPENID: G.openid, UNIONID: G.unionid, APPID: 'test-appid', ENV: 'test-env' }),
  // 服务端互调 mock（pay → 支付工作流 cloudbase_module 用）：记录入参、可配置返回/失败
  callFunction: async (params) => {
    G.callFunctionCalls.push(JSON.parse(JSON.stringify(params)))
    // 注入钩子（测试并发：可在「调用进行中」改库，模拟回调抢先翻状态）。默认无。
    if (typeof G.callFunctionImpl === 'function') await G.callFunctionImpl(params)
    if (G.callFunctionFail) throw new Error('CALL_FUNCTION_FAIL')
    return JSON.parse(JSON.stringify(G.callFunctionResult != null ? G.callFunctionResult : { result: {} }))
  },
  // 云调用支付 mock：记录调用入参；cloudPayFail 时模拟下单失败（pay 测试用）
  cloudPay: {
    unifiedOrder: async (params) => {
      G.cloudPayCalls.push(JSON.parse(JSON.stringify(params)))
      if (G.cloudPayFail) return { returnCode: 'FAIL', returnMsg: 'mock fail' }
      return {
        returnCode: 'SUCCESS',
        resultCode: 'SUCCESS',
        payment: {
          appId: 'test-appid',
          timeStamp: '1718000000',
          nonceStr: 'mock-nonce',
          package: 'prepay_id=mock',
          signType: 'MD5',
          paySign: 'mock-sign',
        },
      }
    },
  },
  uploadFile: async ({ cloudPath, fileContent }) => {
    // 记录上传字节数，供「真实尺寸」测试断言分片重组无截断（根因#8）
    G.lastUpload = { cloudPath, bytes: fileContent ? fileContent.length : 0 }
    return { fileID: 'cloud://test/' + cloudPath }
  },
  getTempFileURL: async ({ fileList }) => {
    // 记录每次调用的批大小：真 sdk 单次 fileList 上限 50，getTempUrls 分批逻辑靠此断言（桩对齐真 SDK）
    G.tempUrlCalls.push((fileList || []).length)
    if ((fileList || []).length > 50) throw new Error('MOCK: getTempFileURL fileList 超 50 上限（真 sdk 会拒）')
    return { fileList: fileList.map((id) => ({ fileID: id, tempFileURL: 'https://tmp/' + id })) }
  },
  // 删云存储文件（孤儿视频 GC 用）：记录删除的 fileID，返回真 sdk 形状 { fileList:[{fileID,status:0}] }
  deleteFile: async ({ fileList }) => {
    G.deletedFiles.push(...(fileList || []))
    return { fileList: (fileList || []).map((id) => ({ fileID: id, status: 0 })) }
  },
  // 下载云存储文件 mock（kit/contentsec imgSecCheck 取图字节走它）：返回固定小 buffer；内容安全的
  // 通过/违规分支由 openapi mock（setOpenapiFail/Result）驱动（真 sdk 下载属根因#8 靠人·桩只锁链路）。
  downloadFile: async ({ fileList }) => ({
    fileList: (fileList || []).map((id) => ({ fileID: id, fileContent: Buffer.from('mock-image-bytes') })),
  }),
  // 云调用 mock（cloud.openapi.*·债#26 发货上传走它）：嵌套属性任意命中、调用记录入参，
  // openapiFail 时抛错（模拟能力未开通/权限未声明）、否则返 openapiResult（默认 errCode:0 成功）。
  // 真 sdk openapi 绑定名 + config.json 权限属真机验（根因#8），桩只锁「接缝被调 + 成功/失败分支」。
  openapi: (() => {
    const node = () =>
      new Proxy(function () {}, {
        get: () => node(),
        apply: async (_f, _t, args) => {
          G.openapiCalls.push(JSON.parse(JSON.stringify((args && args[0]) || {})))
          if (G.openapiFail) {
            const e = new Error('OPENAPI_FAIL')
            e.errCode = G.openapiErrCode != null ? G.openapiErrCode : -1
            throw e
          }
          return JSON.parse(JSON.stringify(G.openapiResult != null ? G.openapiResult : { errCode: 0 }))
        },
      })
    return node()
  })(),
}

// 测试控制面：reset/seed/setOpenId/dump，全部操作 globalThis 上的同一份状态
const control = {
  reset() {
    for (const k of Object.keys(G.store)) delete G.store[k]
    G.openid = 'openid-default'
    G.unionid = ''
    G.cloudPayCalls = []
    G.cloudPayFail = false
    G.callFunctionCalls = []
    G.callFunctionResult = null
    G.callFunctionFail = false
    G.callFunctionImpl = null
    G.lastUpload = null
    G.openapiCalls = []
    G.openapiResult = null
    G.openapiFail = false
    G.openapiErrCode = null
    G.beforeUpdate = null
    G.deletedFiles = []
    G.tempUrlCalls = []
  },
  seed(coll, docs) {
    G.store[coll] = (G.store[coll] || []).concat(JSON.parse(JSON.stringify(docs)))
  },
  setOpenId(id) {
    G.openid = id
  },
  setUnionId(id) {
    G.unionid = id
  },
  dump(coll) {
    return JSON.parse(JSON.stringify(G.store[coll] || []))
  },
  lastUpload() {
    return G.lastUpload ? { ...G.lastUpload } : null
  },
  cloudPayCalls() {
    return JSON.parse(JSON.stringify(G.cloudPayCalls))
  },
  setCloudPayFail(v) {
    G.cloudPayFail = !!v
  },
  callFunctionCalls() {
    return JSON.parse(JSON.stringify(G.callFunctionCalls))
  },
  setCallFunctionResult(v) {
    G.callFunctionResult = v
  },
  // 注入「调用进行中」副作用（测试并发：如 callFlow 期间退款回调抢先翻 refunded）
  setCallFunctionImpl(fn) {
    G.callFunctionImpl = fn
  },
  // 注入「写库前」副作用（测试并发：读-改-写/条件更新窗口里模拟并发方抢先改库·验 CAS/moved 校验真在咬）
  setBeforeUpdate(fn) {
    G.beforeUpdate = fn
  },
  setCallFunctionFail(v) {
    G.callFunctionFail = !!v
  },
  // 云调用 mock 控制（债#26 发货上传）
  openapiCalls() {
    return JSON.parse(JSON.stringify(G.openapiCalls))
  },
  setOpenapiResult(v) {
    G.openapiResult = v
  },
  setOpenapiFail(v, errCode) {
    G.openapiFail = !!v
    G.openapiErrCode = errCode != null ? errCode : null
  },
  // 孤儿视频 GC 断言用：deleteFile 删过哪些 fileID / getTempFileURL 每次批大小（分批 ≤50 断言）
  deletedFiles() {
    return [...G.deletedFiles]
  },
  tempUrlCalls() {
    return [...G.tempUrlCalls]
  },
}

module.exports = cloud
module.exports.control = control
