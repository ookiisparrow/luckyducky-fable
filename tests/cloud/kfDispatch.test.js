import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { vi } from 'vitest'
import {
  recognize,
  rootMenu,
  menuFor,
  route,
  resolveOpenid,
  summarizeOrders,
  handleMessage,
  extUserId,
  processKfBatch,
} from '../../packages/cloud/src/functions/cs/kfCallback/dispatch'

// 分流引擎：关键词识别 → 高亮 msgmenu；menu_id 路由（文字/卡片/转人工/查订单）；身份桥接查订单。

beforeEach(() => control.reset())

describe('extUserId wire 形状（根因#8 真机字段位置·防 40058）', () => {
  it('text 消息：external_userid 在顶层', () => {
    expect(extUserId({ msgtype: 'text', external_userid: 'wmAAA', text: { content: '物流' } })).toBe('wmAAA')
  })
  it('event 进会话：external_userid 在 event 子对象（曾取顶层取空→send_msg 40058）', () => {
    expect(extUserId({ msgtype: 'event', event: { event_type: 'enter_session', external_userid: 'wmBBB' } })).toBe('wmBBB')
  })
  it('都缺 → 空串（不构造空 touser 的非法 send）', () => {
    expect(extUserId({ msgtype: 'event', event: { event_type: 'enter_session' } })).toBe('')
    expect(extUserId(null)).toBe('')
  })
})

describe('processKfBatch 防吞单（审计 P2·一条崩不拖垮整批/不永久跳过）', () => {
  it('单条失败：不中断整批 + 撤回认领 + anyFailed=true；成功项留 seen 去重', async () => {
    const db = cloud.database()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handled = []
    const handleOne = async (msg) => {
      if (msg.msgid === 'm2') throw new Error('boom')
      handled.push(msg.msgid)
    }
    const anyFailed = await processKfBatch(db, [{ msgid: 'm1' }, { msgid: 'm2' }, { msgid: 'm3' }], handleOne)
    expect(anyFailed).toBe(true)
    expect(handled).toEqual(['m1', 'm3']) // m2 抛错但 m1/m3 照常处理（不被中断）
    const seen = control.dump('kfState').map((d) => d._id)
    expect(seen).toContain('seen:m1') // 成功项保留认领
    expect(seen).toContain('seen:m3')
    expect(seen).not.toContain('seen:m2') // 失败项撤回认领 → 下次重拉可重试（不吞单）
    expect(errSpy.mock.calls.flat().join(' ')).toContain('HANDLE_FAILED')
    errSpy.mockRestore()
  })

  it('全成功：anyFailed=false，全部认领', async () => {
    const db = cloud.database()
    const anyFailed = await processKfBatch(db, [{ msgid: 'a' }, { msgid: 'b' }], async () => {})
    expect(anyFailed).toBe(false)
    expect(control.dump('kfState').map((d) => d._id).sort()).toEqual(['seen:a', 'seen:b'])
  })

  it('去重：已 seen 的消息跳过不再 handle（确定性 _id 撞号·幂等）', async () => {
    const db = cloud.database()
    control.seed('kfState', [{ _id: 'seen:dup', at: 1 }])
    const handled = []
    await processKfBatch(db, [{ msgid: 'dup' }, { msgid: 'fresh' }], async (msg) => handled.push(msg.msgid))
    expect(handled).toEqual(['fresh']) // dup 已处理过（add 撞号→回查文档存在=duplicate）→ 跳过
  })

  it('认领基建错（非撞号）：不当重复跳过·告警 + anyFailed + 不处理（外审 P1.4·不永久吞消息）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // 注入「add 抛非撞号错 + seen 文档确实不存在」的 db：模拟 DB 权限/集合缺/瞬时基建错
    const failingDb = {
      collection: () => ({
        add: async () => {
          throw new Error('PERMISSION_DENIED')
        },
        doc: () => ({ get: async () => Promise.reject(new Error('DOCUMENT_NOT_FOUND')), remove: async () => {} }),
      }),
    }
    const handled = []
    const anyFailed = await processKfBatch(failingDb, [{ msgid: 'mX' }], async (msg) => handled.push(msg.msgid))
    expect(anyFailed).toBe(true) // 本批失败 → 调用方保留旧游标下次重拉重认领
    expect(handled).toEqual([]) // 未认领成功就不处理（既不静默吞、也不在无认领下重复副作用）
    expect(errSpy.mock.calls.flat().join(' ')).toContain('CLAIM_FAILED') // 告警（旧实现是静默丢失）
    errSpy.mockRestore()
  })
})

