// 坐席台纯逻辑（会话流轮询增量合并）：
// 游标边界重复回同一条不产生重复气泡；增量并入后按时间升序（乱序落库也排对）；同一时刻不同方向/
// 不同文视为不同条；无时间戳脏消息不进流；游标只进不退、空批不倒退。
// 去重键：有 msgid（入站客户消息·全局唯一）→ 只认 msgid，同秒非文本消息（图片等
// text 恒为 `[msgtype]` 占位）不再被 at|direction|text 误判同条而丢弃；无 msgid（出站坐席消息/历史档，
// 无稳定唯一 id）→ 回退 at|direction|msgtype|text——这条回退键仍有残余边界：纯文本同秒同文重发会被
// 当同条塌掉，无唯一 id 时分不清「真重发」与「重投递」，此处维持既有偏置（宁去重勿重复气泡）。
export interface Msg {
  direction: 'in' | 'out'
  text: string
  at: number
  msgtype?: string
  msgid?: string
  hasMedia?: boolean // 顾客发图坐席可见——true 时 Desk.vue 渲染图片气泡而非纯文本占位
}

// 导出供 Desk.vue 模板 :key 复用：气泡 key 与去重键同源单点——去重键认 msgid 而
// 模板 key 若用 at+direction+text，同秒同向两张图（msgid 不同）会进 msgs 却撞 Vue 重复 key。
// （diffNewInbound 同样复用此键——身份判同单源。）
export const keyOf = (m: Msg) => (m.msgid ? `id:${m.msgid}` : `${m.at}|${m.direction}|${m.msgtype || ''}|${m.text}`)

/** 归一进流：无时间戳/脏形状不进（防脏消息撑乱时间轴）。 */
export function normalizeMsgs(raw: unknown): Msg[] {
  if (!Array.isArray(raw)) return []
  const out: Msg[] = []
  for (const m of raw as Record<string, any>[]) {
    if (!m || typeof m !== 'object') continue
    const at = Number(m.at)
    if (!Number.isFinite(at) || at <= 0) continue // 无时间戳不进流
    const msgid = m.msgid ? String(m.msgid) : undefined
    out.push({
      direction: m.direction === 'out' ? 'out' : 'in',
      text: String(m.text || ''),
      at,
      msgtype: String(m.msgtype || ''),
      msgid,
      hasMedia: !!m.hasMedia,
    })
  }
  return out
}

/** 增量合并（不重气泡·升序）：有 msgid 按 msgid 去重（同刻不同文/不同类不再误杀）；无 msgid 回退旧键；并入后整体按 at 升序。 */
export function mergeThread(existing: Msg[], incoming: unknown): Msg[] {
  const seen = new Set(existing.map(keyOf))
  const merged = [...existing]
  for (const m of normalizeMsgs(incoming)) {
    const k = keyOf(m)
    if (seen.has(k)) continue // 游标边界重复·不重气泡
    seen.add(k)
    merged.push(m)
  }
  return merged.sort((a, b) => a.at - b.at) // 乱序落库也按时间排
}

/** 游标推进：只进不退；空批/更小的游标不倒退。 */
export function advanceCursor(current: number, next: unknown): number {
  const n = Number(next)
  if (!Number.isFinite(n)) return current
  return n > current ? n : current
}

export interface QueueItem {
  sessionId: string
  externalUserId: string
  status: string
  createdAt: number
  waitLabel: string
}

/** 等待时长人话（队列紧迫感）：injectable now 便于测试。 */
export function waitLabel(createdAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - createdAt) / 1000))
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟`
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`
}

export function mapQueue(list: unknown, now: number): QueueItem[] {
  if (!Array.isArray(list)) return []
  const out: QueueItem[] = []
  for (const s of list as Record<string, any>[]) {
    if (!s || !s.sessionId) continue
    out.push({
      sessionId: String(s.sessionId),
      externalUserId: String(s.externalUserId || ''),
      status: String(s.status || ''),
      createdAt: Number(s.createdAt) || 0,
      waitLabel: waitLabel(Number(s.createdAt) || now, now),
    })
  }
  return out
}

