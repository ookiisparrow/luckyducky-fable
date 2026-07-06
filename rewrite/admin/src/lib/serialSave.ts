// 自动保存串行化（守卫 rw-admin-serialsave-golden·治 autosave 乱序覆盖·根因#8「构建过≠真能用」）。
//
// 病根：各页防抖 autosave 直接 `await saveX(整档快照)`，POST 无序号/无队列——慢网下两次自动保存并发在途、
//   乱序完成时服务端最终落的是先发的旧快照，把用户最新编辑覆盖（持久化陈旧态·自愈但窗口内丢数据）。
// 收口：把「实际保存」包一层——在途再触发不并发（只标脏 dirty），当前保存完成后若期间有新编辑则用最新
//   快照补存一次（run 每次执行现读反应式状态→补存即最新·latest-wins）。抛错也解锁、不锁死后续保存。
export function serialSave(run: () => Promise<unknown>) {
  let saving = false
  let dirty = false
  return async function trigger(): Promise<void> {
    if (saving) {
      dirty = true // 在途·标脏·等当前完成后补存最新（不并发发第二个 POST）
      return
    }
    saving = true
    try {
      await run()
    } finally {
      saving = false
    }
    if (dirty) {
      dirty = false
      void trigger() // 期间有新编辑·用最新快照补存一次
    }
  }
}
