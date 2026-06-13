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
