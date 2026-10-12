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
// 不模拟事务：云函数没有用 runTransaction/startTransaction 的地方。

const G = (globalThis.__cloudMock = globalThis.__cloudMock || {
  store: {},
  openid: 'openid-default',
  callFunctionCalls: [],
  callFunctionResult: null,
  openapiCalls: [],
  openapiResult: null,
  openapiFail: false,
  openapiErrCode: null,
  deletedFiles: [],
  tempUrlCalls: [],
})

// JSON 往返保留真云序列化语义（undefined 键被丢等），但 Date 要原样存取：真云存的是日期类型，不是 ISO 串
function tagDate(k, x) {
  return this[k] instanceof Date ? { __mockDate: this[k].getTime() } : x
}
const clone = (v) =>
  v === undefined
    ? undefined
    : JSON.parse(JSON.stringify(v, tagDate), (k, x) =>
        x && typeof x === 'object' && '__mockDate' in x ? new Date(x.__mockDate) : x
      )
// 真云服务端 get()/聚合单次最多取 1000 条
const MAX_LIMIT = 1000

const command = {
  in: (val) => ({ __op: 'in', val }),
  neq: (val) => ({ __op: 'neq', val }),
  lt: (val) => ({ __op: 'lt', val }),
  gt: (val) => ({ __op: 'gt', val }), // 大于（坐席台 cursor 增量：listQueue FIFO / getThread 轮询取新消息）
  gte: (val) => ({ __op: 'gte', val }), // 大于等于（库存原子扣减：扣的那一刻库存仍够才扣）
  exists: (val) => ({ __op: 'exists', val }), // 字段存在/缺失（CAS 初始化窗口前置条件）
  inc: (val) => ({ __op: 'inc', val }), // 原子自增（recordAnomaly 去重计数·真 sdk 服务端原子加，避免读-改-写并发窗）
  aggregate: { sum: (expr) => ({ __aggOp: 'sum', expr }) }, // 聚合算子（GMV 求和）
  // 字段级删除（真 sdk 标准写路径算子，对齐 MongoDB $unset·与下方注释警告的「未验证查询组合子」范畴不同——
  // 这是常规写操作，非查询条件组合）：patch 成 `null` ≠ 字段不存在——CAS 条件 `_.exists(false)` 只认「字段
  // 真缺失」，值为 null 仍算「存在」（例：csSession 重开清质检标记若 patch 成 null，saveQcMark/
  // listQcSampled 的 exists(false) 永远判定「已评过」，质检评分永久 409）。真删字段才是正确表达「清空」的写法。
  remove: () => ({ __op: 'remove' }),
  // 注：pageQuery 复合游标 tiebreaker **不用** _.and()/_.or()——这会是全仓
  // 首次用该组合、只被本桩验证过、从未打过真实云数据库；改用桩里已验证过的单字段 lt/eq 拆两条查询
  // 内存合并（见 kit/paging.ts 注释），因此这里刻意不补 and/or 语义，避免留一套没有生产用途、也没有
  // 真机验证过的桩能力躺在这里给后人误当「已验证」参照抄用。
}

// 写入一个叶子值：inc 算子作原子自增（对齐真 sdk _.inc）；remove 算子真删该键（对齐真 sdk _.remove()·
// $unset 语义——不是赋 undefined/null，是键从对象上消失，配合 exists(false) 才能判「真缺失」）；否则直接赋值。
function writeLeaf(obj, key, v) {
  if (v && typeof v === 'object' && v.__op === 'inc') obj[key] = (Number(obj[key]) || 0) + v.val
  else if (v && typeof v === 'object' && v.__op === 'remove') delete obj[key]
  else obj[key] = v
}

