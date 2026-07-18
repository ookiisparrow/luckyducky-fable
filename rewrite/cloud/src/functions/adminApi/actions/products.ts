import { isValidPriceYuan } from '@ldrw/shared'
import { reply, cleanProduct, storeImage, type Ctx } from '../lib'
import { notifyAlert } from '../../../kit'

// —— 商品图册孤儿 GC 判据单源（E16 共享 helper·防多点漂移·批B）——
// 换图/发布替换/删档三处写点共用这一份 diff 计算 + cover 豁免，别各写一份（漂移＝漏删或误删）。
const GC_GRACE_MS = 24 * 3600 * 1000 // 孤儿图缓期 24h（对齐 courses.publishCourse·在场 admin/详情会话临时址 TTL 内不断图）

type ImgDoc = { cover?: string; images?: string[] } | null | undefined
// 收拢一组文档的图片 fileID：只认 cloud:// 云存储对象（外链/占位符不可删）；cover 位单列供规则1豁免。
function collectImgs(docs: ImgDoc[]): { all: Set<string>; covers: Set<string> } {
  const all = new Set<string>()
  const covers = new Set<string>()
  for (const d of docs) {
    if (!d) continue
    const c = d.cover
    if (c && String(c).startsWith('cloud://')) {
      all.add(String(c))
      covers.add(String(c))
    }
    for (const u of d.images || []) if (u && String(u).startsWith('cloud://')) all.add(String(u))
  }
  return { all, covers }
}
// 孤儿判据（规则2·3·1）：孤儿 ⇔ 变更前并集有、变更后并集无、且不在 cover 豁免集（前后×两档四处 cover
// 的并集·规则1 cover 永不删）。**只按 cover/images 字段的 fileID 精确差集**，永远禁止按存储文件夹列举
// 删除——`products/<pid>/` 前缀被卡片图(Cards.vue·pid=商品id)、首页内容(HomeContentForm·pid='homecontent')、
// 目录页(CatalogPlayerTab·pid='catalogcontent')共居复用：这些图从不写进 products 草稿/发布档的 cover/images
// 字段，故字段差集天然碰不到它们；反之任何「列文件夹删除」形态都会误删共居文件。后人勿改成扫文件夹
// （守卫测试 product-img-gc ⑦ 钉死：禁任何「文件夹/前缀枚举」类存储 API 名出现在本文件）。
function diffOrphans(before: ImgDoc[], after: ImgDoc[]): { orphans: string[]; keep: Set<string> } {
  const b = collectImgs(before)
  const a = collectImgs(after)
  const coverExempt = new Set<string>([...b.covers, ...a.covers])
  const orphans: string[] = []
  for (const id of b.all) if (!a.all.has(id) && !coverExempt.has(id)) orphans.push(id)
  return { orphans, keep: a.all }
}
// 承接旧队列（过滤重新被引用的·keep）+ 本次新孤儿入队（去重·加缓期）——镜像 courses.publishCourse。
function mergePendingGc(old: any, orphans: string[], keep: Set<string>): { fileId: string; deleteAfter: number }[] {
  const carried = (Array.isArray(old) ? old : []).filter((en: any) => en && en.fileId && !keep.has(String(en.fileId)))
  const queued = new Set(carried.map((en: any) => String(en.fileId)))
  const now = Date.now()
  const fresh = orphans.filter((id) => !queued.has(id))
  return [...carried, ...fresh.map((fileId) => ({ fileId, deleteAfter: now + GC_GRACE_MS }))]
}

