// 隐私政策第五/六条「删除资料后对你的个人资料进行删除或匿名化处理」逐项落实 + kfBind 身份只信服务端上下文。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const own = (openid: string, name: string) => `cloud://env.x/checkpoints/${openid}/${name}`

let fetchBackup: any
beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
  fetchBackup = (globalThis as any).fetch
})
afterEach(() => {
  ;(globalThis as any).fetch = fetchBackup
  delete process.env.WXKF_CORPID
  delete process.env.WXKF_SECRET
  vi.restoreAllMocks()
})

describe('deleteAccount：公开评价改匿名，评分与内容保留', () => {
  it('大白话：删资料后本人已上墙评价显示「匿名钩友」，星级和正文不变；别人的评价不动', async () => {
    control.seed('reviews', [
      { _id: 'o1__l1', _openid: 'oME', productId: 'p1', name: '小鸭', rating: 5, text: '好看', tags: [], photos: [], createdAt: 2, picked: true },
      { _id: 'o2__l1', _openid: 'oOther', productId: 'p1', name: '别人', rating: 4, text: '还行', tags: [], photos: [], createdAt: 1, picked: true },
    ])
    expect(await call('deleteAccount')).toEqual({ ok: true, deleted: true })
    const r = await call('getReviews', { productId: 'p1' })
    const mine = r.list.find((x: any) => x.text === '好看')
    const other = r.list.find((x: any) => x.text === '还行')
    expect(mine).toMatchObject({ name: '匿名钩友', rating: 5, text: '好看' })
    expect(other.name).toBe('别人')
  })
})

describe('deleteAccount：意见反馈里的联系方式删掉，反馈正文保留', () => {
  it('大白话：本人反馈的 contact 清空、content 留着；别人的联系方式不动', async () => {
    control.seed('feedback', [
      { _id: 'f1', _openid: 'oME', content: '按钮点不了', contact: '13800000000', createdAt: 1 },
      { _id: 'f2', _openid: 'oOther', content: '别人的', contact: 'wx-other', createdAt: 1 },
    ])
    expect(await call('deleteAccount')).toEqual({ ok: true, deleted: true })
    const [mine, other] = control.dump('feedback')
    expect(mine.contact).toBe('')
    expect(mine.content).toBe('按钮点不了')
    expect(other.contact).toBe('wx-other')
  })
})

