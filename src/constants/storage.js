/**
 * storage key 单一来源 —— 协议字符串不散落页面（拼错即静默失效，无报错可查）。
 * 注：Pinia 持久化的 key 由 store/persist.js 按 `ld_store_<storeId>` 派生，不在此列。
 */
export const STORAGE_KEYS = {
  // 视频教程欢迎页「看过」标记（welcome 写 / me 读）
  VIDEO_INTRO_SEEN: 'ld_video_intro_seen',
}
