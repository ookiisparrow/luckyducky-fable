// 后台身份代码进红区（#400-14）：建号写口令哈希、停用清会话、企微登录签发会话。
import { describe, it, expect } from 'vitest'
import { isRedPath } from '../../scripts/lib/red-paths.mjs'

describe('身份闸红区', () => {
  it.each(['rewrite/cloud/src/functions/adminApi/actions/agents.ts', 'rewrite/cloud/src/functions/adminApi/actions/wecomLogin.ts'])(
    '%s 命中红区',
    (p) => {
      expect(isRedPath(p)).toBe(true)
    }
  )
})
