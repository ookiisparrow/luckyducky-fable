// 课程链路加固批（课程链路审计 2026-07-17）：本批修复的行为不变量集中钉死。
// 覆盖：① activateCourse 真并发同用户双扫不误报 CODE_TAKEN（transition 旧快照病根）；
//      ② saveCourseDraft 乐观并发（rev 不符拒覆盖·不带 baseRev 向后兼容）；
//      ③ cleanupEvents 缓期孤儿视频到期真删/未到期保留 + 弃传分片 TTL；
//      ④ recallScan 定向查询（激活破窗不丢长尾未进课；progress 抽样不全不误报活跃学员）；
//      ⑤ app 网关顶层兜底（未捕获异常落 anomalies 账本·回 INTERNAL 不裸抛）；
//      ⑥ trackEvent video_error 桥接 anomalies（播放失败率服务端可见）。
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'
import { main as adminApi } from '../src/functions/adminApi/index'
import { main as cleanupEvents } from '../src/functions/timers/cleanupEvents'
import { main as recallScan } from '../src/functions/timers/recallScan'
import { sha } from '../src/functions/adminApi/lib'
import { getDb } from '../src/kit'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
})
afterEach(() => {
  control.setBeforeUpdate(null as never)
})

describe('activateCourse 真并发同用户双扫（transition 旧快照·根因#1）', () => {
  it('大白话：网络抖动重发/双击造成同一人同一码两个请求赛跑——输掉抢占的那个也必须认出「抢到的是我自己」，不许误报“码已被别人用了”', async () => {
    control.seed('qrcodes', [{ _id: 'CODE1', status: 'unused', courseId: 'c1', activatedBy: null }])
    // 注入并发：第一个请求的条件更新即将执行时，模拟「并发的同用户请求」已抢先翻码（经真 db.update 写库·
    // injected 标记防递归）——本请求 moved=false 且 transition 返回的旧快照仍是 unused（activatedBy null），
    // 复现真并发时序。注意 dump() 返回克隆、直接改 dump 结果碰不到真库。
    let injected = false
    control.setBeforeUpdate(async ({ coll }: any) => {
      if (coll === 'qrcodes' && !injected) {
        injected = true
        await getDb().collection('qrcodes').doc('CODE1').update({ data: { status: 'activated', activatedBy: 'oME', activatedAt: 1 } })
      }
    })
    const r = await call('activateCourse', { code: 'CODE1' })
    expect(r.error).not.toBe('CODE_TAKEN') // 旧实现按更新前快照判归属→误报；须读回现值认出本人
    expect(r.ok).toBe(true)
    expect(control.dump('activations')).toHaveLength(1) // 幂等自愈建激活记录
  })

  it('大白话：真被别人抢走仍要如实拒（读回现值不放水）', async () => {
    control.seed('qrcodes', [{ _id: 'CODE1', status: 'unused', courseId: 'c1', activatedBy: null }])
    let injected = false
    control.setBeforeUpdate(async ({ coll }: any) => {
      if (coll === 'qrcodes' && !injected) {
        injected = true
        await getDb().collection('qrcodes').doc('CODE1').update({ data: { status: 'activated', activatedBy: 'oOTHER', activatedAt: 1 } })
      }
    })
    const r = await call('activateCourse', { code: 'CODE1' })
    expect(r.error).toBe('CODE_TAKEN')
    expect(r.courseId).toBe('c1')
  })
})

describe('saveCourseDraft 乐观并发（双页签互吃·根因#1）', () => {
  const draft = (title: string) => ({ id: 'c1', title, sort: 0, chapters: [] })

  it('大白话：带过期版本号来保存＝别处已经改过——拒绝覆盖并回 DRAFT_CONFLICT；版本对得上才落库且版本+1', async () => {
    expect((await post('saveCourseDraft', { course: draft('v1'), baseRev: 0 })).ok).toBe(true) // 首存 rev 0→1
    const ok2 = await post('saveCourseDraft', { course: draft('v2'), baseRev: 1 })
    expect(ok2.ok).toBe(true)
    expect(ok2.rev).toBe(2)
    // 另一页签还拿着 rev 1 的旧基线来存——拒，且库内仍是 v2
    const conflict = await post('saveCourseDraft', { course: draft('旧页签的过期编辑'), baseRev: 1 })
    expect(conflict.ok).toBe(false)
    expect(conflict.error).toBe('DRAFT_CONFLICT')
    expect(conflict.rev).toBe(2) // 带回现值供前端提示
    expect(control.dump('coursesDraft')[0].title).toBe('v2') // 未被旧快照覆盖
  })

  it('大白话：不带 baseRev 的旧调用按原语义覆盖（部署窗口内前后端版本错开不卡死保存）', async () => {
    await post('saveCourseDraft', { course: draft('v1'), baseRev: 0 })
    const r = await post('saveCourseDraft', { course: draft('无版本旧调用') })
    expect(r.ok).toBe(true)
    expect(control.dump('coursesDraft')[0].title).toBe('无版本旧调用')
  })
})

