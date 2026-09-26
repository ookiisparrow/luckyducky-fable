<script setup lang="ts">
// 评价挑选（先审后发）：顾客提交后待挑选；勾「上架」才进小程序评价墙。照 Csat 明细表 + 开关。
import { ref, onMounted } from 'vue'
import { RotateCcw, Star } from 'lucide-vue-next'
import { listReviews, setReviewPicked } from '../api/reviews'
import { mapReviewRows, type ReviewRowVM } from '../lib/mapReviews'
import { failText, writeFailText } from '../lib/status'
import { useLatest, appendNew } from '../lib/latest'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import UiButton from '../components/ui/Button.vue'

const STATUS_CHIPS = [
  { key: 'pending', label: '待挑选' },
  { key: 'picked', label: '已上架' },
  { key: 'all', label: '全部' },
] as const
type StatusKey = (typeof STATUS_CHIPS)[number]['key']
const status = ref<StatusKey>('pending')

const rows = ref<ReviewRowVM[]>([])
const cursor = ref<unknown>(null)
const hasMore = ref(false)
const message = ref('')
const busy = ref(false)
const toggling = ref('')
let filterSnapshot: { status: StatusKey } = { status: 'pending' }
const gen = useLatest()

async function load() {
  message.value = '加载中…'
  busy.value = true
  filterSnapshot = { status: status.value }
  const my = gen.begin()
  const r = await listReviews(filterSnapshot)
  if (gen.isStale(my)) return
  busy.value = false
  rows.value = r.ok ? mapReviewRows(r.list) : []
  cursor.value = r.ok ? r.nextCursor : null
  hasMore.value = !!(r.ok && r.hasMore)
  message.value = r.ok ? '' : failText('加载失败', r.error)
}

async function more() {
  if (!hasMore.value || cursor.value == null || busy.value) return
  const g = gen.peek()
  const r = await listReviews({ ...filterSnapshot, cursor: cursor.value })
  if (gen.isStale(g)) return
  if (!r.ok) {
    message.value = failText('加载更多失败', r.error)
    return
  }
  rows.value = appendNew(rows.value, mapReviewRows(r.list))
  cursor.value = r.nextCursor
  hasMore.value = !!r.hasMore
}

async function toggle(row: ReviewRowVM) {
  if (toggling.value) return
  toggling.value = row.id
  const r = await setReviewPicked(row.id, !row.picked)
  toggling.value = ''
  if (!r.ok) {
    message.value = writeFailText('操作失败', r.error)
    return
  }
  await load()
}

function pickStatus(key: StatusKey) {
  if (status.value === key) return
  status.value = key
  void load()
}

onMounted(load)
</script>

<template>
  <div class="ld-page">
    <PageHeader title="评价挑选" sub="小程序只展示勾过「上架」的评价；顾客提交后先待审。微信内容安全仍在提交时拦一遍，挑选是额外的人工闸。">
      <UiButton variant="ghost" size="sm" :disabled="busy" @click="load">
        <RotateCcw :size="14" :stroke-width="1.8" /><span>{{ busy ? '刷新中…' : '刷新' }}</span>
      </UiButton>
    </PageHeader>

    <p v-if="message" class="ld-status">{{ message }}</p>

    <Card title="评价" :sub="status === 'pending' ? '还没上架的（含旧档未标挑选）' : status === 'picked' ? '已在小程序展示' : '待挑选 + 已上架'">
      <template #head>
        <div class="range-chips ld-range-chips">
          <UiButton
            v-for="c in STATUS_CHIPS"
            :key="c.key"
            size="sm"
            :variant="status === c.key ? 'primary' : 'ghost'"
            @click="pickStatus(c.key)"
          >{{ c.label }}</UiButton>
        </div>
      </template>

      <EmptyState v-if="!message && !rows.length && !busy" :icon="Star" text="这一档还没有评价。" />
      <div v-else-if="rows.length" class="ld-table">
        <div class="ld-thead">
          <div class="ld-th" :style="{ width: '150px' }">时间</div>
          <div class="ld-th" :style="{ width: '70px' }">评分</div>
          <div class="ld-th grow">内容</div>
          <div class="ld-th" :style="{ width: '90px' }">状态</div>
          <div class="ld-th ops-cell" :style="{ width: '100px' }">操作</div>
        </div>
        <div class="ld-tbody">
          <div v-for="row in rows" :key="row.id" class="ld-tr">
            <div class="ld-td muted mono ld-muted ld-mono" :style="{ width: '150px' }">{{ row.timeLabel || '—' }}</div>
            <div class="ld-td" :style="{ width: '70px' }">{{ row.rating }} 星</div>
            <div class="ld-td grow">
              <div class="who">{{ row.name || '—' }}<span v-if="row.spec" class="spec"> · {{ row.spec }}</span></div>
              <div class="body">{{ row.text || '（无文字）' }}</div>
              <div v-if="row.tags.length" class="tags">{{ row.tags.join(' · ') }}</div>
              <div v-if="row.photos.length" class="thumbs">
                <img v-for="(u, i) in row.photos" :key="i" :src="u" alt="" />
              </div>
            </div>
            <div class="ld-td" :style="{ width: '90px' }">
              <Badge :tone="row.picked ? 'green' : 'amber'">{{ row.picked ? '已上架' : '待挑选' }}</Badge>
            </div>
            <div class="ld-td ops-cell" :style="{ width: '100px' }">
              <UiButton size="sm" :variant="row.picked ? 'ghost' : 'primary'" :disabled="toggling === row.id" @click="toggle(row)">
                {{ toggling === row.id ? '…' : row.picked ? '撤下' : '上架' }}
              </UiButton>
            </div>
          </div>
        </div>
        <div class="more-wrap ld-more-wrap">
          <UiButton v-if="hasMore" size="sm" variant="ghost" @click="more">加载更多</UiButton>
          <p v-else class="end-mark ld-end-mark">— 已到最早 —</p>
        </div>
      </div>
    </Card>
  </div>
</template>

<style scoped>
.ops-cell {
  justify-content: flex-end;
}
.who {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-ink);
}
.spec {
  font-weight: 400;
  color: var(--ld-content-2);
}
.body {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ld-ink);
}
.tags {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.thumbs {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.thumbs img {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 6px;
  background: var(--ld-bg-faint);
}
</style>
