// 索引核对纯逻辑（check-indexes.mjs 消费）：解析 console-assets/03-复合索引期望表.md 的期望态，
// 与生产库 describeCollection 实际返回的索引 diff。
//
// 【文档格式】P0/P1/P2 三档二级标题分节；每节一张 Markdown 表，集合名在第 1 列、索引规格在
// 第 2 列（P0/P1 表另有第 3「服务的查询」/第 4「出处」列，P2 表只 3 列——本解析器只取前两列，
// 与总列数无关，天然兼容两种表宽）。单集合多索引用全角＋分隔；每段索引规格用反引号包裹
// 「字段 方向」逗号分隔（方向 ↑/↓），个别行反引号后/前有夹带嵌套反引号的中文括注——每段只取
// 第一个反引号片段即可正确避开嵌套干扰，无需改写正册文件（Plan A，见规格 keyFacts⑦）。
export function parseExpectedIndexes(mdText) {
  const byCollection = new Map()
  const warnings = []
  const lines = mdText.split('\n')

  let priority = null
  let inStopSection = false

  for (const rawLine of lines) {
    const line = rawLine

    const headingMatch = line.match(/^## (P[0-2])\b/)
    if (headingMatch) {
      priority = headingMatch[1]
      inStopSection = false
      continue
    }
    if (/^## (不需要复合索引的|drift-checklist)/.test(line)) {
      inStopSection = true
      priority = null
      continue
    }
    if (inStopSection || !priority) continue
    if (!line.trim().startsWith('|')) continue

    const rawCells = line.split('|')
    // 去掉行首/行尾的 | 产生的空 cell（表格行恒以 | 开头结尾）。
    const cells = rawCells.slice(1, rawCells.length - 1).map((s) => s.trim())
    if (cells.length < 2) continue

    const [name, spec] = cells
    if (!name || name === '集合' || /^-+$/.test(name)) continue // 表头/分隔行
    if (/^-+$/.test(spec)) continue

    const segments = spec.split('＋')
    const indexes = []
    for (const seg of segments) {
      const m = seg.match(/`([^`]+)`/)
      if (!m) {
        warnings.push(`${name}: 无法解析索引规格片段「${seg.trim()}」`)
        continue
      }
      const fields = []
      let ok = true
      for (const rawTok of m[1].split(',')) {
        const tok = rawTok.trim()
        const tokMatch = tok.match(/^(\S+)\s+([↑↓])$/)
        if (!tokMatch) {
          warnings.push(`${name}: 无法解析字段 token「${tok}」`)
          ok = false
          continue
        }
        fields.push({ name: tokMatch[1], dir: tokMatch[2] === '↑' ? 1 : -1 })
      }
      if (ok && fields.length > 0) indexes.push({ fields, priority, note: spec })
    }
    if (indexes.length === 0) continue

    const list = byCollection.get(name) || []
    list.push(...indexes)
    byCollection.set(name, list)
  }

  return { byCollection, warnings }
}

function fieldsEqual(a, b) {
  if (a.length !== b.length) return false
  return a.every((f, i) => f.name === b[i].name && f.dir === b[i].dir)
}

function reversedFields(fields) {
  return fields.map((f) => ({ name: f.name, dir: -f.dir }))
}

// 纯函数：expected（parseExpectedIndexes 某集合的条目数组）与 actualIndexesRaw
// （manager.database.describeCollection(name) 返回的 info.Indexes 原始数组）diff。
// 恒排除 _id_ 默认主键索引与含 2d 地理键的索引（不在本期望表覆盖范围）。
// 匹配规则：字段名+方向逐位相同，或字段名相同、方向逐位整体取反（MongoDB 复合索引支持
// 整体反向遍历，源文档「方向说明」段落已明示、按此合并记账）。
export function diffIndexes(expected, actualIndexesRaw) {
  const actual = (actualIndexesRaw || []).filter((idx) => {
    if (idx.Name === '_id_') return false
    if ((idx.Keys || []).some((k) => k.Direction === '2d')) return false
    return true
  })

  const usedActualIdx = new Set()
  const matched = []
  const missing = []

  for (const exp of expected) {
    let foundIdx = -1
    for (let i = 0; i < actual.length; i++) {
      if (usedActualIdx.has(i)) continue
      const actFields = (actual[i].Keys || [])
        .filter((k) => k.Name)
        .map((k) => ({ name: k.Name, dir: Number(k.Direction) }))
      if (fieldsEqual(exp.fields, actFields) || fieldsEqual(reversedFields(exp.fields), actFields)) {
        foundIdx = i
        break
      }
    }
    if (foundIdx >= 0) {
      usedActualIdx.add(foundIdx)
      matched.push({ expected: exp, actual: actual[foundIdx] })
    } else {
      missing.push(exp)
    }
  }

  const extra = actual.filter((_, i) => !usedActualIdx.has(i))

  return { matched, missing, extra }
}
