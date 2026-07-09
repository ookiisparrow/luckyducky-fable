import cloud from 'wx-server-sdk'

/**
 * 云存储原语收口（设计约束「受保护内容短时 URL」：fileID 只在服务端、鉴权后才换短时地址下发）。
 */
export async function getTempUrl(fileId: string): Promise<string | null> {
  if (!fileId) return null
  const r = await cloud.getTempFileURL({ fileList: [fileId] })
  return (r.fileList && r.fileList[0] && r.fileList[0].tempFileURL) || null
}

/**
 * 批量换临时 URL：去重后分批 ≤50/次（真 sdk 单次上限 50）；换不到给显式 null（调用方回退占位）。
 * 批间并发（批C）：各批相互独立、互不依赖对方结果，串行 await 纯属浪费网关往返——改批间
 * Promise.all 并发发起，逐批结果落回同一个 map（写不同 key，无共享可变状态竞争）。等价性：
 * ≤50 常态路径只有一批，循环体只跑一次、行为与串行版完全一致（不并发也不改变现状）；单批失败
 * 仍走既有 fail-soft 口径——该批 catch 到 null 后同样把该批全部 id 落 null，不影响其余批次。
 */
export async function getTempUrls(fileIds: string[]): Promise<Record<string, string | null>> {
  const ids = [...new Set(fileIds.filter(Boolean))]
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50))
  const out: Record<string, string | null> = {}
  await Promise.all(
    batches.map(async (batch) => {
      const r = await cloud.getTempFileURL({ fileList: batch }).catch(() => null)
      for (const f of (r && r.fileList) || []) out[f.fileID] = f.tempFileURL || null
      for (const id of batch) if (!(id in out)) out[id] = null
    })
  )
  return out
}