export async function listDrafts({ cloud, db, drafts }: Ctx) {
  const res = await drafts.orderBy('createdAt', 'desc').limit(100).get()
  const ids = new Set<string>()
  for (const p of res.data) {
    if (p.cover && p.cover.startsWith('cloud://')) ids.add(p.cover)
    for (const u of p.images || []) if (u.startsWith('cloud://')) ids.add(u)
  }
  const urls: Record<string, string> = {}
  if (ids.size) {
    const r = await cloud.getTempFileURL({ fileList: [...ids] })
    for (const f of r.fileList) if (f.tempFileURL) urls[f.fileID] = f.tempFileURL
  }
  // 上架/下架状态映射（S11·债#12 软下架显形）：listed 标记在 products、不在草稿，控制台靠它分
  // 「在售（onsale+listed≠false）/ 已下架（onsale+listed:false）/ 筹备中（未上架·无 products 文档）」。
  // 一次性批量取（草稿 ≤100·bounded·根因#7），口径与 getProducts 一致（旧无字段=可售）。
  const draftIds = res.data.map((p: any) => p.id || p._id).filter(Boolean)
  const listed: Record<string, boolean> = {}
  if (draftIds.length) {
    const pr = await db
      .collection('products')
      .where({ _id: db.command.in(draftIds) })
      .field({ listed: true })
      .get()
      .catch(() => ({ data: [] as any[] }))
    for (const p of pr.data) listed[p._id] = p.listed !== false
  }

  // 6 步上新进度派生（换皮误判「分步态无源·略」·实则可由 cards/courses/qrcodes 批量 join·bounded 同 listed 范式·根因#7）：
  // 视频(课程有段带 videoFileId) / 卡片(card 定稿 final) / 批次(该课有 qrcode·aggregate group 只回有码的课·不扫全表)。
  const _ = db.command
  const courseIds = res.data.map((p: any) => String(p.courseId || '') || 'course-' + (p.id || p._id)).filter(Boolean)
  const cardFinal: Record<string, boolean> = {}
  const hasVideo: Record<string, boolean> = {}
  const hasBatch: Record<string, boolean> = {}
  if (draftIds.length) {
    const cardIds = draftIds.map((id: string) => 'card-' + id)
    const [cr, cor, br] = await Promise.all([
      db.collection('cards').where({ _id: _.in(cardIds) }).get().catch(() => ({ data: [] as any[] })),
      db.collection('courses').where({ _id: _.in(courseIds) }).get().catch(() => ({ data: [] as any[] })),
      // aggregate group：只回「有 qrcode 的 courseId」一行/课·不逐码扫（capacity·根因#7）
      db.collection('qrcodes').aggregate().match({ courseId: _.in(courseIds) }).group({ _id: '$courseId' }).end().catch(() => ({ list: [] as any[] })),
    ])
    for (const c of (cr as any).data || []) {
      const pid = String(c.productId || String(c._id || '').replace(/^card-/, ''))
      cardFinal[pid] = c.status === 'final'
    }
    for (const c of (cor as any).data || []) {
      const cid = String(c.id || c._id || '')
      let vid = false
      for (const ch of c.chapters || []) for (const ls of ch.lessons || []) for (const sg of ls.segments || []) if (sg && sg.videoFileId) vid = true
      hasVideo[cid] = vid
    }
    for (const g of (br as any).list || []) hasBatch[String(g._id || '')] = true
  }
  return reply(200, { ok: true, list: res.data, urls, listed, cardFinal, hasVideo, hasBatch })
}

export async function saveDraft({ db, drafts, data }: Ctx) {
  const p = cleanProduct(data.product)
  if (!p) return reply(400, { ok: false, error: 'BAD_PRODUCT' })
  // 换图缓期 GC（批B·规则4）：整份覆盖前先取旧草稿+发布档，算被撤且非 cover 的孤儿图，缓期入 drafts.pendingGc
  // （单队列之家=草稿档）；不立删——admin listDrafts/mp 详情给这些图签过临时址，同步删=在场会话见 404。
  // pendingGc 是服务端衍生字段（cleanProduct 白名单不含它·客户端注入不了）：从旧草稿读、覆盖时带回。
  const [prevDraft, pub] = await Promise.all([
    drafts.doc(p.id).get().then((r: any) => r.data).catch(() => null),
    db.collection('products').doc(p.id).get().then((r: any) => r.data).catch(() => null),
  ])
  const { orphans, keep } = diffOrphans([prevDraft, pub], [p, pub])
  const withGc = { ...p, pendingGc: mergePendingGc(prevDraft?.pendingGc, orphans, keep) }
  await drafts
    .doc(p.id)
    .set({ data: withGc })
    .catch(async () => {
      await drafts.add({ data: { ...withGc, _id: p.id } })
    })
  return reply(200, { ok: true })
}

