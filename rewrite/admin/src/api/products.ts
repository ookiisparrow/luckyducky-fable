// 商品与内容组 api（薄封装）
import { client } from './index'

export const listDrafts = () => client.post('listDrafts')
export const saveDraft = (product: Record<string, unknown>) => client.post('saveDraft', { product })
export const deleteDraft = (id: string) => client.post('deleteDraft', { id })
export const uploadImage = (b64: string, pid: string, ext: string) => client.post('uploadImage', { b64, pid, ext })
export const publishProduct = (id: string) => client.post('publishProduct', { id })
export const unpublishProduct = (id: string) => client.post('unpublishProduct', { id })
export const republishProduct = (id: string) => client.post('republishProduct', { id })
export const listShowcase = () => client.post('listShowcase')
export const saveShowcase = (items: Array<{ id: string; sort: number; featured: boolean }>) => client.post('saveShowcase', { items })

// 二维码卡片设计器（换皮丢了整块设计器·误判「卡后端」·实则后端 getCard/saveCard + cards 集合早就绪）
export const getCard = (productId: string) => client.post('getCard', { productId })
export const saveCard = (card: Record<string, unknown>) => client.post('saveCard', { card })
