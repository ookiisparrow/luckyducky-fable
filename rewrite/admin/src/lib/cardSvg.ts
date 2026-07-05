// 卡面 SVG 生成（印刷包交付物·1:1 移植旧线 utils/cardSvg.js·守卫 rw-admin-cards-golden）：
// 正面 = 插画面（满版图案 + 品牌角标）；反面 = 二维码面（标题/副文案/二维码占位/扫码引导/退货小字 + 品牌条）。
// 二维码区为占位框——印刷厂按地址清单 CSV 一码一图（用户确认的工作方式）。换皮把整块卡面设计器丢了（误判"卡后端"·
// 实则后端 getCard/saveCard + cards 集合早就绪·仅前端从没接）。
export interface CardModel {
  productId: string
  courseId: string
  name: string
  status: 'draft' | 'final'
  front: { art: string; bg: string; showBrand: boolean }
  back: { bg: string; brandText: string; texts: { title: string; sub: string; scanHint: string; warning: string } }
  sizeMM: { w: number; h: number }
}

// 印刷卡面固定色板（SVG 是独立印刷交付物·印刷/查看软件无 CSS var 可用·必须字面 hex·非 UI 主题色·刻意例外·非 rw-admin-theme-single-source 范围）
const INK = '#241733' // structure-ok 品牌墨（角标条 / 底部品牌条底）
const WHITE = '#ffffff' // structure-ok 卡面白字
const C_TITLE = '#222222' // structure-ok 反面主标题
const C_SUB = '#6e6e76' // structure-ok 反面副文案
const C_QRLINE = '#dcdcdc' // structure-ok 二维码占位框描边
const C_QRTEXT = '#b9b9c0' // structure-ok 二维码占位说明
const C_HINT = '#3d3d42' // structure-ok 扫码引导
const C_WARN = '#9a9aa2' // structure-ok 退货小字提醒

const esc = (s: unknown): string => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const head = (w: number, h: number): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" font-family="'PingFang SC','Microsoft YaHei',sans-serif">`

// 正面 · 插画面
export function buildFrontSvg(card: CardModel, artHref?: string): string {
  const { w, h } = card.sizeMM
  const f = card.front
  const fs = Math.min(w, h)
  const chipH = fs * 0.115
  const chipW = fs * 0.62
  return `${head(w, h)}
  <rect width="${w}" height="${h}" fill="${f.bg}"/>
  ${artHref ? `<image href="${esc(artHref)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>` : ''}
  ${
    f.showBrand
      ? `<rect x="${fs * 0.06}" y="${h - chipH - fs * 0.06}" width="${chipW}" height="${chipH}" rx="${chipH / 2}" fill="${INK}" opacity="0.92"/>
  <text x="${fs * 0.06 + chipW / 2}" y="${h - chipH / 2 - fs * 0.06 + fs * 0.018}" text-anchor="middle" font-size="${fs * 0.045}" font-weight="600" fill="${WHITE}">Lucky Ducky · 小棉鸭</text>`
      : ''
  }
</svg>
`
}

// 反面 · 二维码面（信息五项：主文案/副文案/二维码/扫码引导/退货小字提醒 + 品牌条）
export function buildBackSvg(card: CardModel): string {
  const { w, h } = card.sizeMM
  const b = card.back
  const t = b.texts
  const fs = Math.min(w, h)
  const barH = h * 0.1
  // 自上而下按比例布点，保证横版（90×54）与竖版（105×148）都不挤压
  const titleY = h * 0.13
  const subY = titleY + fs * 0.085
  const qrSide = Math.min(fs * 0.4, h * 0.42)
  const qrX = (w - qrSide) / 2
  const qrY = subY + fs * 0.045
  const hintY = qrY + qrSide + fs * 0.07
  const warnY = h - barH - fs * 0.05
  return `${head(w, h)}
  <rect width="${w}" height="${h}" fill="${b.bg}"/>
  <text x="${w / 2}" y="${titleY}" text-anchor="middle" font-size="${fs * 0.062}" font-weight="700" fill="${C_TITLE}">${esc(t.title)}</text>
  <text x="${w / 2}" y="${subY}" text-anchor="middle" font-size="${fs * 0.04}" fill="${C_SUB}">${esc(t.sub)}</text>
  <rect x="${qrX}" y="${qrY}" width="${qrSide}" height="${qrSide}" fill="none" stroke="${C_QRLINE}" stroke-width="0.4" rx="1.5"/>
  <text x="${w / 2}" y="${qrY + qrSide / 2}" text-anchor="middle" font-size="${fs * 0.034}" fill="${C_QRTEXT}">二维码区 · 一码一图</text>
  <text x="${w / 2}" y="${hintY}" text-anchor="middle" font-size="${fs * 0.042}" font-weight="600" fill="${C_HINT}">${esc(t.scanHint)}</text>
  <text x="${w / 2}" y="${warnY}" text-anchor="middle" font-size="${fs * 0.03}" fill="${C_WARN}">${esc(t.warning)}</text>
  <rect x="0" y="${h - barH}" width="${w}" height="${barH}" fill="${INK}"/>
  <text x="${w / 2}" y="${h - barH / 2 + fs * 0.016}" text-anchor="middle" font-size="${fs * 0.04}" font-weight="600" fill="${WHITE}">${esc(b.brandText || 'Lucky Ducky · 小棉鸭')}</text>
</svg>
`
}
