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
  const doc = {
    hero: { title: str(c.hero?.title, 20), tagline: str(c.hero?.tagline, 40) },
    // 激活页背景图（welcome）：存云存储 fileID（cloud://…，≤200）；空＝小程序回退 /static/hero-full.jpg
    activationBg: str(c.activationBg, 200),
    // 全局·正在激活(loading)图：loading 时还拿不到 courseId 故全局（橱窗管）；空＝回退 activationBg→static
    loadingBg: str(c.loadingBg, 200),
    // 按课程·按状态激活欢迎图（welcome 按屏取·回退 activationBg→static）
    activationBgByCourse,
    trust: (Array.isArray(c.trust) ? c.trust : [])
      .slice(0, 4)
      .map((t: any) => ({ icon: str(t?.icon, 20), label: str(t?.label, 12) })),
    faq: (Array.isArray(c.faq) ? c.faq : [])
      .slice(0, 8)
      .map((f: any) => ({ title: str(f?.title, 40), body: str(f?.body, 150) })),
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

export async function saveHelpVideos({ db, data }: Ctx) {
  // 白名单净化：每条 id/title/sub/desc/dur/videoFileId 限长；封顶 20 条防滥用；空条（无标题且无视频）剔除。
  const raw = Array.isArray(data.items) ? data.items : []
  const items = raw
    .slice(0, 20)
    .map((it: any) => ({
      id: str(it.id, 40) || 'h' + Math.random().toString(36).slice(2, 8),
      title: str(it.title, 40),
      sub: str(it.sub, 40),
      desc: str(it.desc, 150),
      dur: str(it.dur, 10),
      videoFileId: str(it.videoFileId, 200),
    }))
    .filter((it: any) => it.title || it.videoFileId)
  const doc = { items, updatedAt: Date.now() }
  await ensure(db, 'content')
  const coll = db.collection('content')
  await coll
    .doc('helpVideos')
    .set({ data: doc })
    .catch(async () => {
      await coll.add({ data: { ...doc, _id: 'helpVideos' } })
    })
  return reply(200, { ok: true })
}
