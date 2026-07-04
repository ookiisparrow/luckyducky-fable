/**
 * 状态机声明的公共形状与派生工具（设计约束#2：状态机单一权威声明 + 可枚举类型）。
 * 新线改进：类型直接从声明**类型级派生**（SpecStates），无需旧线的生成器脚本——
 * 声明与类型零漂移是构造使然，不靠对账。转移原语（kit/transition）随 M1 kit 批立，
 * 届时「一切流转经原语 + 流转表校验」的运行时守卫接上本声明。
 */
export interface StatusSpec {
  readonly collection: string
  readonly initial: readonly string[]
  readonly terminal: readonly string[]
  readonly transitions: readonly { readonly from: readonly string[]; readonly to: string; readonly trigger: string }[]
}

/** 类型级派生：一个声明里出现过的全部状态字符串的联合类型。 */
export type SpecStates<S extends StatusSpec> =
  | S['initial'][number]
  | S['terminal'][number]
  | S['transitions'][number]['from'][number]
  | S['transitions'][number]['to']

/** 运行时派生：全部出现过的状态字符串（去重排序·测试与守卫用）。 */
export function statesOf(spec: StatusSpec): string[] {
  const set = new Set<string>([...spec.initial, ...spec.terminal])
  for (const t of spec.transitions) {
    for (const f of t.from) set.add(f)
    set.add(t.to)
  }
  return [...set].sort()
}