function matchOne(docVal, cond) {
  if (cond && typeof cond === 'object' && cond.__op) {
    if (cond.__op === 'in') return Array.isArray(cond.val) && cond.val.includes(docVal)
    if (cond.__op === 'neq') return docVal !== cond.val
    // 同真库只在同类型间比大小：null/缺字段不参与（JS 的 null >= 0 为真），Date 字段也不和数字比（JS 会把 Date 转数字）
    if (cond.__op === 'lt') return typeof docVal === typeof cond.val && docVal < cond.val
    if (cond.__op === 'gt') return typeof docVal === typeof cond.val && docVal > cond.val
    if (cond.__op === 'gte') return typeof docVal === typeof cond.val && docVal >= cond.val
    if (cond.__op === 'exists') return cond.val ? docVal !== undefined : docVal === undefined
    throw new Error('MOCK: 桩不支持查询操作符 ' + cond.__op) // 静默当「不匹配」会让用错操作符的查询在测试里假绿
  }
  return docVal === cond
}
// 值为 undefined 的条件键不参与匹配：真 sdk（@cloudbase/database 序列化条件时）把它丢掉，等于没这个条件，
// 不是「字段缺失」——当成缺失会让漏了版本号的 CAS 在测试里照样咬住、真云却无条件写
function matchDoc(doc, filter) {
  if (!filter) return true
  return Object.keys(filter).every((k) => filter[k] === undefined || matchOne(doc[k], filter[k]))
}

// 真 sdk update 先把嵌套普通对象拍平成点路径、逐叶 $set：嵌套对象是合并不是整体替换，空对象整键丢掉；
// 数组、Date、算子是叶子（整体写）。要整体替换得用 set 算子，桩没实现，生产也没用
const isPlainObj = (v) => Object.prototype.toString.call(v) === '[object Object]' && !v.__op
function flatten(data, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(data)) {
    if (isPlainObj(v)) flatten(v, prefix + k + '.', out)
    else out[prefix + k] = v
  }
  return out
}

// 点路径 / 普通字段写入：'done.segId' → doc.done.segId。返回文档是否真变了：
// 真云 stats.updated 数的是改动了的文档，内容没变回 0（user.ts upsertUser 注释记着真机这样）
function applyPatch(doc, data) {
  const before = JSON.stringify(doc, tagDate)
  for (const [k, v] of Object.entries(flatten(data))) {
    if (k.includes('.')) {
      const parts = k.split('.')
      let cur = doc
      for (let i = 0; i < parts.length - 1; i++) {
        if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] == null) cur[parts[i]] = {}
        cur = cur[parts[i]]
      }
      writeLeaf(cur, parts[parts.length - 1], v)
    } else {
      writeLeaf(doc, k, v)
    }
  }
  return JSON.stringify(doc, tagDate) !== before
}

const genId = () => 'mock_' + Math.random().toString(36).slice(2, 12)
const rows = (name) => (G.store[name] = G.store[name] || [])
// 集合存在性（根因#8·真机 sdk：未 createCollection 的集合 add/update 抛错；桩默认自动建掩过·control.markUncreated 逼真机行为）
const uncreated = () => (G.uncreated = G.uncreated || new Set())
const ensureColl = (coll) => {
  if (uncreated().has(coll)) throw new Error('DATABASE_COLLECTION_NOT_EXIST:' + coll)
}

