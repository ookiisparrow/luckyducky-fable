// 旧线冻结摘要——单源函数（守卫 oldline-frozen 与 freeze-oldline.mjs 刷新脚本共用，防两处各写一套漂移）。
// 范围：packages/ 全部源文件（跳过 node_modules / dist / unpackage / .DS_Store 等派生物）。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'

const SKIP = new Set(['node_modules', 'dist', 'unpackage', '.DS_Store', '.git'])

export function oldlineDigest(root) {
  const base = join(root, 'packages')
  const files = {}
  const walk = (d) => {
    for (const e of readdirSync(d).sort()) {
      if (SKIP.has(e)) continue
      const p = join(d, e)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (st.isFile()) {
        files[relative(root, p).split('\\').join('/')] = createHash('sha1')
          .update(readFileSync(p))
          .digest('hex')
      }
    }
  }
  walk(base)
  return files
}
