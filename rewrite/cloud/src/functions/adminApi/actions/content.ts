import { reply, ensure, str, type Ctx } from '../lib'
import { notifyAlert } from '../../../kit'

// —— 首页内容（橱窗逐块②③：hero 文案 / 信任条 / FAQ；规格 §八）——
export async function getHomeContent({ db }: Ctx) {
  const got = await db.collection('content').doc('home').get().catch(() => null)
  return reply(200, { ok: true, home: got?.data || null })
}

export async function saveHomeContent({ db, data }: Ctx) {
  const c = data.home || {}
  // 按课程·按状态的激活欢迎图映射 courseId→{welcome,welcomeBack,taken}（同课程同图·欢迎页与产品对应）：
  // 上新向导按产品 courseId 传图。welcome=欢迎页 / welcomeBack=欢迎回来 / taken=已被激活。
  // 白名单净化：键当 courseId（≤40）、每态值当云存储 fileID（≤200），封顶 100 课防滥用；空态剔除、空课剔除。
  // 兼容旧结构（值为单字符串＝welcome 那张），归一成对象存。
  const WEL_STATES = ['welcome', 'welcomeBack', 'taken'] as const
  const rawByCourse =
    c.activationBgByCourse && typeof c.activationBgByCourse === 'object' ? c.activationBgByCourse : {}
  const activationBgByCourse: Record<string, Record<string, string>> = {}
  for (const k of Object.keys(rawByCourse).slice(0, 100)) {
    const raw = rawByCourse[k]
    const entry: Record<string, string> = {}
    if (typeof raw === 'string') {
      const v = str(raw, 200)
      if (v) entry.welcome = v // 旧单字符串＝欢迎页那张
    } else if (raw && typeof raw === 'object') {
      for (const st of WEL_STATES) {
        const v = str(raw[st], 200)
        if (v) entry[st] = v
      }
    }
    if (Object.keys(entry).length) activationBgByCourse[str(k, 40)] = entry
  }
  // 首页九板块内容白名单净化（键限长、数组封顶防滥用；空态照存＝小程序读侧回退设计默认文案·防误清空）：
  const arrOf = (v: any, cap: number) => (Array.isArray(v) ? v : []).slice(0, cap)
  const doc = {
    // Hero：主标题/副标语 + 搜索框占位文案 + 顶部背景图 fileID（空→小程序回退渐变占位）
    hero: { title: str(c.hero?.title, 20), tagline: str(c.hero?.tagline, 40), search: str(c.hero?.search, 40), img: str(c.hero?.img, 200) },
    // 品牌自述 / 特写方案（title+body+图）/ 「把门槛拆掉」放心区（heading+lead+至多 6 条 icon/标题/正文/图）
    brand: { name: str(c.brand?.name, 20), lead: str(c.brand?.lead, 60) },
    feature: { title: str(c.feature?.title, 30), body: str(c.feature?.body, 80), img: str(c.feature?.img, 200) },
    reassure: {
      heading: str(c.reassure?.heading, 20),
      lead: str(c.reassure?.lead, 60),
      items: arrOf(c.reassure?.items, 6).map((it: any) => ({ icon: str(it?.icon, 20), title: str(it?.title, 20), body: str(it?.body, 120), img: str(it?.img, 200) })),
    },
    // 真实买家秀（heading + 至多 12 条 quote/user/图）/ 收尾 CTA / 页脚（至多 6 链接 + 版权）
    reviews: {
      heading: str(c.reviews?.heading, 20),
      items: arrOf(c.reviews?.items, 12).map((it: any) => ({ quote: str(it?.quote, 120), user: str(it?.user, 20), img: str(it?.img, 200) })),
    },
    closing: { title: str(c.closing?.title, 20), cta: str(c.closing?.cta, 40), img: str(c.closing?.img, 200) },
    footer: { links: arrOf(c.footer?.links, 6).map((s: any) => str(s, 20)).filter(Boolean), copy: str(c.footer?.copy, 120) },
    // 激活页背景图（welcome）：存云存储 fileID（cloud://…，≤200）；空＝小程序回退 /static/hero-full.jpg
    activationBg: str(c.activationBg, 200),
    // 全局·正在激活(loading)图：loading 时还拿不到 courseId 故全局（橱窗管）；空＝回退 activationBg→static
    loadingBg: str(c.loadingBg, 200),
    // 按课程·按状态激活欢迎图（welcome 按屏取·回退 activationBg→static）
    activationBgByCourse,
    trust: arrOf(c.trust, 4).map((t: any) => ({ icon: str(t?.icon, 20), label: str(t?.label, 12) })),
    faq: arrOf(c.faq, 8).map((f: any) => ({ title: str(f?.title, 40), body: str(f?.body, 150) })),
    updatedAt: Date.now(),
  }
  await ensure(db, 'content')
  const coll = db.collection('content')
  await coll
    .doc('home')
    .set({ data: doc })
    .catch(async () => {
      await coll.add({ data: { ...doc, _id: 'home' } })
    })
  return reply(200, { ok: true })
}

