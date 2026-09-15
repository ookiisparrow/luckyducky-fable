/**
 * 状态机声明的公共形状与派生工具（设计约束#2：状态机单一权威声明 + 可枚举类型）。
 * 类型从声明**类型级派生**（SpecStates），声明与类型零漂移是构造使然。
 * 运行时流转走 kit/transition + 流转表校验。
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
