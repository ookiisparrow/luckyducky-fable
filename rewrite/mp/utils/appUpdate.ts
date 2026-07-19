// 强制更新接线（R41·上线前必埋钩子）：wx.getUpdateManager 三段式——静默检查→就绪即弹确认框重启（带「稍后」
// 取消项，不强打断结算/支付中的用户）→下载失败提示删除重装。
// 病：mp 全仓零 getUpdateManager 接线，推支付类 hotfix 时老版本用户永远停在旧代码路径上、无感知也无法自愈。
// utils/ 是依赖方向叶层（T4·rw-dep-direction 咬死出度恒为0）：本文件零 import，纯 wx 原生 API 接线，不碰业务层。
export function checkForUpdate(): void {
  if (typeof wx.getUpdateManager !== 'function') return // 基础库过低兜底（同 app.ts 的 `if (wx.cloud)` 判存范式，非 #ifdef——原生线恒在微信环境无需条件编译）
  const mgr = wx.getUpdateManager()
  mgr.onCheckForUpdate(() => {
    // 仅登记信号（有无新版本可查），不在此处弹窗——真正触发用户可见提示的是 onUpdateReady（新版本已下载
    // 完毕才弹，避免「检测到更新」和「下载完成可重启」之间有个用户点了也无效的空档期）。
  })
  mgr.onUpdateReady(() => {
    wx.showModal({
      title: '发现新版本',
      content: '新版本已经准备好，重启后即可使用',
      showCancel: true, // 带「稍后」：用户可能正在结算/支付流程中途，不强制打断（主脑裁决·非规格原案的 showCancel:false）
      cancelText: '稍后',
      confirmText: '立即重启',
      success: (res) => {
        if (res.confirm) mgr.applyUpdate()
      },
    })
  })
  mgr.onUpdateFailed(() => {
    wx.showModal({
      title: '更新失败',
      content: '新版本下载失败，请删除小程序后重新搜索打开',
      showCancel: false,
    })
  })
}
