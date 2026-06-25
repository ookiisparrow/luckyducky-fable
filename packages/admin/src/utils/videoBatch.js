/**
 * 课时级批量传视频的纯逻辑：把一次选中的多个文件按文件名顺序映射到该课时的小段，
 * 现有段顺序复用、超出部分标记新建。上传本身走 api/cloud.js 的 uploadVideo（不在此）。
 */

// 去掉最后一段扩展名（"起针.mp4" → "起针"；无扩展名原样返回）
export function stripExt(name) {
  const s = String(name)
  const i = s.lastIndexOf('.')
  return i > 0 ? s.slice(0, i) : s
}

/**
 * 计算「文件 → 小段」批量灌入计划。
 * @param {Array<{name:string}>} files 选中的文件（真实 File 天然有 .name）
 * @param {number} existingCount 该课时现有小段数
 * @returns {Array<{file, segIndex:number, isNew:boolean, segName:string}>} 按文件名 numeric 排序
 */
export function planLessonBatch(files, existingCount) {
  return [...files]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    .map((file, segIndex) => ({
      file,
      segIndex,
      isNew: segIndex >= existingCount,
      segName: stripExt(file.name),
    }))
}