// —— 页面内容 CMS（批A·5 页可编辑：欢迎流/目录+播放页求助/我的/关于/协议）——
// 承 saveHomeContent 样板（白名单净化·str 限长·数组封顶·.doc().set 带 .add 回退）；每页一独立净化函数，
// 未知字段丢弃、未知 page fail-closed 拒（信任边界·根因#3 不信前端·守卫 rw-cloud-page-content-sanitized）。
// content 集合每页一 doc（_id=page 键名）；小程序公开读经 app/catalog.getPageContent（catalogPlayer.catalog.heroImage
// 若 cloud:// 换临时 URL，fileID 不出口·照 swapHomeImages 模式）。
const PAGES = ['welcome', 'catalogPlayer', 'mePage', 'about', 'agreement'] as const
const arrOf = (v: any, cap: number) => (Array.isArray(v) ? v : []).slice(0, cap)

// 欢迎流（W1 恭喜屏 + W2 三件事）：w1 单屏文案 + w2 至多 3 条清单。
function sanitizeWelcome(d: any) {
  return {
    w1: { title: str(d?.w1?.title, 60), sub: str(d?.w1?.sub, 120), warning: str(d?.w1?.warning, 120) },
    w2: { items: arrOf(d?.w2?.items, 3).map((it: any) => ({ title: str(it?.title, 60), desc: str(it?.desc, 2000) })) },
  }
}

// 课程目录页 hero/续播/空态 + 播放页求助面板三栏标题 + FAQ（至多 20 条）。heroImage 存云存储 fileID。
function sanitizeCatalogPlayer(d: any) {
  return {
    catalog: {
      heroImage: str(d?.catalog?.heroImage, 200),
      resumeCta: str(d?.catalog?.resumeCta, 40),
      emptyLesson: str(d?.catalog?.emptyLesson, 40),
    },
    help: {
      contactTitle: str(d?.help?.contactTitle, 60),
      videosTitle: str(d?.help?.videosTitle, 60),
      faqTitle: str(d?.help?.faqTitle, 60),
      faq: arrOf(d?.help?.faq, 20).map((f: any) => ({ q: str(f?.q, 120), a: str(f?.a, 1000) })),
    },
  }
}

// 「我」页默认昵称 + 入口列（至多 12 条）。key 只认固定集（以 rewrite/mp/pages/me 实际入口为准·侦察结论修正）：
// courses（全部教程）/orders（我的订单）/aftersales（售后）/address（收货地址）/activate（输入激活码）/
// feedback（意见反馈）/kefu（联系客服）/consent（数据共享授权）/about（关于我们）——不认集外键（丢弃）。
const ME_ENTRY_KEYS = ['courses', 'orders', 'aftersales', 'address', 'activate', 'feedback', 'kefu', 'consent', 'about']
function sanitizeMePage(d: any) {
  return {
    defaultNickname: str(d?.defaultNickname, 20),
    entries: arrOf(d?.entries, 12)
      .map((e: any) => ({ key: str(e?.key, 40), label: str(e?.label, 60), visible: e?.visible !== false }))
      .filter((e: any) => ME_ENTRY_KEYS.includes(e.key)), // 集外 key 丢弃（fail-closed·根因#3）
  }
}

