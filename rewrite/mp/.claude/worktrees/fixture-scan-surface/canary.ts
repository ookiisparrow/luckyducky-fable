// 扫描面金丝雀（病根#16·2026-07-18 盲区体检批1）——这不是业务代码，是守卫扫描面的活体夹具。
// 本文件故意包含多条守卫的违例 token，且刻意放在 .claude/worktrees/ 下：
//   守卫扫描面若把残留 worktree/dot 目录当活代码扫（当日事故：mp-tabbar-exit-guard 残留
//   worktree 让 main 的 npm run check 假红 10 处），本文件会立刻把闸染红、指到这里。
//   闸恒绿 = walker 的 dot 目录排除在生效。删本文件 = 拆掉扫描面回潮的哨兵，须先过拍板。
// 下列 token 供守卫咬合用（勿改成合法写法，改了金丝雀就死了）：
import { getProducts } from '../api/catalog'
export const canary = () => {
  wx.request({ url: 'https://example.invalid' })
  return getProducts
}
