// 目录域 api（页面不直接 callFunction·经本层——承接旧线「api 层收口」约定）
import { callApp, type ApiResult } from '../utils/cloud'

export const getProducts = (): Promise<ApiResult> => callApp('getProducts')
export const getContent = (): Promise<ApiResult> => callApp('getContent')
