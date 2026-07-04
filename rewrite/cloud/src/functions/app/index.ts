import { ERR } from '@ldrw/shared'
import { err } from '../../kit'
import { login, updateProfile } from './actions/user'
import { getProducts, getContent } from './actions/catalog'

/**
 * 用户端聚合网关（蓝图定案·adminApi registry 范式）：event = { action, data }。
 * 每个 action 模块自带完整闸（withOpenId/withRateLimit…），注册表只做分发；
 * 未知 action fail-closed 拒（设计约束#3）。M5 切换日小程序 callFunction('app', {action,data})。
 */
const ACTIONS: Record<string, (event: unknown) => Promise<unknown>> = {
  login,
  updateProfile,
  getProducts,
  getContent,
}

export const main = async (event: any) => {
  const handler = ACTIONS[event?.action]
  if (!handler) return err(ERR.BAD_ARGS, { action: String(event?.action ?? '') })
  return handler(event?.data ?? {})
}
