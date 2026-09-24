// 客户端单例（endpoint 经 VITE_ADMIN_API 注入 → adminApi）。
import { createClient } from './client'

export const client = createClient({ endpoint: import.meta.env.VITE_ADMIN_API || '' })
