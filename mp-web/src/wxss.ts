// 原样载入小程序 wxss（单源：改小程序样式，网页预览跟着变），只做三处机械转换：
// page 选择器 → .mp-page；100vh/100vw → 手机框尺寸变量；rpx → 按 750 设计宽折算。
import tokens from '@mp/styles/tokens.wxss?raw'
import skin from '@mp/styles/px-skin.wxss?raw'
import app from '@mp/app.wxss?raw'
import tabBar from '@mp/custom-tab-bar/index.wxss?raw'
import home from '@mp/pages/home/home.wxss?raw'
import cart from '@mp/pages/cart/cart.wxss?raw'
import me from '@mp/pages/me/me.wxss?raw'

const SOURCES = [tokens, skin, app, tabBar, home, cart, me]

function adapt(css: string): string {
  return css
    .replace(/@import[^;]+;/g, '')
    .replace(/(^|[\s,}])page(?=\s*[,{])/g, '$1.mp-page')
    .replace(/100vh/g, 'var(--mp-vh)')
    .replace(/100vw/g, 'var(--mp-vw)')
    .replace(/(-?\d*\.?\d+)rpx/g, 'calc($1 * var(--mp-rpx))')
}

export function injectMpStyles(): void {
  const style = document.createElement('style')
  style.dataset.source = 'rewrite/mp'
  style.textContent = SOURCES.map(adapt).join('\n')
  document.head.prepend(style)
}
