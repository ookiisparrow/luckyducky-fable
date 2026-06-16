// 微信客服单源 + 打开 helper（R18 / 占位⑨ 升级·关键决策§19，2026-06-16 用户给真值）。
//
// 病根#5「样板复制即漂移」：corpId/url 若散到 4 个客服入口即漂移、改一处漏三处。
//   收口此处单源——4 入口（详情坞 / 「我」/ 售后 / 播放页求助）都调 openCustomerService()，
//   展示组件 emit→父级调、页面直接调，谁都不内联 wx.openCustomerServiceChat 与值。
// 根因#8「构建过≠真机能用」：corpId/url 须真机验过（平台 SDK 不真机验即错·快递100 plugin-private 教训）。
//   真机验「点客服→进微信客服会话」靠人（小程序后台须绑同主体企业 ID·接待人配置）。
export const CUSTOMER_SERVICE = {
  corpId: 'wwda6861818cb50dd9',
  url: 'https://work.weixin.qq.com/kfid/kfcd94c3a2551535247',
}

// 打开微信客服会话。微信端走 wx.openCustomerServiceChat（独立微信客服·跨渠道/企业微信接待）；
// 失败（未绑定/未配置）或非微信端回退提示，不静默吞。
export function openCustomerService() {
  // #ifdef MP-WEIXIN
  wx.openCustomerServiceChat({
    corpId: CUSTOMER_SERVICE.corpId,
    extInfo: { url: CUSTOMER_SERVICE.url },
    fail: () => {
      uni.showToast({ title: '客服暂时打不开，请稍后再试', icon: 'none' })
    },
  })
  // #endif
  // #ifndef MP-WEIXIN
  uni.showToast({ title: '客服请在微信小程序内使用', icon: 'none' })
  // #endif
}
