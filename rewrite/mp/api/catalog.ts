// 目录域 api（页面不直接 callFunction·经本层——承接旧线「api 层收口」约定）
import { callApp, type ApiResult } from '../utils/cloud'

export const getProducts = (): Promise<ApiResult> => callApp('getProducts')
export const getContent = (): Promise<ApiResult> => callApp('getContent')
// 页面内容 CMS 公开读（批B·5 页可编辑文案·云端契约见 app/actions/catalog.ts getPageContent）：
// 返回 { ok, page, content }；调用方经 lib/pageContent 会话缓存收口 + lib/mapPages 映射回退，不散拉。
export const getPageContent = (page: string): Promise<ApiResult> => callApp('getPageContent', { page })
