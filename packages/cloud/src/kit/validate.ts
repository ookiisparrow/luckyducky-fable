/**
 * 输入边界收口（根因账本 #3：不信任前端输入）。
 * str：非字符串 → 空串，超长 → 截断。消费者 updateProfile / trackEvent（≥2，B4b 落地）。
 */
export function str(v: unknown, cap: number): string {
  return typeof v === 'string' ? v.slice(0, cap) : ''
}
