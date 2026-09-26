// 客户端单例（endpoint 经 VITE_ADMIN_API 注入 → adminApi）。
import { createClient, type TypedResult } from './client'

export const client = createClient({ endpoint: import.meta.env.VITE_ADMIN_API || '' })

// 回包是 JSON、运行时不校验：全仓只在这一处把它当契约类型看（钱组的键另有 tests/contracts/admin-money.json 两头测试锁）
export const typedPost = <T extends object, F extends object = {}>(action: string, data?: Record<string, unknown>) =>
  client.post(action, data) as Promise<TypedResult<T, F>>
