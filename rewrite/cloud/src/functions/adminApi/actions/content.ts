import { reply, ensure, str, type Ctx } from '../lib'

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

// —— 求助面板「辅助视频」（全局共用·所有课程同一份；存 content 集合 doc 'helpVideos'）——
// 小程序播放页求助面板「遇到问题了」列表即此；控制台「帮助视频」增删改 + 上传视频（复用 getVideoUploadMeta 直传）。
// 管理端读回原始 videoFileId（已过口令闸）便于显「已传」/保存；小程序公开读经 catalog/getHelpVideos 换临时 URL（fileID 不出口）。
export async function listHelpVideos({ db }: Ctx) {
  const got = await db.collection('content').doc('helpVideos').get().catch(() => null)
  return reply(200, { ok: true, items: (got?.data as any)?.items || [] })
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
  const doc = { items, updatedAt: Date.now() }
  await ensure(db, 'content')
  const coll = db.collection('content')
  const prev = await coll.doc('helpVideos').get().catch(() => null) // GC 基线：读旧份
  await coll
    .doc('helpVideos')
    .set({ data: doc })
    .catch(async () => {
      await coll.add({ data: { ...doc, _id: 'helpVideos' } })
    })
  // 孤儿视频 GC（深审 P3·同 publishCourse 思路）：删「旧份有、新份没有」的 videoFileId；fail-soft 不反噬保存
  const keep = new Set(items.flatMap((it: any) => it.segments.map((sg: any) => String(sg.videoFileId))))
  const prevIds = (((prev && (prev.data as any)) || {}).items || []).flatMap((it: any) =>
    ((it.segments || []) as any[]).map((sg: any) => String(sg.videoFileId || '')).filter(Boolean)
  )
  const orphans = [...new Set(prevIds)].filter((id) => !keep.has(id))
  if (orphans.length) await cloud.deleteFile({ fileList: orphans }).catch(() => {})
  return reply(200, { ok: true })
}