// 删除：草稿 + 已上架商品一并删（外部体检 P2：原只删草稿，已上架仍被买＝「不可撤销」失真）。
// 历史订单存快照、不回读 products，故删上架不伤订单历史；停售/软下架已实现（见本文件 unpublishProduct·债#12 已清）。
//
// 顺序反转 + 失败可见（P0·bug 清除战役II F1）：原两条 remove 各自 .catch(()=>{}) 全吞、恒 ok:true——
// products 删失败时后台列表已消失、小程序端仍在售可购买，管理员却被告知「已删除」。
// 改：**先删 products（发布面）再删 drafts**——若 products 删失败，drafts 还在、商品仍在后台草稿列表
// 可重试删除；危险方向永远是「后台不见了、前台还在卖」，反转顺序后不再可能发生。任一步失败即
// ok:false，不再继续下一步、不再无条件回 ok:true；动作类失败（病根14）经 notifyAlert 留痕。
export async function deleteDraft({ db, cloud, drafts, data }: Ctx) {
  const id = String(data.id || '')
  if (!id) return reply(400, { ok: false, error: 'NO_ID' })
  // 图册立即删（批B·规则5 例外）：两档文档一并删除后 pendingGc 无处安身、商品已不存在（在场详情会话本已死），
  // 立即删可接受。先读两档收 fileID（删档后无从取），cover 位仍豁免（订单快照·规则1）。走 diffOrphans 同源
  // 的 collectImgs：只认 cover/images 字段的 cloud:// fileID，绝不列文件夹（防误删共居的卡片/首页/目录图）。
  const [draftDoc, pubDoc] = await Promise.all([
    drafts.doc(id).get().then((r: any) => r.data).catch(() => null),
    db.collection('products').doc(id).get().then((r: any) => r.data).catch(() => null),
  ])
  const { all, covers } = collectImgs([draftDoc, pubDoc])
  // 并入草稿档已挂起的 pendingGc 队列（前一次换图/发布替换产生、尚在 24h 缓期内的孤儿）：draft 文档是
  // pendingGc 唯一之家，下方 remove() 后队列随文档消失——若只删「当前字段差集」，队里未到期的孤儿将无
  // 文档引用、无队列记录、cleanupEvents 也扫不到，永久漏在云存储。规则5「立即删可接受」本就覆盖这些孤儿
  // （商品已不存在·在场会话已死），故一并立删。cover 豁免同样适用（cover 永不进 pendingGc·防御性保留）。
  const queued = (Array.isArray(draftDoc?.pendingGc) ? draftDoc.pendingGc : [])
    .map((en: any) => String(en?.fileId || ''))
    .filter(Boolean)
  const orphans = [...new Set([...all, ...queued])].filter((u) => !covers.has(u)) // cover 永不删（规则1）
  const prodErr = await db
    .collection('products')
    .doc(id)
    .remove()
    .then(() => null)
    .catch((e: any) => e || new Error('REMOVE_FAIL'))
  if (prodErr) {
    // products 删失败：发布面未下、drafts 保留不动——不继续删 drafts，管理员可在草稿列表重试删除
    await notifyAlert('anomaly', 'deleteDraft', 'REMOVE_FAIL', { id, stage: 'products' })
    return reply(200, { ok: false, error: 'REMOVE_FAIL' })
  }
  const draftErr = await drafts
    .doc(id)
    .remove()
    .then(() => null)
    .catch((e: any) => e || new Error('REMOVE_FAIL'))
  if (draftErr) {
    // products 已删成功（发布面已下）、drafts 残留：如实报失败并留痕，注明状态——重试删除即可收敛
    await notifyAlert('anomaly', 'deleteDraft', 'REMOVE_FAIL', { id, stage: 'drafts', note: 'products already removed' })
    return reply(200, { ok: false, error: 'REMOVE_FAIL' })
  }
  // 两档已删净 → 立即删图册（规则5·cover 已豁免）。deleteFile 失败即留痕告警 + ok:false（病根14·批A 口径）——
  // 档已删、文件泄漏，告警带 orphans 供人工兜底清理，绝不静默吞。
  if (orphans.length) {
    const gcOk = await cloud.deleteFile({ fileList: orphans }).then(() => true).catch(() => false)
    if (!gcOk) {
      await notifyAlert('anomaly', 'deleteDraft', 'GC_DELETE_FAIL', { id, orphans })
      return reply(200, { ok: false, error: 'GC_DELETE_FAIL' })
    }
  }
  return reply(200, { ok: true })
}

