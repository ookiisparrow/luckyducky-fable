import { COLLECTIONS } from '@ldrw/shared'

// 缺档与读失败都折成 null（真 sdk 缺档即 reject），null 的含义由调用方定
export const docData = (db: any, coll: string, id: string): Promise<any> =>
  db.collection(coll).doc(id).get().then((g: any) => (g && g.data) || null, () => null)
export const dropKfState = (db: any, id: string): Promise<void> =>
  db.collection(COLLECTIONS.kfState).doc(id).remove().then(() => {}, () => {})