// 关于我们：引言 + 至多 10 段。
function sanitizeAbout(d: any) {
  return {
    lead: str(d?.lead, 200),
    sections: arrOf(d?.sections, 10).map((s: any) => ({ title: str(s?.title, 60), body: str(s?.body, 2000) })),
  }
}

// 协议页（用户协议 user + 隐私政策 privacy 两份·各至多 30 段）。history 由服务端追加、客户端传的忽略（见 savePageContent）。
function sanitizeAgreementDoc(d: any) {
  const clause = (c: any) => ({
    version: str(c?.version, 20),
    effectiveDate: str(c?.effectiveDate, 20),
    sections: arrOf(c?.sections, 30).map((s: any) => ({ title: str(s?.title, 60), body: str(s?.body, 2000) })),
  })
  return { user: clause(d?.user), privacy: clause(d?.privacy) }
}

const PAGE_SANITIZERS: Record<string, (d: any) => any> = {
  welcome: sanitizeWelcome,
  catalogPlayer: sanitizeCatalogPlayer,
  mePage: sanitizeMePage,
  about: sanitizeAbout,
  agreement: sanitizeAgreementDoc,
}

// history 追加重试上限（同 kit/inventory.ts CAS_RETRY 手法·乐观 CAS 非分布式锁）。
const HISTORY_CAS_RETRY = 5

export async function savePageContent({ db, data }: Ctx) {
  const page = str(data.page, 40)
  if (!PAGES.includes(page as any)) return reply(400, { ok: false, error: 'UNKNOWN_PAGE' }) // 未知 page fail-closed（根因#3）
  const clean: any = PAGE_SANITIZERS[page](data.data || {})
  await ensure(db, 'content')
  const coll = db.collection('content')
  if (page === 'agreement') {
    // history 服务端权威追加（客户端传的一律忽略·防伪造版本史）：读旧份逐 part 比对 version，非空且变更即追
    // {part,version,at:ISO}，封顶 10（保留末 10 条·同 issueSession 剪最旧手法）。
    //
    // 并发保存 fail-closed（P3 复核：原「读 history → 内存追加 → 整体写回」非原子——两次并发保存读到同一份
    // 旧 history，各自追加后写回，后写覆盖先写、丢一条历史记录）。改用乐观 CAS 重试（同 kit/inventory.ts
    // produceStock 手法）：条件带上读到时的版本号 _v（单调计数器，非 updatedAt 时间戳——毫秒级 Date.now()
    // 在同一毫秒内两次写入会撞出同一个值，CAS 条件误判「无冲突」直接覆盖、静默丢一条并发追加，
    // 曾在本地高频重试下实测复现），写前该文档被并发改过则 updated:0、重读重算 additions 再重试
    // （读到的 prevData 已含并发方的新版本，本轮 diff 不会对已存在的版本重复追加，天然去重）；
    // 首次建档走 add() 撞 DUPLICATE_ID 即并发方已建，同样重读重试。非钱链路径，用不到分布式锁。
    for (let i = 0; i < HISTORY_CAS_RETRY; i++) {
      const prev = await coll.doc('agreement').get().catch(() => null)
      const prevData: any = (prev && prev.data) || {}
      const prevHist = Array.isArray(prevData.history) ? prevData.history : []
      const hasV = typeof prevData._v === 'number'
      const prevV = hasV ? prevData._v : 0
      const additions: any[] = []
      for (const part of ['user', 'privacy'] as const) {
        const v = clean[part]?.version
        if (v && v !== prevData[part]?.version) additions.push({ part, version: v, at: new Date().toISOString() })
      }
      const doc = { ...clean, history: [...prevHist, ...additions].slice(-10), _v: prevV + 1, updatedAt: Date.now() }
      if (!prev || !prev.data) {
        const created = await coll
          .add({ data: { ...doc, _id: 'agreement' } })
          .then(() => true)
          .catch(() => false)
        if (created) return reply(200, { ok: true })
        continue // DUPLICATE_ID：并发方已建档，重读重试
      }
      // _v 字段可能缺失（本 CAS 改造前就存在的旧文档，从未写过 _v）——用字面量 0 精确匹配会因「字段真缺失
      // ≠ 值为0」而永远命中不了这类旧文档，CONTENTION 重试 5 次全败、协议页永久保存失败（同 learning.ts
      // confirmEnter 的 entVer CAS 已踩过并修过的同一个坑：exists(false)-or-eq(prevV)，而非裸字面量相等）。
      const _ = db.command
      const r = await coll
        .where({ _id: 'agreement', _v: hasV ? prevV : _.exists(false) })
        .update({ data: doc })
        .catch(() => ({ stats: { updated: 0 } }))
      if (r.stats && r.stats.updated === 1) return reply(200, { ok: true })
      // updated:0＝写前被并发改动抢先，重读重试
    }
    return reply(409, { ok: false, error: 'CONTENTION' }) // 争用耗尽（管理端低频操作·几乎不至）
  }
  const doc = { ...clean, updatedAt: Date.now() }
  await coll
    .doc(page)
    .set({ data: doc })
    .catch(async () => {
      await coll.add({ data: { ...doc, _id: page } })
    })
  return reply(200, { ok: true })
}

