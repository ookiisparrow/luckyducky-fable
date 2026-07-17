import { ERR, COLLECTIONS, QRCODE_STATUS_SPEC } from '@ldrw/shared'
import {
  withOpenId,
  withRateLimit,
  ok,
  err,
  str,
  transition,
  ensureDoc,
  getTempUrl,
  getDb,
  alert,
  recordAnomaly,
} from '../../../kit'

const QR = QRCODE_STATUS_SPEC.transitions[0] // unused→activated（声明单源，不散写状态串）

/** 确保本人激活记录存在（幂等自愈·黄金 §一）：老随机 _id 命中即用；否则确定性 _id=code 原子创建。 */
async function ensureActivation(
  db: any,
  code: string,
  courseId: string,
  OPENID: string,
  now: number
) {
  const legacy = await db
    .collection(COLLECTIONS.activations)
    .where({ code, _openid: OPENID })
    .get()
    .catch(() => ({ data: [] }))
  if (legacy.data.length) return legacy.data[0]
  const doc = { _openid: OPENID, courseId, qrcodeId: code, code, enteredAt: null, createdAt: now }
  try {
    await db.collection(COLLECTIONS.activations).add({ data: { _id: code, ...doc } })
    // 批C·省常态读回：add 成功＝刚落地的这份 doc 就是库内现值（enteredAt 恒 null），调用方
    // activateCourse 只读 act.enteredAt——原地返回与读回等价，省一次网关往返；不影响后续 confirmEnter
    // 的抢占语义（enteredAt 仍是 null，转移仍走那边的条件更新）。
    return { _id: code, ...doc }
  } catch {
    // 撞号（并发/重试/半步失败重入）→ 幂等；但此路径库内现值不确定（可能是并发者已推进 enteredAt），
    // 不能沿用本地 doc 猜测，必须读回真实当前值。
    const got = await db
      .collection(COLLECTIONS.activations)
      .doc(code)
      .get()
      .catch(() => null)
    if (got && got.data) return got.data
    // 双失败（add 抛错 + 读回也失败·P2·根因#14 修复，P2 复核补真留痕）：不伪造激活记录——库里其实没有，
    // 假装成功会让 activateCourse 回「activated」但用户看不到课。留痕告警，调用方对 null 走失败反馈
    // （用户重扫走 qr.activatedBy===OPENID 幂等自愈）。走 recordAnomaly 而非裸 alert()：裸 alert() 只打
    // console.error 一行，不落 anomalies 账本、运营后台 listAnomalies 查不到、企微群也收不到——不满足
    // 「留痕」二字；recordAnomaly(severity:'high') 首见即桥接 alert + 持久化 + （若配了 webhook）推送，
    // 三头都占（kit/anomaly.ts 单源）。kind 用 'invariant-violation'（激活写入未验证成功＝不变量违反，
    // 非直接钱链/安全事件）。
    await recordAnomaly(
      'invariant-violation',
      'ACT_PERSIST_UNVERIFIED',
      { fn: 'activateCourse', code },
      'high'
    )
    return null
  }
}

/**
 * 扫码激活（黄金 §一）：一码一用抢占（transition 条件更新·翻成功者赢）；
 * 抢到/本人重扫一律幂等自愈激活记录；他人码拒且带回 courseId（「已被激活」屏按课程取图）。
 */
