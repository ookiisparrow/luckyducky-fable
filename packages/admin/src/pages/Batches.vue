<script setup>
/**
 * 二维码批次管理（S9·跨课程统一视图）。激活卡批次的生成 / 查看码 / 激活追踪——一码一用。
 *
 * 此前批次只能在「上新向导第 6 步」按单个商品建/看；本页把所有课程的批次汇到一处，带激活进度，
 * 一眼看哪批印了多少、激活了多少。数据＝逐课程 listBatches 合并（课程数少·全量加载诚实·无分页失真）。
 * 批次/码读写仍走云端 adminApi（listBatches/createBatch/listBatchCodes·本页不新增后端）。
 */
import { ref, computed } from 'vue'
import { cloudMode, listBatches, createBatch, listBatchCodes } from '@/api/cloud.js'
import { useProductsStore } from '@/store/products.js'

const store = useProductsStore()

const STATUS = {
  new: { label: '全新', chip: 'grey' },
  using: { label: '使用中', chip: '' },
  done: { label: '已用尽', chip: 'green' },
}
const TABS = [
  ['all', '全部'],
  ['using', '使用中'],
  ['done', '已用尽'],
  ['new', '全新'],
]

const batches = ref([])
const loading = ref(true)
const loadErr = ref('')
const tab = ref('all')
const courseFilter = ref('') // courseId 或 ''=全部
const q = ref('')
// 新建批次抽屉 / 查看码抽屉
const drawer = ref(null) // { mode:'new'|'codes', ... }

// 有配套课程的商品＝可建批次的课程（courseId 单源自商品·名用商品名）
const courses = computed(() =>
  store.list.filter((p) => p.courseId).map((p) => ({ courseId: p.courseId, name: p.name || '未命名商品' })),
)

const statusOf = (b) => (b.activated === 0 ? 'new' : b.activated >= b.total ? 'done' : 'using')

async function loadBatches() {
  if (!cloudMode) {
    loading.value = false
    return
  }
  loading.value = true
  loadErr.value = ''
  try {
    const cs = courses.value
    const results = await Promise.all(
      cs.map((c) =>
        listBatches(c.courseId)
          .then((list) => list.map((b) => ({ ...b, courseId: c.courseId, courseName: c.name })))
          .catch(() => []),
      ),
    )
    batches.value = results.flat().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  } catch (e) {
    loadErr.value = '加载失败：' + e.message
  } finally {
    loading.value = false
  }
}

async function init() {
  await store.load()
  await loadBatches()
}
init()

const counts = computed(() => {
  const c = { all: batches.value.length, new: 0, using: 0, done: 0 }
  for (const b of batches.value) c[statusOf(b)]++
  return c
})
const kpi = computed(() => {
  const codes = batches.value.reduce((s, b) => s + (b.total || 0), 0)
  const activated = batches.value.reduce((s, b) => s + (b.activated || 0), 0)
  return { batches: batches.value.length, codes, activated, rate: codes ? Math.round((activated / codes) * 1000) / 10 : 0 }
})
const shown = computed(() => {
  const kw = q.value.trim().toLowerCase()
  return batches.value.filter((b) => {
    if (tab.value !== 'all' && statusOf(b) !== tab.value) return false
    if (courseFilter.value && b.courseId !== courseFilter.value) return false
    if (kw && !(b.batchId || '').toLowerCase().includes(kw)) return false
    return true
  })
})

const fmtTime = (ms) => {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const pct = (b) => (b.total ? Math.round((b.activated / b.total) * 100) : 0)

function openNew() {
  drawer.value = { mode: 'new', courseId: courses.value[0]?.courseId || '', count: 100, saving: false, error: '', done: null }
}
async function openCodes(b) {
  drawer.value = { mode: 'codes', batch: b, codes: [], loading: true, copied: false }
  try {
    drawer.value.codes = await listBatchCodes(b.batchId)
  } catch (e) {
    drawer.value.error = '加载码失败：' + e.message
  } finally {
    if (drawer.value) drawer.value.loading = false
  }
}
function closeDrawer() {
  if (drawer.value?.saving) return
  drawer.value = null
}

async function doCreate() {
  const d = drawer.value
  if (!d || d.saving) return
  const count = parseInt(d.count, 10)
  if (!d.courseId) {
    d.error = '请选择课程'
    return
  }
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    d.error = '数量需为 1–500 的整数'
    return
  }
  d.saving = true
  d.error = ''
  try {
    const r = await createBatch(d.courseId, count)
    d.done = { batchId: r.batchId, count }
    await loadBatches()
  } catch (e) {
    d.error = '生成失败：' + e.message
    d.saving = false
  }
}

function copyCodes() {
  const d = drawer.value
  if (!d?.codes?.length) return
  navigator.clipboard?.writeText(d.codes.join('\n')).then(() => {
    d.copied = true
    setTimeout(() => drawer.value && (drawer.value.copied = false), 1500)
  })
}
</script>

