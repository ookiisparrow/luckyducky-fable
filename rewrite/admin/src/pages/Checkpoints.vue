<script setup lang="ts">
// 节点诊断策展（设计语言一致性·M3 UI 批15）：为某门课维护「关键节点 + 挽回办法」（学员卡壳时坐席据此精准指导）。
// 整课覆盖式保存——只动定义、绝不碰学员拍照提交（云端保证）。逻辑未动，仅套设计语言。
import { ref, computed, onMounted } from 'vue'
import { RotateCcw, Trash2, Plus, ListChecks, BookOpen } from 'lucide-vue-next'
import { listCheckpoints, saveCheckpoints } from '../api/cs'
import { nextNodeId, duplicateNodeIds } from '../lib/mapCs'
import { useLatest } from '../lib/latest'
import UiButton from '../components/ui/Button.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import EmptyState from '../components/ui/EmptyState.vue'

interface NodeRow {
  nodeId: string
  title: string
  remedy: string
  order: number
}

const courseId = ref('course-duck') // 默认旗舰课（换皮丢了默认载入·每次手敲）
const loadedCourseId = ref('') // 已载入（屏上节点所属）课程·钉住身份（P1·save 写它、非可编辑输入框——防改了课号没重载即整册覆盖到别课·同姊妹页 Courses 绑载入档 id）
const nodes = ref<NodeRow[]>([])
const loaded = ref(false)
const message = ref('')
const busy = ref(false)
const confirmKey = ref('')
const baseRev = ref(0) // 拉取那一刻的元档版本号（乐观并发基线·批A·课程级 CAS 元档 defmeta:<courseId>）
const conflicted = ref(false) // 冲突态：别处已改过本课策展——提示重载，不自动 reload、不丢当前编辑
const loadGen = useLatest() // load() 乱序守卫（批A·同 Batches G1）：连点载入/换课时旧回包别把 nodes 污染成错课

// 课号输入框与已载入课漂移（改了没点载入）：提示先重载，避免以为在编 A 其实要覆盖 A（save 仍写 loadedCourseId 保数据安全）
const courseDrifted = computed(() => loaded.value && courseId.value.trim() !== loadedCourseId.value)

async function load() {
  if (!courseId.value.trim()) return
  confirmKey.value = '' // 换课即复位危险态（P1·「保存整课」全量覆盖·残留误删会被永久上云·批3 规格）
  const c = courseId.value.trim()
  const my = loadGen.begin() // 乱序守卫（批A）：只让最后一次发起的 listCheckpoints 结果落地
  const r = await listCheckpoints(c)
  if (loadGen.isStale(my)) return // 已发起更新的 load()·整包丢弃（nodes/loaded/baseRev/message 全不写）
  nodes.value = r.ok
    ? ((r.list as Record<string, any>[]) || []).map((n) => ({ nodeId: String(n.nodeId || ''), title: String(n.title || ''), remedy: String(n.remedy || ''), order: Number(n.order) || 0 }))
    : []
  loaded.value = r.ok
  if (r.ok) {
    loadedCourseId.value = c // 钉住本次载入的课·save/覆盖以它为准
    baseRev.value = Number(r.rev) || 0 // 记下拉取那一刻的元档版本号
    conflicted.value = false // 重新载入即解除冲突态
  }
  message.value = r.ok ? '' : '加载失败：' + String(r.error || '')
}

function addNode() {
  nodes.value.push({ nodeId: nextNodeId(nodes.value.map((n) => n.nodeId)), title: '', remedy: '', order: nodes.value.length })
}
// ↑↓ 重排（换皮丢·节点顺序有业务含义·且 order 曾在 addNode 定死不重算＝排序错乱隐患）
function move(i: number, dir: number) {
  const j = i + dir
  if (j < 0 || j >= nodes.value.length) return
  const t = nodes.value[i]
  nodes.value[i] = nodes.value[j]
  nodes.value[j] = t
  confirmKey.value = '' // 重排后清「已武装删除」·防下标编码 confirmKey 落到换位后的另一节点→删错（P2·对齐姊妹页）
}
function delNode(i: number) {
  if (confirmKey.value !== 'd:' + i) {
    confirmKey.value = 'd:' + i
    return
  }
  confirmKey.value = ''
  nodes.value.splice(i, 1)
}

