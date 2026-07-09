// 自动保存串行化（守卫 rw-admin-serialsave-golden·治 autosave 乱序覆盖·根因#8「构建过≠真能用」）。
//
// 病根：各页防抖 autosave 直接 `await saveX(整档快照)`，POST 无序号/无队列——慢网下两次自动保存并发在途、
//   乱序完成时服务端最终落的是先发的旧快照，把用户最新编辑覆盖（持久化陈旧态·自愈但窗口内丢数据）。
// 收口：把「实际保存」包一层——在途再触发不并发（只标脏 dirty），当前保存完成后若期间有新编辑则用最新
//   快照补存（run 每次执行现读反应式状态→补存即最新·latest-wins）。抛错也解锁、不锁死后续保存。
// trigger() 返回**当前保存链**的 Promise：`await flushSave()` 会等到链彻底排空（含在途 + 尾随补存）——
//   调用方（如 closeEditor 关闭前）据此保证「等最后一次编辑真落库再置空 ref」，不丢数据。
export function serialSave(run: () => Promise<unknown>) {
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
