// 小程序包内静态图（/static/*）→ 网页可用的 URL，直接取 rewrite/mp/static 原文件。
const files = import.meta.glob('../../rewrite/mp/static/*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

export function mpStatic(path: string): string {
  if (!path.startsWith('/static/')) return path
  return files[`../../rewrite/mp${path}`] ?? path
}
