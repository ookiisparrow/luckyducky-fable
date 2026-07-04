/** 输入边界收口（设计约束「不信前端输入」）：非字符串 → 空串，超长 → 截断。 */
export function str(v: unknown, cap: number): string {
  return typeof v === 'string' ? v.slice(0, cap) : ''
}
