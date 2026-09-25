# business/packaging

有单短句实际会发出的包装话术，只留这两类：

- 合照：`ask_photo_01`～`ask_photo_03`
- 同理：`empathy_01`～`empathy_03`

## 同理以本目录为准

短序列 `sequences/packaging_damage_priority_short.json` 的共情池是 `orLib: business/packaging`，`orPool` 为 `empathy_01`、`empathy_02`、`empathy_03`。顾客听到的同理就是本目录这三份 txt。

要改顾客听到的句子，改 `empathy_01.txt`～`empathy_03.txt`。`lib/emotion/empathy/` 不在这条短序列的抽取路径上，改那里顾客听不到。