describe('deleteAccount：节点拍照提交连同云存储文件一起删', () => {
  it('大白话：本人提交档删掉、照片文件删掉；节点定义和别人的提交不动', async () => {
    control.seed('checkpoints', [
      { _id: 'sub:oME:c1:n1', type: 'sub', _openid: 'oME', courseId: 'c1', nodeId: 'n1', fileId: own('oME', 'a.jpg') },
      { _id: 'sub:oME:c1:n2', type: 'sub', _openid: 'oME', courseId: 'c1', nodeId: 'n2', fileId: own('oME', 'b.jpg') },
      { _id: 'sub:oOther:c1:n1', type: 'sub', _openid: 'oOther', courseId: 'c1', nodeId: 'n1', fileId: own('oOther', 'c.jpg') },
      { _id: 'def:c1:n1', type: 'def', courseId: 'c1', nodeId: 'n1', title: '起针' },
    ])
    expect(await call('deleteAccount')).toEqual({ ok: true, deleted: true })
    expect(control.dump('checkpoints').map((d: any) => d._id).sort()).toEqual(['def:c1:n1', 'sub:oOther:c1:n1'])
    expect(control.deletedFiles().sort()).toEqual([own('oME', 'a.jpg'), own('oME', 'b.jpg')])
  })

  it('大白话：提交档里填的是别人的文件（比如商品图）——档删掉，但绝不拿管理权限去删那张图', async () => {
    control.seed('checkpoints', [
      { _id: 'sub:oME:c1:n1', type: 'sub', _openid: 'oME', courseId: 'c1', nodeId: 'n1', fileId: 'cloud://env.x/products/p1.jpg' },
      { _id: 'sub:oME:c1:n2', type: 'sub', _openid: 'oME', courseId: 'c1', nodeId: 'n2', fileId: own('oOther', 'c.jpg') },
    ])
    expect(await call('deleteAccount')).toEqual({ ok: true, deleted: true })
    expect(control.dump('checkpoints')).toEqual([])
    expect(control.deletedFiles()).toEqual([])
  })

  it('大白话：删文件整体失败——回 INTERNAL，提交档留着（重试还能找到文件去删）', async () => {
    control.seed('checkpoints', [
      { _id: 'sub:oME:c1:n1', type: 'sub', _openid: 'oME', courseId: 'c1', nodeId: 'n1', fileId: own('oME', 'a.jpg') },
    ])
    vi.spyOn(cloud as any, 'deleteFile').mockRejectedValue(new Error('MOCK_DELETE_FAIL'))
    expect(await call('deleteAccount')).toEqual({ ok: false, error: 'INTERNAL' })
    expect(control.dump('checkpoints')).toHaveLength(1)
  })

  it('大白话：部分文件删失败——删成功的那条档摘掉、失败的留着，整体回 INTERNAL；重试只补删剩下的', async () => {
    control.seed('checkpoints', [
      { _id: 'sub:oME:c1:n1', type: 'sub', _openid: 'oME', courseId: 'c1', nodeId: 'n1', fileId: own('oME', 'a.jpg') },
      { _id: 'sub:oME:c1:n2', type: 'sub', _openid: 'oME', courseId: 'c1', nodeId: 'n2', fileId: own('oME', 'b.jpg') },
    ])
    const spy = vi.spyOn(cloud as any, 'deleteFile').mockImplementation(async ({ fileList }: any) => ({
      fileList: fileList.map((id: string) => ({ fileID: id, status: id.endsWith('b.jpg') ? -1 : 0 })),
    }))
    expect(await call('deleteAccount')).toEqual({ ok: false, error: 'INTERNAL' })
    expect(control.dump('checkpoints').map((d: any) => d._id)).toEqual(['sub:oME:c1:n2'])
    spy.mockRestore()
    expect(await call('deleteAccount')).toEqual({ ok: true, deleted: true })
    expect(control.dump('checkpoints')).toEqual([])
    expect(control.deletedFiles()).toEqual([own('oME', 'b.jpg')])
  })

  it('大白话：上次文件删掉了但摘档失败——重试时文件已经不存在（逐项回失败码）也算删成功，档摘掉、回 deleted:true', async () => {
    control.seed('checkpoints', [
      { _id: 'sub:oME:c1:n1', type: 'sub', _openid: 'oME', courseId: 'c1', nodeId: 'n1', fileId: own('oME', 'a.jpg') },
    ])
    control.setBeforeRemove(({ coll }: any) => {
      if (coll === 'checkpoints') throw new Error('MOCK_DB_FAIL')
    })
    expect(await call('deleteAccount')).toEqual({ ok: false, error: 'INTERNAL' })
    expect(control.deletedFiles()).toEqual([own('oME', 'a.jpg')])
    expect(control.dump('checkpoints')).toHaveLength(1)

    control.setBeforeRemove(null as never)
    vi.spyOn(cloud as any, 'deleteFile').mockImplementation(async ({ fileList }: any) => ({
      fileList: fileList.map((id: string) => ({ fileID: id, status: -1, errMsg: 'STORAGE_FILE_NONEXIST' })),
    }))
    expect(await call('deleteAccount')).toEqual({ ok: true, deleted: true })
    expect(control.dump('checkpoints')).toEqual([])
  })

  it('大白话：删文件的返回里没提到某个文件——当没删，档留着回 INTERNAL（不能没确认就摘档）', async () => {
    control.seed('checkpoints', [
      { _id: 'sub:oME:c1:n1', type: 'sub', _openid: 'oME', courseId: 'c1', nodeId: 'n1', fileId: own('oME', 'a.jpg') },
      { _id: 'sub:oME:c1:n2', type: 'sub', _openid: 'oME', courseId: 'c1', nodeId: 'n2', fileId: own('oME', 'b.jpg') },
    ])
    const spy = vi.spyOn(cloud as any, 'deleteFile').mockResolvedValueOnce({})
    expect(await call('deleteAccount')).toEqual({ ok: false, error: 'INTERNAL' })
    expect(control.dump('checkpoints')).toHaveLength(2)

    spy.mockResolvedValueOnce({ fileList: [{ fileID: own('oME', 'a.jpg'), status: 0 }] })
    expect(await call('deleteAccount')).toEqual({ ok: false, error: 'INTERNAL' })
    expect(control.dump('checkpoints').map((d: any) => d._id)).toEqual(['sub:oME:c1:n2'])
  })

  it('大白话：连点两次并发——另一次已经把档摘了，本次删到 0 条；回读确认真没了就回 deleted:true', async () => {
    control.seed('checkpoints', [
      { _id: 'sub:oME:c1:n1', type: 'sub', _openid: 'oME', courseId: 'c1', nodeId: 'n1', fileId: own('oME', 'a.jpg') },
    ])
    const db = cloud.database()
    vi.spyOn(cloud as any, 'deleteFile').mockImplementation(async ({ fileList }: any) => {
      await db.collection('checkpoints').where({ _openid: 'oME' }).remove()
      return { fileList: fileList.map((id: string) => ({ fileID: id, status: -1, errMsg: 'storage file not exist' })) }
    })
    expect(await call('deleteAccount')).toEqual({ ok: true, deleted: true })
    expect(control.dump('checkpoints')).toEqual([])
  })

  it('大白话：摘档说删了 0 条、档其实还在——照旧 INTERNAL，不装已删除', async () => {
    control.seed('checkpoints', [
      { _id: 'sub:oME:c1:n1', type: 'sub', _openid: 'oME', courseId: 'c1', nodeId: 'n1', fileId: own('oME', 'a.jpg') },
    ])
    control.setBeforeRemove(({ coll, filter }: any) => {
      if (coll === 'checkpoints') filter._id = '__nothing__' // 让这次 remove 一条没删到
    })
    expect(await call('deleteAccount')).toEqual({ ok: false, error: 'INTERNAL' })
    expect(control.dump('checkpoints')).toHaveLength(1)
  })

  it('大白话：超过一页（>50 条）的提交也全删干净', async () => {
    control.seed(
      'checkpoints',
      Array.from({ length: 120 }, (_, i) => ({
        _id: `sub:oME:c1:n${i}`,
        type: 'sub',
        _openid: 'oME',
        courseId: 'c1',
        nodeId: `n${i}`,
        fileId: own('oME', `${i}.jpg`),
      }))
    )
    expect(await call('deleteAccount')).toEqual({ ok: true, deleted: true })
    expect(control.dump('checkpoints')).toEqual([])
    expect(control.deletedFiles()).toHaveLength(120)
  })
})

