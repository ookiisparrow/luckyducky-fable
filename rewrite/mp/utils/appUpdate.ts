// 强制更新接线（R41·上线前必埋钩子）：微信启动时自行检查并下载新版本，这里只接两个结果——就绪即弹确认框
// 重启（带「稍后」取消项，不强打断结算/支付中的用户）；下载失败提示删除重装。不注册 onCheckForUpdate：
// 「检测到更新」时新版本还没下完，此刻提示用户点了也无效。
// 病：mp 全仓零 getUpdateManager 接线，推支付类 hotfix 时老版本用户永远停在旧代码路径上、无感知也无法自愈。
// utils/ 是依赖方向叶层（T4·rw-dep-direction 咬死出度恒为0）：本文件零 import，纯 wx 原生 API 接线，不碰业务层。
export function checkForUpdate(): void {
  if (typeof wx.getUpdateManager !== 'function') return // 基础库过低兜底（同 app.ts 的 `if (wx.cloud)` 判存范式，非 #ifdef——原生线恒在微信环境无需条件编译）
  const mgr = wx.getUpdateManager()
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