// 快捷回复 + 页内提醒（直接复用后端 listKb）。
export interface KbEntry {
  key: string
  question: string
  answer: string
}

/** 快捷回复过滤：剔除 enabled===false / 空 question 或 answer 的条目（与 dispatch.ts bot 侧「未启用跳过」语义
 *  对齐）；保留 listKb 现行返回序（category→order），不额外排序。 */
export function filterQuickReplies(list: unknown): KbEntry[] {
  if (!Array.isArray(list)) return []
  const out: KbEntry[] = []
  for (const e of list as Record<string, any>[]) {
    if (!e || typeof e !== 'object') continue
    if (e.enabled === false) continue
    const question = String(e.question || '').trim()
    const answer = String(e.answer || '').trim()
    if (!question || !answer) continue
    out.push({ key: String(e.key || ''), question, answer })
  }
  return out
}

/** 提醒聚合公式一半——队列新增会话数：首拉（prevIds 为 null）不算新增，只数 nextIds 里没见过的 id。 */
export function diffNewSessions(prevIds: string[] | null, nextIds: string[]): number {
  if (!prevIds) return 0
  const seen = new Set(prevIds)
  let n = 0
  for (const id of nextIds) if (!seen.has(id)) n++
  return n
}

/** 提醒聚合公式另一半——失焦期间当前打开会话的新入站消息数：首拉（prevMsgs 为 null）不算新增；出站消息不计；
 *  身份判同复用 mergeThread 同一套 keyOf（游标边界重复不重计）。 */
export function diffNewInbound(prevMsgs: Msg[] | null, nextMsgs: Msg[]): number {
  if (!prevMsgs) return 0
  const seen = new Set(prevMsgs.map(keyOf))
  let n = 0
  for (const m of nextMsgs) if (m.direction === 'in' && !seen.has(keyOf(m))) n++
  return n
}

/** 标题角标（恒幂等）：n>0 前缀 `(n) `，n=0 原样返回 base——反复以 n=0 调用不叠加/不残留前缀。 */
export function titleWithBadge(base: string, n: number): string {
  return n > 0 ? `(${n}) ${base}` : base
}