// 频控（深审 P2·根因#13 认证/兑换端点防爆破）：激活码兑换是「猜有效未用码」的典型爆破面（每次调用一读一条件写），
// 码空间 32^10≈1e15 使盲猜不现实，但仍须按 openid 限速拖慢定向枚举 + 挡刷库成本（同 trackEvent/login 口径）。
export const activateCourse = withOpenId(
  withRateLimit('activateCourse', { max: 10, windowMs: 60_000 }, async ({ db, OPENID, event }) => {
    const code = String((event as any).code || '').trim()
    if (!code) return err(ERR.INVALID_CODE)
    const now = Date.now()

    const { moved, doc: qr } = await transition(COLLECTIONS.qrcodes, code, [...QR.from], QR.to, {
      activatedBy: OPENID,
      activatedAt: now,
    })

    if (!qr) return err(ERR.INVALID_CODE)
    // transition 返回的是更新前旧快照（课程链路审计 2026-07-17·根因#1）：真并发同用户双扫（网络抖动重发/
    // 双击）时，后到方 moved=false 且快照仍是 unused（activatedBy null）——据此判「他人占用」会把本人
    // 激活成功误报成 CODE_TAKEN。快照未见归属且没抢到时读回库内现值再判（撞在自己身上走幂等自愈分支）。
    let qrNow = qr
    if (!moved && !qr.activatedBy) {
      const fresh = await db.collection(COLLECTIONS.qrcodes).doc(code).get().catch(() => null)
      if (fresh && fresh.data) qrNow = fresh.data
    }
    if (moved || qrNow.activatedBy === OPENID) {
      const act = await ensureActivation(db, code, qrNow.courseId, OPENID, now)
      // 双失败未持久化（P2·根因#14）：库里其实没写成功，别回「activated」——回错误码走客户端已有失败反馈路径；
      // 用户重扫时 qr.activatedBy===OPENID 命中本分支再试一次 ensureActivation，天然幂等自愈。
      if (!act) return err(ERR.NOT_ACTIVATED, { courseId: qrNow.courseId })
      return ok({ state: act.enteredAt ? 'mine' : 'activated', courseId: qrNow.courseId })
    }
    return err(ERR.CODE_TAKEN, { courseId: qrNow.courseId })
  })
)

/**
 * 确认进课（黄金 §二）：退货权法律节点。enteredAt null→时间戳原子抢占（只一次）；
 * 首次进课按件失效退货权（enteredQty++·entVer CAS 防并发少记）；送礼无单不报错。
 */
// 频控（深审 P2·根因#13）：确认进课是退货权失效的法律节点写，按 openid 限速挡刷（正常人一次进课远低于此）。
export const confirmEnter = withOpenId(
  withRateLimit('confirmEnter', { max: 10, windowMs: 60_000 }, async ({ db, OPENID, event }) => {
    const _ = db.command
    const code = String((event as any).code || '').trim()
    if (!code) return err(ERR.BAD_ARGS)

    const acts = await db.collection(COLLECTIONS.activations).where({ code, _openid: OPENID }).get()
    if (!acts.data.length) return err(ERR.NOT_ACTIVATED)
    const act = acts.data[0]

    const now = Date.now()
    let enteredAt = act.enteredAt
    let revoked: { orderId: string; lineId: string; productId: string } | null = null

    if (!enteredAt) {
      const grab = await db
        .collection(COLLECTIONS.activations)
        .where({ _id: act._id, enteredAt: null })
        .update({ data: { enteredAt: now } })
      if (!grab.stats || grab.stats.updated !== 1) {
        const fresh = await db
          .collection(COLLECTIONS.activations)
          .doc(act._id)
          .get()
          .catch(() => null)
        return ok({
          enteredAt: (fresh && fresh.data && fresh.data.enteredAt) || now,
          revoked: null,
        })
      }
      enteredAt = now

      // 启发式失效：本人 paid/shipped/done 订单里最早一条仍可退的本课程行，进一件账
      const prods = await db
        .collection(COLLECTIONS.products)
        .where({ courseId: act.courseId })
        .limit(500) // 显式上界（深审 P2·病根#7）：裸 .get() 默认 100 截断会让本课部分商品的退货权撤销漏判
        .get()
      const prodIds = prods.data.map((p: any) => p.id)
      if (prodIds.length) {
        const orders = await db
          .collection(COLLECTIONS.orders)
          .where({ _openid: OPENID, status: _.in(['paid', 'shipped', 'done']) })
          .orderBy('createdAt', 'asc')
          .limit(200) // 显式上界：防默认 100 截断漏到要撤退货权的订单
          .get()
        for (const order of orders.data) {
          let cur: any = order
          for (let attempt = 0; attempt < 3 && cur; attempt++) {
            const idx = (cur.items || []).findIndex(
              (it: any) =>
                prodIds.includes(it.productId) &&
                it.refundable !== false &&
                (it.enteredQty || 0) < (it.qty || 1)
            )
            if (idx < 0) break
            const items = cur.items.map((it: any, i: number) => {
              if (i !== idx) return it
              const entered = (it.enteredQty || 0) + 1
              const qty = it.qty || 1
              return { ...it, enteredQty: entered, refundable: entered < qty }
            })
            const upd = await db
              .collection(COLLECTIONS.orders)
              .where({
                _id: cur._id,
                entVer: typeof cur.entVer === 'number' ? cur.entVer : _.exists(false),
              })
              .update({ data: { items, entVer: (cur.entVer || 0) + 1 } })
            if (upd.stats && upd.stats.updated === 1) {
              const ri = cur.items[idx]
              revoked = {
                orderId: cur.id,
                lineId: ri.lineId || ri.productId,
                productId: ri.productId,
              }
              break
            }
            const fresh = await db
              .collection(COLLECTIONS.orders)
              .doc(cur._id)
              .get()
              .catch(() => null)
            cur = fresh && fresh.data
            // 放弃即告警：耗尽 3 次重试（attempt===2）与「重读本身失败」（cur 变 null，下一轮 for
            // 条件 `attempt<3 && cur` 直接为假、提前退出）是两条不同的放弃路径，缺一都会让这单退货权
            // 撤销悄悄没了却无人知道——收敛到同一告警出口，不让控制流的巧合替某条失败路径顶案。
            if (attempt === 2 || !cur) alert('money', 'confirmEnter', 'REVOKE_RACE', { orderId: order.id })
          }
          if (revoked) break
        }
      }
    }

    return ok({ enteredAt, revoked })
  })
)

