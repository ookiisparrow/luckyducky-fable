import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseExpectedIndexes, diffIndexes } from '../../scripts/lib/index-check.mjs'

// fixture 刻意仿真实文档的刁钻形状：＋分隔多索引一行 / 单字段+括注在反引号外 /
// 嵌套反引号夹在查询列括注里 / P0-P1(4列)与P2(3列，无查询列)两种表宽 / 分节标题。
const FIXTURE_MD = `# fixture

## P0 · 热路径

| 集合 | 复合索引（字段·方向） | 服务的查询 | 出处 |
|---|---|---|---|
| orders | \`_openid ↑, createdAt ↓, _id ↓\` | 我的订单列表 | a.ts:1 |
| products | \`listed ↑, sort ↑\` | 商品目录（注：\`listed\` 是 neq 条件，不走就只建 \`sort ↑\` 单字段） | b.ts:2 |

## P1 · 次热路径

| 集合 | 复合索引 | 服务的查询 | 出处 |
|---|---|---|---|
| afterSales | \`appliedAt ↓, _id ↓\` ＋ \`status ↑, appliedAt ↓, _id ↓\` ＋ \`orderId ↑, appliedAt ↓, _id ↓\` | 三种筛选形态 | c.ts:3 |
| afterSales | \`outRefundNo ↑\`（单字段） | 退款回调反查 | d.ts:4 |

## P2 · 低频

| 集合 | 复合索引 | 出处 |
|---|---|---|
| anomalies | \`resolved ↑, kind ↑, lastSeen ↓\`（前缀覆盖） | e.ts:5 |

## 不需要复合索引的（附排除理由，防误建）

- \`kit/inventory.ts:198,202\`——where 与 orderBy 同为 \`productId\` 一列。

## drift-checklist（并入 README 总单）

- [ ] 占位
`

describe('index-check parseExpectedIndexes：fixture 覆盖刁钻形状', () => {
  it('无解析告警', () => {
    const { warnings } = parseExpectedIndexes(FIXTURE_MD)
    expect(warnings).toEqual([])
  })

  it('P0 分节：普通复合索引正确解析', () => {
    const { byCollection } = parseExpectedIndexes(FIXTURE_MD)
    const orders = byCollection.get('orders')
    expect(orders).toHaveLength(1)
    expect(orders[0].priority).toBe('P0')
    expect(orders[0].fields).toEqual([
      { name: '_openid', dir: 1 },
      { name: 'createdAt', dir: -1 },
      { name: '_id', dir: -1 },
    ])
  })

  it('嵌套反引号夹在查询列括注里不干扰索引列解析', () => {
    const { byCollection } = parseExpectedIndexes(FIXTURE_MD)
    const products = byCollection.get('products')
    expect(products).toHaveLength(1)
    expect(products[0].fields).toEqual([
      { name: 'listed', dir: 1 },
      { name: 'sort', dir: 1 },
    ])
  })

  it('＋ 分隔多索引一行 → 全部拆出；加上同集合第二行单字段行，共 4 条', () => {
    const { byCollection } = parseExpectedIndexes(FIXTURE_MD)
    const afterSales = byCollection.get('afterSales')
    expect(afterSales).toHaveLength(4)
  })

  it('单字段 + 括注在反引号外 → 正确剥离括注', () => {
    const { byCollection } = parseExpectedIndexes(FIXTURE_MD)
    const single = byCollection.get('afterSales').find((i) => i.fields.length === 1)
    expect(single.fields).toEqual([{ name: 'outRefundNo', dir: 1 }])
  })

  it('P2 三列表格（无查询列）也能正确解析', () => {
    const { byCollection } = parseExpectedIndexes(FIXTURE_MD)
    const anomalies = byCollection.get('anomalies')
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0].priority).toBe('P2')
    expect(anomalies[0].fields).toEqual([
      { name: 'resolved', dir: 1 },
      { name: 'kind', dir: 1 },
      { name: 'lastSeen', dir: -1 },
    ])
  })

  it('「不需要复合索引的」章节内容不误入 byCollection', () => {
    const { byCollection } = parseExpectedIndexes(FIXTURE_MD)
    expect(byCollection.has('kit/inventory.ts:198,202')).toBe(false)
  })
})

describe('index-check parseExpectedIndexes：真实 03 表冒烟解析（文档格式漂移探测网）', () => {
  it('对真实 console-assets/03-复合索引期望表.md 全文解析不抛错、有下限数量、无告警', () => {
    const mdPath = join(process.cwd(), 'console-assets', '03-复合索引期望表.md')
    const mdText = readFileSync(mdPath, 'utf8')
    const { byCollection, warnings } = parseExpectedIndexes(mdText)
    expect(warnings).toEqual([])
    expect(byCollection.size).toBeGreaterThanOrEqual(10)
  })
})

describe('index-check diffIndexes：匹配/反向匹配/缺失/多余', () => {
  const expected = [
    {
      fields: [
        { name: 'a', dir: 1 },
        { name: 'b', dir: -1 },
      ],
      priority: 'P0',
    },
  ]

  it('完全匹配', () => {
    const actual = [
      {
        Name: 'idx1',
        Keys: [
          { Name: 'a', Direction: '1' },
          { Name: 'b', Direction: '-1' },
        ],
      },
    ]
    const { matched, missing, extra } = diffIndexes(expected, actual)
    expect(matched).toHaveLength(1)
    expect(missing).toHaveLength(0)
    expect(extra).toHaveLength(0)
  })

  it('整体反向匹配（MongoDB 复合索引反向遍历等价规则）', () => {
    const actual = [
      {
        Name: 'idx1',
        Keys: [
          { Name: 'a', Direction: '-1' },
          { Name: 'b', Direction: '1' },
        ],
      },
    ]
    const { matched, missing } = diffIndexes(expected, actual)
    expect(matched).toHaveLength(1)
    expect(missing).toHaveLength(0)
  })

  it('缺失（实际库无匹配索引）', () => {
    const { matched, missing } = diffIndexes(expected, [])
    expect(matched).toHaveLength(0)
    expect(missing).toHaveLength(1)
  })

  it('多余（含默认 _id_ 索引恒排除，不计入 extra）', () => {
    const actual = [
      { Name: '_id_', Keys: [{ Name: '_id', Direction: '1' }] },
      { Name: 'idx-extra', Keys: [{ Name: 'c', Direction: '1' }] },
    ]
    const { matched, missing, extra } = diffIndexes(expected, actual)
    expect(matched).toHaveLength(0)
    expect(missing).toHaveLength(1)
    expect(extra).toHaveLength(1)
    expect(extra[0].Name).toBe('idx-extra')
  })

  it('含 2d 地理键的索引恒排除（不误判为多余的普通索引）', () => {
    const actual = [{ Name: 'geo1', Keys: [{ Name: 'loc', Direction: '2d' }] }]
    const { extra } = diffIndexes([], actual)
    expect(extra).toHaveLength(0)
  })
})