describe('cleanupEvents：缓期孤儿视频 + 弃传分片（根因#7/#1）', () => {
  it('大白话：到期的孤儿视频真删并出队、没到期的原地保留下轮再看；弃传超 24h 的分片清掉、新分片不动', async () => {
    control.setOpenId('')
    const now = Date.now()
    control.seed('courses', [
      {
        _id: 'c1',
        id: 'c1',
        title: '课',
        chapters: [],
        pendingGc: [
          { fileId: 'cloud://v/due.mp4', deleteAfter: now - 1000 }, // 已到期
          { fileId: 'cloud://v/not-yet.mp4', deleteAfter: now + 86400_000 }, // 未到期
        ],
      },
    ])
    control.seed('uploadChunks', [
      { _id: 'u1-0', uploadId: 'u1', seq: 0, b64: 'AA', createdAt: now - 25 * 3600_000 }, // 弃传超 24h
      { _id: 'u2-0', uploadId: 'u2', seq: 0, b64: 'BB', createdAt: now - 60_000 }, // 进行中
    ])
    const r: any = await cleanupEvents()
    expect(r.videoGc).toBe(1)
    expect(control.deletedFiles()).toContain('cloud://v/due.mp4')
    expect(control.deletedFiles()).not.toContain('cloud://v/not-yet.mp4')
    const left = control.dump('courses')[0].pendingGc
    expect(left).toHaveLength(1)
    expect(left[0].fileId).toBe('cloud://v/not-yet.mp4')
    const chunks = control.dump('uploadChunks')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]._id).toBe('u2-0')
  })
})

describe('recallScan 定向查询（规模破窗不丢长尾/不误报·根因#7）', () => {
  it('大白话：激活总量破 500 后，最老的「拿码没进课」客户依然进召回名单（不再被最近 500 滑窗挤出）', async () => {
    control.setOpenId('')
    const now = Date.now()
    const acts: any[] = [{ _id: 'a-old', _openid: 'oLONGTAIL', courseId: 'c1', enteredAt: null, createdAt: now - 500 * 86400_000 }]
    for (let i = 0; i < 501; i++) {
      acts.push({ _id: 'a' + i, _openid: 'o' + i, courseId: 'c1', enteredAt: now - i * 1000, createdAt: now - i * 1000 })
    }
    control.seed('activations', acts)
    // 501 个已进课者都有进度（不该被召回）——他们的 progress 定向可查
    control.seed(
      'progress',
      Array.from({ length: 501 }, (_, i) => ({ _id: 'p' + i, _openid: 'o' + i, courseId: 'c1', done: {} }))
    )
    const r: any = await recallScan()
    expect(r.unstarted).toBe(1) // 老未进课客户被找到（旧实现 createdAt 倒序滑窗下＝0，永久失联）
    expect(r.unfinished).toBe(0) // 有进度的活跃学员零误报（旧实现全局无序抽 500 会漏抽误报）
  })
})

describe('app 网关顶层兜底（未捕获异常可观测·根因#14）', () => {
  it('大白话：action 内没接住的数据库异常不再裸冒——调用方拿到 INTERNAL 错误码，anomalies 账本落 APP_ACTION_UNCAUGHT', async () => {
    control.seed('activations', [{ _id: 'act1', _openid: 'oME', courseId: 'c1', code: 'K1', enteredAt: 123 }])
    control.seed('progress', [{ _id: 'oME__c1', _openid: 'oME', courseId: 'c1', done: {} }])
    control.setBeforeUpdate(({ coll }: any) => {
      if (coll === 'progress') throw new Error('MOCK_DB_DOWN')
    })
    const r = await call('trackEvent', { type: 'watch_at', page: 'player', targetId: 's1', meta: { courseId: 'c1', at: 10, dur: 60 } })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('INTERNAL') // 不裸抛（wx.cloud fail 回调对开发者是黑箱）
    const anomalies = control.dump('anomalies')
    expect(anomalies.some((a: any) => a.code === 'APP_ACTION_UNCAUGHT')).toBe(true) // 账本留痕
  })
})