export async function getPageContent({ db, data }: Ctx) {
  const page = str(data.page, 40)
  if (!PAGES.includes(page as any)) return reply(400, { ok: false, error: 'UNKNOWN_PAGE' }) // 未知 page fail-closed（根因#3）
  const got = await db.collection('content').doc(page).get().catch(() => null)
  return reply(200, { ok: true, page, content: (got && got.data) || null })
}

// —— 求助面板「辅助视频」（全局共用·所有课程同一份；存 content 集合 doc 'helpVideos'）——
// 小程序播放页求助面板「遇到问题了」列表即此；控制台「帮助视频」增删改 + 上传视频（复用 getVideoUploadMeta 直传）。
// 管理端读回原始 videoFileId（已过口令闸）便于显「已传」/保存；小程序公开读经 catalog/getHelpVideos 换临时 URL（fileID 不出口）。
export async function listHelpVideos({ db }: Ctx) {
  const got = await db.collection('content').doc('helpVideos').get().catch(() => null)
  const d = (got?.data as any) || {}
  // rev 供前端做 baseRev（乐观并发基线·同 saveCourseDraft 口径）：缺档=0
  return reply(200, { ok: true, items: d.items || [], rev: Number(d.rev) || 0 })
}

export async function saveHelpVideos({ db, cloud, data }: Ctx) {
  // 白名单净化（两级：主题→小段）：主题 id/title/sub/desc 限长；小段 id/name/dur/videoFileId 限长。
  // 主题封顶 20、每主题小段封顶 20 防滥用；空小段（无视频）剔除；空主题（无标题且无任何带视频小段）剔除。
  const raw = Array.isArray(data.items) ? data.items : []
  const items = raw
    .slice(0, 20)
    .map((it: any) => {
      const segments = (Array.isArray(it.segments) ? it.segments : [])
        .slice(0, 20)
        .map((sg: any) => ({
          id: str(sg.id, 40) || 's' + Math.random().toString(36).slice(2, 8),
          name: str(sg.name, 40),
          dur: str(sg.dur, 10),
          videoFileId: str(sg.videoFileId, 200),
        }))
        .filter((sg: any) => sg.videoFileId)
      return {
        id: str(it.id, 40) || 'h' + Math.random().toString(36).slice(2, 8),
        title: str(it.title, 40),
        sub: str(it.sub, 40),
        desc: str(it.desc, 150),
        segments,
      }
    })
    .filter((it: any) => it.title || it.segments.length)
  await ensure(db, 'content')
  const coll = db.collection('content')
  const prev = await coll.doc('helpVideos').get().catch(() => null) // GC 基线 + 乐观并发基线：读旧份
  // 乐观并发（批A·内容域并发安全·根因#1·同 saveCourseDraft rev/baseRev/DRAFT_CONFLICT 口径）：整档覆盖。
  // 诚实边界：同 courses.ts 一样是「文档级 get→比对→set」，get 与 set 之间仍有毫秒级 TOCTOU 窗（非
  // checkpoints.ts defmeta 那种条件 update 真 CAS）——帮助视频保存低频、真实冲突是人差几分钟的编辑，可接受。
  // （items 整体替换）＝两处并发编辑（双页签/双管理员）后保存者静默吃掉先保存者的编辑。客户端带上拉取时
  // 的 rev，不符即拒（前端提示重新载入，不静默覆盖）；不带 baseRev 的旧调用按原语义覆盖（部署窗口兼容）。
  const curRev = prev && prev.data ? Number((prev.data as any).rev) || 0 : 0
  const baseRev = Number(data.baseRev)
  // 冲突分支：既不覆盖内容也绝不 GC 删文件——否则先保存者的编辑丢了、其视频还被误删（不可逆）。
  if (Number.isFinite(baseRev) && curRev !== baseRev) return reply(200, { ok: false, error: 'DRAFT_CONFLICT', rev: curRev })
  const doc = { items, updatedAt: Date.now(), rev: curRev + 1 }
  await coll
    .doc('helpVideos')
    .set({ data: doc })
    .catch(async () => {
      await coll.add({ data: { ...doc, _id: 'helpVideos' } })
    })
  // 孤儿视频 GC（深审 P3·同 publishCourse 思路）：删「旧份有、新份没有」的 videoFileId。**写成功后才 GC**
  // （冲突分支已 early-return，到不了这里）。GC 删除失败不再静默吞（H2·同 saveCheckpoints 判例·病根#14）：
  // 保存本身已成功，但 orphans 删不掉时如实回 ok:false + notifyAlert 留痕（orphans 进 anomalies 账本可人工回收，
  // 低频面不为罕见失败建 pendingGc 队列）——别静默过关让前端误显「已保存」而云存储悄悄只增不减。
  const keep = new Set(items.flatMap((it: any) => it.segments.map((sg: any) => String(sg.videoFileId))))
  const prevIds = (((prev && (prev.data as any)) || {}).items || []).flatMap((it: any) =>
    ((it.segments || []) as any[]).map((sg: any) => String(sg.videoFileId || '')).filter(Boolean)
  )
  const orphans = [...new Set(prevIds)].filter((id) => !keep.has(id))
  if (orphans.length) {
    // 整体调用失败＝全部 orphans 视为删除失败；成功但含 status!=0 的项＝那几个失败（真 sdk 逐文件状态）。
    const failed: string[] = await cloud
      .deleteFile({ fileList: orphans })
      .then((r: any) => ((r && r.fileList) || []).filter((f: any) => f && f.status !== 0).map((f: any) => String(f.fileID)))
      .catch(() => orphans)
    if (failed.length) {
      await notifyAlert('anomaly', 'saveHelpVideos', 'GC_DELETE_FAIL', { orphans: failed })
      return reply(200, { ok: false, error: 'GC_DELETE_FAIL', rev: doc.rev })
    }
  }
  return reply(200, { ok: true, rev: doc.rev })
}
