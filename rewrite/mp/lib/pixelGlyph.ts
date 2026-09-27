// 像素小字形点阵（v5 设计稿 pixel-mini.js 移植·2px 图标级）：X＝实心（跟随文字色），x＝25% 淡晕。
// 渲染走 box-shadow（一个图标一个节点、颜色吃 currentColor、整格不糊），不用 canvas——静态小图标不值得异步取节点。
// ponytail: 不做设计稿的「吸附物理像素」平移；真机出现半像素糊边再补。
export const PIXEL_GLYPHS: Record<string, string[]> = {
  back: ['...XX', '..XX.', '.XX..', 'XX...', '.XX..', '..XX.', '...XX'],
  chev: ['XX...', '.XX..', '..XX.', '...XX', '..XX.', '.XX..', 'XX...'],
  arrow: ['....X..', '.....X.', 'XXXXXXX', '.....X.', '....X..'],
  up: ['..X..', '.XXX.', 'X.X.X', '..X..', '..X..', '..X..', '..X..'],
  down: ['..X..', '..X..', '..X..', '..X..', 'X.X.X', '.XXX.', '..X..'],
  minus: ['.....', '.....', 'XXXXX', '.....', '.....'],
  plus: ['..X..', '..X..', 'XXXXX', '..X..', '..X..'],
  times: ['X...X', '.X.X.', '..X..', '.X.X.', 'X...X'],
  check: ['......X', '.....XX', 'X...XX.', 'XX.XX..', '.XXX...', '..X....'],
  play: ['X....', 'XX...', 'XXX..', 'XXXX.', 'XXX..', 'XX...', 'X....'],
  playL: ['X......', 'XX.....', 'XXX....', 'XXXX...', 'XXXXX..', 'XXXXXX.', 'XXXXX..', 'XXXX...', 'XXX....', 'XX.....', 'X......'],
  pause: ['XX.XX', 'XX.XX', 'XX.XX', 'XX.XX', 'XX.XX', 'XX.XX', 'XX.XX'],
  star: ['...X...', '..XXX..', 'XXXXXXX', '.XXXXX.', '..XXX..', '.XX.XX.', 'XX...XX'],
  star5: ['..X..', '.XXX.', 'XXXXX', '.XXX.', '.X.X.'],
  // 写评价星键用的 9×9 大星（设计稿 px-star·用 size=4 场景格）
  star9: ['....X....', '...XXX...', '...XXX...', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '.XXXXXXX.', '.XXX.XXX.', 'XX.....XX'],
  led: ['.xxx.', 'xXXXx', 'xXXXx', 'xXXXx', '.xxx.'],
  dot: ['XXX', 'XXX', 'XXX'],
  node: ['.XXX.', 'XXXXX', 'XXXXX', 'XXXXX', '.XXX.'],
  nodeCur: ['..xxx..', '.xXXXx.', 'xXXXXXx', 'xXXXXXx', 'xXXXXXx', '.xXXXx.', '..xxx..'],
  ring: ['.XXX.', 'X...X', 'X...X', 'X...X', '.XXX.'],
  del: ['..XXXXXXX', '.XX.....X', 'XX..X.X.X', 'X....X..X', 'XX..X.X.X', '.XX.....X', '..XXXXXXX'],
}

export interface GlyphShadow {
  w: number
  h: number
  cell: number
  solid: string
  halo: string
}

// 阴影整体右下错开一格：元素自身（一格大、透明）挡不住任何像素，左上角 (0,0) 也画得出来；
// 组件把这个节点放在 (-cell,-cell)，视觉上点阵正好落在 w×h 盒子里。
export function glyphShadow(name: string, cell: number, halo = true): GlyphShadow {
  const rows = PIXEL_GLYPHS[name]
  if (!rows) return { w: 0, h: 0, cell, solid: '', halo: '' }
  const solid: string[] = []
  const soft: string[] = []
  rows.forEach((r, y) =>
    [...r].forEach((ch, x) => {
      const s = `${(x + 1) * cell}px ${(y + 1) * cell}px 0 0 currentColor`
      if (ch === 'X') solid.push(s)
      else if (ch === 'x' && halo) soft.push(s)
    })
  )
  return { w: rows[0].length * cell, h: rows.length * cell, cell, solid: solid.join(','), halo: soft.join(',') }
}
