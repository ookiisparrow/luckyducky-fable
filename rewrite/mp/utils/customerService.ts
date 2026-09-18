// 微信客服单源。病根#5：corpId/url 散到多处就会漂——wx.openCustomerServiceChat 只应出现在这一处。
// 根因#8：corpId/url 须真机验（小程序后台绑同主体企业微信 ID + 接待人）。
const CUSTOMER_SERVICE = {
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