describe('trackEvent video_error 桥接（播放失败率可见·根因#14）', () => {
  it('大白话：播放器报一次 video_error，anomalies 账本按 课程:段 聚合出一条 MP_VIDEO_ERROR', async () => {
    const r = await call('trackEvent', { type: 'video_error', page: 'player', targetId: 's1', meta: { courseId: 'c1', phase: 'stall' } })
    expect(r.ok).toBe(true)
    const a = control.dump('anomalies').find((x: any) => x.code === 'MP_VIDEO_ERROR')
    expect(a).toBeTruthy()
    expect(a.ctx.segmentId).toBe('s1')
    expect(a.ctx.phase).toBe('stall')
    // 同段再报只累加 count 不新开条目（指纹去重）
    await call('trackEvent', { type: 'video_error', page: 'player', targetId: 's1', meta: { courseId: 'c1', phase: 'media' } })
    expect(control.dump('anomalies').filter((x: any) => x.code === 'MP_VIDEO_ERROR')).toHaveLength(1)
  })
})

// ─── VOD 转码管线批2（决策§31）：上传签名 / 转码同步 / 发布闸 / GC 分流 ───
describe('VOD 上传签名 + 转码同步 + 发布闸 + GC 分流（转码管线·决策§31 批2）', () => {
  const VOD_DRAFT = {
    _id: 'c1',
    id: 'c1',
    title: 'VOD 课',
    sort: 1,
    rev: 3,
    chapters: [
      {
        id: 'ch1',
        title: '章',
        lessons: [
          {
            id: 'l1',
            name: '课时',
            dur: '',
            segments: [
              { id: 's1', name: '已转段', dur: '', videoFileId: '5285890784246869296' },
              { id: 's2', name: '转码中段', dur: '', videoFileId: '5285890784246869297' },
              { id: 's3', name: '老线段', dur: '1:00', videoFileId: 'cloud://v/s3.mp4' },
            ],
          },
        ],
      },
    ],
  }
  const seedVodConfig = () =>
    control.seed('secureConfig', [{ _id: 'vod', secretId: 'AKIDtest', secretKey: 'sk-test-secret', playKey: 'pk', procedure: 'LuckyDuckyVod' }])
  // fetch 桩（同企微免登 withFetch 口径·多带 init 供断言 X-TC-Action/请求体）
  const withFetch = async (impl: (url: string, init?: any) => any, fn: () => Promise<void>) => {
    const saved = globalThis.fetch
    ;(globalThis as any).fetch = async (url: any, init?: any) => ({ json: async () => impl(String(url), init) })
    try {
      await fn()
    } finally {
      globalThis.fetch = saved
    }
  }

  it('大白话：VOD 未配置——签名端点回 VOD_NOT_CONFIGURED（admin 借此回退云存储直传老路，上传不断档）', async () => {
    const r = await post('getVodUploadSignature')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('VOD_NOT_CONFIGURED')
  })

  it('大白话：已配置——签发 UGC 上传签名：参数串含 secretId/procedure、HMAC-SHA1 可复算、绝不泄 secretKey', async () => {
    seedVodConfig()
    const r = await post('getVodUploadSignature')
    expect(r.ok).toBe(true)
    const raw = Buffer.from(String(r.signature), 'base64')
    const mac = raw.subarray(0, 20)
    const orig = raw.subarray(20).toString()
    expect(orig).toContain('secretId=AKIDtest')
    expect(orig).toContain('procedure=LuckyDuckyVod')
    expect(orig.includes('sk-test-secret')).toBe(false) // 零回显：密钥绝不进签名明文
    const { createHmac } = await import('node:crypto')
    expect(mac.equals(createHmac('sha1', 'sk-test-secret').update(orig).digest())).toBe(true) // 官方 UGC 算法可复算
  })

  it('大白话：同步转码状态——就绪段回写 vodUrl/封面/雪碧图/时长、未就绪只计数、rev 递增防旧稿覆盖', async () => {
    seedVodConfig()
    control.seed('coursesDraft', [VOD_DRAFT])
    const actions: string[] = []
    await withFetch((_url, init) => {
      actions.push(String(init?.headers?.['X-TC-Action']))
      return {
        Response: {
          MediaInfoSet: [
            {
              FileId: '5285890784246869296',
              BasicInfo: { CoverUrl: 'https://vod.example.com/cover/1.jpg' },
              MetaData: { Duration: 95.5 },
              TranscodeInfo: {
                TranscodeSet: [
                  { Definition: 0, Url: 'https://vod.example.com/125/orig.mp4' },
                  { Definition: 100240, Url: 'https://vod.example.com/125/f100240.mp4' },
                ],
              },
              ImageSpriteInfo: { ImageSpriteSet: [{ WebVttUrl: 'https://vod.example.com/125/sprite.vtt' }] },
            },
            { FileId: '5285890784246869297', TranscodeInfo: { TranscodeSet: [] } },
          ],
        },
      }
    }, async () => {
      const r = await post('syncVodMedia', { courseId: 'c1' })
      expect(r.ok).toBe(true)
      expect(r.ready).toBe(1)
      expect(r.processing).toBe(1)
      expect(r.rev).toBe(4)
    })
    expect(actions).toEqual(['DescribeMediaInfos'])
    const segs = control.dump('coursesDraft')[0].chapters[0].lessons[0].segments
    expect(segs[0].vodUrl).toBe('https://vod.example.com/125/f100240.mp4') // 挑非源画质（Definition≠0）转码产物
    expect(segs[0].vodPoster).toBe('https://vod.example.com/cover/1.jpg')
    expect(segs[0].vodSpriteVtt).toBe('https://vod.example.com/125/sprite.vtt')
    expect(segs[0].dur).toBe('1:36') // 95.5s → 1:36（转码元数据回填空时长·手填不覆盖）
    expect(segs[1].vodUrl).toBeFalsy()
    expect(control.dump('coursesDraft')[0].rev).toBe(4)
  })

  it('大白话：发布闸——还有段转码未就绪就拒发布（VOD_PROCESSING+计数），「传完 ≠ 可播」不放伪成功', async () => {
    control.seed('coursesDraft', [VOD_DRAFT])
    const r = await post('publishCourse', { courseId: 'c1' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('VOD_PROCESSING')
    expect(r.pending).toBe(2)
    expect(control.dump('courses')).toHaveLength(0) // 未发布——学员端零影响
  })

  it('大白话：全部就绪后发布放行——vodUrl 随发布进正式课程文档，cloud:// 老段不受影响', async () => {
    const ready = JSON.parse(JSON.stringify(VOD_DRAFT))
    for (const sg of ready.chapters[0].lessons[0].segments)
      if (/^\d{8,}$/.test(sg.videoFileId)) sg.vodUrl = 'https://vod.example.com/x/f0.mp4'
    control.seed('coursesDraft', [ready])
    const r = await post('publishCourse', { courseId: 'c1' })
    expect(r.ok).toBe(true)
    const pub = control.dump('courses')[0]
    expect(pub.chapters[0].lessons[0].segments[0].vodUrl).toBe('https://vod.example.com/x/f0.mp4')
    expect(pub.chapters[0].lessons[0].segments[2].videoFileId).toBe('cloud://v/s3.mp4')
  })

  it('大白话：GC 分流——到期孤儿 cloud:// 走 deleteFile、VOD FileId 走 DeleteMedia；删失败留队下轮重试', async () => {
    control.setOpenId('')
    seedVodConfig()
    const past = Date.now() - 1000
    control.seed('courses', [
      {
        _id: 'c1',
        id: 'c1',
        chapters: [],
        pendingGc: [
          { fileId: 'cloud://v/old.mp4', deleteAfter: past },
          { fileId: '52858907842468611', deleteAfter: past },
          { fileId: '52858907842468612', deleteAfter: past },
          { fileId: '52858907842468613', deleteAfter: Date.now() + 3600_000 },
        ],
      },
    ])
    const deleted: string[] = []
    await withFetch((_url, init) => {
      expect(String(init?.headers?.['X-TC-Action'])).toBe('DeleteMedia')
      const fid = String(JSON.parse(String(init?.body || '{}')).FileId)
      if (fid === '52858907842468612') return { Response: { Error: { Code: 'InternalError', Message: 'mock' } } }
      deleted.push(fid)
      return { Response: { RequestId: 'mock' } }
    }, async () => {
      const r: any = await cleanupEvents()
      expect(r.videoGc).toBe(2) // cloud://old + vod 611；612 失败留队、613 未到期
    })
    expect(deleted).toEqual(['52858907842468611'])
    expect((control as any).deletedFiles()).toContain('cloud://v/old.mp4')
    const q = control.dump('courses')[0].pendingGc.map((en: any) => String(en.fileId))
    expect(q).toEqual(['52858907842468612', '52858907842468613'])
  })
})