class DocRef {
  constructor(coll, id) {
    this.coll = coll
    this.id = id
  }
  async get() {
    // 写前注入同款读侧钩子（casDecrement 瞬时读故障测试用）：可对 doc(id).get() 单点注入抛错
    // （非「无档」的真读失败，如网络/DB 瞬时故障），与下方「无档」reject 区分——回调收到 {coll,id}
    // （Query.get() 的 beforeGet 收到 {coll,filter,skip,limit}，字段不同，测试按需解构，互不干扰）。默认无。
    if (typeof G.beforeGet === 'function') await G.beforeGet({ coll: this.coll, id: this.id })
    const found = rows(this.coll).find((d) => d._id === this.id)
    if (!found) throw new Error('DOCUMENT_NOT_FOUND') // 真 sdk：缺失即 reject
    return { data: clone(found) }
  }
  async set({ data }) {
    // 真 sdk：doc().set({data}) 的 data 不得含 _id（_id 由 doc(id) 指定），含则 reject。
    // 桩对齐此约束——否则「get().data(含_id) 原样 set 回」的 bug 在桩里假绿、真机 500（根因#8·saveSettings 实测踩中）。
    if (data && Object.prototype.hasOwnProperty.call(data, '_id'))
      throw new Error('INVALID_PARAM: set data 不能含 _id（真 sdk 约束）')
    // 写前注入（测试并发：doc().set() 是 createAgent 等「先查后写」路径的落库点，复用 update 同一钩子名）。默认无。
    if (typeof G.beforeUpdate === 'function') await G.beforeUpdate({ coll: this.coll, data, id: this.id })
    const arr = rows(this.coll)
    const i = arr.findIndex((d) => d._id === this.id)
    const doc = { ...clone(data), _id: this.id }
    if (i >= 0) arr[i] = doc
    else arr.push(doc)
    return { _id: this.id }
  }
  async update({ data }) {
    ensureColl(this.coll)
    // 写前注入（测试并发：读-改-写窗口里让「并发方」先落库·同 setCallFunctionImpl 范式）。默认无。
    if (typeof G.beforeUpdate === 'function') await G.beforeUpdate({ coll: this.coll, data })
    const found = rows(this.coll).find((d) => d._id === this.id)
    if (!found) return { stats: { updated: 0 } }
    return { stats: { updated: applyPatch(found, clone(data)) ? 1 : 0 } }
  }
  async remove() {
    // 删前注入（测试：删失败不得被装成已删除）。回调收到 {coll,id}；Query.remove() 收到 {coll,filter}。默认无。
    if (typeof G.beforeRemove === 'function') await G.beforeRemove({ coll: this.coll, id: this.id })
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
    // 真 sdk where() 同步校验：必须是普通对象；有键但值全是 undefined 直接抛
    if (Object.prototype.toString.call(cond) !== '[object Object]') throw new Error('查询参数必须为对象')
    const keys = Object.keys(cond)
    if (keys.length && keys.every((k) => cond[k] === undefined)) throw new Error('查询参数对象值不能均为undefined')
    this._filter = cond
    return this
  }
  orderBy(field, dir = 'asc') {
    // 链式多列排序（pageQuery 复合游标 tiebreaker）：累积多次 .orderBy() 调用，
    // 先到先比、平局看下一列——单次调用行为不变。
    this._order = this._order || []
    this._order.push({ field, dir })
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
  field(proj) {
    if (Object.values(proj).some((v) => v !== true)) throw new Error('MOCK: field() 只实现了包含式投影')
    this._field = proj
    return this
  }
  doc(id) {
    return new DocRef(this.coll, id)
  }
  _rows() {
    let out = rows(this.coll).filter((d) => matchDoc(d, this._filter))
    if (this._order && this._order.length) {
      const order = this._order
      out = [...out].sort((a, b) => {
        for (const { field, dir } of order) {
          const av = a[field],
            bv = b[field]
          const c = av < bv ? -1 : av > bv ? 1 : 0
          if (c !== 0) return dir === 'desc' ? -c : c
        }
        return 0
      })
    }
    if (this._skip != null) out = out.slice(this._skip)
    out = out.slice(0, this._limit != null ? this._limit : 100) // 对齐真 SDK：服务端裸 .get() 默认 100 条封顶（根因#8 桩≠真藏无界读）
    return out
  }
  async get() {
    // 写前注入同款读侧钩子（kit/inventory getInventory 分页扫描单页失败测试用）：
    // 可在具体页（按 coll/skip 判断）注入抛错，模拟真机分页扫描中单页 .get() 失败（非到底）。默认无。
    if (this._limit > MAX_LIMIT) throw new Error('MOCK: limit 超过真云上限 ' + MAX_LIMIT)
    if (typeof G.beforeGet === 'function')
      await G.beforeGet({ coll: this.coll, filter: this._filter, skip: this._skip, limit: this._limit })
    const keep = this._field && ['_id', ...Object.keys(this._field)]
    const pick = (d) => (keep ? Object.fromEntries(keep.filter((k) => k in d).map((k) => [k, d[k]])) : d)
    return { data: this._rows().map((d) => clone(pick(d))) }
  }
  async count() {
    // 写前注入同款钩子（测试：精确聚合异常→兜底近样本口径场景，逼真机 count() 失败·默认无）
    if (typeof G.beforeCount === 'function') await G.beforeCount({ coll: this.coll, filter: this._filter })
    return { total: rows(this.coll).filter((d) => matchDoc(d, this._filter)).length }
  }
  async update({ data }) {
    ensureColl(this.coll)
    // 写前注入（测试并发：条件更新 where 求值前让「并发方」先改库·验 CAS 真在咬）。默认无。
    if (typeof G.beforeUpdate === 'function') await G.beforeUpdate({ coll: this.coll, data })
    // 真云 where().update() 改全部匹配文档，不受读取的默认 100 条截断
    const hit = rows(this.coll).filter((d) => matchDoc(d, this._filter))
    return { stats: { updated: hit.filter((d) => applyPatch(d, clone(data))).length } }
  }
  async remove() {
    ensureColl(this.coll)
    if (typeof G.beforeRemove === 'function') await G.beforeRemove({ coll: this.coll, filter: this._filter })
    const arr = rows(this.coll)
    const before = arr.length
    G.store[this.coll] = arr.filter((d) => !matchDoc(d, this._filter))
    return { stats: { removed: before - G.store[this.coll].length } }
  }
  async add({ data }) {
    ensureColl(this.coll)
    // 写前注入（测试并发：add() 撞键/真写失败场景，同 beforeUpdate 范式）。默认无。
    if (typeof G.beforeAdd === 'function') await G.beforeAdd({ coll: this.coll, data })
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

// 聚合管线（最小实现）：支持 .match(filter).group({_id, key:$.sum('$field' | 常数)}).end()。
// _id 为 '$field' 时真按该字段值分桶（真实 wx-server-sdk 语义）；_id:null 是单桶（GMV/评分求和）。
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
  limit(n) {
    this._limit = n
    return this
  }
  async end() {
    // 聚合前注入（测试：精确聚合异常→兜底口径场景，可按 coll 判断选择性抛错）。默认无。
    if (typeof G.beforeAggregate === 'function') await G.beforeAggregate({ coll: this.coll, match: this._match })
    if (this._limit > MAX_LIMIT) throw new Error('MOCK: limit 超过真云上限 ' + MAX_LIMIT)
    const cap = this._limit ?? 20 // 真云聚合不写 limit 只回 20 条
    const docs = rows(this.coll).filter((d) => matchDoc(d, this._match))
    if (!this._group) return { list: docs.slice(0, cap).map(clone) }
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
        if (v && v.__aggOp === 'sum' && typeof v.expr === 'number') {
          out[k] = v.expr * b.docs.length // $.sum(1) 常量：每条计 expr（真 sdk 按桶计数的写法）
        } else if (v && v.__aggOp === 'sum') {
          const f = String(v.expr).replace(/^\$/, '')
          out[k] = b.docs.reduce((n, d) => n + (Number(d[f]) || 0), 0)
        }
      }
      return out
    })
    return { list: list.slice(0, cap) }
  }
}

