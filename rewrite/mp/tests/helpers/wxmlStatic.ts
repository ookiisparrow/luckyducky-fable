// wxml/wxss 静态断言共用：live 剥掉 wxml 注释（注释掉的节点不算数）；rule 取一条 wxss 规则块（选择器须在行首），找不到即红。
import { expect } from 'vitest'

export const live = (w: string) => w.replace(/<!--[\s\S]*?-->/g, '')

export const rule = (css: string, sel: string) => {
  const i = css.indexOf('\n' + sel + ' {')
  expect(i, `缺 ${sel}`).toBeGreaterThanOrEqual(0)
  return css.slice(i, css.indexOf('}', i))
}
