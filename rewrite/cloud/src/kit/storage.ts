import cloud from 'wx-server-sdk'

/**
 * 云存储原语收口（设计约束「受保护内容短时 URL」：fileID 只在服务端、鉴权后才换短时地址下发）。
 *
 * 批1·签发缓存（根因#15 加载链路冗余）：临时地址换发是网关外呼（~几十~上百 ms/批），同一批热点图
 * （首页封面/详情图册）在多个会话/多次列表拉取里被反复重签，白打穿组件与 CDN 缓存。这里加**容器级**签发
 * 缓存：只有调用方传了 `maxAge`（明确「这地址我要缓存住 maxAge 秒」）且真换到址才写缓存——**未传 maxAge
 * 的调用行为与现状完全全等**（learning.ts 视频路径零变化，刻意：签发缓存只覆盖长命图片，短命/一次性视频
 * 址不进缓存）。key 含 maxAge（不同 maxAge 不串），TTL 留 5min 安全边际防边界失效。
 */
export interface TempUrlOpts {
  /** 换发时向平台申请的地址有效期（秒）；同时作为容器级签发缓存的 TTL 依据。不传＝不缓存（现状全等）。 */
  maxAge?: number
  /** 是否给换到的 https 址拼数据万象图像处理参数（默认关·见 IMAGE_PROC_SUFFIX）。 */
  imageProc?: boolean
}

/**
 * 图片临时地址有效期（秒）。7200＝2h，与平台观测到的默认过期同值——保守起步、零过期风险；
 * 拉长（省更多重签）留待真机验证长效址在 mp 会话内不失效后再调（根因#8 靠人：真机才证得了）。
 */
export const IMAGE_URL_MAX_AGE = 7200

// 容器级签发缓存（跨请求复用·随冷启动自然清空）：key = `${maxAge}|${fileId}`，值存**原始** https 址
// （不含图像处理参数·读出时才拼·见 withImageProc）——开关翻转/参数变化不吐旧态。上界 2000 条，满了整清
// （简单够用·热点集远小于 2000·别上 LRU 防过度工程）。
const urlCache = new Map<string, { url: string; expireAt: number }>()
const URL_CACHE_MAX = 2000
const CACHE_MARGIN_MS = 5 * 60 * 1000 // TTL 安全边际：提前 5min 过期，防「刚好到点」的边界址失效

/**
 * 图像处理接缝单点（根因#12 平台规则外部风险）：数据万象（CI）的 imageMogr2 处理参数（如
 * `imageMogr2/thumbnail/750x/format/webp/quality/80`）由控制台开通后经环境变量 `LD_IMAGE_PROC` 下发，
 * **空＝关**（当前控制台未开通数据万象的默认态·见 docs/人工配置清单.md）。拼接规则收口在此一处：平台
 * 若改参数格式只改这里 + 环境变量。仅 opts.imageProc 为 true 的调用拼；按 url 是否已含 '?' 决定用 '&'/'?'。
 * 运行时读环境变量（非模块加载期定值）：控制台翻开关重配后，重新引用的缓存原始址即时按新参数拼、不吐旧态。
 */
function withImageProc(url: string): string {
  const suffix = process.env.LD_IMAGE_PROC || ''
  if (!suffix) return url
  return url + (url.includes('?') ? '&' : '?') + suffix
}

/**
 * 批量换临时 URL：去重后分批 ≤50/次（真 sdk 单次上限 50）；换不到给显式 null（调用方回退占位）。
 * 批间并发（批C）：各批相互独立、互不依赖对方结果，串行 await 纯属浪费网关往返——改批间
 * Promise.all 并发发起，逐批结果落回同一个 map（写不同 key，无共享可变状态竞争）。等价性：
 * ≤50 常态路径只有一批，循环体只跑一次、行为与串行版完全一致（不并发也不改变现状）；单批失败
 * 仍走既有 fail-soft 口径——该批 catch 到 null 后同样把该批全部 id 落 null，不影响其余批次。
 *
 * 批1·签发缓存（见文件头注）：传了 maxAge 时先查容器级缓存（命中直接复用原始址·不进 sdk），未命中的
 * 才去换；换到且传了 maxAge 才写缓存（null 不缓存·fail-soft 语义原样）。imageProc 在**读出**时才拼（缓存
 * 存原始址）。**未传 maxAge：完全走原路径**（无缓存读写、fileList 仍传裸 string 数组），与现状字节级全等。
 */
export async function getTempUrls(
  fileIds: string[],
  opts: TempUrlOpts = {}
): Promise<Record<string, string | null>> {
  const { maxAge, imageProc } = opts
  const ids = [...new Set(fileIds.filter(Boolean))]
  const out: Record<string, string | null> = {}
  const now = Date.now()

  // 输出成形：命中缓存直接落原始址（读出时按 imageProc 拼）；未命中攒进 toFetch 去换。
  const toFetch: string[] = []
  for (const id of ids) {
    if (maxAge != null) {
      const hit = urlCache.get(`${maxAge}|${id}`)
      if (hit && hit.expireAt > now) {
        out[id] = imageProc ? withImageProc(hit.url) : hit.url
        continue
      }
    }
    toFetch.push(id)
  }

  const batches: string[][] = []
  for (let i = 0; i < toFetch.length; i += 50) batches.push(toFetch.slice(i, i + 50))
  await Promise.all(
    batches.map(async (batch) => {
      // 传了 maxAge：fileList 项带 { fileID, maxAge } 让平台按需签长效址；未传：裸 string（现状全等）。
      const fileList = maxAge != null ? batch.map((id) => ({ fileID: id, maxAge })) : batch
      const r = await cloud.getTempFileURL({ fileList }).catch(() => null)
      for (const f of (r && r.fileList) || []) {
        const url = f.tempFileURL || null
        if (url && maxAge != null) {
          if (urlCache.size >= URL_CACHE_MAX) urlCache.clear() // 满即整清（简单够用·别上 LRU）
          urlCache.set(`${maxAge}|${f.fileID}`, { url, expireAt: now + maxAge * 1000 - CACHE_MARGIN_MS })
        }
        out[f.fileID] = url ? (imageProc ? withImageProc(url) : url) : null // null 不缓存·fail-soft 原样
      }
      for (const id of batch) if (!(id in out)) out[id] = null
    })
  )
  return out
}

/** 单 id 换址：getTempUrls 的单元素包装（单实现·不传 opts＝现状全等·learning/agentDesk 视频址走此路径不缓存）。 */
export async function getTempUrl(fileId: string, opts: TempUrlOpts = {}): Promise<string | null> {
  if (!fileId) return null
  const map = await getTempUrls([fileId], opts)
  return map[fileId] ?? null
}

/** 仅测试：清空容器级签发缓存，隔离跨 case 复用相同 fileID 的污染（批1）。 */
export function __resetTempUrlCacheForTest(): void {
  urlCache.clear()
}