describe('deleteAccount：评价/反馈/节点集合还没建过＝本来就没有，不是删失败', () => {
  it('大白话：三个集合都报「集合不存在」仍回 deleted:true；其它读写故障照旧 INTERNAL', async () => {
    const missing = ({ coll }: any) => {
      if (['reviews', 'feedback', 'checkpoints'].includes(coll)) throw new Error('DATABASE_COLLECTION_NOT_EXIST')
    }
    control.setBeforeUpdate(missing)
    control.setBeforeGet(missing)
    control.setBeforeRemove(missing)
    expect(await call('deleteAccount')).toEqual({ ok: true, deleted: true })

    control.reset()
    control.setOpenId('oME')
    control.setBeforeUpdate(({ coll }: any) => {
      if (coll === 'feedback') throw new Error('MOCK_DB_FAIL')
    })
    expect(await call('deleteAccount')).toEqual({ ok: false, error: 'INTERNAL' })
  })

  it('大白话：评价改匿名那步库故障——回 INTERNAL，不报已删除', async () => {
    control.setBeforeUpdate(({ coll }: any) => {
      if (coll === 'reviews') throw new Error('MOCK_DB_FAIL')
    })
    expect(await call('deleteAccount')).toEqual({ ok: false, error: 'INTERNAL' })
  })

  it('大白话：读节点提交档故障——回 INTERNAL，档和照片都还在', async () => {
    control.seed('checkpoints', [
      { _id: 'sub:oME:c1:n1', type: 'sub', _openid: 'oME', courseId: 'c1', nodeId: 'n1', fileId: own('oME', 'a.jpg') },
    ])
    control.setBeforeGet(({ coll }: any) => {
      if (coll === 'checkpoints') throw new Error('MOCK_DB_FAIL')
    })
    expect(await call('deleteAccount')).toEqual({ ok: false, error: 'INTERNAL' })
    expect(control.dump('checkpoints')).toHaveLength(1)
    expect(control.deletedFiles()).toEqual([])
  })
})

