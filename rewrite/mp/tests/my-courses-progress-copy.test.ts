// 我的课程：进度没读到时不许教「下拉」。本页 json 无下拉刷新、也无 scroll-view refresher，
// 点那一行必须走已有 onRetryLoad，并且 catch 住，避免连课卡一起点进目录。
// rewrite/mp tsconfig 无 node:fs，走 ?raw（见 raw-imports.d.ts）。
import { describe, expect, it } from 'vitest'
import wxmlRaw from '../pages/my-courses/my-courses.wxml?raw'
import jsonRaw from '../pages/my-courses/my-courses.json?raw'
import tsRaw from '../pages/my-courses/my-courses.ts?raw'

function live(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('我的课程进度读不到的说法', () => {
  it('大白话：页面没有下拉刷新，失败句不教人下拉，点一下走已有重试', () => {
    const wxml = live(wxmlRaw)
    const page = live(tsRaw)
    expect(wxml).toContain('学习进度暂时读不到')
    expect(wxml).toContain('点此重试')
    expect(wxml).toContain('catch:tap="onRetryLoad"')
    // 整页失败态的重试按钮仍是 bind（守卫 rw-mp-list-loadfailed-state 只认 bind:tap）
    expect(wxml).toContain('bind:tap="onRetryLoad"')
    expect(wxml).not.toContain('下拉')
    expect(wxml).not.toMatch(/refresher-enabled|onPullDownRefresh|enablePullDownRefresh/)
    expect(jsonRaw).not.toMatch(/enablePullDownRefresh|onPullDownRefresh/)
    expect(page).toContain('onRetryLoad()')
    expect(page).not.toContain('onPullDownRefresh')
  })
})