const db = {
  collection: (name) => new Query(name),
  command,
  serverDate: () => new Date(),
  createCollection: async (name) => {
    uncreated().delete(name) /* 建集合=从「未建」集合移除·解除 add/update 抛错（其余按需自建·空操作） */
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
    return JSON.parse(JSON.stringify(G.callFunctionResult != null ? G.callFunctionResult : { result: {} }))
  },
  uploadFile: async ({ cloudPath }) => ({ fileID: 'cloud://test/' + cloudPath }),
  getTempFileURL: async ({ fileList }) => {
    const list = fileList || []
    // 记录每次调用的批大小：真 sdk 单次 fileList 上限 50，getTempUrls 分批逻辑靠此断言（桩对齐真 SDK）
    G.tempUrlCalls.push(list.length)
    if (list.length > 50) throw new Error('MOCK: getTempFileURL fileList 超 50 上限（真 sdk 会拒）')
    // 接受 string | { fileID, maxAge } 双形（带 maxAge 换长效址·真 sdk 同支持）：取 fileID 作 key
    return {
      fileList: list.map((it) => {
        const id = typeof it === 'string' ? it : it.fileID
        return { fileID: id, tempFileURL: 'https://tmp/' + id }
      }),
    }
  },
  // 删云存储文件（孤儿视频 GC 用）：记录删除的 fileID，返回真 sdk 形状 { fileList:[{fileID,status:0}] }
  deleteFile: async ({ fileList }) => {
    G.deletedFiles.push(...(fileList || []))
    return { fileList: (fileList || []).map((id) => ({ fileID: id, status: 0 })) }
  },
  // 下载云存储文件 mock（kit/contentsec imgSecCheck 取图字节走它）：云函数官方形状
  // { fileID } → { fileContent, statusCode }（不是 getTempFileURL/deleteFile 的 fileList）。
  // 内容安全的通过/违规分支由 openapi mock（setOpenapiFail/Result）驱动（真 sdk 下载属根因#8 靠人·桩只锁链路与形状）。
  downloadFile: async ({ fileID } = {}) => {
    if (typeof fileID !== 'string' || !fileID) {
      throw new Error('MOCK: downloadFile expects { fileID }（云函数 wx-server-sdk 官方形状，不是 fileList）')
    }
    return { fileContent: Buffer.from('mock-image-bytes'), statusCode: 200 }
  },
  // 云调用 mock（cloud.openapi.*·发货上传走它）：嵌套属性任意命中、调用记录入参，
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
    G.callFunctionCalls = []
    G.callFunctionResult = null
    G.callFunctionImpl = null
    G.openapiCalls = []
    G.openapiResult = null
    G.openapiFail = false
    G.openapiErrCode = null
    G.beforeUpdate = null
    G.beforeAdd = null
    G.beforeGet = null
    G.beforeCount = null
    G.beforeRemove = null
    G.beforeAggregate = null
    G.uncreated = new Set()
    G.deletedFiles = []
    G.tempUrlCalls = []
  },
  seed(coll, docs) {
    G.store[coll] = (G.store[coll] || []).concat(clone(docs))
  },
  setOpenId(id) {
    G.openid = id
  },
  setUnionId(id) {
    G.unionid = id
  },
  dump(coll) {
    return clone(G.store[coll] || [])
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
  // 注入「add() 前」副作用（测试并发：撞键/真写失败场景，同 beforeUpdate 范式）
  setBeforeAdd(fn) {
    G.beforeAdd = fn
  },
  // 注入「get() 前」副作用（测试：分页扫描单页失败场景，可按 coll/skip 判断选择性抛错）
  setBeforeGet(fn) {
    G.beforeGet = fn
  },
  // 注入「count() 前」副作用（测试：精确聚合异常→兜底近样本口径场景，可按 coll 判断选择性抛错）
  setBeforeCount(fn) {
    G.beforeCount = fn
  },
  // 注入「aggregate().end() 前」副作用（测试：聚合失败场景，可按 coll 判断选择性抛错）
  setBeforeAggregate(fn) {
    G.beforeAggregate = fn
  },
  // 注入「remove() 前」副作用（测试：删失败场景，可按 coll 判断选择性抛错）
  setBeforeRemove(fn) {
    G.beforeRemove = fn
  },
  // 逼真机「集合未建」（根因#8）：标记集合未 createCollection·其 add/update 抛错·验代码有 createCollection 兜底
  markUncreated(name) {
    ;(G.uncreated = G.uncreated || new Set()).add(name)
  },
  // 云调用 mock 控制（发货上传）
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
