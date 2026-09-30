import { fxHint } from './sysUi'
// 微信客服单源。病根#5：corpId/url 散到多处就会漂——wx.openCustomerServiceChat 只应出现在这一处。
// 根因#8：corpId/url 须真机验（小程序后台绑同主体企业微信 ID + 接待人）。
const CUSTOMER_SERVICE = {
  corpId: 'wwda6861818cb50dd9',
  url: 'https://work.weixin.qq.com/kfid/kfcd94c3a2551535247',
}

function open(): void {
  wx.openCustomerServiceChat({
    corpId: CUSTOMER_SERVICE.corpId,
    extInfo: { url: CUSTOMER_SERVICE.url },
    fail: () => {
      fxHint(null, '客服暂时打不开，请稍后再试')
    },
  })
}

/** 打开微信客服会话。失败（未绑定/未配置）不静默吞，toast 反馈（根因#14 可观测）。
 *  传 copy：先把上下文（订单号/商品/原因）复制到剪贴板，成功回调 onCopied（页面给提示）；
 *  复制失败也照样打开客服——复制只是顺手，不阻断求助。不传参数行为同旧。 */
export function openCustomerService(copy?: string, onCopied?: () => void): void {
  if (!copy) return open()
  wx.setClipboardData({ data: copy, success: () => onCopied?.(), complete: () => open() })
}
