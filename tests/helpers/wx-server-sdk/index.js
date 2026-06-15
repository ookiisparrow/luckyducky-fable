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
})

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

const command = {
  in: (val) => ({ __op: 'in', val }),
  neq: (val) => ({ __op: 'neq', val }),
  lt: (val) => ({ __op: 'lt', val }),
  exists: (val) => ({ __op: 'exists', val }), // 字段存在/缺失（CAS 初始化窗口前置条件，债#21）
  aggregate: { sum: (expr) => ({ __aggOp: 'sum', expr }) }, // 聚合算子（GMV 求和·债#18续）
}

function matchOne(docVal, cond) {
  if (cond && typeof cond === 'object' && cond.__op) {
    if (cond.__op === 'in') return Array.isArray(cond.val) && cond.val.includes(docVal)
    if (cond.__op === 'neq') return docVal !== cond.val
    if (cond.__op === 'lt') return docVal < cond.val
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
    const arr = rows(this.coll)
    const i = arr.findIndex((d) => d._id === this.id)
    const doc = { ...clone(data), _id: this.id }
    if (i >= 0) arr[i] = doc
    else arr.push(doc)
    return { _id: this.id }
  }
  async update({ data }) {
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
    if (this._limit != null) out = out.slice(0, this._limit)
    return out
  }
  async get() {
    return { data: this._rows().map(clone) }
  }
  async count() {
    return { total: rows(this.coll).filter((d) => matchDoc(d, this._filter)).length }
  }
  async update({ data }) {
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

// 聚合管线（最小实现·债#18续）：支持 .match(filter).group({_id, key:$.sum('$field')}).end()。
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
    const out = { _id: this._group._id ?? null }
    for (const [k, v] of Object.entries(this._group)) {
      if (k === '_id') continue
      if (v && v.__aggOp === 'sum') {
        const f = String(v.expr).replace(/^\$/, '')
        out[k] = docs.reduce((n, d) => n + (Number(d[f]) || 0), 0)
      }
    }
    return { list: [out] }
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
  getWXContext: () => ({ OPENID: G.openid, APPID: 'test-appid', ENV: 'test-env' }),
  // 服务端互调 mock（pay → 支付工作流 cloudbase_module 用）：记录入参、可配置返回/失败
  callFunction: async (params) => {
    G.callFunctionCalls.push(JSON.parse(JSON.stringify(params)))
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
  getTempFileURL: async ({ fileList }) => ({
    fileList: fileList.map((id) => ({ fileID: id, tempFileURL: 'https://tmp/' + id })),
  }),
}

// 测试控制面：reset/seed/setOpenId/dump，全部操作 globalThis 上的同一份状态
const control = {
  reset() {
    for (const k of Object.keys(G.store)) delete G.store[k]
    G.openid = 'openid-default'
    G.cloudPayCalls = []
    G.cloudPayFail = false
    G.callFunctionCalls = []
    G.callFunctionResult = null
    G.callFunctionFail = false
    G.lastUpload = null
  },
  seed(coll, docs) {
    G.store[coll] = (G.store[coll] || []).concat(JSON.parse(JSON.stringify(docs)))
  },
  setOpenId(id) {
    G.openid = id
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
  setCallFunctionFail(v) {
    G.callFunctionFail = !!v
  },
}

module.exports = cloud
module.exports.control = control
