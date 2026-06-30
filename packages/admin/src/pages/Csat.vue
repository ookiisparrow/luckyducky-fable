<script setup>
/**
 * 客服满意度（后台360工作站 B4.3·admin 侧·只读报表）。
 * 顾客在微信客服会话里点「⭐ 评价服务」打 1-5 分（可选补充原因），这里看 均分 + 各档分布 + 总评价数。
 * 数据只读自 csat 集合（bounded 近似·量大时标 approx）；评分入口/写入在客服 bot（dispatch recordCsat）。
 */
import { ref } from 'vue'
import { cloudMode, getCsatReport } from '@/api/cloud.js'

const STARS = [5, 4, 3, 2, 1] // 高分在上
const report = ref(null)
const loading = ref(false)
const loadErr = ref('')

async function load() {
  if (!cloudMode) return
  loading.value = true
  loadErr.value = ''
  try {
    report.value = await getCsatReport()
  } catch (e) {
    loadErr.value = '满意度加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
load()

function pct(score) {
  const r = report.value
  if (!r || !r.total) return 0
  return Math.round(((r.dist?.[score] || 0) / r.total) * 100)
}
</script>

<template>
  <div>
    <div class="headrow">
      <div>
        <h2>客服满意度</h2>
        <p class="desc">顾客在客服会话里给本次服务打的分（1-5 星）。均分越高、五星占比越大越好；低分多说明要改进响应或解决能力。</p>
      </div>
      <button class="mini" :disabled="loading" @click="load">{{ loading ? '加载中…' : '刷新' }}</button>
    </div>

    <p v-if="!cloudMode" class="hint warn">满意度报表需云端模式（配置 admin/.env.local 的 VITE_ADMIN_API）。</p>
    <template v-else>
      <p v-if="loadErr" class="hint warn">{{ loadErr }}</p>
      <p v-else-if="loading && !report" class="hint">加载中…</p>
      <p v-else-if="report && !report.total" class="hint">还没有顾客评价。顾客在客服会话点「⭐ 评价服务」后这里会出现数据。</p>

      <template v-else-if="report">
        <div class="cards">
          <div class="card">
            <div class="big">{{ report.avg }}</div>
            <div class="cap">平均分（满分 5）</div>
          </div>
          <div class="card">
            <div class="big">{{ report.total }}</div>
            <div class="cap">总评价数{{ report.approx ? '（近似）' : '' }}</div>
          </div>
          <div class="card">
            <div class="big">{{ report.withNote }}</div>
            <div class="cap">带补充原因</div>
          </div>
        </div>

        <div class="dist">
          <div v-for="s in STARS" :key="s" class="row">
            <span class="lab">{{ s }} 星</span>
            <div class="bar"><div class="fill" :style="{ width: pct(s) + '%' }"></div></div>
            <span class="val">{{ report.dist?.[s] || 0 }}（{{ pct(s) }}%）</span>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.headrow {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
h2 {
  font-size: 16.5px;
  color: var(--ink);
  margin: 0 0 4px;
}
.desc {
  font-size: 12px;
  color: var(--content-2);
  margin: 0;
}
.cards {
  display: flex;
  gap: 12px;
  margin-bottom: 18px;
}
.card {
  flex: 1;
  border: 1px solid var(--line);
  border-radius: 13px;
  padding: 16px 14px;
  background: var(--white);
  text-align: center;
}
.big {
  font-size: 28px;
  font-weight: 800;
  color: var(--brand);
}
.cap {
  font-size: 12px;
  color: var(--content-2);
  margin-top: 4px;
}
.dist {
  border: 1px solid var(--line);
  border-radius: 13px;
  padding: 14px 16px;
  background: var(--white);
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0;
}
.lab {
  width: 40px;
  font-size: 12.5px;
  color: var(--content-2);
  flex: 0 0 auto;
}
.bar {
  flex: 1;
  height: 12px;
  border-radius: 6px;
  background: var(--bg-grey);
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--brand);
  border-radius: 6px;
}
.val {
  width: 90px;
  text-align: right;
  font-size: 12px;
  color: var(--ink);
  flex: 0 0 auto;
}
.mini {
  border: 1px solid var(--line);
  background: var(--white);
  font-size: 12px;
  color: var(--content-2);
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
  flex: 0 0 auto;
}
.hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
  margin: 6px 0 14px;
}
.hint.warn {
  border-color: #f0c8c5;
  background: #fdf0ef;
  color: var(--red);
}
</style>
