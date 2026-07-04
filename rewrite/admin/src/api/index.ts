// 客户端单例（endpoint 经 VITE_ADMIN_API 注入·并行期指向 adminApi v2 新名 HTTP 触发路径）。
import { createClient } from './client'

export const client = createClient({ endpoint: import.meta.env.VITE_ADMIN_API || '' })