// 小图单发（b64 ≤ 80K 字符）；大图走分片（HTTP 请求体上限约 100KB，调试日志 F）
export async function uploadImage({ cloud, data }: Ctx) {
  const b64 = String(data.b64 || '')
  if (!b64 || b64.length > 90_000) return reply(400, { ok: false, error: 'BAD_IMAGE' })
  return reply(200, await storeImage(cloud, b64, data))
}

// 上架小程序：商品草稿 → products（价格转数字，重复上架保留原 sort/featured）
export async function publishProduct({ db, drafts, data }: Ctx) {
  const id = String(data.id || '')
  if (!id) return reply(400, { ok: false, error: 'NO_ID' })
  const got = await drafts.doc(id).get().catch(() => null)
  if (!got || !got.data) return reply(400, { ok: false, error: 'NO_DRAFT' })
  const d = got.data
  if (!d.cover) return reply(400, { ok: false, error: 'NEED_COVER' })
  // 价格硬边界：有限正数且 ≤ 上限——拦负价 / Infinity / 超大价穿透（外部体检 P1）
  if (!d.name || !isValidPriceYuan(d.price)) return reply(400, { ok: false, error: 'NEED_INFO' })
  if (
    !Array.isArray(d.skus) ||
    !d.skus.length ||
    d.skus.some((x: any) => !x.name || !isValidPriceYuan(x.price))
  ) {
    return reply(400, { ok: false, error: 'NEED_SKUS' })
  }
  const productsColl = db.collection('products')
  const exist = await productsColl.doc(id).get().catch(() => null)
  let sort = exist?.data?.sort
  let featured = exist?.data?.featured
  if (sort === undefined) {
    const top = await productsColl.orderBy('sort', 'desc').limit(1).get()
    sort = (top.data[0]?.sort ?? 0) + 1
    featured = true
  }
  // 重新上架（编辑后再发布）不得隐式改变销售状态：保留旧 listed/unlistedAt——已停售（listed:false）商品
  // 编辑重发仍停售，须显式 republishProduct 才恢复销售（审核 P1·债#12·防整文档 set 抹掉 listed→「无字段=可售」隐式复活）。
  const carry: Record<string, unknown> = {}
  if (exist?.data && 'listed' in exist.data) {
    carry.listed = exist.data.listed
    if (exist.data.unlistedAt != null) carry.unlistedAt = exist.data.unlistedAt
  }
  const doc = {
    id,
    name: d.name,
    tag: d.tag || '',
    price: Number(d.price),
    was: isValidPriceYuan(d.was) ? Number(d.was) : null,
    brief: d.brief || '',
    cover: d.cover,
    images: d.images || [],
    skus: d.skus.map((x: any) => ({ name: x.name, price: Number(x.price) })),
    params: d.params || [],
    detailSections: d.detailSections || [],
    kit: d.kit || [],
    courseId: d.courseId || '',
    featured: !!featured,
    sort,
    updatedAt: Date.now(),
    ...carry, // 保留旧 listed/unlistedAt（重新上架不隐式恢复销售·审核 P1）
  }
  await productsColl
    .doc(id)
    .set({ data: doc })
    .catch(async () => {
      await productsColl.add({ data: { ...doc, _id: id } })
    })
  // 发布替换孤儿缓期入队（批B·规则4）：旧发布(exist)不再被新发布(doc=草稿)引用的非 cover 图进 drafts.pendingGc
  // （单队列之家=草稿档·发布 action 也写它），对齐 courses.publishCourse；立删会让在场 admin/详情会话临时址 404。
  // products 档本身不携 pendingGc（doc 显式白名单不含它）——队列只此一家在草稿档。
  const { orphans, keep } = diffOrphans([exist?.data, d], [doc, d])
  const pendingGc = mergePendingGc(d.pendingGc, orphans, keep)
  await drafts.doc(id).update({ data: { status: 'onsale', pendingGc } })
  return reply(200, { ok: true })
}

