import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// 静态托管部署（/admin 路径）；endpoint 经 VITE_ADMIN_API 注入。
// base 用绝对路径 /admin/（2026-08-18 改：原 './' 相对路径在访问 /admin（无尾斜杠）时被解析到网站
// 根目录 → 加载根目录旧 assets 白屏（根因＝根目录堆 60 个历史残留文件）；绝对路径任何访问方式都正确。
// @ldrw/shared 别名直连 TS 源（P2 顺手改批新增·同 rewrite/cloud/build.mjs 既有先例，无需先 build shared dist）：
// admin 是 Vite/esbuild 打包，不受 mp 那条「微信开发者工具编译不出仓外引用」的限制（见 mp/lib/checkoutConst.ts
// 头注），可以直接引用状态标签等跨端共享的展示口径单源。
export default defineConfig({
  plugins: [vue()],
  base: '/admin/',
  resolve: {
    alias: {
      '@ldrw/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
})
