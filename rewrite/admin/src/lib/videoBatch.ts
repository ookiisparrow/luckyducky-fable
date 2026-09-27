// 传视频的前端辅助：课时级「多文件→小段」灌入计划、读本地视频时长；上传走 api/content.uploadVideo。

// 去掉最后一段扩展名（"起针.mp4" → "起针"；无扩展名原样返回）
function stripExt(name: string): string {
  const s = String(name)
  const i = s.lastIndexOf('.')
  return i > 0 ? s.slice(0, i) : s
}

interface BatchPlanItem<T> {
  file: T
  segIndex: number
  isNew: boolean
  segName: string
}

// 计算「文件 → 小段」批量灌入计划：按文件名 numeric 排序（1,2,10 而非字典序 1,10,2），
// 现有段顺序复用、超出 existingCount 的标 isNew（新建）。泛型只依赖 .name·测试可传 {name} 桩。
export function planLessonBatch<T extends { name: string }>(files: T[], existingCount: number): Array<BatchPlanItem<T>> {
  return [...files]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    .map((file, segIndex) => ({ file, segIndex, isNew: segIndex >= existingCount, segName: stripExt(file.name) }))
}

// 视频时长自动读取（选完视频读元数据填 dur·mm:ss）
export function readDuration(file: File): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      const s = Math.round(v.duration || 0)
      resolve(s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '')
    }
    v.onerror = () => {
      URL.revokeObjectURL(url)
      resolve('')
    }
    v.src = url
  })
}