/** 公开课程目录（黄金 §三）：逐层显式白名单，绝不下发视频源；段只暴露 hasVideo 布尔。 */
function publicSegment(s: any) {
  return { id: s.id, name: s.name, dur: s.dur, hasVideo: !!s.videoFileId }
}
function publicLesson(l: any) {
  return { id: l.id, name: l.name, dur: l.dur, segments: (l.segments || []).map(publicSegment) }
}
function publicChapter(ch: any) {
  return { id: ch.id, title: ch.title, lessons: (ch.lessons || []).map(publicLesson) }
}

export const getCourses = async () => {
  const db = getDb()
  // 显式上界（病根#7·守卫 rw-app-catalog-reads-bounded·深审 P2 同处独立发现取并）：同 getProducts 口径，
  // 防默认 100 条静默截断——课程目录破百后第 101 门起从用户课程页无声消失。
  const res = await db.collection(COLLECTIONS.courses).orderBy('sort', 'asc').limit(1000).get()
  return ok({
    list: res.data.map((c: any) => ({
      id: c.id,
      title: c.title,
      chapters: (c.chapters || []).map(publicChapter),
    })),
  })
}

/**
 * 取分段播放地址（黄金 §三·fail-closed）：一律须本人已确认进课；旧库残留预览标记不构成授权
 * （免费预览通道已整条撤除）；素材未剪 → url:null；鉴权过才换短时临时 URL。
 */
