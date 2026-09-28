import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deriveTierCharsets } from '../../scripts/lib/brand-font-charset.mjs'

// 品牌字体挑字口径（v5·老板 2026-09-28 拍板）：圆体只留给按钮/标题/界面固定文案，正文长段和用户内容走黑体。
// 所以字库只收「真用圆体显示」的字——黑体(.t-sys)/等宽(.mono) 子树、输入框、系统弹窗提示、20 字以上长段、
// 云端报错文案都不收；GB2312 兜底层删除（只剩两层）。用迷你小程序样本钉口径。
let tiers
beforeAll(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-font-'))
  const w = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), text)
  }
  w('rewrite/mp/app.json', JSON.stringify({ pages: ['pages/home/home', 'pages/doc/doc'], tabBar: { list: [{ pagePath: 'pages/home/home', text: '首页' }] } }))
  w('rewrite/mp/app.ts', '')
  w(
    'rewrite/mp/pages/home/home.wxml',
    `<view class="k">购买</view>
<text class="t-sys hm-sub">正文段落</text>
<view class="t-sys"><text>嵌套正文</text></view>
<text class="mono">单号</text>
<input placeholder="请输入昵称" />
<textarea placeholder="写点什么" />
<text class="hm-title">{{ok ? '已选' : '选择'}}</text>`
  )
  w(
    'rewrite/mp/pages/home/home.ts',
    `const TITLE = '新品上架'
wx.showToast({ title: '网络异常', icon: 'none' })
wx.showModal({ title: '确认删除', content: '删除后不能恢复' })
this.ping('收藏成功')
fxHint(this, '敬请期待')
const BODY = '我们希望每个人都能亲手创造自己的随身幸运物件这是一段长长的正文说明'`
  )
  w('rewrite/mp/pages/doc/doc.wxml', '<view class="doc-h">协议</view>')
  w('rewrite/shared/src/seed/products.ts', "export const P = [{ name: '小棉鸭', note: '附送卡片' }]")
  w('rewrite/cloud/src/errors.ts', "export const E = '库存不足请稍后'")
  tiers = deriveTierCharsets(root)
})

const has = (set, text) => [...text].every((c) => set.has(c))

describe('品牌字体挑字口径（只收真用圆体显示的字）', () => {
  it('大白话：按钮、标题、界面固定文案、tab 名、绑定里的字面量、seed 商品名收进首屏字库', () => {
    expect(has(tiers.tier1, '购买首页已选择新品上架小棉鸭')).toBe(true)
    expect(has(tiers.tier2, '协议附送卡片')).toBe(true)
  })

  it('大白话：黑体正文（含嵌套）、等宽数字、输入框、系统弹窗/提示、长段正文、云端报错文案都不收', () => {
    const all = new Set([...tiers.tier1, ...tiers.tier2])
    for (const t of ['正文段落嵌套', '单号', '请输入昵称写点什么', '网络异常确认删除后不能恢复收藏成功敬请期待', '我们希望每个人都能亲手', '库存不足请稍后']) {
      expect([...t].filter((c) => all.has(c)).join(''), t).toBe('')
    }
  })

  it('大白话：GB2312 兜底层删了——用户内容走黑体，不再为昵称/地址囤 2870 字', () => {
    expect(Object.keys(tiers).sort()).toEqual(['tier1', 'tier2'])
  })
})