<template>
  <div>
    <header class="head">
      <div>
        <h1>二维码批次</h1>
        <p class="sub">激活卡批次的生成 · 查看码 · 激活追踪——一码一用，汇总所有课程</p>
      </div>
      <button class="btn primary" :disabled="!cloudMode || !courses.length" @click="openNew">＋ 生成新批次</button>
    </header>

    <p v-if="!cloudMode" class="hint warn">二维码批次需云端模式（配置 VITE_ADMIN_API）。</p>

    <template v-else>
      <div class="kpis">
        <div class="kpi card"><div class="kn">{{ kpi.batches }}</div><div class="kl">批次总数</div></div>
        <div class="kpi card"><div class="kn">{{ kpi.codes.toLocaleString() }}</div><div class="kl">码总数</div></div>
        <div class="kpi card"><div class="kn">{{ kpi.activated.toLocaleString() }}</div><div class="kl">已激活</div></div>
        <div class="kpi card"><div class="kn">{{ kpi.rate }}%</div><div class="kl">平均激活率</div></div>
      </div>

      <div class="bar">
        <div class="tabs">
          <button v-for="[k, label] in TABS" :key="k" class="tab" :class="{ on: tab === k }" @click="tab = k">
            {{ label }}<span class="tab-n">{{ counts[k] }}</span>
          </button>
        </div>
        <div class="filters">
          <select v-model="courseFilter" class="input course-sel">
            <option value="">全部课程</option>
            <option v-for="c in courses" :key="c.courseId" :value="c.courseId">{{ c.name }}</option>
          </select>
          <input v-model="q" class="input" placeholder="搜索批次号" />
        </div>
      </div>

      <p v-if="loadErr" class="hint warn">{{ loadErr }}</p>
      <p v-else-if="loading" class="hint">加载中…</p>
      <p v-else-if="!batches.length" class="hint">还没有批次。点右上「生成新批次」给某个课程印一批激活卡。</p>
      <p v-else-if="!shown.length" class="hint">这个筛选下没有批次。</p>

      <div v-else class="card table">
        <div class="row hrow">
          <span>批次号</span><span>所属课程</span><span>生成时间</span><span class="r">数量</span>
          <span>激活进度</span><span>状态</span><span class="r">操作</span>
        </div>
        <div v-for="b in shown" :key="b.batchId" class="row">
          <span class="bid">{{ b.batchId }}</span>
          <span class="course">{{ b.courseName }}</span>
          <span class="muted">{{ fmtTime(b.createdAt) }}</span>
          <span class="r">{{ b.total }}</span>
          <span class="prog">
            <span class="pbar"><i :class="statusOf(b)" :style="{ width: Math.max(pct(b), 2) + '%' }" /></span>
            <em>{{ b.activated }}/{{ b.total }} · {{ pct(b) }}%</em>
          </span>
          <span><span class="chip" :class="STATUS[statusOf(b)].chip">{{ STATUS[statusOf(b)].label }}</span></span>
          <span class="r"><button class="btn ghost mini" @click="openCodes(b)">查看码</button></span>
        </div>
      </div>

      <p v-if="batches.length" class="foot muted">共 {{ batches.length }} 批次（全部已加载）</p>
    </template>

    <!-- 抽屉：生成新批次 / 查看码 -->
    <div v-if="drawer" class="drawer-mask" @click="closeDrawer">
      <aside class="drawer" @click.stop>
        <div class="d-head">
          <span class="d-title">{{ drawer.mode === 'new' ? '生成新批次' : '批次 ' + drawer.batch.batchId }}</span>
          <button class="x" :disabled="drawer.saving" @click="closeDrawer">×</button>
        </div>

        <div class="d-body">
          <!-- 生成新批次 -->
          <template v-if="drawer.mode === 'new'">
            <template v-if="!drawer.done">
              <label class="field-label">课程</label>
              <select v-model="drawer.courseId" class="input">
                <option v-for="c in courses" :key="c.courseId" :value="c.courseId">{{ c.name }}</option>
              </select>
              <label class="field-label" style="margin-top: 14px">数量（1–500 张激活卡）</label>
              <input v-model="drawer.count" class="input" type="number" min="1" max="500" />
              <p class="d-tip">每张卡一个唯一二维码，一码一用。生成后可在列表「查看码」复制导出去印刷。</p>
              <p v-if="drawer.error" class="err">{{ drawer.error }}</p>
            </template>
            <div v-else class="d-ok">
              ✅ 已为该课程生成 <b>{{ drawer.done.count }}</b> 张激活卡（批次 {{ drawer.done.batchId }}）。
              <p>可在列表里点该批次「查看码」复制全部码去印刷。</p>
            </div>
          </template>

          <!-- 查看码 -->
          <template v-else>
            <div class="codes-meta">
              {{ drawer.batch.courseName }} · {{ drawer.batch.activated }}/{{ drawer.batch.total }} 已激活 ·
              {{ fmtTime(drawer.batch.createdAt) }}
            </div>
            <p v-if="drawer.loading" class="hint">加载码…</p>
            <p v-else-if="drawer.error" class="hint warn">{{ drawer.error }}</p>
            <template v-else>
              <div class="codes-act">
                <span class="muted">共 {{ drawer.codes.length }} 个码</span>
                <button class="btn ghost mini" @click="copyCodes">{{ drawer.copied ? '✓ 已复制' : '复制全部码' }}</button>
              </div>
              <div class="codes-list">
                <code v-for="c in drawer.codes" :key="c">{{ c }}</code>
              </div>
            </template>
          </template>
        </div>

        <div v-if="drawer.mode === 'new' && !drawer.done" class="d-foot">
          <button class="btn ghost" :disabled="drawer.saving" @click="closeDrawer">取消</button>
          <button class="btn primary" :disabled="drawer.saving" @click="doCreate">{{ drawer.saving ? '生成中…' : '生成批次' }}</button>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
