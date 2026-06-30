import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { imgSecCheck } from '../../packages/cloud/src/kit/contentsec'
import { main as submitCheckpointPhoto } from '../../packages/cloud/src/functions/learning/submitCheckpointPhoto'
import { listCheckpoints, saveCheckpoints } from '../../packages/cloud/src/functions/admin/adminApi/actions/checkpoints'
import { getCustomer360 } from '../../packages/cloud/src/functions/admin/adminApi/actions/customer360'

// 后台360工作站 B2.2 节点诊断：UGC 拍照上传（imgSecCheck fail-closed·根因#3）+ admin 策展 + 360 节点照片 provider。
const db = cloud.database()
const ctx = (data) => ({ db, cloud, data, drafts: {} })
const parse = (res) => JSON.parse(res.body)
const cpOf = (r) => r.panels.find((p) => p.key === 'checkpoints')

// 让本人「已进课」（submitCheckpointPhoto 的进课闸）
const seedEntered = (openid, courseId) =>
  control.seed('activations', [{ _id: openid + '__' + courseId, _openid: openid, courseId, enteredAt: 5000 }])

beforeEach(() => {
  control.reset()
  control.setOpenId('u1')
})

describe('kit/contentsec imgSecCheck（内容安全接缝·fail-closed·根因#3）', () => {
  it('errCode 0 → ok（图安全）', async () => {
    expect(await imgSecCheck('cloud://a.png')).toEqual({ ok: true })
  })
  it('87014 内容违规 → IMG_RISKY（拒）', async () => {
    control.setOpenapiFail(true, 87014)
    expect(await imgSecCheck('cloud://a.png')).toEqual({ ok: false, error: 'IMG_RISKY' })
  })
  it('其它异常（能力未开/网络）→ SEC_CHECK_FAIL（fail-closed 拒·非违规码也不放行）', async () => {
    control.setOpenapiFail(true, -1)
    expect(await imgSecCheck('cloud://a.png')).toEqual({ ok: false, error: 'SEC_CHECK_FAIL' })
  })
  it('空 fileId → NO_FILE（不放行）', async () => {
    expect((await imgSecCheck('')).ok).toBe(false)
  })
})

describe('submitCheckpointPhoto（拍照上传·闸 + 进课 + 内容安全 fail-closed + 幂等）', () => {
  it('NO_OPENID（无可信身份 fail-closed·根因#3）', async () => {
    control.setOpenId('')
    expect((await submitCheckpointPhoto({ courseId: 'k1', nodeId: 'n1', fileId: 'f' })).error).toBe('NO_OPENID')
  })

  it('BAD_ARGS（缺 courseId/nodeId/fileId）', async () => {
    seedEntered('u1', 'k1')
    expect((await submitCheckpointPhoto({ courseId: 'k1', nodeId: 'n1' })).error).toBe('BAD_ARGS')
    expect(control.dump('checkpoints')).toHaveLength(0)
  })

  it('NOT_ENTITLED（未确认进课不能传·防未购造数·与 trackEvent 同闸）', async () => {
    const r = await submitCheckpointPhoto({ courseId: 'k1', nodeId: 'n1', fileId: 'cloud://x.png' })
    expect(r.error).toBe('NOT_ENTITLED')
    expect(control.dump('checkpoints')).toHaveLength(0)
  })

  it('已进课 + 内容安全过 → 落库 sub 提交（确定性 _id·绑本人 openid）', async () => {
    seedEntered('u1', 'k1')
    const r = await submitCheckpointPhoto({ courseId: 'k1', nodeId: 'n1', fileId: 'cloud://x.png' })
    expect(r.ok).toBe(true)
    const rows = control.dump('checkpoints')
    expect(rows).toHaveLength(1)
    expect(rows[0]._id).toBe('sub:u1:k1:n1')
    expect(rows[0].type).toBe('sub')
    expect(rows[0]._openid).toBe('u1') // 云端写本人·不信前端
    expect(rows[0].fileId).toBe('cloud://x.png')
    expect(rows[0].secPassed).toBe(true)
  })

  it('内容违规（imgSecCheck IMG_RISKY）→ 拒且绝不入库（fail-closed·守卫 ugc-imgsecchecked）', async () => {
    seedEntered('u1', 'k1')
    control.setOpenapiFail(true, 87014)
    const r = await submitCheckpointPhoto({ courseId: 'k1', nodeId: 'n1', fileId: 'cloud://bad.png' })
    expect(r.error).toBe('IMG_RISKY')
    expect(control.dump('checkpoints')).toHaveLength(0) // 违规图一条都不落
  })

  it('校不了（能力未开/网络）→ SEC_CHECK_FAIL·不入库（fail-closed·证明安全才放行）', async () => {
    seedEntered('u1', 'k1')
    control.setOpenapiFail(true, -1)
    const r = await submitCheckpointPhoto({ courseId: 'k1', nodeId: 'n1', fileId: 'cloud://x.png' })
    expect(r.error).toBe('SEC_CHECK_FAIL')
    expect(control.dump('checkpoints')).toHaveLength(0)
  })

  it('幂等：同节点重传覆盖最新（确定性 _id·不重复建档）', async () => {
    seedEntered('u1', 'k1')
    await submitCheckpointPhoto({ courseId: 'k1', nodeId: 'n1', fileId: 'cloud://v1.png' })
    await submitCheckpointPhoto({ courseId: 'k1', nodeId: 'n1', fileId: 'cloud://v2.png' })
    const rows = control.dump('checkpoints').filter((d) => d.type === 'sub')
    expect(rows).toHaveLength(1) // 覆盖·非新增
    expect(rows[0].fileId).toBe('cloud://v2.png') // 最新
  })
})

