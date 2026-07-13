// 自动保存串行化（守卫 rw-admin-serialsave-golden·治 autosave 乱序覆盖·根因#8「构建过≠真能用」）。
//
// 病根：各页防抖 autosave 直接 `await saveX(整档快照)`，POST 无序号/无队列——慢网下两次自动保存并发在途、
//   乱序完成时服务端最终落的是先发的旧快照，把用户最新编辑覆盖（持久化陈旧态·自愈但窗口内丢数据）。
// 收口：把「实际保存」包一层——在途再触发不并发（只标脏 dirty），当前保存完成后若期间有新编辑则用最新
//   快照补存（run 每次执行现读反应式状态→补存即最新·latest-wins）。抛错也解锁、不锁死后续保存。
// trigger() 返回**当前保存链**的 Promise：`await flushSave()` 会等到链彻底排空（含在途 + 尾随补存）——
//   调用方（如 closeEditor 关闭前）据此保证「等最后一次编辑真落库再置空 ref」，不丢数据。
//
// 跨组件实例乱序覆盖（批D·P1）：以上收口只治得了**同一个 serialSave() 调用**（同一组件实例）内部的乱序——
//   running/dirty 是该次调用的局部闭包变量。Products/Cards/Courses/HelpVideos/PageContent 这类页面每次
//   setup() 都重新调用一次 serialSave()；若用户网络慢时快速切走再切回，Vue 建出全新组件实例、起一条全新
//   独立的串行链，对旧实例仍在途的补存请求一无所知。旧实例卸载那一刻发出的补存请求（读的是卸载时的旧快照）
//   可能比新实例已经成功落库的编辑更晚到达服务器，把新编辑覆盖回旧快照——两条链互不知情，各自的串行化都
//   没错，错在「链」本身按实例分裂了。
// 收口：调用时传 key（同一资源用同一个 key）即改走模块级共享槽位（registry，跨组件重建持续存在，不随组件
//   卸载清空）——同 key 的多次 serialSave() 调用共享同一条 running/dirty 链，且槽位记的 run 永远指向「最近
//   一次调用 serialSave(run, key) 的那个闭包」（新实例接管旧实例的写权）。旧实例卸载触发的补存若命中「链已
//   在途」，只落一个 dirty 标记、不再并发起第二条链；真正执行补存那一轮读的是槽位上*当时*最新的 run——如果
//   新实例已经接管，补存用的就是新实例的现读状态，天然 latest-wins，不管两条请求谁先发出、谁的响应先到。
//   key 缺省时退回纯组件实例级队列（原语义不变，向后兼容——单测大量沿用无 key 调用，且无 key 时也没有可比对
//   的跨实例信息）。
export function serialSave(run: () => Promise<unknown>, key?: string) {
  if (key) return serialSaveShared(run, key)
  let running: Promise<void> | null = null
  let dirty = false
  async function loop(): Promise<void> {
    try {
      do {
        dirty = false
        await run()
      } while (dirty) // 期间有新编辑（dirty）→ 用最新快照再跑一轮·直到干净
    } finally {
      running = null
    }
  }
  const trigger = (function (): Promise<void> {
    if (running) {
      dirty = true // 在途·标脏（不并发发第二个 POST）·返回在途链供调用方 await 排空
      return running
    }
    running = loop()
    return running
  }) as { (): Promise<void>; settled(): Promise<void> }
  // .settled()（批3 规格新增·只加不改既有语义）：只等**已经在途**的链，idle 时不强制多跑一轮 run()——
  // trigger() 本身的 do-while 恒至少跑一次，idle 时调它也会多发一次 POST，不适合"危险动作发起前先确认
  // 没有旧快照的请求还在路上"这类场景（Cards.finalize/Products.doSave 都踩过：clearTimeout 只挡得住
  // 未触发的防抖定时器，挡不住已经发出、正在等回包的请求，晚到的旧快照 autosave 会把新写盖回去）。
  trigger.settled = () => running ?? Promise.resolve()
  return trigger
}

interface SharedSlot {
  running: Promise<void> | null
  dirty: boolean
  run: () => Promise<unknown>
}
// key → 共享槽位（模块级·不随组件实例销毁——这正是跨实例协调所需要的「活得比组件久」的存放处）。
const registry = new Map<string, SharedSlot>()

function serialSaveShared(run: () => Promise<unknown>, key: string) {
  const existing = registry.get(key)
  let slot: SharedSlot
  if (existing) {
    slot = existing
    slot.run = run // 新实例接管：往后（含尾随补存轮）一律用这次最新闭包的 run，不再用旧实例的
  } else {
    slot = { running: null, dirty: false, run }
    registry.set(key, slot)
  }
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
