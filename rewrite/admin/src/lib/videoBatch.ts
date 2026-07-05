// 课时级批量传视频纯逻辑（换皮回归还原·1:1 移植旧 packages/admin/src/utils/videoBatch.js·TS 泛型化便测）。
// 上传本身走 api/content.uploadVideo（不在此·本文件只算「多文件→小段」灌入计划）。守卫 rw-admin-videobatch-golden。

// 去掉最后一段扩展名（"起针.mp4" → "起针"；无扩展名原样返回）
export function stripExt(name: string): string {
  const s = String(name)
  const i = s.lastIndexOf('.')
  return i > 0 ? s.slice(0, i) : s
}

export interface BatchPlanItem<T> {
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
