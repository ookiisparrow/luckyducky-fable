/**
 * wx-server-sdk 最小环境声明（新线版·只声明用到的 API 面 + 测试桩 control 面）。
 * 运行时：云环境提供真实 sdk；测试：file: 内存桩（stub-only-sdk 守卫保证不换真 sdk）。
 */
declare module 'wx-server-sdk' {
  export interface WXContext {
    OPENID: string
    APPID: string
    ENV: string
    UNIONID?: string
  }
  interface Cloud {
    init(opts?: { env?: string }): void
    DYNAMIC_CURRENT_ENV: string
    database(): any
    getWXContext(): WXContext
    callFunction(params: { name: string; data?: unknown }): Promise<any>
    uploadFile(params: { cloudPath: string; fileContent: unknown }): Promise<{ fileID: string }>
    getTempFileURL(params: {
      fileList: (string | { fileID: string; maxAge?: number })[]
    }): Promise<{ fileList: { fileID: string; tempFileURL: string }[] }>
  }
  /** 测试桩专有（真 sdk 无此导出·只在 tests/ 使用）。 */
  export const control: {
    reset(): void
    seed(coll: string, docs: unknown[]): void
    dump(coll: string): any[]
    setOpenId(openid: string): void
    [k: string]: any
  }
  const cloud: Cloud
  export default cloud
}
