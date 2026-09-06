// 自动保存只有一套串行循环（roots: #5, #8）：在途触发只标脏，完成后用最新状态补存。
// 同 key 的新组件接管旧组件的队列，避免快速切签后的旧快照覆盖新编辑。
// trigger() 返回整条保存链；settled() 只等待已有链，空闲时不额外提交。
interface SaveSlot {
  running: Promise<void> | null
  dirty: boolean
  run: () => Promise<unknown>
}
// key → 共享槽位（模块级·不随组件实例销毁——这正是跨实例协调所需要的「活得比组件久」的存放处）。
const registry = new Map<string, SaveSlot>()

// 同资源跨组件实例共享队列；无 key 时使用独立槽位。两者只在槽位归属上不同。
export function serialSave(run: () => Promise<unknown>, key?: string) {
  const slot: SaveSlot = (key && registry.get(key)) || { running: null, dirty: false, run }
  slot.run = run // 新实例接管：在途链的后续补存读取最新闭包
  if (key) registry.set(key, slot)
  // 注意：trigger 闭包只读 slot.run（不在 trigger 内重新赋值）——若在 trigger() 里也 `slot.run = run`，
  // 旧实例卸载后触发的补存会把 slot.run 又抢回旧闭包，抵消「新实例接管」。归属权只在 serialSave() 调用
  // （构造）那一刻确立一次，谁最后调用 serialSave(fn, key) 谁就是当前归属者。
  async function loop(): Promise<void> {
    try {
      do {
        slot.dirty = false
        await slot.run() // 现读槽位上*当时*最新绑定的 run——可能已被更新的实例接管，latest-wins 跨实例延续
      } while (slot.dirty)
    } finally {
      slot.running = null
    }
  }
  const trigger = (function (): Promise<void> {
    if (slot.running) {
      slot.dirty = true
      return slot.running
    }
    slot.running = loop()
    return slot.running
  }) as { (): Promise<void>; settled(): Promise<void> }
  trigger.settled = () => slot.running ?? Promise.resolve()
  return trigger
}

// 会话过期提示用（批D·根因2）：是否有资源正在自动保存链上（在途请求或已排队的补存）——
// 会话过期跳登录前若命中，说明这次过期可能正好打断了一次未落盘的编辑，不能悄无声息就跳走。
// 只统计走了共享槽位（传 key）的调用——无 key 的组件实例级队列没有登记处，也没有跨组件协调的必要。
export function hasPendingSaves(): boolean {
  for (const slot of registry.values()) if (slot.running || slot.dirty) return true
  return false
}

export async function settleAllSaves(): Promise<void> {
  const promises = []
  for (const slot of registry.values()) {
    if (slot.running) promises.push(slot.running)
  }
  await Promise.all(promises)
}
