// 微信客服单源（M2 播放页竖屏沉浸重设计批·帮助入口）。
// 病根#5「样板复制即漂移」：corpId/url 若散到多处客服入口即漂移、改一处漏三处——
//   rewrite/mp 内 wx.openCustomerServiceChat 只应出现在这一处（守卫 rw-mp-player-immersive 兜底核）。
// 真值承接旧线 packages/miniapp/src/utils/customerService.js（2026-06-16 用户给真值，关键决策§19）。
// 原生线（rewrite/mp）无 uni-app 多端条件编译，恒在微信小程序环境运行，故无需 #ifdef 分支。
// 根因#8「构建过≠真机能用」：corpId/url 须真机验（小程序后台须绑同主体企业微信 ID + 接待人配置）——
//   本批未验，见 rewrite/mp/README.md 真机走查清单「帮助拉起客服」条目。
export const CUSTOMER_SERVICE = {
  corpId: 'wwda6861818cb50dd9',
  url: 'https://work.weixin.qq.com/kfid/kfcd94c3a2551535247',
}

/** 打开微信客服会话。失败（未绑定/未配置）不静默吞，toast 反馈（根因#14 可观测）。 */
export function openCustomerService(): void {
  wx.openCustomerServiceChat({
    corpId: CUSTOMER_SERVICE.corpId,
    extInfo: { url: CUSTOMER_SERVICE.url },
    fail: () => {
      wx.showToast({ title: '客服暂时打不开，请稍后再试', icon: 'none' })
    },
  })
}
