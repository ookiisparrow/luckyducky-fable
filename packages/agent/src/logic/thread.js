/**
 * 会话消息流的纯逻辑（增量合并·去重·排序）。
 *
 * 实时＝轮询（承面C工单 §1 定稿）：前端每 2-3s 调 getThread(cursor) 拉「cursor 之后」的新消息，
 * 把新批次并入已有流。抽成纯函数便于单测——off-by-one / 重复气泡 / 乱序是轮询增量的 bug 高发区，
 * 也是车道 B 唯一真算法逻辑（其余是 UI 编排）。契约 ThreadMessage = { direction, msgtype, text, at }。
 */

/** 一条消息的去重键：ThreadMessage 无 id，按 (at, direction, text) 唯一（同毫秒同向同文视为同条）。 */
export function threadKey(m) {
  return `${m.at}|${m.direction}|${m.text}`
}

/**
 * 合并已有消息流与新增批次：并集去重、按 at 升序。
 * 防轮询重叠（cursor 边界重复回同一条）/ 乱序（并发落库时序抖动）导致重复或倒序气泡。
 */
export function mergeThread(prev, batch) {
  const seen = new Set()
  const out = []
  for (const m of [...(prev || []), ...(batch || [])]) {
    if (!m || typeof m.at !== 'number') continue
    const k = threadKey(m)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(m)
  }
  out.sort((a, b) => a.at - b.at)
  return out
}

/**
 * 从消息流推进游标：取最大 at 作为下次 getThread 的 cursor（字符串·契约 cursor 为 string）。
 * 空流回退到传入的旧游标（不倒退）。
 */
export function advanceCursor(messages, prevCursor) {
  let max = Number(prevCursor) || 0
  for (const m of messages || []) if (typeof m.at === 'number' && m.at > max) max = m.at
  return max ? String(max) : prevCursor || ''
}
