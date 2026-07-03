import cloud from 'wx-server-sdk'

/**
 * 取云存储文件临时 URL（kit 收口 cloud 存储原语，业务函数不直引 sdk）。
 * 用于受保护内容：fileID 只在服务端、鉴权通过后换成短时效 URL 下发（审计 P1）。
 */
export async function getTempUrl(fileId: string): Promise<string | null> {
  if (!fileId) return null
  const r = await cloud.getTempFileURL({ fileList: [fileId] })
  return (r.fileList && r.fileList[0] && r.fileList[0].tempFileURL) || null
}

/**
 * 批量换临时 URL（深审 P3）：一次收集全部 fileID、分批 ≤50/次换取（真 sdk getTempFileURL 单次
 * fileList 上限 50·超限被拒）——替代逐个文件一次一调（帮助视频上限 20 主题×20 段=400 次 API 调用/请求）。
 * 返回 fileId → tempFileURL 映射；换不到（文件已删/异常）→ null，调用方回退占位。
 */
export async function getTempUrls(fileIds: string[]): Promise<Record<string, string | null>> {
  const ids = [...new Set(fileIds.filter(Boolean))]
  const out: Record<string, string | null> = {}
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50)
    const r = await cloud.getTempFileURL({ fileList: batch }).catch(() => null)
    for (const f of (r && r.fileList) || []) out[f.fileID] = f.tempFileURL || null
    for (const id of batch) if (!(id in out)) out[id] = null // 整批失败也给显式 null，不留 undefined
  }
  return out
}
