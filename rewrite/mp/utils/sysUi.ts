// 自绘系统层调用口（页面 px-fx 组件的提示/加载/确认·每个页面根下都放 <px-fx id="fx" />·tests 核对）。
// 放 utils（叶层）：utils/exitGuard、utils/customerService 也要弹提示；lib/pxFx 原样转出，页面照旧从 lib/pxFx 取。
// 像素化 9c（老板 2026-09-30）：提示、加载、确认一律自绘，原生 showToast/showLoading/showModal 只剩没挂 px-fx 时兜底
// （版本更新弹窗 utils/appUpdate 例外·规格留原生）。page 不传＝当前页（utils/组件里没有页面实例时用）。
type Host = { selectComponent(sel: string): unknown }
export type ConfirmOpts = { title: string; content?: string; confirmText?: string; cancelText?: string; danger?: boolean; single?: boolean }
type Layer = {
  toast(text: string, ok?: boolean, ms?: number, mask?: boolean): void
  loading(text: string): void
  loaded(): void
  confirm(o: ConfirmOpts): Promise<boolean>
}
type ToastOpts = { ms?: number; mask?: boolean }

const layer = (page?: Host | null): Layer | null => {
  const p = page ?? (typeof getCurrentPages === 'function' ? (getCurrentPages().slice(-1)[0] as unknown as Host | undefined) : undefined)
  return p && typeof p.selectComponent === 'function' ? ((p.selectComponent('#fx') as Layer | null) ?? null) : null
}

/** 成功轻提示（像素 ✓）。提示期间换页会被新露面那页接着显示（同原生·见 px-fx lastToast），随即返回/跳页也照用。 */
export function fxToast(page: Host | null, text: string, o: ToastOpts = {}): void {
  const fx = layer(page)
  if (fx) return fx.toast(text, true, o.ms, o.mask)
  wx.showToast({ title: text, icon: 'success', duration: o.ms, mask: o.mask })
}

/** 普通轻提示（不带图标）：同 fxToast。 */
export function fxHint(page: Host | null, text: string, o: ToastOpts = {}): void {
  const fx = layer(page)
  if (fx) return fx.toast(text, false, o.ms, o.mask)
  wx.showToast({ title: text, icon: 'none', duration: o.ms, mask: o.mask })
}

/** 加载框（像素转圈·挡点按），配 fxLoaded 收。 */
export function fxLoading(page: Host | null, text: string): void {
  const fx = layer(page)
  if (fx) return fx.loading(text)
  wx.showLoading({ title: text, mask: true })
}
export function fxLoaded(page: Host | null): void {
  const fx = layer(page)
  if (fx) return fx.loaded()
  wx.hideLoading()
}

/** 确认半屏：true＝确认。danger＝左键红字按住 700ms（右墨黑＝保留）；single＝只一颗「知道了」类通知。 */
export function fxConfirm(page: Host | null, o: ConfirmOpts): Promise<boolean> {
  const fx = layer(page)
  if (fx) return fx.confirm(o)
  return new Promise((resolve) =>
    wx.showModal({
      title: o.title,
      content: o.content ?? '',
      showCancel: !o.single,
      confirmText: o.confirmText ?? '确定',
      cancelText: o.cancelText ?? '取消',
      success: (r) => resolve(!!r?.confirm),
      fail: () => resolve(false),
    })
  )
}
