import type { CustomerPanelProvider } from './types'
import { ordersProvider } from './providers/orders'
import { activationProvider } from './providers/activation'

// 360 板块注册表（架构规范铁律一/五）：所有板块在此登记一行；编排器只认本表、不认具体板块。
// 新板块＝写 provider + 在此加一行（核心/编排器零改·开放-封闭）。守卫 cs-module-registered 焊「providers/ 下每个都在此注册」。
const PROVIDERS: CustomerPanelProvider[] = [ordersProvider, activationProvider]

// feature-flag（铁律四）：config 集合 doc 'csModules' 字段 modules[key].enabled 覆盖 provider 默认 enabled——
// 缺省＝provider.enabled。控制台改 config 即可灰度/停某板块（真可关·非硬编码恒开）。守卫 cs-module-toggleable 焊之。
export async function enabledProviders(db: any): Promise<CustomerPanelProvider[]> {
  const cfg = await db.collection('config').doc('csModules').get().catch(() => null)
  const overrides: Record<string, { enabled?: boolean }> = (cfg && cfg.data && cfg.data.modules) || {}
  return PROVIDERS.filter((p) => {
    const o = overrides[p.key]
    return o && typeof o.enabled === 'boolean' ? o.enabled : p.enabled
  }).sort((a, b) => a.order - b.order)
}