// 坐席切状态：代际号拦过期回包，锚只被更新成功推进，全部请求收尾后 UI 收敛到最后确认态。
// 测见 tests/desk.test.ts「坐席状态并发收敛」。无服务端版本号，不保证与服务端处理顺序强一致。
export function createStatusController(
  post: (_action: string, _payload?: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>,
  initial: 'online' | 'busy' | 'offline' = 'online',
) {
  let statusSeq = 0
  let confirmedStatus: 'online' | 'busy' | 'offline' = initial
  let confirmedGen = 0
  let inFlight = 0
  return {
    async setStatus(
      s: 'online' | 'busy' | 'offline',
      apply: { setStatus: (_v: 'online' | 'busy' | 'offline') => void; setMessage: (_v: string) => void },
      errorText: (_code: string | undefined) => string,
    ) {
      const my = ++statusSeq
      inFlight++
      apply.setStatus(s)
      const r = await post('setAgentStatus', { status: s })
      inFlight--
      if (r.ok && my > confirmedGen) {
        confirmedStatus = s
        confirmedGen = my
      }
      if (my === statusSeq && !r.ok) {
        apply.setStatus(confirmedStatus)
        apply.setMessage(errorText(r.error))
      }
      if (inFlight === 0) apply.setStatus(confirmedStatus)
    },
  }
}

/** 定时轮询的在途闸：同一 key 上一拍没回来就跳过这一拍，慢网下请求不堆积、不重复计费。只包定时器，
 *  坐席手动触发的拉取（打开会话/认领后刷新）不经此闸。按 key 分闸：切会话后旧会话卡住的请求
 *  不能挡住新会话的轮询。 */
export function skipWhileBusy(fn: () => Promise<unknown>, keyOf: () => unknown = () => ''): () => Promise<void> {
  const busy = new Set<unknown>()
  return async () => {
    const k = keyOf()
    if (busy.has(k)) return
    busy.add(k)
    try {
      await fn()
    } finally {
      busy.delete(k)
    }
  }
}

/** 坐席动作错误人话（原文兜底）。 */
export function deskErrorText(e: unknown): string {
  const code = String(e || '')
  const MAP: Record<string, string> = {
    AT_CAPACITY: '你在接的会话满了——先结束/放手一个再认领',
    NOT_CLAIMABLE: '这单已被别人接走了',
    NOT_ACTIVE: '会话不在服务中（可能已结束或退回队列）',
    NOT_FOUND: '会话不存在',
    FORBIDDEN: '这不是你在接的会话',
    NO_CHANNEL: '会话缺渠道信息，发不了消息',
    SEND_FAIL: '消息没发出去（微信侧拒收）——没有归档，请重试',
    NO_BRIDGE: '这位顾客还没绑定身份，看不了 360',
    NO_CONSENT: '顾客未同意数据共享——按规定不能看 TA 的资料',
    ALREADY_CLOSED: '会话已经结束了',
    SESSION_LOST: '登录已失效，请重新登录',
    WRITE_FAIL: '状态没保存成功，稍后再试', // setAgentStatus 写失败不吞
    CALL_TIMEOUT: '服务器太久没回话。如果刚才是提交操作，可能已经生效——先刷新看看再决定要不要重试', // 后台刷列表也显这句
    AUTH_UNAVAILABLE: '登录校验服务暂时不可用，稍后再试',
    BAD_JSON_RESPONSE: '服务器回包读不懂，刷新后再试',
    NETWORK: '网络不通，检查网络后重试',
    ESCALATED_SUPER_ONLY: '这单已升级给商户处理，只有管理员能接',
    NO_AGENT: '没认出你的坐席身份，请重新登录',
    BAD_ARGS: '请求内容不全（比如消息是空的），检查后重试',
    SERVER_ERROR: '服务器处理时出错了。如果刚才是提交操作，可能已部分生效——先刷新看看再决定要不要重试',
    TOO_MANY_ATTEMPTS: '这个网络下口令试错太多次，已被暂时锁定，过几分钟再试',
  }
  return MAP[code] || MAP[code.split(':')[0]] || '操作没成功（' + code + '）'
}

/** 企微免登失败人话（落到口令登录页时显示）：没绑号/被停用这类换口令也许能进、也许不能，要说清。 */
export function wecomLoginText(e: unknown): string {
  const code = String(e || '')
  const MAP: Record<string, string> = {
    BAD_CODE: '企微免登没通过（链接已失效，或你不是企业成员）。请从企微里重新打开，或用口令登录',
    NO_BOUND_ACCOUNT: '你的企微账号还没绑定坐席账号。请找管理员绑定，或先用口令登录',
    WECOM_ID_TAKEN: '你的企微账号绑在了好几个坐席账号上，认不出是哪个。请找管理员处理，或先用口令登录',
    ACCOUNT_DISABLED: '这个坐席账号已被停用，请找管理员恢复',
    KF_TOKEN_UNAVAILABLE: '企微免登服务暂时不可用。请稍后从企微重新打开，或先用口令登录',
    WECOM_ID_LOOKUP_FAIL: '查企微绑定时读库失败。请稍后从企微重新打开，或先用口令登录',
    NO_SESSION_TOKEN: '企微认出你了，但云端没发下登录凭证。请稍后从企微重新打开，或先用口令登录',
    TOO_MANY_ATTEMPTS: '这个网络下登录试错太多次，已被暂时锁定，过几分钟再试',
  }
  return MAP[code] || '企微免登没成功，请用口令登录（' + code + '）'
}
