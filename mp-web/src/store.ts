// 网页预览的样例数据与本地状态（不连云·刷新即复原）。金额照小程序约定用「分」整数，只在展示层转元。
import { computed, reactive, ref } from 'vue'
import { mapProducts } from '@mp/lib/mapHome'

export type Tab = 'home' | 'cart' | 'me'

const SAMPLE_PRODUCTS = [
  { id: 'kit-duck', name: '小棉鸭初学钩织学习套装', priceFen: 9900, cover: '/products/duck-kit.png' },
  { id: 'kit-hats', name: '三色小帽子配件包', priceFen: 3900, cover: '/products/hats.png' },
  { id: 'kit-bear', name: '小熊钩织套装', priceFen: 8900, cover: '/products/bear.png' },
  { id: 'kit-frog', name: '小蛙钩织套装', priceFen: 8900, cover: '/products/frog.png' },
]

export const products = mapProducts(SAMPLE_PRODUCTS.map((p) => ({ ...p, price: p.priceFen / 100 })))
const priceOf = (id: string) => SAMPLE_PRODUCTS.find((p) => p.id === id)?.priceFen ?? 0

export interface CartLine {
  lineId: string
  id: string
  name: string
  sku: string
  cover: string
  qty: number
  selected: boolean
}

const line = (id: string, sku: string, qty: number): CartLine => {
  const p = SAMPLE_PRODUCTS.find((x) => x.id === id)!
  return { lineId: `${id}:${sku}`, id, name: p.name, sku, cover: p.cover, qty, selected: true }
}

export const cart = reactive<{ items: CartLine[] }>({
  items: [line('kit-duck', '经典黄', 1), line('kit-hats', '粉 · 紫 · 红', 2)],
})

export const fenLabel = (fen: number) => '¥' + (fen / 100).toFixed(2)
export const lineFen = (l: CartLine) => priceOf(l.id) * l.qty

export const selectedCount = computed(() => cart.items.filter((l) => l.selected).length)
export const totalLabel = computed(() => fenLabel(cart.items.filter((l) => l.selected).reduce((s, l) => s + lineFen(l), 0)))
export const cargo = computed(() => Math.min(3, selectedCount.value))

export function addToCart(id: string) {
  const exist = cart.items.find((l) => l.id === id && l.sku === '默认款')
  if (exist) exist.qty = Math.min(99, exist.qty + 1)
  else cart.items.push(line(id, '默认款', 1))
}

export const tab = ref<Tab>('home')

export const toastMsg = ref('')
let toastTimer: ReturnType<typeof setTimeout> | undefined
export function toast(msg: string) {
  clearTimeout(toastTimer)
  toastMsg.value = msg
  toastTimer = setTimeout(() => (toastMsg.value = ''), 1600)
}
