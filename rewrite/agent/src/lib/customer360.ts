// 坐席台顾客 360 瘦映射。标量与明细的拆法、中文标签从 admin `mapCs.ts` 的 mapPanels 抄来
// （坐席台不引 admin、不开共享包）。金额不换算：画像 totalSpent、订单 amount 云端已是元，这里只按原文显示。

export interface PanelField {
  k: string
  v: string
}

export interface PanelGroupVM {
  name: string
  count: number
  capped: boolean
  items: PanelField[][]
}

export interface PanelVM {
  key: string
  label: string
  failed: boolean
  rows: PanelField[]
  groups: PanelGroupVM[]
}

const GROUP_CAP = 50

// 与 admin mapCs.ts 的 CS_LABELS 同文。未知字段回退原始 key。
const CS_LABELS: Record<string, string> = {
  orderCount: '订单数', ordersCapped: '订单超采样', paidCount: '已付单数', totalSpent: '总消费（元）',
  activatedCount: '已激活课', enteredCount: '已进课', enterRate: '进课率 %', lastActiveAt: '最近活跃',
  count: '数量', capped: '超采样',
  orders: '订单', activations: '激活/课程', positions: '学习位置', photos: '节点照片',
  id: '单号', status: '状态', amount: '金额（元）', createdAt: '时间', itemCount: '件数', trackingNo: '运单号',
  courseId: '课程', code: '激活码', activated: '已激活', entered: '已进课', enteredAt: '进课时间',
  courseTitle: '课程', chapterTitle: '章', lessonName: '课时', segmentName: '小节',
  atSec: '进度（秒）', doneCount: '完成段', totalSegments: '总段', percent: '完成度 %', updatedAt: '更新',
  nodeId: '节点', title: '节点名', fileId: '文件',
}

const csLabel = (k: string): string => CS_LABELS[k] || k

// 与 admin format.dateTime 同式：本地时区到分钟。非法回空，交给 fmtVal 回退原文。
function dateTime(ts: unknown): string {
  const n = Number(ts)
  if (!Number.isFinite(n) || n <= 0) return ''
  const d = new Date(n)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function fmtVal(k: string, v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (/At$/.test(k) && typeof v === 'number') return dateTime(v) || String(v)
  return String(v)
}

function buildGroup(name: string, arr: unknown[]): PanelGroupVM {
  const items: PanelField[][] = arr.slice(0, GROUP_CAP).map((item) => {
    if (item && typeof item === 'object') {
      return Object.entries(item as Record<string, unknown>)
        .filter(([, val]) => val != null && val !== '')
        .map(([kk, val]) => ({ k: csLabel(kk), v: fmtVal(kk, val) }))
    }
    return [{ k: '', v: String(item) }]
  })
  return { name: csLabel(name), count: arr.length, capped: arr.length > GROUP_CAP, items }
}

/** 把 getSessionCustomer360 的 panels 拆成标量行 + 明细行。单面板 error 只标自己。 */
export function mapPanels(r: unknown): PanelVM[] {
  const d = (r && typeof r === 'object' ? r : {}) as Record<string, any>
  if (!Array.isArray(d.panels)) return []
  return (d.panels as Record<string, any>[]).filter(Boolean).map((p) => {
    const failed = !!p.error
    const rows: PanelField[] = []
    const groups: PanelGroupVM[] = []
    const data = p.data
    if (!failed && data && typeof data === 'object' && !Array.isArray(data)) {
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        if (Array.isArray(v)) {
          groups.push(buildGroup(k, v))
        } else if (v != null && v !== false) {
          // 标量不画 false（「超采样：否」是噪声）；明细里的 false 在 buildGroup 留下
          rows.push({ k: csLabel(k), v: fmtVal(k, v) })
        }
      }
    }
    return { key: String(p.key || ''), label: String(p.label || p.key || ''), failed, rows, groups }
  })
}
