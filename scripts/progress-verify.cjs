// 进度上云 E2E（一次性验证，照 p3-verify 样板）：trackEvent 写 → getMyProgress 读
const automator = require('miniprogram-automator')

const t = (p, ms, tag) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(tag + ' 超时')), ms))])

async function callFn(mp, name, data) {
  await mp.evaluate(
    (name, data) => {
      globalThis.__pv = null
      wx.cloud
        .callFunction({ name, data })
        .then((r) => (globalThis.__pv = { done: true, result: r.result }))
        .catch((e) => (globalThis.__pv = { done: true, error: String(e) }))
    },
    name,
    data,
  )
  for (let i = 0; i < 40; i++) {
    const r = await mp.evaluate(() => globalThis.__pv)
    if (r && r.done) {
      if (r.error) throw new Error(`${name} 调用失败：${r.error}`)
      return r.result
    }
    await new Promise((s) => setTimeout(s, 250))
  }
  throw new Error(name + ' 轮询超时')
}

;(async () => {
  const mp = await t(automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' }), 8000, 'connect')
  await t(mp.systemInfo(), 8000, 'RPC探活')

  // 1) 段看完事件
  const r1 = await callFn(mp, 'trackEvent', {
    type: 'segment_done', page: 'player', targetId: 'l1-s1',
    meta: { courseId: 'course-duck', lessonId: 'l1', at: 40, dur: 200 },
  })
  console.log('trackEvent segment_done:', JSON.stringify(r1))

  // 2) 离开位置事件
  const r2 = await callFn(mp, 'trackEvent', {
    type: 'watch_at', page: 'player', targetId: 'l1-s2',
    meta: { courseId: 'course-duck', lessonId: 'l1', at: 55, dur: 200 },
  })
  console.log('trackEvent watch_at:', JSON.stringify(r2))

  // 3) 读回折叠后的进度
  const r3 = await callFn(mp, 'getMyProgress', {})
  const doc = (r3.list || []).find((d) => d.courseId === 'course-duck')
  console.log('progress doc:', JSON.stringify(doc))
  const pass = doc && doc.done && doc.done['l1-s1'] === true && doc.last && doc.last.segmentId === 'l1-s2' && doc.last.at === 55
  console.log(pass ? 'E2E PASS：写入折叠与读回全部正确' : 'E2E FAIL：折叠结果与预期不符')
  await mp.disconnect()
  process.exit(pass ? 0 : 1)
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
