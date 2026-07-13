import { isValidPriceYuan } from '@ldrw/shared'
import { reply, cleanProduct, storeImage, type Ctx } from '../lib'
import { notifyAlert } from '../../../kit'

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

export async function saveDraft({ drafts, data }: Ctx) {
  const p = cleanProduct(data.product)
  if (!p) return reply(400, { ok: false, error: 'BAD_PRODUCT' })
  await drafts
    .doc(p.id)
    .set({ data: p })
    .catch(async () => {
      await drafts.add({ data: { ...p, _id: p.id } })
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
export async function deleteDraft({ db, drafts, data }: Ctx) {
  const id = String(data.id || '')
  if (!id) return reply(400, { ok: false, error: 'NO_ID' })
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
  await drafts.doc(id).update({ data: { status: 'onsale' } })
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
