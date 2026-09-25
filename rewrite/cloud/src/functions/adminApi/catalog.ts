import { str } from '../../kit'

// adminApi 商品/课程草稿工具：白名单清洗、云存储上传、manager-node。与身份/钱链无关，故不放红区 lib.ts。

// 运营手填销量（#119 ①）：非负整数；脏值/缺省→0。不是订单加总。
export function cleanSold(v: unknown): number {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n) || n < 0) return 0
  return n > 99_999_999 ? 99_999_999 : n
}

export const arrOf = (v: unknown, cap: number): any[] => (Array.isArray(v) ? v : []).slice(0, cap)

// 草稿白名单字段（防杂字段入库）
export function cleanProduct(p: any) {
  if (!p || typeof p !== 'object' || !p.id) return null
  return {
    id: String(p.id).slice(0, 40),
    cover: str(p.cover, 300),
    images: arrOf(p.images, 20).map((u: any) => str(u, 300)),
    name: str(p.name, 60),
    price: str(String(p.price ?? ''), 12),
    was: str(String(p.was ?? ''), 12),
    sold: cleanSold(p.sold),
    tag: str(p.tag, 20),
    brief: str(p.brief, 120),
    skus: arrOf(p.skus, 30).map((s: any) => ({ name: str(s?.name, 30), price: str(String(s?.price ?? ''), 12) })),
    params: arrOf(p.params, 8).map((kv: any) => [str(kv?.[0], 10), str(kv?.[1], 40)]),
    detailSections: arrOf(p.detailSections, 4).map((d: any) => ({ lead: str(d?.lead, 30), body: str(d?.body, 200) })),
    kit: arrOf(p.kit, 8).map((k: any) => ({ icon: str(k?.icon, 24), name: str(k?.name, 14), qty: str(k?.qty, 14) })),
    courseId: str(p.courseId, 40),
    cardStatus: p.cardStatus === 'final' ? 'final' : p.cardStatus === 'draft' ? 'draft' : '',
    batchCount: Number(p.batchCount) || 0,
    videoStats:
      p.videoStats && typeof p.videoStats === 'object'
        ? { total: Number(p.videoStats.total) || 0, done: Number(p.videoStats.done) || 0 }
        : null,
    status: p.status === 'onsale' ? 'onsale' : 'preparing',
    createdAt: Number(p.createdAt) || Date.now(),
    updatedAt: Date.now(),
  }
}

// 课程草稿白名单（三层结构，与小程序 courses 同形；字段截断防杂数据）
export function cleanCourse(c: any) {
  if (!c || typeof c !== 'object' || !c.id) return null
  return {
    id: String(c.id).slice(0, 40),
    title: str(c.title, 60),
    sort: Number(c.sort) || 0,
    chapters: arrOf(c.chapters, 30).map((ch: any) => ({
      id: str(ch?.id, 40) || 'c' + Math.random().toString(36).slice(2, 8),
      title: str(ch?.title, 60),
      lessons: arrOf(ch?.lessons, 50).map((l: any) => ({
        id: str(l?.id, 40) || 'l' + Math.random().toString(36).slice(2, 8),
        name: str(l?.name, 60),
        dur: str(l?.dur, 10),
        segments: arrOf(l?.segments, 30).map((sg: any) => ({
          id: str(sg?.id, 40) || 's' + Math.random().toString(36).slice(2, 8),
          name: str(sg?.name, 60),
          dur: str(sg?.dur, 10),
          videoFileId: str(sg?.videoFileId, 300),
          // VOD 转码产物（决策§31 批2·syncVodMedia 服务端回写；此处入白名单让 admin 草稿保存的
          // 往返不抹掉它们）。学员端不泄露：publicSegment/getCourses 逐层白名单不含这些字段，
          // 播放地址只经 getPlaybackUrl 鉴权后签名下发。
          vodUrl: str(sg?.vodUrl, 500),
          vodPoster: str(sg?.vodPoster, 500),
          vodSpriteVtt: str(sg?.vodSpriteVtt, 500),
        })),
      })),
    })),
    updatedAt: Date.now(),
  }
}

// base64 → 云存储 products/<pid>/，返回 fileID + 临时展示 URL
export async function storeImage(cloud: any, b64: string, data: any) {
  const ext = ['png', 'jpg', 'mp4', 'mov'].includes(data.ext) ? data.ext : 'jpg'
  // 消毒（深审 P3·同 getVideoUploadMeta）：客户端串直接拼云存储对象键，'../' 类字符不入路径
  const pid =
    String(data.pid || 'misc')
      .replace(/[^\w-]/g, '')
      .slice(0, 40) || 'misc'
  const prefix = data.kind === 'video' ? 'videos' : 'products'
  const cloudPath = `${prefix}/${pid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const up = await cloud.uploadFile({ cloudPath, fileContent: Buffer.from(b64, 'base64') })
  const r = await cloud.getTempFileURL({ fileList: [up.fileID] })
  return { ok: true, fileID: up.fileID, url: r.fileList[0]?.tempFileURL || '' }
}

// manager-node：用函数运行时临时密钥初始化（签发直传凭证用）
let _manager: any = null
export function manager() {
  if (_manager) return _manager
  const Manager = require('@cloudbase/manager-node')
  _manager = new Manager({
    secretId: process.env.TENCENTCLOUD_SECRETID,
    secretKey: process.env.TENCENTCLOUD_SECRETKEY,
    token: process.env.TENCENTCLOUD_SESSIONTOKEN,
    envId: process.env.TCB_ENV || process.env.SCF_NAMESPACE,
  })
  return _manager
}
