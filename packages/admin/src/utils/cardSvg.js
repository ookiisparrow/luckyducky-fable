/**
 * 卡面 SVG 生成（印刷包交付物，规格 §六：双面卡）。
 * 正面 = 插画面（满版图案 + 品牌角标）；反面 = 二维码面（标题/副文案/二维码区/三步说明/品牌条）。
 * 二维码区为占位框——印刷厂按地址清单 CSV 一码一图（用户确认的工作方式）。
 * 图案优先内嵌 dataURL（打开即见），取不到时退回远程引用。
 */
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const head = (w, h) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" font-family="'PingFang SC','Microsoft YaHei',sans-serif">`

// 正面 · 插画面
export function buildFrontSvg(card, artHref) {
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
      ? `<rect x="${fs * 0.06}" y="${h - chipH - fs * 0.06}" width="${chipW}" height="${chipH}" rx="${chipH / 2}" fill="#241733" opacity="0.92"/>
  <text x="${fs * 0.06 + chipW / 2}" y="${h - chipH / 2 - fs * 0.06 + fs * 0.018}" text-anchor="middle" font-size="${fs * 0.045}" font-weight="600" fill="#ffffff">Lucky Ducky · 小棉鸭</text>`
      : ''
  }
</svg>
`
}

// 反面 · 二维码面（信息五项：主文案/副文案/二维码/扫码引导/退货小字提醒 + 品牌条）
export function buildBackSvg(card) {
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
  <text x="${w / 2}" y="${titleY}" text-anchor="middle" font-size="${fs * 0.062}" font-weight="700" fill="#222222">${esc(t.title)}</text>
  <text x="${w / 2}" y="${subY}" text-anchor="middle" font-size="${fs * 0.04}" fill="#6e6e76">${esc(t.sub)}</text>
  <rect x="${qrX}" y="${qrY}" width="${qrSide}" height="${qrSide}" fill="none" stroke="#dcdcdc" stroke-width="0.4" rx="1.5"/>
  <text x="${w / 2}" y="${qrY + qrSide / 2}" text-anchor="middle" font-size="${fs * 0.034}" fill="#b9b9c0">二维码区 · 一码一图</text>
  <text x="${w / 2}" y="${hintY}" text-anchor="middle" font-size="${fs * 0.042}" font-weight="600" fill="#3d3d42">${esc(t.scanHint)}</text>
  <text x="${w / 2}" y="${warnY}" text-anchor="middle" font-size="${fs * 0.03}" fill="#9a9aa2">${esc(t.warning)}</text>
  <rect x="0" y="${h - barH}" width="${w}" height="${barH}" fill="#241733"/>
  <text x="${w / 2}" y="${h - barH / 2 + fs * 0.016}" text-anchor="middle" font-size="${fs * 0.04}" font-weight="600" fill="#ffffff">${esc(b.brandText || 'Lucky Ducky · 小棉鸭')}</text>
</svg>
`
}