describe('关键词识别（确定性·低幻觉）', () => {
  it('命中类别 + 命中词', () => {
    expect(recognize('我的东西怎么还没到')).toEqual({ cat: 'logistics', word: '没到' })
    expect(recognize('激活码不会用')).toEqual({ cat: 'activation', word: '激活码' })
    expect(recognize('想退货')).toEqual({ cat: 'aftersale', word: '退货' })
    expect(recognize('有没有钩织教程')).toMatchObject({ cat: 'tutorial' })
    expect(recognize('你们几点上班')).toBeNull()
  })
})

describe('msgmenu 内容', () => {
  it('rootMenu 五大入口 + tail 提示打字', () => {
    const m = rootMenu()
    expect(m.list.map((i) => i.click.id)).toEqual(['cat:logistics', 'cat:activation', 'cat:aftersale', 'cat:tutorial', 'human'])
    expect(m.tail_content).toContain('打字')
  })
  it('menuFor 物流：head 高亮识别词 + 含查订单/转人工', () => {
    const m = menuFor('logistics', '没到')
    expect(m.head_content).toContain('没到')
    const ids = m.list.map((i) => i.click.id)
    expect(ids).toContain('order:query')
    expect(ids).toContain('human')
  })
})

describe('menu_id 路由', () => {
  it('human→转人工 / order:query→查订单 / FAQ→读 kb / 申请售后→小程序卡片 / 分类→下级菜单', () => {
    expect(route('human')).toEqual({ type: 'transfer' })
    expect(route('order:query')).toEqual({ type: 'order_query' })
    // FAQ 叶子答案改从 kb 单源读（B4.1·守卫 faq-via-kb-single-source）：route 只回 faqKey，答案由 handleMessage 读 kb
    expect(route('aftersale:policy')).toEqual({ type: 'faq', faqKey: 'aftersale:policy' })
    // 卡片 page 须是 pages.json 已注册路由（外审 P2.11·根因#8）：售后页是 aftersales(带 s)、课程页在 pkg-video 分包
    expect(route('aftersale:apply')).toMatchObject({ type: 'miniprogram', page: 'pages/aftersales/index' })
    expect(route('course:open')).toMatchObject({ type: 'miniprogram', page: 'pkg-video/courses/index' })
    expect(route('cat:logistics').type).toBe('menu')
    expect(route('未知id').type).toBe('menu') // 兜底回根菜单
  })
})

describe('身份桥接 + 订单摘要', () => {
  it('resolveOpenid：映射存在返 openid，不存在返 null', async () => {
    const db = cloud.database()
    control.seed('kfIdentity', [{ _id: 'ext:euid-1', openid: 'openid-A' }])
    expect(await resolveOpenid(db, 'euid-1')).toBe('openid-A')
    expect(await resolveOpenid(db, 'euid-none')).toBeNull()
  })

  it('summarizeOrders：取最近订单 + 状态中文', async () => {
    const db = cloud.database()
    control.seed('orders', [
      // 运单号写在 shipping 子对象（发货时 adminApi 写 shipping:{company,trackingNo}）——真机 wire 形状（外审 P2.19·根因#8）
      { _id: 'o1', id: 'o1', _openid: 'openid-A', status: 'shipped', shipping: { company: 'SF', trackingNo: 'SF123' }, createdAt: 200 },
      { _id: 'o2', id: 'o2', _openid: 'openid-A', status: 'paid', createdAt: 100 },
    ])
    const txt = await summarizeOrders(db, 'openid-A')
    expect(txt).toContain('o1')
    expect(txt).toContain('已发货')
    expect(txt).toContain('SF123') // 取 o.shipping.trackingNo（曾错取顶层 o.trackingNo→永远显示不出运单号）
    expect(await summarizeOrders(db, 'openid-empty')).toContain('没查到')
  })
})

