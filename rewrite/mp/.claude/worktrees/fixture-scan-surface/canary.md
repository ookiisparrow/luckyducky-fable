# 扫描面金丝雀 · md 面（病根#16·盲区体检批1）

本文件与同目录 canary.ts 一起构成守卫扫描面的活体夹具：故意含「投屏」「casting」token，
放在 `.claude/worktrees/` 下。`rw-mp-no-casting` 等按目录递归的守卫若未排除 dot 目录，
会把本文件当活代码咬红——闸恒绿即证明扫描面排除在生效。勿删、勿去 token。