h1 {
  font-size: 22px;
  color: var(--ink);
  margin: 0 0 5px;
}
.sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--content-2);
}
.kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 16px;
}
.kpi {
  padding: 16px 18px;
}
.kn {
  font-size: 24px;
  font-weight: 700;
  color: var(--ink);
}
.kl {
  font-size: 12px;
  color: var(--content-2);
  margin-top: 3px;
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.tabs {
  display: flex;
  gap: 8px;
}
.tab {
  border: 1px solid var(--line-strong);
  background: var(--white);
  border-radius: var(--r-pill);
  padding: 7px 14px;
  font-size: 12.5px;
  color: var(--content-2);
  cursor: pointer;
}
.tab.on {
  background: var(--purple-ink);
  border-color: var(--purple-ink);
  color: var(--white);
  font-weight: 600;
}
.tab-n {
  margin-left: 5px;
  font-size: 11px;
  opacity: 0.75;
}
.filters {
  display: flex;
  gap: 8px;
}
.course-sel {
  width: 150px;
}
.filters .input {
  width: 180px;
}
.table {
  overflow: hidden;
}
.row {
  display: grid;
  grid-template-columns: 150px 1fr 140px 64px 200px 78px 90px;
  align-items: center;
  gap: 12px;
  padding: 11px 18px;
  font-size: 12.5px;
}
.row + .row {
  border-top: 1px solid var(--line);
}
.hrow {
  background: var(--bg-lilac);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--content-2);
}
.r {
  text-align: right;
  justify-self: end;
}
.bid {
  font-family: ui-monospace, Menlo, monospace;
  font-weight: 600;
  font-size: 12px;
  color: var(--ink);
}
.course {
  color: var(--content);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.muted {
  color: var(--content-2);
}
.prog {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pbar {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: var(--bg-grey);
  overflow: hidden;
}
.pbar i {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: var(--brand);
}
.pbar i.done {
  background: var(--green);
}
.pbar i.new {
  background: var(--line-strong);
}
.prog em {
  flex: 0 0 auto;
  font-style: normal;
  font-size: 11px;
  color: var(--content-2);
  white-space: nowrap;
}
.btn.mini {
  padding: 6px 11px;
  font-size: 12px;
}
.chip.grey {
  background: var(--bg-grey);
  color: var(--content-2);
}
.foot {
  margin-top: 14px;
  font-size: 11.5px;
}
.hint {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 11.5px;
}
.hint.warn {
  border-color: #f0c8c5;
  background: #fdf0ef;
  color: var(--red);
}

/* 抽屉 */
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(36, 23, 51, 0.32);
  display: flex;
  justify-content: flex-end;
  z-index: 50;
}
.drawer {
  width: 440px;
  max-width: 92vw;
  height: 100%;
  background: var(--white);
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 30px rgba(36, 23, 51, 0.18);
}
.d-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px;
  border-bottom: 1px solid var(--line);
}
.d-title {
  font-weight: 700;
  font-size: 15px;
  color: var(--ink);
}
.x {
  border: none;
  background: none;
  font-size: 22px;
  line-height: 1;
  color: var(--content-2);
  cursor: pointer;
}
.d-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 22px;
}
.d-tip {
  margin: 10px 0 0;
  font-size: 11.5px;
  color: var(--content-2);
  line-height: 1.5;
}
.err {
  color: var(--red);
  font-size: 12px;
  margin: 10px 0 0;
}
.d-ok {
  font-size: 13px;
  color: var(--content);
  line-height: 1.6;
}
.d-ok p {
  font-size: 12px;
  color: var(--content-2);
  margin: 8px 0 0;
}
.codes-meta {
  font-size: 12px;
  color: var(--content-2);
  margin-bottom: 12px;
}
.codes-act {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.codes-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: calc(100vh - 240px);
  overflow-y: auto;
}
.codes-list code {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11.5px;
  color: var(--content);
  padding: 5px 8px;
  background: var(--bg-lilac);
  border-radius: 6px;
}
.d-foot {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  padding: 16px 22px;
  border-top: 1px solid var(--line);
}
</style>