describe('adminApi 策展（saveCheckpoints / listCheckpoints·整课覆盖式 def）', () => {
  it('saveCheckpoints upsert def + 按 order 列出（只 def·sub 不混入）', async () => {
    await saveCheckpoints(
      ctx({
        courseId: 'k1',
        nodes: [
          { nodeId: 'n2', title: '收尾藏线', remedy: '回针两次再剪', order: 2 },
          { nodeId: 'n1', title: '魔术环', remedy: '收紧前别松手', order: 1 },
        ],
      })
    )
    const list = parse(await listCheckpoints(ctx({ courseId: 'k1' }))).list
    expect(list.map((x) => x.nodeId)).toEqual(['n1', 'n2']) // 按 order 升序
    expect(list[0].title).toBe('魔术环')
    expect(list[0].remedy).toBe('收紧前别松手')
  })

  it('BAD_ARGS（缺 courseId）', async () => {
    expect(parse(await saveCheckpoints(ctx({ nodes: [] }))).error).toBe('BAD_ARGS')
  })

  it('整课覆盖式：删本课不在新列表的旧 def·不碰用户 sub 提交', async () => {
    await saveCheckpoints(ctx({ courseId: 'k1', nodes: [{ nodeId: 'n1', title: 'A' }, { nodeId: 'n2', title: 'B' }] }))
    control.seed('checkpoints', [{ _id: 'sub:u1:k1:n1', type: 'sub', _openid: 'u1', courseId: 'k1', nodeId: 'n1', fileId: 'f' }])
    await saveCheckpoints(ctx({ courseId: 'k1', nodes: [{ nodeId: 'n1', title: 'A2' }] })) // 去掉 n2
    const defs = control.dump('checkpoints').filter((d) => d.type === 'def')
    expect(defs.map((d) => d.nodeId)).toEqual(['n1']) // n2 def 被删
    expect(control.dump('checkpoints').some((d) => d.type === 'sub')).toBe(true) // 用户提交保留
  })
})

describe('节点照片 provider（B2.2·经 getCustomer360·join 节点定义取标题）', () => {
  it('返本人各节点照片 + join def 标题（只本人·bounded）', async () => {
    control.seed('checkpoints', [
      { _id: 'def:k1:n1', type: 'def', courseId: 'k1', nodeId: 'n1', title: '魔术环', order: 1 },
      { _id: 'sub:A:k1:n1', type: 'sub', _openid: 'A', courseId: 'k1', nodeId: 'n1', fileId: 'cloud://a.png', createdAt: 100 },
      { _id: 'sub:B:k1:n1', type: 'sub', _openid: 'B', courseId: 'k1', nodeId: 'n1', fileId: 'cloud://b.png' }, // 别人的
    ])
    const cp = cpOf(parse(await getCustomer360(ctx({ openid: 'A' }))))
    expect(cp.label).toBe('节点照片')
    expect(cp.data.count).toBe(1) // 只 A 的
    expect(cp.data.photos[0].title).toBe('魔术环') // join def
    expect(cp.data.photos[0].fileId).toBe('cloud://a.png')
  })

  it('无提交客人：空 photos·不报错（错误隔离）', async () => {
    const cp = cpOf(parse(await getCustomer360(ctx({ openid: 'Z' }))))
    expect(cp.error).toBeUndefined()
    expect(cp.data.count).toBe(0)
  })

  it('节点无 def 定义：标题回退 nodeId（不崩）', async () => {
    control.seed('checkpoints', [
      { _id: 'sub:A:k1:nx', type: 'sub', _openid: 'A', courseId: 'k1', nodeId: 'nx', fileId: 'cloud://x.png' },
    ])
    const cp = cpOf(parse(await getCustomer360(ctx({ openid: 'A' }))))
    expect(cp.data.photos[0].title).toBe('nx')
  })
})
