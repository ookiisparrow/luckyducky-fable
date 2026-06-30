// 客户360 板块统一接口（架构规范铁律三·provider 模式）：每个板块实现本接口、注册到 registry，
// getCustomer360 编排器只遍历 registry、不认识任何具体板块——加/删/改一个面板只动对应 provider、核心零改。
export interface CustomerPanelProvider {
  /** 板块唯一键（feature-flag 覆盖 config.csModules.modules[key]·审计/前端按它认面板） */
  key: string
  /** 面板展示名 */
  label: string
  /** 默认开关（可被 config 集合覆盖·铁律四 feature-flag） */
  enabled: boolean
  /** 渲染顺序（小在前） */
  order: number
  /** 取该板块数据（须 bounded·防大客户 360 拖垮·capacity-reads-bounded） */
  fetch(db: any, openid: string): Promise<unknown>
}

/** 编排器输出的单个面板（data＝provider 返回；error＝该板块取数失败的隔离标记·不拖垮整页） */
export interface Customer360Panel {
  key: string
  label: string
  order: number
  data: unknown
  error?: string
}
