// Vite `?raw` 原文导入的环境类型声明（本仓 rewrite/mp/tsconfig.json 是小程序端 CommonJS 严格配置、
// 无 @types/node/import.meta，故不能用 node:fs+import.meta.url 读文件；改走 vitest 的 Vite 管线
// `import x from './foo.ext?raw'` 拿文本内容，仅测试文件用得到）。
declare module '*?raw' {
  const content: string
  export default content
}
