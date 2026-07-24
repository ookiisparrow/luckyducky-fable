import cloud from 'wx-server-sdk'

/**
 * 微信发货信息上传接缝（根因#12 平台接缝单点 + 合规债#26）。
 *
 * 微信要求「实物 + 微信支付」的小程序在支付成功后上传发货信息（upload_shipping_info），否则订单资金
 * 冻结/无法结算 + 后台反复弹「待接入订单发货管理」。本接缝走微信云开发「云调用」cloud.openapi——
 * access_token 由云环境注入、**无需 AppSecret**（区别 kit/wecom 企业微信走 qyapi 须自管 token）。
 *
 * fail-soft（钱链不反噬·根因#3 边界）：本仓发货以本地 orders 状态机为准（shipOrder 已写库）；微信上传
 * 失败绝不回滚本地发货，只回 { ok, error } 供调用方留痕 + [LD_ALERT] 告警人工补录（mp 后台手动录入兜底）。
 *
 * ⚠️ 真发前置（靠人·根因#8「拿到 ≠ 用通」；未满足时本接缝失败→fail-soft→本地照发 + 告警，不阻塞）：
 *   ① mp 后台开通「发货信息管理」能力（2026-06-26 用户确认已开通）；② 云函数部署产物 config.json 声明 openapi
 *      权限 `wxaSecOrder.uploadShippingInfo`（权限串 === JS 调用路径 cloud.openapi.<串>·官方云调用规则；已由
 *      build.mjs OPENAPI_PERMS 自动产出·守卫 openapi-perm-declared 锁登记不漏）；③ 真单真机验上传成功 +
 *      mp 后台无「待接入发货管理」提醒。代码替不了 ①③ 两步，只把链路做成「配好即生效」。
 */
export type ShipUpload = {
  orderId: string // 商户订单号 out_trade_no（= order.id）
  openid: string // 买家 openid（payer）
  transactionId: string // 微信支付单号（order_number_type=1·首选·无需 mchid）
  company: string // 物流公司中文名（admin 录入）
  trackingNo: string // 运单号
}
export type ShipResult = { ok: boolean; error?: string }

// 微信物流公司编码（delivery_company_list·与快递100 com 编码不同套·债#26）；未命中→'OTHER'（微信允许其他公司）。
const WX_DELIVERY: Record<string, string> = {
  顺丰: 'SF',
  顺丰速运: 'SF',
  圆通: 'YTO',
  圆通速递: 'YTO',
  中通: 'ZTO',
  中通快递: 'ZTO',
  申通: 'STO',
  申通快递: 'STO',
  韵达: 'YD',
  韵达速递: 'YD',
  邮政: 'YZPY',
  中国邮政: 'YZPY',
  EMS: 'EMS',
  京东: 'JD',
  京东物流: 'JD',
  极兔: 'JTSD',
  极兔速递: 'JTSD',
  德邦: 'DBL',
  德邦快递: 'DBL',
}

/** 物流公司中文名 → 微信编码；未登记返 'OTHER'（微信允许 OTHER + 自定义名）。 */
export function wxDeliveryCode(company: string): string {
  return WX_DELIVERY[String(company || '').trim()] || 'OTHER'
}

/**
 * 向微信上传一笔订单的发货信息（云调用·单点）。绝不抛错：任何失败（能力未开通 / 权限未声明 / 网络 /
 * 缺 transactionId）都收成 { ok:false, error } 供调用方 fail-soft 处理。成功返 { ok:true }。
 */
export async function uploadShippingToWx(o: ShipUpload): Promise<ShipResult> {
  if (!o.transactionId) return { ok: false, error: 'NO_TRANSACTION_ID' }
  try {
    const r = await (cloud as any).openapi.wxaSecOrder.uploadShippingInfo({
      orderKey: { orderNumberType: 1, transactionId: o.transactionId },
      logisticsType: 1, // 1=实体物流
      deliveryMode: 1, // 1=统一发货（单包裹）
      shippingList: [
        {
          trackingNo: o.trackingNo,
          expressCompany: wxDeliveryCode(o.company),
          itemDesc: '钩织材料包',
        },
      ],
      uploadTime: new Date().toISOString(),
      payer: { openid: o.openid },
    })
    // 云调用成功 errCode/errcode=0；非 0 视为失败（留原始码供对账）。
    // 回包整个 falsy＝拿不到任何确认，也按失败算——fail-soft 只兜「不抛穿」，不兜「谎报成功」（2026-07-24 变异分诊缺口①）。
    if (!r) return { ok: false, error: 'WX_EMPTY_RESP' }
    const code = r.errCode ?? r.errcode
    if (code != null && code !== 0) return { ok: false, error: 'WX_ERR_' + code }
    return { ok: true }
  } catch (e: any) {
    const code = e && (e.errCode ?? e.errcode)
    return { ok: false, error: code != null ? 'WX_ERR_' + code : String((e && e.message) || 'WX_SHIP_FAIL') }
  }
}
