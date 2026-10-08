// 可手动放行的 Promise：测竞态时让某个请求「在途」，到点再 release(v) 让它返回。
export const pending = () => {
  let release: (v: unknown) => void = () => {}
  const p = new Promise((r) => (release = r))
  return { p, release: (v: unknown) => release(v) }
}
