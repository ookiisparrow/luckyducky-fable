import { isValidPriceYuan } from '@ldrw/shared'
import { reply, cleanProduct, storeImage, type Ctx } from '../lib'

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
  return reply(200, { ok: true, list: res.data, urls, listed })
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
// 历史订单存快照、不回读 products，故删上架不伤订单历史；临时下架属另一功能（院外债#12）。
export async function deleteDraft({ db, drafts, data }: Ctx) {
  const id = String(data.id || '')
  if (!id) return reply(400, { ok: false, error: 'NO_ID' })
  await drafts.doc(id).remove().catch(() => {})
  await db.collection('products').doc(id).remove().catch(() => {})
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
  for (const it of items) {
    const id = String(it?.id || '')
    if (!id) continue
    await productsColl
      .doc(id)
      .update({ data: { sort: Number(it.sort) || 0, featured: !!it.featured } })
      .catch(() => {})
  }
  return reply(200, { ok: true })
}
