// 源码扫描式断言的公用工具：先剥注释（防注释文本喂假绿），再按函数截取片段。

export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/** 截取「从某导出函数声明起、到 until 里任一指名函数声明前（或文件末尾）」的源码片段（剥注释后）。 */
export function funcSlice(rawSrc: string, name: string, until: string[] = []): string {
  const src = stripComments(rawSrc)
  const start = new RegExp(`(export\\s+)?async\\s+function\\s+${name}\\s*\\(`).exec(src)
  if (!start) throw new Error(`未找到函数 ${name}`)
  let end = src.length
  for (const u of until) {
    const m = new RegExp(`(export\\s+)?async\\s+function\\s+${u}\\s*\\(`).exec(src.slice(start.index + 1))
    if (m) end = Math.min(end, start.index + 1 + m.index)
  }
  return src.slice(start.index, end)
}
