// node 内建 crypto 的最小声明（只声明 genQrcodes 用到的 randomBytes）。
// tcb 运行时提供真实 crypto；esbuild platform:node 自动外置。不引 @types/node 避免全局污染。
declare module 'crypto' {
  export function randomBytes(size: number): Uint8Array
}
