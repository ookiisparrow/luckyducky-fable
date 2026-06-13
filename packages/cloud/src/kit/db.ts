import cloud from 'wx-server-sdk'

let inited = false

/**
 * 取数据库句柄；init 只跑一次（根因账本 #5：收编 28 份 cloud.init 样板）。
 * 业务代码一律 getDb()，不再各自 cloud.init——由 check-structure 的
 * kit-only-cloud-primitives 不变量在 packages/cloud/src/functions 下强制。
 */
export function getDb() {
  if (!inited) {
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
    inited = true
  }
  return cloud.database()
}
