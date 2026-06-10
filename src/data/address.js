/**
 * 地址簿样例数据（用户域）。从 data/checkout.js 迁出（技术债 #3）：
 * 地址属用户域，不该依赖结算页数据。地址上云后这份样例只作 H5 / App 回退或删除。
 */

// 样例收货地址：address store 初始播一条，保证结算开箱即可下单
export const SAMPLE_ADDRESS = {
  name: '陈圆圆',
  phone: '138 0000 1234',
  isDefault: true,
  region: '浙江省 杭州市 西湖区',
  detail: '文三路 478 号华星时代广场 A 座 1502 室',
}
