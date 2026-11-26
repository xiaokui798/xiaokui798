# 全物品图标集 v1 — 清单与规格（batch 52）

盘点来源：recipes.mjs（RECIPES/BLOCK）、crops.mjs（FARM_MATERIALS/CROPS）、
enemies.mjs（RARE_MATERIALS）、weapons.mjs（WEAPONS）、tech.mjs（TECH）、
progression.mjs（BOSS_DROPS）、game.js（blockNames）。逐表核对，一个不漏。

## 规格

- 画布：96×96（viewBox `0 0 96 96`），透明底，单个 SVG 文件，无外部引用。
- 画法：与游戏一致的低多边形方块风——扁平多边形色块分面（facet），不用渐变、
  不用照片纹理；轮廓粗、色块大，保证缩到 24×24（提示条尺寸）仍可辨认。
- 配色锚点：方块色取游戏 blockColors 原值——草 #4a9938、泥土 #7d4d29、
  石头 #6e756e、木头 #7a4a1f、树叶 #38782e；装备三阶统一色系：
  石阶灰、熔火橙、断星紫。
- 命名：文件名 = 物品 key（以装备/注册表 key 为准）+ `.svg`。
- 绿勾：单独一个 `check.svg`（绿圆底白勾角标），不画进任何物品图标；
  接线时由 UI 叠加到物品图标右下角。

## 清单（40 个物品图标 + 1 个角标）

### 方块材料（5）
| key | 文件 | 中文名 |
|---|---|---|
| grass | grass.svg | 草方块 |
| dirt | dirt.svg | 泥土 |
| stone | stone.svg | 石头 |
| wood | wood.svg | 木头 |
| leaf | leaf.svg | 树叶 |

### 农场材料（3）
| key | 文件 | 中文名 |
|---|---|---|
| wheatSeed | wheatSeed.svg | 小麦种子 |
| wheat | wheat.svg | 小麦 |
| fertilizer | fertilizer.svg | 腐叶 |

### 稀有材料 / Boss 掉落（2）
| key | 文件 | 中文名 |
|---|---|---|
| emberCore | emberCore.svg | 熔火核心（熔炉守卫掉落） |
| starShard | starShard.svg | 断星碎片（断星巨像掉落） |

### 敷料（3）
| key | 文件 | 中文名 |
|---|---|---|
| dressing | dressing.svg | 树叶敷料 |
| bandage | bandage.svg | 树皮绷带 |
| bigDressing | bigDressing.svg | 树叶大敷料 |

### 食物（3）
| key | 文件 | 中文名 |
|---|---|---|
| bakedWheat | bakedWheat.svg | 烤麦饼 |
| veggieSalad | veggieSalad.svg | 果蔬沙拉 |
| stew | stew.svg | 炖菜 |

### 设施（1）
| key | 文件 | 中文名 |
|---|---|---|
| workbench | workbench.svg | 工作台 |

### 武器（6）
| key | 文件 | 中文名 |
|---|---|---|
| stoneSword | stoneSword.svg | 石剑 |
| stoneAxe | stoneAxe.svg | 石斧 |
| emberSword | emberSword.svg | 熔火剑 |
| emberAxe | emberAxe.svg | 熔火斧 |
| starSword | starSword.svg | 断星剑 |
| starAxe | starAxe.svg | 断星斧 |

### 工具（3）
| key | 文件 | 中文名 |
|---|---|---|
| stonePickaxe | stonePickaxe.svg | 石镐 |
| emberPickaxe | emberPickaxe.svg | 熔火镐 |
| starPickaxe | starPickaxe.svg | 断星镐 |

### 护甲（3）
| key | 文件 | 中文名 |
|---|---|---|
| stoneArmor | stoneArmor.svg | 石甲 |
| emberArmor | emberArmor.svg | 熔火甲 |
| starArmor | starArmor.svg | 断星甲 |

### Boss 专用枪械（3）
| key | 文件 | 中文名 |
|---|---|---|
| pulseWeapon | pulseWeapon.svg | 星脉枪 |
| rapid | rapid.svg | 蜂鸣速射枪 |
| cannon | cannon.svg | 裂晶重炮 |

### 科技节点（8）
| key | 文件 | 中文名 |
|---|---|---|
| stoneGear | stoneGear.svg | 石阶装备 |
| emberTech | emberTech.svg | 熔火科技 |
| emberGear | emberGear.svg | 熔火阶装备 |
| starTech | starTech.svg | 断星科技 |
| starGear | starGear.svg | 断星阶装备 |
| toughness | toughness.svg | 坚韧 |
| swiftHands | swiftHands.svg | 快手 |
| firstAid | firstAid.svg | 急救 |

### 角标（1）
| key | 文件 | 用途 |
|---|---|---|
| check | check.svg | 绿勾角标（overlay，叠加到物品图标角上） |

## 盘点发现的对不上（报指挥部，未自行改动）

1. **石斧两个 key**：配方表里是 `axe`（工作台行 id 为 #craft-axe），
   武器表/装备里是 `stoneAxe`。同一件物品两个 key。图标文件用 `stoneAxe`
   （装备与快捷栏口径）；接线时需注意配方 key → 图标 key 的映射，
   或由系统组统一 key。
2. **workbench 一 key 两用**：RECIPES 的工作台（物品）与 TECH 的工作台
   （科技节点）同 key 同名。本图标一图两用，无冲突，仅记录。
3. **fertilizer 双表登记**：腐叶同时在 RECIPES（可制作）与 FARM_MATERIALS
   （农场材料）中，key 一致，是同一物品，无冲突，仅记录。
4. **pulseBurst（星脉爆发）有名无物**：在 WEAPONS 表里有名字，
   实为星脉枪的蓄力开火模式，不是可持有物品、没有快捷栏格，
   本轮未配图标（配了也无处用）。若指挥部想要，可补。
5. **punch（拳头）**：武器档案，非物品，未配图标。
6. **科技节点类**：stoneGear/emberGear/starGear 是解锁类别而非可持有物品，
   图标按“三阶齿轮”画成节点徽记；toughness/swiftHands/firstAid 是增益节点，
   分别以盾/手/红十字徽记表示。