// 频控（深审 P3·病根#13）：签发付费视频临时地址的端点，按 openid 限速防无限铸签名地址/刷成本；
// 上限宽松（正常观看切段+预取每分钟远低于此·客户端已缓存 prefetch·不误伤连续播放）。
export const getPlaybackUrl = withOpenId(
  withRateLimit('getPlaybackUrl', { max: 60, windowMs: 60_000 }, async ({ db, OPENID, event }) => {
    const e: any = event
    const courseId = String(e.courseId || '')
    const segmentId = String(e.segmentId || '')
    if (!courseId || !segmentId) return err(ERR.BAD_ARGS)

    // 批C·并行取回（零依赖只读）：课程文档读与鉴权读的入参只来自 courseId/segmentId/OPENID（已核对
    // 课程文档零依赖），互不依赖对方结果——并行发起省一次网关往返；判定顺序原样保持
    // NO_COURSE→NO_SEGMENT→NOT_ENTITLED。素材未剪（url:null）分支下 acts 结果单纯丢弃——纯读零副作用，
    // 等价原「未剪视频不查鉴权」语义，代价仅是该分支多付一次本可省的读（权衡：省掉常态有视频路径的
    // 一次串行往返，换未剪视频这一冷分支多一次并行读，净为正）。
    // .catch(()=>({data:[]}))（P2 复核·根因#14）：未剪段场景本不该查鉴权，此查询若瞬时失败/集合未建
    // 不该让整个云函数调用未捕获抛错——同文件其它鉴权读一律 catch 兜底空数组，失败即视为「查无本人已确认
    // 记录」，fail-closed 走 NOT_ENTITLED 拒绝而非放行（不是伪造通过）；未剪段分支本就丢弃 acts，兜底不影响该分支。
    const [got, acts] = await Promise.all([
      db
        .collection(COLLECTIONS.courses)
        .doc(courseId)
        .get()
        .catch(() => null),
      db
        .collection(COLLECTIONS.activations)
        .where({ _openid: OPENID, courseId, enteredAt: db.command.neq(null) })
        .get()
        .catch(() => ({ data: [] })),
    ])
    if (!got || !got.data) return err(ERR.NO_COURSE)

    let seg: any = null
    for (const ch of got.data.chapters || []) {
      for (const l of ch.lessons || []) {
        const f = (l.segments || []).find((s: any) => s.id === segmentId)
        if (f) {
          seg = f
          break
        }
      }
      if (seg) break
    }
    if (!seg) return err(ERR.NO_SEGMENT)
    if (!seg.videoFileId) return ok({ url: null })

    if (!acts.data.length) return err(ERR.NOT_ENTITLED)

    return ok({ url: await getTempUrl(String(seg.videoFileId)) })
  })
)

/** 本人已解锁课程（黄金 §五）：只认已确认进课；同课多码去重取最早。 */
export const getMyCourses = withOpenId(async ({ db, OPENID }) => {
  const _ = db.command
  const res = await db
    .collection(COLLECTIONS.activations)
    .where({ _openid: OPENID, enteredAt: _.neq(null) })
    .limit(200)
    .get()
  const byCourse: Record<string, { courseId: string; enteredAt: number }> = {}
  for (const a of res.data) {
    if (!byCourse[a.courseId] || a.enteredAt < byCourse[a.courseId].enteredAt) {
      byCourse[a.courseId] = { courseId: a.courseId, enteredAt: a.enteredAt }
    }
  }
  return ok({ list: Object.values(byCourse) })
})

/** 我的学习进度（只本人·集合未建=空）。 */
export const getMyProgress = withOpenId(async ({ db, OPENID }) => {
  try {
    const res = await db
      .collection(COLLECTIONS.progress)
      .where({ _openid: OPENID })
      .limit(200)
      .get()
    return ok({ list: res.data })
  } catch {
    return ok({ list: [] })
  }
})

async function addTo(db: any, coll: string, data: any) {
  try {
    await db.collection(coll).add({ data })
  } catch {
    try {
      await db.createCollection(coll)
    } catch {
      /* 已存在 */
    }
    // 第二次 add 也兜底（课程链路审计 2026-07-17·根因#14）：首次失败若非「集合缺失」而是基础设施瞬时
    // 抖动，这里大概率复现同因再失败——原来异常直接冒出 trackEvent，恰在最需要观测的时刻埋点通道先失明。
    // 留痕告警（alert 只打结构化日志行，不回调 recordAnomaly，防观测递归），埋点丢一条可容忍、丢得无声不可容忍。
    await db
      .collection(coll)
      .add({ data })
      .catch(() => alert('anomaly', 'trackEvent', 'EVENT_WRITE_LOST', { coll }))
  }
}

