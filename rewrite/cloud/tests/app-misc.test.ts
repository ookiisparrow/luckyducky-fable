// 黄金 learning-content §一（激活码生成管理闸）/§八（UGC 内容安全 fail-closed）/§十二（seed/init 管理闸）
// + admin-misc §四（意见反馈过闸）/§五（事件流水定时清理）+ cs-agent §一（建库清单含坐席集合）（守卫 rw-misc-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { COLLECTIONS, SEED_PRODUCTS, SEED_COURSES } from '@ldrw/shared'
import { main as genQrcodes, makeBatchId } from '../src/functions/ops/genQrcodes'
import { main as seedProducts } from '../src/functions/ops/seedProducts'
import { main as seedCourses } from '../src/functions/ops/seedCourses'
import { main as initDb } from '../src/functions/ops/initDb'
import { main as cleanupEvents } from '../src/functions/timers/cleanupEvents'
import { main as app } from '../src/functions/app/index'

beforeEach(() => {
  control.reset()
  control.setOpenId('')
})

describe('激活码生成（黄金 §一：管理闸·防废码·数量合法·批次不撞）', () => {
  beforeEach(() => control.seed('courses', [{ _id: 'c1', title: '钩织入门' }]))

  it('大白话：后台/CLI（无身份）放行；普通用户一律拒且一个码不生成；管理员放行', async () => {
    control.setOpenId('oUser')
    const r = (await genQrcodes({ courseId: 'c1', count: 3 })) as any
    expect(r.error).toBe('ADMIN_ONLY')
    expect(control.dump('qrcodes').length).toBe(0)
    control.seed('users', [{ _id: 'u1', _openid: 'oAdmin', isAdmin: true }])
    control.setOpenId('oAdmin')
    expect(((await genQrcodes({ courseId: 'c1', count: 2 })) as any).ok).toBe(true)
    control.setOpenId('')
    expect(((await genQrcodes({ courseId: 'c1', count: 1 })) as any).ok).toBe(true)
  })

  it('大白话：缺课程/课程不存在拒；数量漏传/非数字/为 0 拒不再静默按 1；码唯一且用易抄写字符表；同课同秒两批不撞号', async () => {
    expect(((await genQrcodes({ count: 3 })) as any).error).toBe('BAD_ARGS')
    expect(((await genQrcodes({ courseId: 'ghost', count: 3 })) as any).error).toContain('UNKNOWN_COURSE')
    for (const bad of [{}, { count: 0 }, { count: 'abc' }]) {
      expect(((await genQrcodes({ courseId: 'c1', ...bad })) as any).error).toBe('BAD_ARGS')
    }
    expect(control.dump('qrcodes').length).toBe(0) // 全拒·一个码没生成
    const r = (await genQrcodes({ courseId: 'c1', count: 30 })) as any
    expect(r.count).toBe(30)
    expect(new Set(r.codes).size).toBe(30) // 全局唯一（code 即 _id·库级约束）
    for (const c of r.codes) expect(c).toMatch(/^LD[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/) // 无 0/O/1/I
    // 同课同一毫秒两批：批次号必不相同（时间精度外再加随机后缀·防后台错误合并）
    const now = Date.now()
    expect(makeBatchId('c1', now)).not.toBe(makeBatchId('c1', now))
  })
})

describe('seed / init 管理闸（黄金 §十二：防覆盖生产数据·清单=单源全量）', () => {
  it('大白话：普通用户种数据一律拒且不写库（防覆盖生产商品/课程）；后台放行且幂等重跑不重复建档', async () => {
    control.setOpenId('oUser')
    expect(((await seedProducts({})) as any).error).toBe('ADMIN_ONLY')
    expect(((await seedCourses({})) as any).error).toBe('ADMIN_ONLY')
    expect(control.dump('products').length).toBe(0)
    control.setOpenId('')
    const p = (await seedProducts({})) as any
    expect(p.count).toBe(SEED_PRODUCTS.length)
    await seedProducts({}) // 幂等：id 作 _id·set upsert·重跑不翻倍
    expect(control.dump('products').length).toBe(SEED_PRODUCTS.length)
    const c = (await seedCourses({})) as any
    expect(c.count).toBe(SEED_COURSES.length)
    expect(control.dump('courses').length).toBe(SEED_COURSES.length)
  })

  it('大白话：初始化建库清单与集合单一源全量对齐（加集合不用改函数），坐席会话/坐席状态两集合在册可锁权限', async () => {
    const r = (await initDb({})) as any
    expect(r.ok).toBe(true)
    const names = Object.keys(r.result)
    expect(names.sort()).toEqual(Object.values(COLLECTIONS).sort()) // 清单＝单源全量
    expect(names).toContain('csSession') // 坐席两集合在册（防动态建·控制台锁不住的窗口）
    expect(names).toContain('agentState')
  })
})

describe('意见反馈（黄金 admin-misc：过闸·白名单·限频）', () => {
  const submit = (data: Record<string, unknown>) => app({ action: 'submitFeedback', data }) as Promise<any>

  it('大白话：无身份拒；空白内容拒不落库；分类越界归默认、超长截断；落库绑云端本人身份', async () => {
    expect((await submit({ content: 'x' })).error).toBe('NO_OPENID')
    control.setOpenId('oU1')
    expect((await submit({ content: '   ' })).error).toBe('EMPTY_FEEDBACK')
    expect(control.dump('feedback').length).toBe(0)
    const long = '很'.repeat(600)
    expect((await submit({ content: long, category: 'hacker', contact: 'wx: duck', openid: '伪造' })).ok).toBe(true)
    const doc = control.dump('feedback')[0]
    expect(doc._openid).toBe('oU1') // 身份以云端为准·不信前端
    expect(doc.category).toBe('other') // 枚举越界归默认
    expect(doc.content.length).toBe(500) // 超长截断
  })

  it('大白话：单人限频——超限那条被拒且不落库', async () => {
    control.setOpenId('oU1')
    for (let i = 0; i < 10; i++) expect((await submit({ content: '反馈' + i })).ok).toBe(true)
    const over = await submit({ content: '第 11 条' })
    expect(over.error).toBe('RATE_LIMITED')
    expect(control.dump('feedback').length).toBe(10)
  })
})

describe('节点拍照上传（黄金 §八：进课闸·内容安全 fail-closed·覆盖式幂等）', () => {
  const submit = (data: Record<string, unknown>) => app({ action: 'submitCheckpointPhoto', data }) as Promise<any>
  const seedEntered = () => control.seed('activations', [{ _id: 'a1', _openid: 'oU1', courseId: 'c1', enteredAt: 123 }])

  it('大白话：无身份拒；缺参拒；未进课拒（防未购造数）——全部不落库', async () => {
    expect((await submit({ courseId: 'c1', nodeId: 'n1', fileId: 'f1' })).error).toBe('NO_OPENID')
    control.setOpenId('oU1')
    expect((await submit({ courseId: 'c1', nodeId: 'n1' })).error).toBe('BAD_ARGS')
    expect((await submit({ courseId: 'c1', nodeId: 'n1', fileId: 'f1' })).error).toBe('NOT_ENTITLED') // 未进课
    control.seed('activations', [{ _id: 'a0', _openid: 'oU1', courseId: 'c1', enteredAt: null }]) // 激活未进课也不行
    expect((await submit({ courseId: 'c1', nodeId: 'n1', fileId: 'f1' })).error).toBe('NOT_ENTITLED')
    expect(control.dump('checkpoints').length).toBe(0)
  })

  it('大白话：图安全放行落库为本人提交；同节点重传覆盖不重复建档；违规拒；校验不了（能力未开/网络）也拒——证明安全才放行', async () => {
    control.setOpenId('oU1')
    seedEntered()
    expect((await submit({ courseId: 'c1', nodeId: 'n1', fileId: 'f1' })).ok).toBe(true)
    const doc = control.dump('checkpoints')[0]
    expect(doc._id).toBe('sub:oU1:c1:n1')
    expect(doc._openid).toBe('oU1')
    expect(doc.secPassed).toBe(true)
    // 覆盖式幂等：同节点重传 → 仍一条·fileId 更新
    expect((await submit({ courseId: 'c1', nodeId: 'n1', fileId: 'f2' })).ok).toBe(true)
    expect(control.dump('checkpoints').length).toBe(1)
    expect(control.dump('checkpoints')[0].fileId).toBe('f2')
    // 违规（平台判 87014）→ 拒且不入库
    control.setOpenapiFail(true, 87014)
    expect((await submit({ courseId: 'c1', nodeId: 'n2', fileId: 'f3' })).error).toBe('IMG_RISKY')
    // 校验不了（能力未开/网络异常·非违规码）→ 同样拒（fail-closed）
    control.setOpenapiFail(true)
    expect((await submit({ courseId: 'c1', nodeId: 'n3', fileId: 'f4' })).error).toBe('SEC_CHECK_FAIL')
    expect(control.dump('checkpoints').length).toBe(1) // n2/n3 一条没进
  })

  it('大白话：courseId/nodeId 含冒号一律拒（fail-closed·同 saveCheckpoints 先例：防 sub:openid:courseId:nodeId 拼接跨课/跨节点撞键覆盖）', async () => {
    control.setOpenId('oU1')
    seedEntered()
    const r1 = await submit({ courseId: 'c1:evil', nodeId: 'n1', fileId: 'f1' })
    expect(r1.error).toBe('BAD_ARGS:COLON_IN_ID')
    const r2 = await submit({ courseId: 'c1', nodeId: 'n1:evil', fileId: 'f1' })
    expect(r2.error).toBe('BAD_ARGS:COLON_IN_ID')
    expect(control.dump('checkpoints').length).toBe(0)
  })
})

describe('事件流水定时清理（黄金 admin-misc：只删过期·服务端专用）', () => {
  const OLD = Date.now() - 91 * 24 * 3600_000
  const NEW = Date.now() - 1 * 24 * 3600_000

  it('大白话：客户端带身份调用一律拒不删；服务端触发只删 90 天前——事件流/过期频控/客服去重痕各归各删，无时间戳的令牌游标不误删', async () => {
    control.seed('events', [
      { _id: 'e-old', createdAt: OLD },
      { _id: 'e-new', createdAt: NEW },
    ])
    control.seed('rateLimit', [
      { _id: 'r-old', updatedAt: OLD },
      { _id: 'r-live', updatedAt: NEW },
    ])
    control.seed('kfState', [
      { _id: 'seen:m-old', at: OLD },
      { _id: 'seen:m-new', at: NEW },
      { _id: 'token', accessToken: 'TKN', expireAt: 1 }, // 无 at·不误删
      { _id: 'cursor:kf1', cursor: 'abc' },
    ])
    control.setOpenId('oUser') // 客户端伪造触发：拒·不删
    expect(((await cleanupEvents()) as any).removed).toBe(0)
    expect(control.dump('events').length).toBe(2)
    control.setOpenId('') // 服务端定时触发
    const r = (await cleanupEvents()) as any
    expect(r).toMatchObject({ ok: true, removed: 1, rateLimit: 1, kfSeen: 1 })
    expect(control.dump('events').map((d: any) => d._id)).toEqual(['e-new'])
    expect(control.dump('rateLimit').map((d: any) => d._id)).toEqual(['r-live'])
    expect(control.dump('kfState').map((d: any) => d._id).sort()).toEqual(['cursor:kf1', 'seen:m-new', 'token'])
  })
})
