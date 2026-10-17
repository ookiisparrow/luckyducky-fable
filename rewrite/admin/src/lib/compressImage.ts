// 后台上传前 canvas 压缩（roots: #5）：宽上限 + jpeg 质量阶梯，压到 b64SizeOk 为止。
// 默认跟多数调用方（卡片插画 / 首页 / 目录 hero）走 900 + [0.8, 0.6, 0.45, 0.3]。
// 商品封面/相册走 720 档，调用方显式覆盖，不在这里猜。
import { b64SizeOk } from './mapProducts'

const COMPRESS_DEFAULT_MAX_WIDTH = 900
const COMPRESS_DEFAULT_QUALITIES = [0.8, 0.6, 0.45, 0.3] as const

type CompressImageOpts = {
  maxWidth?: number
  qualities?: readonly number[]
}

export async function compressImage(file: File, opts: CompressImageOpts = {}): Promise<string> {
  const maxWidth = opts.maxWidth ?? COMPRESS_DEFAULT_MAX_WIDTH
  const qualities = opts.qualities ?? COMPRESS_DEFAULT_QUALITIES
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    const scale = Math.min(1, maxWidth / img.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    for (const q of qualities) {
      const b64 = canvas.toDataURL('image/jpeg', q).split(',')[1] || ''
      if (b64SizeOk(b64)) return b64
    }
    return ''
  } catch {
    // 图读不出来与压完仍超限同一出口：交空串，调用方已有「换小一点」提示
    return ''
  } finally {
    URL.revokeObjectURL(url)
  }
}
