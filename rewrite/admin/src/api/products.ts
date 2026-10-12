// 商品与内容组 api（薄封装）
// 回包类型取 @ldrw/shared 的后台契约
import type { AdminDrafts, AdminShowcase, AdminCard, AdminCardDoc, AdminUploaded } from '@ldrw/shared'
import { typedPost } from './index'

export const listDrafts = () => typedPost<AdminDrafts>('listDrafts')
export const saveDraft = (product: Record<string, unknown>) => typedPost<object>('saveDraft', { product })
export const deleteDraft = (id: string) => typedPost<object>('deleteDraft', { id })
export const uploadImage = (b64: string, pid: string, ext: string) => typedPost<AdminUploaded>('uploadImage', { b64, pid, ext })
export const publishProduct = (id: string, opts?: { featured?: boolean }) =>
  typedPost<object>('publishProduct', opts ? { id, featured: opts.featured === true } : { id })
export const unpublishProduct = (id: string) => typedPost<object>('unpublishProduct', { id })
export const republishProduct = (id: string) => typedPost<object>('republishProduct', { id })
export const listShowcase = () => typedPost<AdminShowcase>('listShowcase')
export const saveShowcase = (items: Array<{ id: string; sort: number; featured: boolean }>) => typedPost<object, { failedIds: string[] }>('saveShowcase', { items })

// 二维码卡片设计器（getCard/saveCard + cards 集合）
export const getCard = (productId: string) => typedPost<AdminCard>('getCard', { productId })
export const saveCard = (card: AdminCardDoc) => typedPost<object>('saveCard', { card })
