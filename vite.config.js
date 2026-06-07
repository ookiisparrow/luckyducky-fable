import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import fs from 'fs'
import path from 'path'

// 把 cloudfunctions/ 拷到小程序编译产物(uni 默认不拷),微信工具才能识别并上传云函数。
// UNI_OUTPUT_DIR 由 uni 在编译时注入(dev=dist/dev/mp-weixin、build=dist/build/mp-weixin)。
function copyCloudfunctions() {
  return {
    name: 'copy-cloudfunctions',
    closeBundle() {
      const out = process.env.UNI_OUTPUT_DIR
      const src = path.resolve(process.cwd(), 'cloudfunctions')
      if (out && fs.existsSync(src)) {
        fs.cpSync(src, path.join(out, 'cloudfunctions'), { recursive: true })
      }
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [uni(), copyCloudfunctions()],
})
