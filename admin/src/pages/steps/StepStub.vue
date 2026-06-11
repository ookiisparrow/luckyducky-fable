<script setup>
/**
 * 第 4/5/6 步占位（v1.5 接入）：说明该步将做什么 + 指向设计稿。
 * ④ 教学视频编排（嵌入三层编排工具，对接云端 coursesDraft）
 * ⑤ 二维码卡片设计器 ⑥ 码批次与印刷包（SVG + 地址 CSV 打包下载）
 */
import { STEP_NAMES } from '@/store/products.js'

const props = defineProps({ step: { type: Number, default: 4 } })

const DETAIL = {
  4: '三层编排（章节 → 课时 → 小段）+ 分段视频上传 + 草稿/发布。对接云端课程数据（coursesDraft），与小程序播放器同构。',
  5: '卡面设计器：上传图案 / 编辑文案 / 自定义尺寸（mm）；二维码区按激活码自动生成。',
  6: '按备货量生成激活码批次，打包下载「卡面 SVG + 二维码地址 CSV」交付印刷厂（一地址一码）。',
}
const detail = DETAIL[props.step] || ''
</script>

<template>
  <div class="stub">
    <div class="badge">v1.5</div>
    <h2>第 {{ step }} 步 · {{ STEP_NAMES[step - 1] }}</h2>
    <p class="desc">{{ detail }}</p>
    <p class="ref">界面设计已定稿：见 <code>design/exports/</code> 对应设计稿；本步骤功能在下一批次接入，先用「下一步」跳过不影响前三步的保存。</p>
  </div>
</template>

<style scoped>
.stub {
  text-align: center;
  padding: 60px 40px 30px;
}
.badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  color: var(--brand-active);
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  border-radius: var(--r-pill);
  padding: 3px 10px;
  margin-bottom: 12px;
}
h2 {
  font-size: 16.5px;
  color: var(--ink);
  margin: 0 0 10px;
}
.desc {
  font-size: 13px;
  color: var(--content);
  max-width: 560px;
  margin: 0 auto 8px;
  line-height: 1.7;
}
.ref {
  font-size: 11.5px;
  color: var(--content-2);
  max-width: 560px;
  margin: 0 auto;
  line-height: 1.7;
}
</style>
