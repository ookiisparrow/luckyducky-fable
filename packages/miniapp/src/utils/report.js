/**
 * 前端错误自动上报（运营钩子①·待办#23 前端半边）。
 *
 * 为什么有它：上线初期是 bug 高发期，前端 JS 错误 / 未捕获 Promise 拒绝 / 关键接口失败若只在
 * 用户端控制台静默，开发侧看不见。这里把这些错误「轻封装」成一条埋点事件复用既有 events 通道
 * （trackEvent → events 集合·有 cleanupEvents TTL 兜底·只写不读·安全），便于事后翻库定位。
 *
 * 设计要点：
 *   - **不改 trackEvent 本体**：只在 track() 之上薄封装，type='error'，错误细节进 meta。
 *   - fire-and-forget：track 本身即不 await、失败仅 warn，绝不阻塞交互、绝不二次抛错。
 *   - 防自激：上报失败不再触发上报（track 内部已吞错只 warn，不抛 → onError/rejection 不会再被勾起）。
 *   - meta 体积受控：错误信息截断到 ~400 字（trackEvent 端 meta ≤1024 字硬上限再兜一道）。
 *   - 小程序端走云；H5 / App 端 track 为空操作（无云），仅本地日志（logger）已覆盖。
 *
 * 用法：
 *   reportError('app', err)                       // 全局运行时错误
 *   reportError('promise', reason)                // 未捕获 Promise 拒绝
 *   reportError('api', err, { name: 'createOrder' }) // 关键接口失败
 */
import { track } from '@/utils/track.js'

// 把任意错误对象压成可读短串（截断防 meta 撑爆）。
function brief(err) {
  let s = ''
  if (err == null) s = ''
  else if (typeof err === 'string') s = err
  else if (err.message) s = String(err.message) + (err.stack ? '\n' + err.stack : '')
  else {
    try {
      s = JSON.stringify(err)
    } catch {
      s = String(err)
    }
  }
  return s.slice(0, 400)
}

export function reportError(tag, err, extra = {}) {
  // tag = 错误场景（app / promise / api…）；extra 可带接口名等上下文。
  // 不在此处 try/catch 再抛——track 内部已 fire-and-forget 吞错，避免上报自身又触发 onError。
  track('error', {
    page: typeof tag === 'string' ? tag : '',
    meta: { tag, msg: brief(err), ...extra },
  })
}
