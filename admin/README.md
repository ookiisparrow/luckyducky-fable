# Lucky Ducky · 内容控制台（网页版）

商品上新流水线管理端。规格：`docs/设计规格-管理控制台.md`；UI 设计稿：`design/console.pen`（导出图 `design/exports/`）。

## 跑起来

```bash
cd admin
npm install
npm run dev      # 本机预览（浏览器打开提示的 localhost 地址）
npm run build    # 构建（产物 admin/dist，将来部署云开发静态托管）
```

## 当前状态（v1 第一批：流水线骨架）

- ✅ 登录壳（本地演示模式：任意非空账号密码可进）
- ✅ 商品列表（六步完成度圆点、新建/删除/继续上新）
- ✅ 上新向导：①产品图片（封面图 + 其余图，拖拽排序）②商品信息 ③SKU（行内编辑），每步自动保存
- ⬜ ④教学视频 ⑤二维码卡片 ⑥码批次与印刷包（v1.5，向导内为占位说明）
- ⬜ 云接线（CloudBase Web SDK：真实登录 / 云函数 / 云存储）——当前数据存浏览器本地（localStorage），
  适配层收口在 `src/api/cloud.js`，切云只改这一个文件。

## 结构

```
src/
  api/cloud.js        后端适配层（当前本地模式；云接线只改这里）
  store/products.js   商品流水线数据（六步完成度判定 stepDone）
  router.js           /login /products /product/:id/step/:n
  components/Sidebar.vue          左侧导航（按步骤直达六入口）
  pages/Login.vue / ProductList.vue / Wizard.vue
  pages/steps/        各步骤页（StepImages / StepInfo / StepSkus / StepStub）
  styles/tokens.css   设计 token（与小程序 uni.scss 同源幸运紫）
```