describe('submitCheckpointPhoto：重拍换下的旧照片、拒入库的照片当场删，不留没人引用的文件', () => {
  const submit = (nodeId: string, fileId: string) => call('submitCheckpointPhoto', { courseId: 'c1', nodeId, fileId })
  beforeEach(() => control.seed('activations', [{ _id: 'a1', _openid: 'oME', courseId: 'c1', enteredAt: 1 }]))

  it('大白话：同节点重拍后旧照片当场删掉；再删资料删掉新照片——两张都删了；同一张图重传不删自己', async () => {
    expect((await submit('n1', own('oME', 'a.jpg'))).ok).toBe(true)
    expect((await submit('n1', own('oME', 'a.jpg'))).ok).toBe(true)
    expect(control.deletedFiles()).toEqual([])
    expect((await submit('n1', own('oME', 'b.jpg'))).ok).toBe(true)
    expect(control.deletedFiles()).toEqual([own('oME', 'a.jpg')])
    expect(await call('deleteAccount')).toEqual({ ok: true, deleted: true })
    expect(control.deletedFiles().sort()).toEqual([own('oME', 'a.jpg'), own('oME', 'b.jpg')])
  })

  it('大白话：内容安全拒掉（违规 / 校不了）的照片当场删，不入库', async () => {
    control.setOpenapiFail(true, 87014)
    expect((await submit('n1', own('oME', 'x.jpg'))).error).toBe('IMG_RISKY')
    control.setOpenapiFail(true)
    expect((await submit('n2', own('oME', 'y.jpg'))).error).toBe('SEC_CHECK_FAIL')
    expect(control.deletedFiles()).toEqual([own('oME', 'x.jpg'), own('oME', 'y.jpg')])
    expect(control.dump('checkpoints')).toEqual([])
  })

  it('大白话：旧照片删失败——新提交照样成功，但留一条告警（不静默吞）', async () => {
    expect((await submit('n1', own('oME', 'a.jpg'))).ok).toBe(true)
    vi.spyOn(cloud as any, 'deleteFile').mockRejectedValue(new Error('MOCK_DELETE_FAIL'))
    expect((await submit('n1', own('oME', 'b.jpg'))).ok).toBe(true)
    expect(control.dump('checkpoints')[0].fileId).toBe(own('oME', 'b.jpg'))
    expect(control.dump('anomalies').some((a: any) => a.code === 'CHECKPOINT_ORPHAN_FILE')).toBe(true)
  })
})

describe('submitCheckpointPhoto：只收本人目录下的照片', () => {
  it('大白话：fileId 不在 checkpoints/<本人openid>/ 下一律拒、不入库——否则删资料时会拿管理权限删到别人的图', async () => {
    control.seed('activations', [{ _id: 'a1', _openid: 'oME', courseId: 'c1', enteredAt: 1 }])
    const submit = (fileId: string) => call('submitCheckpointPhoto', { courseId: 'c1', nodeId: 'n1', fileId })
    expect((await submit('cloud://env.x/products/p1.jpg')).error).toBe('BAD_ARGS:FILE_NOT_OWNED')
    expect((await submit(own('oOther', 'x.jpg'))).error).toBe('BAD_ARGS:FILE_NOT_OWNED')
    expect((await submit('cloud://env.x/checkpoints/oME/sub/x.jpg')).error).toBe('BAD_ARGS:FILE_NOT_OWNED')
    expect(control.dump('checkpoints')).toEqual([])
    expect((await submit(own('oME', 'x.jpg'))).ok).toBe(true)
    expect(control.dump('checkpoints')[0].fileId).toBe(own('oME', 'x.jpg'))
  })
})

describe('kfBind：unionid 只认服务端上下文', () => {
  const stubKf = (extByUnion: Record<string, string>) => {
    process.env.WXKF_CORPID = 'c'
    process.env.WXKF_SECRET = 's'
    const seen: any[] = []
    ;(globalThis as any).fetch = async (url: string, init?: any) => ({
      json: async () => {
        const body = init?.body ? JSON.parse(init.body) : {}
        if (String(url).includes('gettoken')) return { access_token: 'T', expires_in: 7200 }
        if (String(url).includes('idconvert')) {
          seen.push(body)
          return { external_userid: extByUnion[body.unionid] || '' }
        }
        return {}
      },
    })
    return seen
  }

  it('大白话：前端伪造别人的 unionid——不改写别人的 ext→openid 映射，外呼只带本人上下文里的 unionid', async () => {
    control.seed('kfIdentity', [{ _id: 'ext:eu-victim', openid: 'oVictim', unionid: 'uVictim' }])
    const seen = stubKf({ uVictim: 'eu-victim', uMe: 'eu-me' })
    control.setUnionId('uMe')
    const r = await call('kfBind', { unionid: 'uVictim' })
    expect(r).toEqual({ ok: true, bound: true })
    expect(seen.map((b) => b.unionid)).toEqual(['uMe'])
    const byId = Object.fromEntries(control.dump('kfIdentity').map((d: any) => [d._id, d]))
    expect(byId['ext:eu-victim'].openid).toBe('oVictim')
    expect(byId['ext:eu-me']).toMatchObject({ openid: 'oME', unionid: 'uMe' })
  })

  it('大白话：上下文拿不到 unionid 就拒（NO_UNIONID），前端传什么都不用、不写映射', async () => {
    control.seed('kfIdentity', [{ _id: 'ext:eu-victim', openid: 'oVictim', unionid: 'uVictim' }])
    const seen = stubKf({ uVictim: 'eu-victim' })
    expect(await call('kfBind', { unionid: 'uVictim' })).toEqual({ ok: false, error: 'NO_UNIONID' })
    expect(seen).toEqual([])
    expect(control.dump('kfIdentity')).toEqual([{ _id: 'ext:eu-victim', openid: 'oVictim', unionid: 'uVictim' }])
  })
})
