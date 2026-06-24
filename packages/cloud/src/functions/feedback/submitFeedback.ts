import { withOpenId, withRateLimit, ok, err, str, COLLECTIONS } from '../../kit'

// 用户意见反馈（运营钩子①·待办#23 前端半边）：上线初期 bug 高发期主动收用户反馈。
// 写库必过闸（根因#3·withOpenId fail-closed）+ 按 openid 限频（根因#13·withRateLimit），防刷库堆垃圾。
// feedback 集合内部状态、仅管理端可读（控制台锁权限）；客户端只写不读。
//
// 白名单字段 + 长度上限（不信前端·根因#3）：
//   category 仅收枚举内值（bug/idea/other）、越界归 'other'；content 必填、≤500；contact 选填、≤100。
//   附环境上下文（page/version/platform）便于复现；时间戳 epoch 毫秒。

const CAPS = { content: 500, contact: 100, page: 64, version: 32, platform: 16 }
const CATEGORIES = ['bug', 'idea', 'other'] as const

// 写入；集合不存在则建一次再重试（免 initDb 时序依赖，同 trackEvent 范式）。
async function addTo(db: any, coll: string, data: any) {
  try {
    await db.collection(coll).add({ data })
  } catch {
    try {
      await db.createCollection(coll)
    } catch {
      /* 已存在则忽略 */
    }
    await db.collection(coll).add({ data })
  }
}

export const main = withOpenId(
  // 频控（根因#13）：反馈是低频动作，单用户 10 次/分远超正常，超即拒——挡刷
  withRateLimit('submitFeedback', { max: 10, windowMs: 60_000 }, async ({ db, OPENID, event }) => {
    const e: any = event
    const content = str(e.content, CAPS.content).trim()
    if (!content) return err('EMPTY_FEEDBACK')
    const category = (CATEGORIES as readonly string[]).includes(e.category) ? e.category : 'other'
    await addTo(db, COLLECTIONS.feedback, {
      _openid: OPENID,
      category,
      content,
      contact: str(e.contact, CAPS.contact).trim(),
      page: str(e.page, CAPS.page),
      version: str(e.version, CAPS.version),
      platform: str(e.platform, CAPS.platform),
      createdAt: Date.now(),
    })
    return ok()
  })
)
