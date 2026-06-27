import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'

// adminApi 杂项闸门（审核批次B）：分片 seq 连续性、批次 count 校验、看板交易异常。
const KEY = 'test-admin-key-123'
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')

async function call(action, data = {}) {
  const res = await main({ httpMethod: 'POST', body: JSON.stringify({ action, key: KEY, data }) })
  return { status: res.statusCode, ...JSON.parse(res.body) }
}

beforeEach(() => {
  control.reset()
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY) }])
})

describe('adminApi 杂项闸门', () => {
  it('uploadFinish：seq 不连续（0,2 共 2 片）不再拼出损坏文件', async () => {
    control.seed('uploadChunks', [
      { uploadId: 'u1', seq: 0, b64: 'aGk=', createdAt: Date.now() },
      { uploadId: 'u1', seq: 2, b64: 'aGk=', createdAt: Date.now() },
    ])
    const res = await call('uploadFinish', { uploadId: 'u1', total: 2, ext: 'jpg', pid: 'p1' })
    expect(res.error).toBe('CHUNKS_MISSING')
  })

  it('uploadFinish：seq 正好 0..total-1 才放行拼接', async () => {
    control.seed('uploadChunks', [
      { uploadId: 'u2', seq: 0, b64: 'aGk=', createdAt: Date.now() },
      { uploadId: 'u2', seq: 1, b64: 'aGk=', createdAt: Date.now() },
    ])
    const res = await call('uploadFinish', { uploadId: 'u2', total: 2, ext: 'jpg', pid: 'p1' })
    expect(res.ok).toBe(true)
  })

  it('上架价格硬边界：负价拒（NEED_INFO）、超大 SKU 价拒（NEED_SKUS）（外部体检 P1）', async () => {
    control.seed('productsDraft', [
      { _id: 'pneg', id: 'pneg', name: '测试', cover: 'cloud://c', price: -5, skus: [{ name: 'a', price: 10 }] },
    ])
    expect((await call('publishProduct', { id: 'pneg' })).error).toBe('NEED_INFO')
    control.seed('productsDraft', [
      { _id: 'pbig', id: 'pbig', name: '测试', cover: 'cloud://c', price: 198, skus: [{ name: 'a', price: 200000 }] },
    ])
    expect((await call('publishProduct', { id: 'pbig' })).error).toBe('NEED_SKUS')
  })

  it('删除商品：草稿 + 已上架一并删，删除诚实（外部体检 P2）', async () => {
    control.seed('productsDraft', [{ _id: 'pd', id: 'pd', name: 'X', status: 'onsale' }])
    control.seed('products', [{ _id: 'pd', id: 'pd', name: 'X', price: 10 }])
    expect((await call('deleteDraft', { id: 'pd' })).ok).toBe(true)
    expect(control.dump('productsDraft').find((x) => x._id === 'pd')).toBeUndefined()
    expect(control.dump('products').find((x) => x._id === 'pd')).toBeUndefined()
  })

  it('createBatch：count 漏传/非法一律 BAD_ARGS（不再静默生成 1 个码）', async () => {
    expect((await call('createBatch', { courseId: 'course-duck' })).error).toBe('BAD_ARGS')
    expect((await call('createBatch', { courseId: 'course-duck', count: 'x' })).error).toBe('BAD_ARGS')
  })

  it('getDashboard：交易异常三类（feeMismatch / refundMismatch / 退款卡单超 1h）', async () => {
    control.seed('orders', [
      { _id: 'o1', id: 'o1', status: 'paid', amount: 2, feeMismatch: true, createdAt: Date.now(), items: [] },
      { _id: 'o2', id: 'o2', status: 'paid', amount: 178, createdAt: Date.now(), items: [] },
    ])
    control.seed('afterSales', [
      { _id: 'a1', orderId: 'o2', status: 'approved', approvedAt: Date.now() - 2 * 3600_000, refundAmount: 1 },
      { _id: 'a2', orderId: 'o2', status: 'applied', refundMismatch: true, refundAmount: 2 },
      { _id: 'a3', orderId: 'o2', status: 'approved', approvedAt: Date.now(), refundAmount: 3 }, // 刚触发，不算卡单
    ])
    const res = await call('getDashboard')
    expect(res.ok).toBe(true)
    expect(res.txAlerts.feeMismatch).toEqual(['o1'])
    expect(res.txAlerts.refundMismatch).toEqual(['a2'])
    expect(res.txAlerts.stuckRefunds).toEqual(['a1'])
  })
})

