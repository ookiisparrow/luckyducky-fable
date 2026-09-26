// 变异分诊批（2026-07-24）：kit/db.ts 首轮变异分 12.5%（7 幸存全在「init 只跑一次」语义）——
// 该语义是文件头声明的设计约束（#5 平台原语收口 kit），此前无测试站岗，本文件锁死。
import { describe, it, expect, vi, afterEach } from 'vitest'
import cloud from 'wx-server-sdk'
import { getDb, isCollectionMissing, isDocMissing, isEmptyDoc, getDocOrNull } from '../src/kit/db'

afterEach(() => vi.restoreAllMocks())

describe('kit/db（云初始化只跑一次）', () => {
  it('大白话：连取两次库句柄，cloud.init 只被调用一次且带动态环境参数——重复 init/漏 init/丢 env 都红', () => {
    const initSpy = vi.spyOn(cloud, 'init')
    const db1 = getDb()
    const db2 = getDb()
    expect(db1).toBeTruthy()
    expect(db2).toBeTruthy()
    // 本测试文件模块图独立（vitest 默认按文件隔离），首次 getDb 必走 init 分支
    expect(initSpy).toHaveBeenCalledTimes(1)
    expect(initSpy).toHaveBeenCalledWith({ env: cloud.DYNAMIC_CURRENT_ENV })
  })
})

// 下面几条杀的是错误分类器的存活变异：报错信息分散在 message / errMsg / errmsg / code / errCode 各字段，
// 漏看任何一个字段，「集合没建」就会被当成读失败（或反过来），库存与售后读路径会走错分支。
describe('kit/db 错误分类器逐字段认', () => {
  it('集合未建：五个字段各自单独携带时都认；报错是纯字符串也认', () => {
    expect(isCollectionMissing({ message: 'collection does not exist' })).toBe(true)
    expect(isCollectionMissing({ errMsg: 'DATABASE_COLLECTION_NOT_EXIST' })).toBe(true)
    expect(isCollectionMissing({ errmsg: 'collection does not exist' })).toBe(true)
    expect(isCollectionMissing({ code: -502005 })).toBe(true)
    expect(isCollectionMissing({ errCode: 'COLLECTION_NOT_EXIST' })).toBe(true)
    expect(isCollectionMissing('COLLECTION_NOT_EXIST')).toBe(true)
  })

  it('集合未建：权限/网络报错优先判成读失败；空值不认', () => {
    expect(isCollectionMissing({ errCode: -502005, errMsg: 'permission denied' })).toBe(false)
    expect(isCollectionMissing(null)).toBe(false)
    expect(isCollectionMissing(undefined)).toBe(false)
  })

  it('无档：空值、空串都不算无档', () => {
    expect(isDocMissing(null)).toBe(false)
    expect(isDocMissing('')).toBe(false)
  })

  it('无档：「document <id> does not exist」这种不带 .get / with _id 的文案也认', () => {
    expect(isDocMissing(new Error('document abc123 does not exist'))).toBe(true)
  })

  // 误判成无档＝限量 SKU 当不限量放行，所以这两种「看着像」的报错必须判否
  it('无档：集合没建、没权限的报错即使也带「document … does not exist」也不认', () => {
    expect(isDocMissing({ errMsg: 'document.get:fail collection does not exist' })).toBe(false)
    expect(isDocMissing({ errMsg: 'document.get:fail permission denied, document does not exist' })).toBe(false)
  })

  it('无档：不同字段的文案不拼成一句来认', () => {
    expect(isDocMissing({ message: 'failed to update document', errMsg: 'index does not exist' })).toBe(false)
  })

  it('get() 成功时的空档判定：非空数组、非空对象、原始值都不是空档', () => {
    expect(isEmptyDoc({ data: [] })).toBe(true)
    expect(isEmptyDoc({ data: [{ _id: 'a' }] })).toBe(false)
    expect(isEmptyDoc({ data: {} })).toBe(true)
    expect(isEmptyDoc({ data: { _id: 'a' } })).toBe(false)
    expect(isEmptyDoc({ data: 'x' })).toBe(false)
    expect(isEmptyDoc({ data: 0 })).toBe(false)
  })

  it('getDocOrNull：get() 回空包或 null 都给 null，不给 undefined', async () => {
    expect(await getDocOrNull({ get: async () => ({}) })).toBeNull()
    expect(await getDocOrNull({ get: async () => null })).toBeNull()
    expect(await getDocOrNull({ get: async () => ({ data: { _id: 'a' } }) })).toEqual({ _id: 'a' })
  })
})
