// RSS 端点（内容分发/收录信号）：教程集合出 feed。手写 XML 零新依赖——
// @astrojs/rss 整包为此过重（CLAUDE.md 防过度工程）；转义闸齐全。
import type { APIRoute } from 'astro'
import { SITE, BRAND_NAME } from '../lib/schema'
import { sortedTutorials, TUTORIALS_DESCRIPTION } from '../lib/tutorials'

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const GET: APIRoute = async () => {
  const tutorials = await sortedTutorials()
  const items = tutorials
    .map((t) =>
      [
        '    <item>',
        `      <title>${esc(t.data.title)}</title>`,
        `      <link>${SITE}/tutorials/${t.slug}/</link>`,
        `      <guid>${SITE}/tutorials/${t.slug}/</guid>`,
        `      <pubDate>${new Date(`${t.data.datePublished}T00:00:00+08:00`).toUTCString()}</pubDate>`,
        `      <description>${esc(t.data.description)}</description>`,
        '    </item>',
      ].join('\n')
    )
    .join('\n')
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    `    <title>${esc(`${BRAND_NAME} · 钩织教程`)}</title>`,
    `    <link>${SITE}/</link>`,
    `    <description>${esc(TUTORIALS_DESCRIPTION)}</description>`,
    '    <language>zh-CN</language>',
    items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n')
  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
