// 锁 handleMessage 关单评分自由文本分支（拆局部函数前后行为须一致）：时窗/菜单优先/先消费标记再记分/回原因菜单。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { handleMessage, type DispatchCtx } from '../src/functions/cs/kfCallback/dispatch'
import { getDb } from '../src/kit'

const HOUR = 3600_000
const marker = (euid: string) => control.dump('kfState').find((x: any) => x._id === 'csatask:' + euid)
const collector = (openid?: string) => {
  const sent: any[] = []
  const ctx: DispatchCtx = {
    db: getDb(),
    openKfId: 'kf1',
    cfg: { appid: '', thumbMediaId: '' },
    send: async (p: any) => void sent.push(p),
    ...(openid === undefined ? {} : { openid }),
  }
  return { sent, ctx }
}

beforeEach(() => {
  control.reset()
  control.setOpenId('')
})

describe('关单评分自由文本（p-cs）', () => {
  it('时窗内纯数字：记分绑 openid、消费标记、只回一条补充原因菜单', async () => {
    control.seed('kfState', [{ _id: 'csatask:euA', at: Date.now() - HOUR }])
    const { sent, ctx } = collector('oA')
    await handleMessage(ctx, { externalUserId: 'euA', menuId: '', text: '3' })
    const rows = control.dump('csat')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ externalUserId: 'euA', openid: 'oA', score: 3 })
    expect(marker('euA')).toBeUndefined()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ touser: 'euA', open_kfid: 'kf1', msgtype: 'msgmenu' })
    expect(JSON.stringify(sent[0].msgmenu)).toContain('csatnote:')
  })

  it('标记过期（>48h）：不记分、标记保留、落回正常分流（根菜单）', async () => {
    control.seed('kfState', [{ _id: 'csatask:euB', at: Date.now() - 48 * HOUR - 60_000 }])
    const { sent, ctx } = collector('oB')
    await handleMessage(ctx, { externalUserId: 'euB', menuId: '', text: '5' })
    expect(control.dump('csat')).toHaveLength(0)
    expect(marker('euB')).toBeTruthy()
    expect(sent).toHaveLength(1)
    expect(sent[0].msgtype).toBe('msgmenu')
    expect(JSON.stringify(sent[0].msgmenu)).not.toContain('csatnote:')
  })

  it('带 menuId 时不走评分文本：标记不消费、按菜单路由走', async () => {
    control.seed('kfState', [{ _id: 'csatask:euC', at: Date.now() }])
    const { sent, ctx } = collector('')
    await handleMessage(ctx, { externalUserId: 'euC', menuId: 'order:query', text: '5' })
    expect(control.dump('csat')).toHaveLength(0)
    expect(marker('euC')).toBeTruthy()
    expect(sent).toHaveLength(1)
    expect(sent[0].text.content).toContain('还没识别到你的小程序账号')
  })

  it('非 1-5 纯数字不当评分：标记保留', async () => {
    control.seed('kfState', [{ _id: 'csatask:euD', at: Date.now() }])
    const { ctx } = collector('oD')
    await handleMessage(ctx, { externalUserId: 'euD', menuId: '', text: '6' })
    expect(control.dump('csat')).toHaveLength(0)
    expect(marker('euD')).toBeTruthy()
  })

  // 锚点 ^…$：顾客话里夹带 1-5（「3号」「12」）不能被当评分吃掉标记。
  it.each(['3号', '12'])('含数字但非纯 1-5（%s）：不记分、标记保留、落回正常分流', async (text) => {
    control.seed('kfState', [{ _id: 'csatask:euG', at: Date.now() }])
    const { sent, ctx } = collector('oG')
    await handleMessage(ctx, { externalUserId: 'euG', menuId: '', text })
    expect(control.dump('csat')).toHaveLength(0)
    expect(marker('euG')).toBeTruthy()
    expect(sent).toHaveLength(1)
    expect(sent[0].msgtype).toBe('msgmenu')
    expect(JSON.stringify(sent[0].msgmenu)).not.toContain('csatnote:')
  })

  it('记分写失败：标记已先消费（先删标记后记分），如实回没记上', async () => {
    control.seed('kfState', [{ _id: 'csatask:euE', at: Date.now() }])
    // recordCsat 会吞掉写失败抛出的一切（含断言错误），故在钩子里只取证、出钩子再断言。
    let markerAtWrite: unknown = 'hook-not-called'
    control.setBeforeUpdate(({ coll }: any) => {
      if (coll !== 'csat') return
      markerAtWrite = marker('euE')
      throw new Error('WRITE_FAIL')
    })
    const orig = console.error
    console.error = () => {}
    const { sent, ctx } = collector('oE')
    try {
      await handleMessage(ctx, { externalUserId: 'euE', menuId: '', text: '2' })
    } finally {
      console.error = orig
      control.setBeforeUpdate(null as never)
    }
    expect(markerAtWrite).toBeUndefined()
    expect(marker('euE')).toBeUndefined()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ msgtype: 'text', text: { content: '评分没记上，请稍后再评一次 🙏' } })
  })

  it('人工接待中（active）发纯数字：bot 静默，不记分、不消费标记', async () => {
    control.seed('csSession', [{ _id: 'wxkf:kf1:euF', status: 'active', updatedAt: Date.now() }])
    control.seed('kfState', [{ _id: 'csatask:euF', at: Date.now() }])
    const { sent, ctx } = collector('oF')
    await handleMessage(ctx, { externalUserId: 'euF', menuId: '', text: '3' })
    expect(control.dump('csat')).toHaveLength(0)
    expect(marker('euF')).toBeTruthy()
    expect(sent).toHaveLength(0)
  })
})
