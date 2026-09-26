// @vitest-environment happy-dom
// External.vue 挂载测试：腾讯云三张卡带本环境 envId 深链并标「预选本环境」；没配后端地址时退回通用链；
// 全部新窗口打开且不把本页句柄交给外站。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'

// envId 在模块顶层从 VITE_ADMIN_API 取一次，所以每种环境都要重新加载页面模块
async function mountWith(api: string) {
  vi.stubEnv('VITE_ADMIN_API', api)
  vi.resetModules()
  const { default: External } = await import('../src/pages/External.vue')
  return mount(External)
}
const hrefs = (w: Awaited<ReturnType<typeof mountWith>>) => w.findAll('a.ext-card-link').map((a) => a.attributes('href'))

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('External.vue 外部后台直达', () => {
  it('大白话：配了后端地址——云开发三张卡带 envId 预选本环境，其余官方后台链原样', async () => {
    const w = await mountWith('https://cloudbase-abc123-1234567890.ap-shanghai.app.tcloudbase.com/admin')
    expect(hrefs(w)).toEqual([
      'https://tcb.cloud.tencent.com/dev?envId=cloudbase-abc123',
      'https://console.cloud.tencent.com/tcb?envId=cloudbase-abc123',
      'https://console.cloud.tencent.com/tcb/monitor?envId=cloudbase-abc123',
      'https://mp.weixin.qq.com/',
      'https://pay.weixin.qq.com/',
      'https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html',
      'https://work.weixin.qq.com/',
    ])
    expect(w.findAll('a.ext-card-link').filter((a) => a.text().includes('预选本环境'))).toHaveLength(3)
  })

  it('大白话：本地没配后端地址——退回通用链、不挂「预选本环境」，链接照样能点', async () => {
    const w = await mountWith('')
    expect(hrefs(w).slice(0, 3)).toEqual([
      'https://tcb.cloud.tencent.com/dev',
      'https://console.cloud.tencent.com/tcb',
      'https://console.cloud.tencent.com/tcb/monitor',
    ])
    expect(w.text()).not.toContain('预选本环境')
  })

  it('大白话：每张卡都在新窗口打开，并带 noopener 防外站反控本页', async () => {
    const w = await mountWith('')
    for (const a of w.findAll('a.ext-card-link')) {
      expect(a.attributes('target')).toBe('_blank')
      expect(a.attributes('rel')).toContain('noopener')
    }
  })
})
