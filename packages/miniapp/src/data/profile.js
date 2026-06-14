/**
 * 「我」页静态数据。来源：原型 MyProfile.jsx。
 * 以后接后端：用户走 api/user.js、订单角标走 api/shop.js，字段保持一致。
 *
 * 订单图标用墨色版（truck-ink 与首页信任条的紫灰 truck 区分）。
 */
export const USER = {
  name: 'Lucky friend', // 一键登录新用户默认昵称（可在「编辑资料」改）
  lv: 'Lv.2 幸运钩织者',
  bio: '在学钩织的第 12 天，目标是钩满一窝小鸭~',
}

// 继续学习（样例进度；以后由真实观看记录驱动）
export const CONTINUE_VIDEO = {
  ep: '基础课 · 第 3 集',
  name: '起针与锁针 · 钩出第一行',
  at: '08:24',
  dur: '12:30',
  pct: 68,
}

// 订单九宫格入口（角标不再写死——「我」页按订单 store 真实数量计算）
export const ORDER_TABS = [
  { icon: 'wallet', label: '待支付', key: 'pending' },
  { icon: 'package', label: '待发货', key: 'toship' },
  { icon: 'truck-ink', label: '待收货', key: 'toreceive' },
  { icon: 'circle-check-big', label: '已完成', key: 'done' },
  { icon: 'refresh-cw', label: '退款/售后', key: 'refund' },
]
