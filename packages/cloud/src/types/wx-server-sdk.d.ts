/**
 * wx-server-sdk 的最小环境声明——只声明 kit 实际用到的 API 面。
 * 运行时：tcb 提供真实 sdk；测试：file: 内存桩（tests/helpers/wx-server-sdk，
 * 由 check-structure 的 stub-only-sdk 不变量保证不被换成真 sdk）。
 */
declare module 'wx-server-sdk' {
  interface WXContext {
    OPENID: string
    APPID: string
    ENV: string
  }
  interface Cloud {
    init(opts?: { env?: string }): void
    DYNAMIC_CURRENT_ENV: string
    database(): any
    getWXContext(): WXContext
    callFunction(params: { name: string; data?: any }): Promise<any>
    uploadFile(params: { cloudPath: string; fileContent: any }): Promise<{ fileID: string }>
    getTempFileURL(params: {
      fileList: string[]
    }): Promise<{ fileList: { fileID: string; tempFileURL: string }[] }>
  }
  const cloud: Cloud
  export = cloud
}