describe('handleMessage 编排', () => {
  function mkCtx() {
    const sent = []
    const transferred = []
    return {
      sent,
      transferred,
      ctx: {
        db: cloud.database(),
        openKfId: 'wkKf',
        cfg: { appid: 'wxapp', thumbMediaId: 'thumb1' },
        send: async (p) => sent.push(p),
        transfer: async (eid) => transferred.push(eid),
      },
    }
  }

  it('自由文本命中关键词 → 发高亮 msgmenu', async () => {
    const { ctx, sent } = mkCtx()
    await handleMessage(ctx, { externalUserId: 'e1', menuId: '', text: '我的东西还没到' })
    expect(sent[0].msgtype).toBe('msgmenu')
    expect(sent[0].msgmenu.head_content).toContain('没到')
  })

  it('点 human → 先发转接确认文字 + 尽力转人工（48002 兜底·见配置手册）', async () => {
    const { ctx, sent, transferred } = mkCtx()
    await handleMessage(ctx, { externalUserId: 'e2', menuId: 'human', text: '' })
    expect(transferred).toEqual(['e2']) // 仍尝试转接（权限通了即自动分配）
    expect(sent).toHaveLength(1) // 顾客必有文字反馈，不再静默无响应
    expect(sent[0].msgtype).toBe('text')
    expect(sent[0].text.content).toContain('人工')
  })

  it('点 order:query 但未绑定 → 引导登录文字', async () => {
    const { ctx, sent } = mkCtx()
    await handleMessage(ctx, { externalUserId: 'e3', menuId: 'order:query', text: '' })
    expect(sent[0].msgtype).toBe('text')
    expect(sent[0].text.content).toContain('登录')
  })

  it('点 order:query 已绑定 → 会话内回订单摘要', async () => {
    control.seed('kfIdentity', [{ _id: 'ext:e4', openid: 'openid-B' }])
    control.seed('orders', [{ _id: 'o9', id: 'o9', _openid: 'openid-B', status: 'paid', createdAt: 1 }])
    const { ctx, sent } = mkCtx()
    await handleMessage(ctx, { externalUserId: 'e4', menuId: 'order:query', text: '' })
    expect(sent[0].text.content).toContain('o9')
  })

  it('点申请售后 → 发 miniprogram 卡片跳现有页', async () => {
    const { ctx, sent } = mkCtx()
    await handleMessage(ctx, { externalUserId: 'e5', menuId: 'aftersale:apply', text: '' })
    expect(sent[0].msgtype).toBe('miniprogram')
    expect(sent[0].miniprogram.pagepath).toBe('pages/aftersales/index') // 已注册路由（外审 P2.11）
    expect(sent[0].miniprogram.appid).toBe('wxapp')
  })

  it('卡片缺封面素材(thumbMediaId)→ 降级发文字（防 40058·小程序未发布/thumb 未配时）', async () => {
    const { ctx, sent } = mkCtx()
    ctx.cfg = { appid: 'wxapp', thumbMediaId: '' } // 有 appid 无封面
    await handleMessage(ctx, { externalUserId: 'e6', menuId: 'aftersale:apply', text: '' })
    expect(sent[0].msgtype).toBe('text')
    expect(sent[0].text.content).toContain('申请售后')
  })
})
