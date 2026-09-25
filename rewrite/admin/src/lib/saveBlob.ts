// 浏览器端把内存里的文件交给用户下载（打包/导出 CSV/卡面 SVG 共用）。
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