// 根因#8「验证样本失真」：原项目最小样本（1×1 测试图）过、真实 200KB 照片必拒——
// 验收方法论要求 E2E 用真实尺寸样本。下面用真实 200KB 图走完整分片链路，断言重组无截断。
describe('真实尺寸分片上传（根因#8 验收方法论：真实样本而非玩具）', () => {
  // fixture：200KB 伪随机字节（非全零、可压不缩水），base64 后必然跨 90,000/片上限＝多片
  function realImageB64(bytes) {
    const buf = Buffer.alloc(bytes)
    for (let i = 0; i < bytes; i++) buf[i] = (i * 37 + 11) & 0xff
    return buf.toString('base64')
  }
  function splitChunks(b64, size = 90_000) {
    const out = []
    for (let i = 0; i < b64.length; i += size) out.push(b64.slice(i, i + size))
    return out
  }

  it('真实 200KB 图：多片上传 → 重组字节完整（云存储收到 === 原图大小）', async () => {
    const BYTES = 200 * 1024
    const chunks = splitChunks(realImageB64(BYTES))
    expect(chunks.length).toBeGreaterThan(1) // 确属多片真实尺寸，非 1×1 玩具
    for (let seq = 0; seq < chunks.length; seq++) {
      expect((await call('uploadChunk', { uploadId: 'big', seq, b64: chunks[seq] })).ok).toBe(true)
    }
    const fin = await call('uploadFinish', { uploadId: 'big', total: chunks.length, ext: 'jpg', pid: 'pbig' })
    expect(fin.ok).toBe(true)
    // 关键：分片→重组→base64 解码全程无截断，落库字节数等于原图 200KB
    expect(control.lastUpload().bytes).toBe(BYTES)
  })

  it('uploadChunk 尺寸边界：90,000 放行、90,001 拒 BAD_CHUNK（边界即验，非只验逻辑）', async () => {
    expect((await call('uploadChunk', { uploadId: 'b1', seq: 0, b64: 'a'.repeat(90_000) })).ok).toBe(true)
    expect((await call('uploadChunk', { uploadId: 'b2', seq: 0, b64: 'a'.repeat(90_001) })).error).toBe(
      'BAD_CHUNK',
    )
  })

  // P2：回落分片容量须覆盖 admin 体积闸（uploadVideo 放行 ≤15MB）。原 uploadFinish 上限 total>200
  // ≈12MB 二进制 < 15MB 闸 → 12~15MB 视频走回落通道必 BAD_FINISH（直传不受影响·边界 bug）。
  // 体积闸 15MB / CHUNK 80KB(b64) → ~263 片；uploadFinish 上限须 ≥ 此片数。
  it('视频回落分片：~15MB 视频（263 片）能重组上线——回落容量须覆盖体积闸 15MB（P2 修）', async () => {
    const N = Math.ceil(((15 * 1024 * 1024 * 4) / 3 / 80_000)) // 15MB 二进制 → b64 → 80KB/片 ≈ 263
    control.seed(
      'uploadChunks',
      Array.from({ length: N }, (_, seq) => ({ uploadId: 'vid', seq, b64: 'AA==', createdAt: Date.now() })),
    )
    const fin = await call('uploadFinish', { uploadId: 'vid', total: N, ext: 'mp4', pid: 'help', kind: 'video' })
    expect(fin.ok).toBe(true)
  })

  it('uploadFinish 片数仍有上限：超上限（301 片）拒 BAD_FINISH（防无界回落）', async () => {
    const res = await call('uploadFinish', { uploadId: 'over', total: 301, ext: 'mp4', pid: 'help', kind: 'video' })
    expect(res.error).toBe('BAD_FINISH')
  })
})

// 根因#8（桩≠真 SDK 藏过的坑）：真 wx-server-sdk doc(id).set({data}) 的 data 含 _id 即 reject。saveSettings
// 把 get 回来的 doc（含 _id）`{...cur}` 原样写回——首存（doc 不存在·cur 空无 _id）过、二次存（doc 已存在·
// get 带回 _id）真机 500（用户配企微告警 webhook 实测踩中）。桩已对齐「set data 含 _id 即抛」，本测试锁往返。
describe('saveSettings 二次保存不 500（根因#8：get 回来的 _id 不能带回 set·隐式 {...cur} 版）', () => {
  const WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-123'
  it('首存 urlPrefix → 再存 webhook：二次保存仍 200/ok，且首存字段被合并保留', async () => {
    expect((await call('saveSettings', { urlPrefix: 'https://x.cn/q/' })).ok).toBe(true)
    // 二次保存：settings doc 已存在，get().data 带 _id——不剥则 set 抛 → fallback add 撞键 → 500（本测试逮此）
    const r2 = await call('saveSettings', { alertWebhook: WEBHOOK, alertEvents: { UNKNOWN_ORDER: true } })
    expect(r2.status).toBe(200)
    expect(r2.ok).toBe(true)
    const got = await call('getSettings')
    expect(got.settings.alertWebhook).toBe(WEBHOOK)
    expect(got.settings.urlPrefix).toBe('https://x.cn/q/') // 合并保存（非整存覆盖）·首存不被抹
  })

  it('非法 webhook 仍拒 BAD_WEBHOOK（格式闸不被本修破坏）', async () => {
    expect((await call('saveSettings', { alertWebhook: 'http://evil.example/x' })).error).toBe('BAD_WEBHOOK')
  })
})
