// 目录域 api（页面不直接 callFunction·经本层收口）
import { callApp, type ApiResult } from '../utils/cloud'

export const getProducts = (): Promise<ApiResult> => callApp('getProducts')
// 单商品详情（列表不带图册，详情页专拉·云端契约见 app/actions/catalog.ts getProductDetail）：
// 返回 { ok, product }（含完整 images 图册·列表 getProducts 已省流不下发）；经 lib/catalog 按 id 缓存收口。
export const getProductDetail = (id: string): Promise<ApiResult> => callApp('getProductDetail', { id })
export const getContent = (): Promise<ApiResult> => callApp('getContent')
// 页面内容 CMS 公开读（5 页可编辑文案·云端契约见 app/actions/catalog.ts getPageContent）：
// 返回 { ok, page, content }；调用方经 lib/pageContent 会话缓存收口 + lib/mapPages 映射回退，不散拉。
export const getPageContent = (page: string): Promise<ApiResult> => callApp('getPageContent', { page })
