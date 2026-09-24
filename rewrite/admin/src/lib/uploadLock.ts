// 批量上传在途锁：课时批量传视频期间禁止离页/切步，避免卸载后把 videoFileId 写回一棵不可达的树。
// Courses 既是独立页也嵌在上新第 4 步；切步只改 query、路由不 leave，所以锁给 router.beforeEach +
// Wizard.go + 本页 leave 三处一起看。
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
