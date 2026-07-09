// 批量上传在途锁（P1·bug sweep Round2 item12·同 scmHandoff.ts 单例范式）：Courses 课时级批量传视频
// 期间离页/切步会孤儿化——Courses 有两种宿主形态：独立路由页（onBeforeRouteLeave 能拦）+ 被 Wizard.vue
// `v-else-if="step===4"` 嵌入（Wizard 切步＝仅 query 变化＝路由 update 非 leave，onBeforeRouteLeave 不触发，
// 组件却照样被 v-else-if 卸载——这是主触发路径）。卸载后 batchUpload 循环持有的课时对象裸引用断链，
// 仍在跑的上传把 videoFileId 写回一棵不可达的树，永久丢失且无报错。
// 纯 SPA 模块级单例（同 scmHandoff 不用 Pinia/持久化）：Courses 组件 set/clear；消费方三处——router.ts
// 全局 beforeEach（主闸·任何导航含仅 query 变化必过，收口 Shell 侧栏/浏览器历史旁路）+ Wizard.go() 与
// Courses 自身 onBeforeRouteLeave（纵深·就近给出上下文提示）。
let locked = false

export function setUploadLock(): void {
  locked = true
}
export function clearUploadLock(): void {
  locked = false
}
export function isUploadLocked(): boolean {
  return locked
}
