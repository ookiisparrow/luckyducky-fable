# Lucky Ducky · 内容控制台（网页版）

商品上新流水线管理端。规格：`docs/设计规格-管理控制台.md`；UI 设计稿：`design/console.pen`（导出图 `design/exports/`）。

## 跑起来

```bash
cd admin
npm install
npm run dev      # 本机预览（浏览器打开提示的 localhost 地址）
npm run build    # 构建（产物 admin/dist，将来部署云开发静态托管）
```

## 当前状态

> 功能完成度以 `docs/现状与路线.md` 为单一权威（状态单源·CLAUDE §1），本文只讲「怎么跑 + 结构」、不复述进度免漂移。

- 上新向导六步：①产品图片 ②商品信息 ③SKU ④教学视频 ⑤二维码卡片 ⑥码批次与印刷包，每步自动保存（步骤页见下方结构 `pages/steps/`）。
- 数据适配层收口在 `src/api/cloud.js`，云接线只改这一个文件。

## 结构

```
src/
  api/cloud.js        后端适配层（当前本地模式；云接线只改这里）
  store/products.js   商品流水线数据（六步完成度判定 stepDone）
  router.js           /login /products /product/:id/step/:n
  components/Sidebar.vue          左侧导航（按步骤直达六入口）
  pages/Login.vue / ProductList.vue / Wizard.vue
  pages/steps/        各步骤页（StepImages / StepInfo / StepSkus / StepVideos / StepCards / StepBatch / StepStub）
  styles/tokens.css   设计 token（与小程序 uni.scss 同源幸运紫）
```