// 停售（软下架·债#12）：products.listed=false → getProducts 不再下发（顾客端列表消失）。
// 区别 deleteDraft（硬删商品记录）：停售可恢复、保留记录；区别 saveShowcase 的 featured（只管首页橱窗位）。
// 详情页直达（按 id）与历史订单快照不受影响（订单存快照、不回读 products）。
export async function unpublishProduct({ db, data }: Ctx) {
  const id = String(data.id || '')
  if (!id) return reply(400, { ok: false, error: 'NO_ID' })
  const upd = await db
    .collection('products')
    .doc(id)
    .update({ data: { listed: false, unlistedAt: Date.now() } })
    .catch(() => null)
  if (!upd || !upd.stats || upd.stats.updated !== 1) return reply(400, { ok: false, error: 'NO_PRODUCT' })
  return reply(200, { ok: true })
}

// 恢复销售（债#12）：listed=true → getProducts 重新下发。
export async function republishProduct({ db, data }: Ctx) {
  const id = String(data.id || '')
  if (!id) return reply(400, { ok: false, error: 'NO_ID' })
  const upd = await db
    .collection('products')
    .doc(id)
    .update({ data: { listed: true, unlistedAt: null } })
    .catch(() => null)
  if (!upd || !upd.stats || upd.stats.updated !== 1) return reply(400, { ok: false, error: 'NO_PRODUCT' })
  return reply(200, { ok: true })
}

// —— 小程序橱窗（规格 §八）：一比一首页预览的排序与上下架 ——
export async function listShowcase({ db, cloud }: Ctx) {
  const res = await db.collection('products').orderBy('sort', 'asc').limit(100).get()
  const ids = res.data.map((p: any) => p.cover).filter((u: any) => u && u.startsWith('cloud://'))
  const urls: Record<string, string> = {}
  if (ids.length) {
    const r = await cloud.getTempFileURL({ fileList: [...new Set<string>(ids)] })
    for (const f of r.fileList) if (f.tempFileURL) urls[f.fileID] = f.tempFileURL
  }
  return reply(200, { ok: true, list: res.data, urls })
}

export async function saveShowcase({ db, data }: Ctx) {
  const items = Array.isArray(data.items) ? data.items.slice(0, 100) : []
  if (!items.length) return reply(400, { ok: false, error: 'NO_ITEMS' })
  const productsColl = db.collection('products')
  let failed = 0 // 逐条失败计数（P2·bug sweep Round2 item16·根因#14）：原 .catch(()=>{}) 静默吞错，无论成败前端
  // 永远收到 ok:true——「已保存」是假象。改计数后任一失败即回 ok:false，不再误导消费方（admin Showcase.vue
  // 已按 r.ok 通用判断成败，无需改消费方）。
  for (const it of items) {
    const id = String(it?.id || '')
    if (!id) continue
    await productsColl
      .doc(id)
      .update({ data: { sort: Number(it.sort) || 0, featured: !!it.featured } })
      .catch(() => {
        failed++
      })
  }
  if (failed) {
    // 真留痕（P2·bug sweep Round2 复审补漏）：裸 alert() 只打 console.error 一行，不落 anomalies 账本、
    // admin listAnomalies 查不到、企微群也收不到——不满足「留痕」二字（同 learning.ts ensureActivation
    // 注释 / orders.ts shipOne 既有写法）。改 notifyAlert：①同样打日志 ②落 anomalies 账本 ③按配置推企微。
    await notifyAlert('anomaly', 'saveShowcase', 'PARTIAL_WRITE', { failed, total: items.length })
    return reply(400, { ok: false, error: 'PARTIAL_WRITE:' + failed })
  }
  return reply(200, { ok: true })
}
