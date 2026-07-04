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
 */
export async function getTempUrls(fileIds: string[]): Promise<Record<string, string | null>> {
  const ids = [...new Set(fileIds.filter(Boolean))]
  const out: Record<string, string | null> = {}
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50)
    const r = await cloud.getTempFileURL({ fileList: batch }).catch(() => null)
    for (const f of (r && r.fileList) || []) out[f.fileID] = f.tempFileURL || null
    for (const id of batch) if (!(id in out)) out[id] = null
  }
  return out
}
