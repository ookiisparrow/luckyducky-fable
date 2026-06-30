<script setup>
/**
 * 节点诊断·关键节点策展（后台360工作站 B2.2·admin 侧）。
 * 给一门课维护若干「关键节点」：每个节点 = 标题（学员卡在哪）+ 挽回办法（怎么补救）+ 顺序。
 * 学员在节点拍照上传成果/卡点（小程序 pages/checkpoint），坐席在客户360「节点照片」面板看轨迹，
 * 结合这里策展的「挽回办法」精准指导。一集合两形状：本页写 def 节点定义；用户拍照写 sub 提交（互不干扰）。
 * - 整课覆盖式保存：保存即把本课节点同步成当前列表（删掉的节点定义会被移除·不碰用户照片）。
 * - MVP 先一门旗舰课（课程 ID 默认 course-duck·可改）；课程选择器待后续接课程列表。
 */
import { ref } from 'vue'
import { cloudMode, listCheckpoints, saveCheckpoints } from '@/api/cloud.js'
import { confirmDialog, toast } from '@/utils/ui.js'

const courseId = ref('course-duck') // 旗舰课默认；可改成别的课 ID
const nodes = ref([])
const loading = ref(false)
const saving = ref(false)
const loadErr = ref('')

const rid = () => 'n' + Math.random().toString(36).slice(2, 8)

async function load() {
  if (!cloudMode) return
  loading.value = true
  loadErr.value = ''
  try {
    const list = await listCheckpoints(courseId.value.trim())
    nodes.value = list.map((n) => ({ nodeId: n.nodeId || rid(), title: n.title || '', remedy: n.remedy || '' }))
  } catch (e) {
    loadErr.value = '节点加载失败：' + e.message
  } finally {
    loading.value = false
  }
}
load()

function addNode() {
  nodes.value.push({ nodeId: rid(), title: '', remedy: '' })
}
async function removeNode(i) {
  if (await confirmDialog({ title: '删除', message: '删除这个关键节点？', confirmText: '删除', danger: true }))
    nodes.value.splice(i, 1)
}
function move(i, d) {
  const j = i + d
  if (j < 0 || j >= nodes.value.length) return
  const arr = nodes.value
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}

async function save() {
  if (saving.value) return
  const cid = courseId.value.trim()
  if (!cid) return toast('请先填课程 ID', 'err')
  saving.value = true
  try {
    const payload = nodes.value
      .filter((n) => n.title.trim())
      .map((n, i) => ({ nodeId: n.nodeId, title: n.title.trim(), remedy: n.remedy.trim(), order: i }))
    const ok = await saveCheckpoints(cid, payload)
    toast(ok ? '已保存 ✓' : '保存失败，检查网络', ok ? 'ok' : 'err')
  } catch (e) {
    toast('保存失败：' + e.message, 'err')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <div class="headrow">
      <div>
        <h2>节点诊断</h2>
        <p class="desc">
          给一门课设几个「关键节点」：学员到这里拍照上传成果/卡点，坐席在客户360「节点照片」里看，结合你写的「挽回办法」指导。
        </p>
      </div>
    </div>

    <p v-if="!cloudMode" class="hint warn">节点策展需云端模式（配置 admin/.env.local 的 VITE_ADMIN_API）。</p>
    <template v-else>
      <div class="courserow">
        <label>课程 ID</label>
        <input v-model="courseId" class="cid" placeholder="course-duck" @keyup.enter="load" />
        <button class="mini" @click="load">切换 / 重载</button>
      </div>

      <p v-if="loadErr" class="hint warn">{{ loadErr }}</p>
      <p v-else-if="loading" class="hint">加载中…</p>

      <template v-else>
        <p v-if="!nodes.length" class="hint">还没有关键节点。点下面「＋ 添加节点」新增一个。</p>

        <div v-for="(n, i) in nodes" :key="n.nodeId" class="node">
          <div class="node-head">
            <span class="num">{{ i + 1 }}</span>
            <input v-model="n.title" class="name title" placeholder="节点标题（学员卡在哪·如「钩魔术环总松开」）" />
            <button class="mini" title="上移" @click="move(i, -1)">↑</button>
            <button class="mini" title="下移" @click="move(i, 1)">↓</button>
            <button class="mini del" @click="removeNode(i)">删除</button>
          </div>
          <textarea
            v-model="n.remedy"
            class="name remedy"
            rows="2"
            placeholder="挽回办法（怎么补救·坐席据此指导·如「左手食指压住线头别松，收紧后再钩第一针」）"
          ></textarea>
        </div>

        <button class="addnode" @click="addNode">＋ 添加节点</button>

        <div class="footrow">
          <button class="save-btn" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
          <span class="tip">保存＝把本课节点同步成上面这份；删掉的节点定义会被移除（不影响已上传的学员照片）。</span>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.headrow {
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
.courserow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0 16px;
}
.courserow label {
  font-size: 12.5px;
  color: var(--content-2);
}
.cid {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 13px;
  width: 220px;
  font-family: inherit;
}
.node {
  border: 1px solid var(--line);
  border-radius: 13px;
  padding: 12px 14px;
  margin-bottom: 12px;
  background: var(--white);
}
.node-head {
  display: flex;
  align-items: center;
  gap: 9px;
}
.num {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  border-radius: 6px;
  background: var(--bg-grey);
  color: var(--content-2);
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.name {
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 13px;
  background: transparent;
  outline: none;
  font-family: inherit;
}
.name:hover {
  border-color: var(--line-strong);
}
.name:focus {
  border-color: var(--brand);
  background: var(--white);
}
.title {
  flex: 1;
  font-weight: 700;
  font-size: 14px;
}
.remedy {
  display: block;
  width: 100%;
  margin-top: 6px;
  box-sizing: border-box;
  resize: vertical;
  line-height: 1.5;
}
.addnode {
  width: 100%;
  border: 1px solid var(--purple-line);
  background: var(--bg-lilac);
  color: var(--brand-active);
  font-size: 13px;
  font-weight: 600;
  border-radius: 13px;
  padding: 12px;
  cursor: pointer;
  margin-bottom: 14px;
}
.footrow {
  display: flex;
  align-items: center;
  gap: 12px;
}
.save-btn {
  border: none;
  background: var(--brand);
  color: var(--white);
  font-size: 13.5px;
  font-weight: 600;
  border-radius: 9px;
  padding: 10px 22px;
  cursor: pointer;
}
.save-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.tip {
  font-size: 11.5px;
  color: var(--content-2);
}
.mini {
  border: none;
  background: none;
  font-size: 11.5px;
  color: var(--content-2);
  cursor: pointer;
  flex: 0 0 auto;
}
.mini.del:hover {
  color: var(--red);
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
