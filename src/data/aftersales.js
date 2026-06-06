/**
 * 退款/售后页静态数据。来源：原型 Checkout.jsx 的 AS_TYPES / AS_ORDERS。
 * 以后接后端：售后类型固定、可申请订单走 api/shop.js。图标用紫色变体。
 */
export const AS_TYPES = [
  { icon: 'rotate-ccw-purple', label: '退货退款', sub: '已收到货' },
  { icon: 'wallet-purple', label: '仅退款', sub: '未收到货' },
  { icon: 'repeat', label: '换货', sub: '换色/款式' },
  { icon: 'message-square-warning', label: '投诉商家', sub: '问题反馈' },
]

// 历史快照（denormalized，order-specific）；样例价对齐总表 catalog，避免看着不一致。
export const AS_ORDERS = [
  { name: '幸运小鸭礼盒 · 经典暖黄', meta: '已完成 · 2026-05-30', price: 198 },
  { name: '进阶套装 · 小伙伴们', meta: '待收货 · 2026-06-02', price: 399 },
]
