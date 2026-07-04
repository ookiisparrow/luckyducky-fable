import cloud from 'wx-server-sdk'

let inited = false

/**
 * 取数据库句柄；init 只跑一次（设计约束#5：平台原语收口 kit，业务码禁裸 cloud.*）。
 */
export function getDb() {
  if (!inited) {
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
    inited = true
  }
  return cloud.database()
}
