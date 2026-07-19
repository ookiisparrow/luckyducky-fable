import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_COLLECTIONS, resolveCollections } from '../../scripts/lib/db-backup-collections.mjs'

// 防手抄漂移（DEFAULT_COLLECTIONS 是与 rewrite/shared/src/collections.ts 手工对齐的独立清单，
// 见该文件头注）：交叉核对每一项都真的在集合单一来源里存在，不是拍脑袋编的名字。
const collectionsSource = readFileSync(join(process.cwd(), 'rewrite/shared/src/collections.ts'), 'utf8')

describe('db-backup-collections DEFAULT_COLLECTIONS', () => {
  it('每一项都能在 rewrite/shared/src/collections.ts 找到对应键名（防手抄漂移）', () => {
    for (const name of DEFAULT_COLLECTIONS) {
      expect(collectionsSource).toMatch(new RegExp(`\\b${name}:\\s*'${name}'`))
    }
  })

  it('不含 secureConfig（明文凭证集合默认排除）', () => {
    expect(DEFAULT_COLLECTIONS).not.toContain('secureConfig')
  })
})

describe('db-backup-collections resolveCollections', () => {
  it('无 --collections → 返回 DEFAULT_COLLECTIONS 原样', () => {
    const { list, droppedSecrets } = resolveCollections({})
    expect(list).toEqual(DEFAULT_COLLECTIONS)
    expect(droppedSecrets).toBe(false)
  })

  it('自定义子集 → 按逗号切分并去空白', () => {
    const { list } = resolveCollections({ collections: 'users, orders ,afterSales' })
    expect(list).toEqual(['users', 'orders', 'afterSales'])
  })

  it('含 secureConfig 且未加 includeSecrets → 剔除且 droppedSecrets:true', () => {
    const { list, droppedSecrets } = resolveCollections({ collections: 'users,secureConfig' })
    expect(list).toEqual(['users'])
    expect(droppedSecrets).toBe(true)
  })

  it('含 secureConfig 且加了 includeSecrets:true → 保留、droppedSecrets:false', () => {
    const { list, droppedSecrets } = resolveCollections({ collections: 'users,secureConfig', includeSecrets: true })
    expect(list).toEqual(['users', 'secureConfig'])
    expect(droppedSecrets).toBe(false)
  })
})
