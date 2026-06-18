import { reply, ensure, str, type Ctx } from '../lib'

// —— 首页内容（橱窗逐块②③：hero 文案 / 信任条 / FAQ；规格 §八）——
export async function getHomeContent({ db }: Ctx) {
  const got = await db.collection('content').doc('home').get().catch(() => null)
  return reply(200, { ok: true, home: got?.data || null })
}

export async function saveHomeContent({ db, data }: Ctx) {
  const c = data.home || {}
  // 按课程的激活欢迎图映射 courseId→fileID（同课程同图·欢迎页与产品对应）：上新向导按产品 courseId 传图。
  // 白名单净化：键当 courseId（≤40）、值当云存储 fileID（≤200），封顶 100 条防滥用；空值剔除。
  const rawByCourse =
    c.activationBgByCourse && typeof c.activationBgByCourse === 'object' ? c.activationBgByCourse : {}
  const activationBgByCourse: Record<string, string> = {}
  for (const k of Object.keys(rawByCourse).slice(0, 100)) {
    const v = str(rawByCourse[k], 200)
    if (v) activationBgByCourse[str(k, 40)] = v
  }
  const doc = {
    hero: { title: str(c.hero?.title, 20), tagline: str(c.hero?.tagline, 40) },
    // 激活页背景图（welcome）：存云存储 fileID（cloud://…，≤200）；空＝小程序回退 /static/hero-full.jpg
    activationBg: str(c.activationBg, 200),
    // 按课程激活欢迎图（welcome 按 courseId 取·回退 activationBg→static）
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
