import { ERR } from '@ldrw/shared'
import { enabledProviders } from './registry'
import type { Customer360Panel } from './types'

// 客户360 编排器（架构规范铁律三）：遍历 registry 里 enabled 的 provider、统一调 fetch、组装面板。
// 本身不认识任何具体板块（无 switch/if key·加删板块只动 provider）。各板块取数互相隔离——
// 一个 provider 失败只标该面板 error、不拖垮整页（坐席看全貌·一处挂不能全黑）。
export async function assembleCustomer360(
  db: any,
  openid: string
): Promise<{ openid: string; panels: Customer360Panel[] }> {
  const providers = await enabledProviders(db)
  const panels = await Promise.all(
    providers.map(async (p): Promise<Customer360Panel> => {
      try {
        const data = await p.fetch(db, openid)
        return { key: p.key, label: p.label, order: p.order, data }
      } catch {
        return { key: p.key, label: p.label, order: p.order, data: null, error: ERR.PANEL_FETCH_FAIL }
      }
    })
  )
  return { openid, panels }
}