/**
 * 埋点+进度折叠（黄金 §四）：events 流水照记；segment_done/watch_at 折叠进「每用户每课一条」；
 * 防刷：未确认进课的进度事件不折叠（流水仍记，供分析）；限频挡刷库洪水。
 */
export const trackEvent = withOpenId(
  withRateLimit('trackEvent', { max: 60, windowMs: 60_000 }, async ({ db, OPENID, event }) => {
    const e: any = event
    const type = str(e.type, 32)
    if (!type) return err(ERR.NO_TYPE)
    const page = str(e.page, 64)
    const targetId = str(e.targetId, 64)
    let meta = e.meta
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {}
    if (JSON.stringify(meta).length > 1024) return err(ERR.META_TOO_BIG)

    const now = Date.now()
    await addTo(db, COLLECTIONS.events, {
      _openid: OPENID,
      type,
      page,
      targetId,
      meta,
      createdAt: now,
    })

    // 客户端崩溃桥接进 bug 账本（工业级完善批8·根因#14）：events 流水人不会主动翻，anomalies 账本运营后台
    // Anomalies 页天天看——同一条崩溃信号必须落两处才算「记回总部账本、店主翻后台能看」。severity:'low'
    // （单条客户端报错不主动推告警刷屏，仅留痕待人巡查）；fp 取 msg 前缀做去重细分（同一报错聚成一条累加
    // count，不同报错各自成条，不撞成一坨）。recordAnomaly 本身 fail-soft，不反噬 trackEvent 主流程。
    if (type === 'client_error') {
      const msg = str(meta.msg, 500)
      await recordAnomaly('client-error', 'MP_JS_ERROR', { fp: msg.slice(0, 60), page, msg }, 'low')
    }

    // 播放失败桥接（课程链路审计 2026-07-17·根因#14）：品牌核心价值链（视频播放）的失败率原先服务端
    // 零记录——mp 播放器三类失败点（取址失败 fetch/媒体硬失败 media/缓冲失速 stall）现随 video_error
    // 上报，按 课程:段 细分指纹聚合（同段反复坏聚一条累加 count，不同段各自成条），运营后台可查分布。
    if (type === 'video_error') {
      const vCourse = str(meta.courseId, 64)
      await recordAnomaly(
        'client-error',
        'MP_VIDEO_ERROR',
        { fp: (vCourse + ':' + targetId).slice(0, 60), page, courseId: vCourse, segmentId: targetId, phase: str(meta.phase, 16) },
        'low'
      )
    }

    const courseId = str(meta.courseId, 64)
    if ((type === 'segment_done' || type === 'watch_at') && courseId) {
      const _ = db.command
      const owns = await db
        .collection(COLLECTIONS.activations)
        .where({ _openid: OPENID, courseId, enteredAt: _.neq(null) })
        .get()
        .catch(() => ({ data: [] }))
      if (!owns.data.length) return ok()
      const last = {
        lessonId: str(meta.lessonId, 64),
        segmentId: targetId,
        at: Number(meta.at) || 0,
        dur: Number(meta.dur) || 0,
      }
      const progress = db.collection(COLLECTIONS.progress)
      let found
      try {
        found = await progress.where({ _openid: OPENID, courseId }).get()
      } catch {
        found = { data: [] }
      }
      const patch: Record<string, unknown> = { last, updatedAt: now }
      if (type === 'segment_done' && targetId) patch[`done.${targetId}`] = true
      if (found.data.length) {
        await progress.doc(found.data[0]._id).update({ data: patch })
      } else {
        const pid = OPENID + '__' + courseId
        await ensureDoc(COLLECTIONS.progress, pid, {
          _openid: OPENID,
          courseId,
          done: {},
          last,
          createdAt: now,
        })
        await progress.doc(pid).update({ data: patch })
      }
    }
    return ok()
  })
)
