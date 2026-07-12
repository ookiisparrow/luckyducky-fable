import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// 管理控制台 v2（M3）：静态托管部署（同旧 admin 路数·/admin 路径）；endpoint 经 VITE_ADMIN_API 注入。
// @ldrw/shared 别名直连 TS 源（P2 顺手改批新增·同 rewrite/cloud/build.mjs 既有先例，无需先 build shared dist）：
// admin 是 Vite/esbuild 打包，不受 mp 那条「微信开发者工具编译不出仓外引用」的限制（见 mp/lib/checkoutConst.ts
// 头注），可以直接引用状态标签等跨端共享的展示口径单源。
export default defineConfig({
  plugins: [vue()],
  base: './',
  resolve: {
    alias: {
      '@ldrw/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
})