async function save() {
  if (busy.value || !loadedCourseId.value || conflicted.value) return // 冲突未重载前不再发保存（纵深防御·逼先点「载入」·同 flushSave 范式）
  // order 按当前位置重算（修排序错乱：换皮 order 在 addNode 定死、删除后不重算）+ 过滤空标题节点
  const payload = nodes.value.filter((n) => n.title.trim()).map((n, i) => ({ ...n, order: i }))
  // nodeId 重复即拦（后端 _id=`def:课:nodeId` upsert·撞键会静默相互覆盖丢节点）——用户手改 nid 或历史撞号都挡在提交前
  const dup = duplicateNodeIds(payload.map((n) => n.nodeId))
  if (dup.length) {
    message.value = `节点 id 重复（${dup.join('、')}），请改成唯一后再保存`
    return
  }
  // 空「节点 id」友好拦截（D3·bug 清除批D·对照 Kb.vue 先例）：云端已 fail-closed 拒绝整批，这里提前拦下
  // 给出具体原因——防「无节点 id」被误当「已移除」在云端整课覆盖时误删旧节点。
  if (payload.some((n) => !n.nodeId.trim())) {
    message.value = '有节点未填「节点 id」——为防误删旧节点已拦下，请补齐后再保存'
    return
  }
  busy.value = true
  // 写「已载入的课」loadedCourseId·不是可编辑输入框（P1·改了课号没重载不会把本课节点整册覆盖到别课）
  const r = await saveCheckpoints(loadedCourseId.value, payload, baseRev.value)
  busy.value = false
  // 保存成功 / GC_REMOVE_FAIL 都已 bump 元档 rev——刷新基线，否则「重存收敛」会撞自己刚 bump 的 rev（批A）。
  // 刻意排除 DRAFT_CONFLICT（对齐姊妹页 HelpVideos.save 第 166 行）：冲突回包也带 rev=curRev，若照刷基线，
  // 用户不重载再点一次「保存整课」就会 baseRev===curRev、CAS 通过、本地过期数据整册覆盖别处刚保存的策展（无声丢失·本批要防的场景）。
  if (r.ok || r.error === 'GC_REMOVE_FAIL') baseRev.value = Number(r.rev) || baseRev.value
  if (r.error === 'DRAFT_CONFLICT') {
    // 别处（另一页签/窗口/管理员）已改过本课策展：拒写防互相覆盖·不自动 reload 不丢当前编辑（迭代I 载入失败保护范式）
    conflicted.value = true
    message.value = '内容已被别处修改，请重新载入后再保存'
    return
  }
  // GC_REMOVE_FAIL（H2）：新节点已 upsert 成功，只是旧节点 GC 删除失败残留——友好文案区分于「整体没存上」
  message.value = r.ok
    ? `已保存 ${Number(r.count) || 0} 个节点到 ${loadedCourseId.value}（整课覆盖·学员提交不受影响）`
    : r.error === 'GC_REMOVE_FAIL'
      ? '已保存新节点，但有旧节点未删净（重存一次即可收敛）'
      : '保存失败：' + String(r.error || '')
}

onMounted(load) // 默认旗舰课自动载入
</script>

<template>
  <div class="ld-page">
    <PageHeader title="节点诊断（关键节点策展）" sub="为某门课维护「关键节点 + 挽回办法」，学员卡壳时坐席照此精准指导。整课覆盖保存，不碰学员提交。">
      <UiButton v-if="loaded" :disabled="busy" @click="save">{{ busy ? '保存中…' : '保存整课' }}</UiButton>
    </PageHeader>

    <div class="ld-toolbar">
      <label class="ld-search">
        <BookOpen :size="15" :stroke-width="1.8" />
        <input v-model="courseId" placeholder="course-xxx" @keyup.enter="load" />
      </label>
      <UiButton variant="ghost" size="sm" @click="load"><RotateCcw :size="14" :stroke-width="1.8" /><span>载入</span></UiButton>
    </div>
    <p v-if="message" class="ld-status">{{ message }}</p>
    <p v-if="courseDrifted" class="ld-status drift">课号框已改为「{{ courseId.trim() }}」但未载入——当前编辑与「保存整课」仍作用于已载入的 <b>{{ loadedCourseId }}</b>；要编另一门课请先点「载入」。</p>

    <template v-if="loaded">
      <!-- 零节点引导（批3）：默认课自动载入成功但没配过节点时，曾裸一个「加节点」无任何说明（全站唯一裸空态） -->
      <p v-if="!nodes.length" class="ld-status">「{{ loadedCourseId }}」还没配节点——点下方「加节点」建第一个；要编其他课，在上方输入课号点「载入」。</p>
      <Card v-for="(n, i) in nodes" :key="i">
        <div class="node-head">
          <Badge tone="brand">{{ i + 1 }}</Badge>
          <input v-model="n.nodeId" placeholder="节点 id（如 n1）" class="nid" />
          <input v-model="n.title" placeholder="节点名（如 第二段收口）" maxlength="100" class="ntitle" />
          <button class="icon-btn" title="上移" :disabled="i === 0" @click="move(i, -1)">↑</button>
          <button class="icon-btn" title="下移" :disabled="i === nodes.length - 1" @click="move(i, 1)">↓</button>
          <button class="icon-btn del" :class="{ warn: confirmKey === 'd:' + i }" :title="confirmKey === 'd:' + i ? '再点确认删除' : '删节点'" @click="delNode(i)"><Trash2 :size="14" :stroke-width="1.8" /></button>
        </div>
        <textarea v-model="n.remedy" placeholder="挽回办法（学员卡这里时坐席照此指导·≤2000 字）" maxlength="2000" />
      </Card>
      <UiButton variant="ghost" @click="addNode"><Plus :size="14" :stroke-width="2" /><span>加节点</span></UiButton>
    </template>
    <EmptyState v-else-if="!message" :icon="ListChecks" text="输入课程编号（course-xxx）载入其关键节点" />
  </div>
</template>

<style scoped>
/* 本页独有：节点行内编辑（id/名/上下移/删除的一行控件 + 补救话术 textarea）。
 * 页头/卡/徽章/空态/按钮/工具条/搜索/状态行已交共享原语与 .ld-* 全局类。 */
.drift {
  color: var(--ld-amber);
}
.drift b {
  font-family: var(--ld-font-mono);
}
.node-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.nid {
  flex: none;
  width: 120px;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
  font-family: var(--ld-font-mono);
}
.ntitle {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg);
  color: var(--ld-content-2);
  cursor: pointer;
}
.icon-btn:hover:not(:disabled) {
  color: var(--ld-content);
  border-color: var(--ld-purple-line);
}
.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.icon-btn.del:hover:not(:disabled) {
  color: var(--ld-red);
  border-color: var(--ld-red-line);
}
.icon-btn.warn {
  color: var(--ld-red);
  border-color: var(--ld-red-line);
  background: var(--ld-bg-red-soft);
}
textarea {
  width: 100%;
  min-height: 48px;
  padding: 8px 12px;
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-sm);
  font-size: 13px;
  font-family: var(--ld-font);
  box-sizing: border-box;
  resize: vertical;
}
</style>
