// 变异分诊批（2026-07-24）：kit/db.ts 首轮变异分 12.5%（7 幸存全在「init 只跑一次」语义）——
// 该语义是文件头声明的设计约束（#5 平台原语收口 kit），此前无测试站岗，本文件锁死。
import { describe, it, expect, vi, afterEach } from 'vitest'
import cloud from 'wx-server-sdk'
import { getDb } from '../src/kit/db'

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
