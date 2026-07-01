<script setup>
/**
 * 统一反馈宿主（App.vue 挂一次）：右上角 toast 栈 + 居中确认弹窗，替全站原生 alert/confirm。
 * 状态在 utils/ui.js（toast/confirmDialog）。与 admin/components/FeedbackHost.vue 同形。
 */
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-vue-next'
import { toasts, dismissToast, confirmState, resolveConfirm } from '@/utils/ui.js'

const ICON = { ok: CheckCircle2, err: AlertCircle, info: Info }
</script>

<template>
  <!-- toast 栈 -->
  <div class="toast-wrap">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type" @click="dismissToast(t.id)">
      <component :is="ICON[t.type] || Info" :size="16" />
      <span>{{ t.message }}</span>
    </div>
  </div>

  <!-- 确认弹窗 -->
  <div v-if="confirmState.open" class="cf-mask" @click.self="resolveConfirm(false)" @keydown.esc="resolveConfirm(false)">
    <div class="cf-box" role="dialog" aria-modal="true">
      <div class="cf-head">
        <span class="cf-title">{{ confirmState.title }}</span>
        <button class="cf-x" @click="resolveConfirm(false)"><X :size="16" /></button>
      </div>
      <p class="cf-msg">{{ confirmState.message }}</p>
      <div class="cf-foot">
        <button class="btn ghost" @click="resolveConfirm(false)">{{ confirmState.cancelText }}</button>
        <button class="btn" :class="confirmState.danger ? 'danger' : 'primary'" @click="resolveConfirm(true)">
          {{ confirmState.confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toast-wrap {
  position: fixed;
  top: 18px;
  right: 18px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 340px;
  padding: 11px 15px;
  border-radius: 11px;
  font-size: 13px;
  color: var(--ink);
  background: var(--white);
  border: 1px solid var(--line);
  box-shadow: 0 10px 30px #241f3322;
  cursor: pointer;
  animation: toast-in 0.18s ease;
}
.toast.ok {
  border-color: var(--green-line);
  color: var(--green);
}
.toast.err {
  border-color: #f0c8c5;
  color: var(--red);
}
.toast.info {
  border-color: var(--purple-line);
  color: var(--brand-active);
}
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.cf-mask {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: #241f3340;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.cf-box {
  width: 100%;
  max-width: 400px;
  background: var(--white);
  border-radius: 14px;
  box-shadow: 0 24px 60px #241f3333;
  overflow: hidden;
}
.cf-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 0;
}
.cf-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink);
}
.cf-x {
  border: none;
  background: none;
  cursor: pointer;
  color: var(--content-2);
  display: flex;
  padding: 2px;
}
.cf-x:hover {
  color: var(--ink);
}
.cf-msg {
  padding: 10px 18px 16px;
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--content);
  white-space: pre-line;
}
.cf-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 18px;
  background: var(--bg-lilac);
  border-top: 1px solid var(--line);
}
</style>
