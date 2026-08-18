# 项目流程闭环分析报告（第三轮）

> 审计日期：2026-08-17
> 审计范围：全项目源码（22 个 mock 模块 + 30 个页面 + 布局/权限/持久化/定时任务），逐文件对照代码实测
> 审计方法：不采信前两轮审计结论，全部对照代码复核；实际运行生产构建、冒烟测试（223/223 通过），并编写独立边界验证脚本复测
> 状态图例：⚠️ 高危 ｜ 🐛 缺陷 ｜ 🔧 一致性 ｜ ➕ 待补充
> 前提：项目处于纯静态演示模式，后续对接接口；仅关注"对接接口后流程能否真实闭环"

## 一、总体结论

**主链路闭环成立，架构质量高。** 本轮实测发现的 2 个缺陷均已修复（2026-08-17）：N-1（司机端 RBAC 拦截，P0，a 方案）、N-2（在途车辆可被手动二次派车，P1，推荐方案 + 种子状态一致性关联修复），均位于既有测试盲区；次要问题 M1-M8 亦已全部于 2026-08-17 修复（M1-M4：结算/对账快照价口径、出库充足性守卫、消息定向；M5-M8：发票陈旧强制红冲、司机端身份守卫、登出清 operator、登录失败锁定）；第四节待补充环节 1-3 已于 2026-08-17 补充（签收硬拦截+补签入口、客户异议流程、合同改价审批），环节 4-6 已于 2026-08-18 补充（质量/水分扣重、预付款管理、消息免打扰），环节 7-8 已于 2026-08-18 补充（安全库存预警、行级数据权限），环节 9-10 已于 2026-08-18 补充（登录验证码+密码哈希、电子单证归档），主链路资金安全闸门（签收=收货依据、客户异议可触发重新对账、改价须审批）、结算模型完整性（按质扣重、预付冲抵信用）、运营风控/多租户前置（库存跌破下限告警、按账号行级数据权限）与登录安全/单据级审计追溯（图形验证码+密码哈希不落明文、磅单/签收单/发票电子单证统一归档可下载）全部闭合，第四节待补充环节 1-10 已全部补充并回归。
前两轮审计中"司机端扫码走内部核心、不受登录用户权限影响"的表述曾与代码实际不符（N-1），已修复并对齐。

主链路（代码实测确认接线真实，非页面孤岛）：

```
客户门户发起需求 → 合同(草稿→部门审批→公司审批→执行) → 拆批计划(信用/剩余量校验)
→ 派车(互斥+乐观锁+年检拦截) → 司机接单 → 扫码装货(进磅+仓库出库/安全库存预警)
→ 发车 → 在途(定时任务遥测+围栏事件) → 扫码卸货(出磅+仓库入库) → 电子签收(收货凭证，缺失可补签)
→ 生成结算单(快照单价+质量扣重) → 三方对账(含签收状态/质量扣重) → 客户门户确认(硬闸门，异议触发重新对账)
→ 确认结算(签收硬拦截) → 收款(手工/银行核销/预付款抵扣) → 逾期(定时校准) → 开票(红冲/重开)
```

异常闭环、安全模块、成本侧、司机收入、消息中心、RBAC 单点校验、乐观锁、正规 ID 生成均实测存在且逻辑自洽。
`src/mock/flow.js`（2008 行）作为服务层中枢设计良好：状态流转集中、带前置守卫、带审计日志、带回卷联动，可 1:1 映射为后端 endpoint——这是本项目对接 API 迁移成本可控的根本原因。

## 二、实测发现的缺陷（第三轮新增）

### N-1 ⚠️ P0：司机端核心流程被 RBAC 拦截，司机账号无法使用 — ✅ 已修复（2026-08-17，a 方案）

`scanConfirmLoad`/`scanConfirmUnload`（`src/mock/flow.js:1145-1162`）调用的是**带 RBAC 的 PC 入口**
`confirmLoad`/`confirmUnload`（`flow.js:268` / `flow.js:328`），而非注释与第二轮审计声称的"内部核心"
`doConfirmLoad`/`doConfirmUnload`。司机角色操作权限为空数组（`src/permission-table.js:53`），实测：

```
司机账号(手机号登录) 扫码确认装货 → "当前角色「司机」无此操作权限，操作已被服务层拦截"
```

连带影响：司机端**发车**（`flow.js:276`）、**到达**（`flow.js:291`）同样有 `requireAction('dispatch')`，
司机角色全部被拦。司机账号登录后实际只能接单和看收入，扫码确认/发车/到达/签收整条执行链不可用，
"司机手机号登录直达司机端"的设计目标落空。

测试盲区原因：冒烟测试调用 `scanConfirmLoad` 时未切换操作人为司机（默认 admin）；UI e2e 司机场景只测了登录+账号锁定。

**修复记录（2026-08-17，a 方案已实施）**：
- `depart`/`arrive` 拆分为内部核心 `doDepart`/`doArrive`（状态机守卫不变）+ PC 端 RBAC 入口（`flow.js:278-317`）；
- `scanConfirmLoad/scanConfirmUnload` 改调内部核心 `doConfirmLoad/doConfirmUnload`（`flow.js:1163-1181`）；
- 新增司机端入口 `driverDepart`/`driverArrive`（走内部核心，另记"司机端"审计日志，`flow.js:1130-1144`）；
- 司机端页面改用司机端入口（`src/views/driver/app.vue`）；PC 端调度详情仍走 RBAC 入口，不受影响；
- 回归：冒烟测试新增第 16 节 8 项断言（司机身份扫码装/卸货、司机端发车/到达、状态机守卫、只读用户 PC 端仍被拦截）223→231 项；UI e2e 新增场景 14（司机手机号登录 → 接单 → 扫码装货 → 发车 → 到达 → 扫码卸货签收全链路）39→46 项，全部通过。

### N-2 🐛 P1：在途车辆/司机可被手动二次派车（服务层漏洞） — ✅ 已修复（2026-08-17，推荐方案）

`BUSY_STATUSES = ['pending', 'loading', 'exception']`（`flow.js:576`）**不含 `intransit`/`unloading`**。
自动匹配路径靠 `v.status === 'idle'` 过滤兜住，但手动指定路径（`flow.js:618-619`）与乐观锁终检
`validateResourceCommit`（`flow.js:585-589`）都只查 `BUSY_STATUSES`。实测：

```
车辆进入在途(inuse) → 手动指定该车再派一张 → 派车成功（漏洞）
```

UI 选车下拉（`src/views/plan/list.vue:253-256` 只列 idle 车辆）掩盖了该问题，但服务层即未来后端
endpoint，对接后即为真实车辆超占。与 `releaseResource` 使用的 `ACTIVE`（含 intransit/unloading，
`flow.js:28`）口径不一致。

**修复记录（2026-08-17，推荐方案已实施）**：
- `BUSY_STATUSES` 改为全部非终态 `['pending','loading','intransit','unloading','exception']`（`flow.js:589-592`），手动指定路径与乐观锁终检同步收紧；
- 计划列表/详情选车下拉的内联状态列表改用 `BUSY_STATUSES` 常量，消除口径复制（`src/views/plan/list.vue`、`src/views/plan/detail.vue`）；
- **关联修复（种子数据一致性）**：修复过程中发现种子存在 4 台"在途车次但车辆仍标 idle、司机仍标 available"的不一致数据（旧口径下自动匹配池也会漏放），在 `recalcAll` 启动校准中新增车辆/司机状态与实际执行对齐（执行中→占用、无执行中→释放，不触碰 maintenance/scrapped/disabled）；持久化快照版本 7→8 丢弃旧快照；
- 回归：冒烟测试新增第 17 节 7 项断言（在途/卸货中车辆手动二次派车拦截、完成后恢复可派车）231→238 项，全部通过；UI e2e 46/46 通过。

### 次要问题（一致性/边界）

| # | 级别 | 问题 | 位置 |
|---|------|------|------|
| M1 | ✅ 已修复 | "生成结算"候选列表预览运费用**合同当前单价**，实际账单用**车次快照单价**——合同改价后预览额≠实际账单额（2026-08-17 修复：预览改用与实际账单同口径） | `flow.js:756` |
| M2 | ✅ 已修复 | 对账差异金额/损耗金额同样按合同当前单价折算，应逐车次用快照价（2026-08-17 修复：逐车次快照价折算） | `flow.js:814` |
| M3 | ✅ 已修复 | 仓库出库无库存充足性守卫：批次不足时静默扣到 0，不告警不拦截（2026-08-17 修复：充足性守卫 + 跨批次 FIFO） | `flow.js:222` |
| M4 | ✅ 已修复 | 消息中心为全局广播，无按用户/角色定向（2026-08-17 修复：按角色定向，审批消息只发审批人） | `flow.js:97` |
| M5 | ✅ 已修复 | 已开票账单发生异常补扣后发票金额变陈旧；调整记录只写"需红冲重开"，无强制流程或标记，发票额与账单额可长期不一致（2026-08-17 修复：发票"金额陈旧"标记 + 红冲重开前拦截收款） | `flow.js:459` |
| M6 | ✅ 已修复 | `acceptDispatch`/`signReceipt` 无 RBAC 守卫（任何登录角色可调用），服务层作为后端等价物应补（2026-08-17 修复：司机端身份守卫 `requireDriverApp`，覆盖全部 6 个司机端入口） | `flow.js:1109` / `flow.js:1116` |
| M7 | ✅ 已修复 | 退出登录不清除服务层 `operator`，登出后服务调用仍记在旧用户名下（审计日志失真）（2026-08-17 修复：`clearOperator` + 刷新按登录态恢复） | `src/store/index.js:80` 未调 `setOperator` |
| M8 | ✅ 已修复 | 登录无失败次数锁定/限流；密码明文存 localStorage（演示可接受，对接时须换 JWT/短信）（2026-08-17 修复：连续 5 次失败锁定 5 分钟，按账号持久化；明文存储维持演示口径） | `src/views/login/index.vue:129-154` |

### M1-M4 修复记录（2026-08-17）

**M1（结算预览单价口径）**：`settlementCandidates` 预览运费改用 `calcSettlementFees`（车次快照单价 × 出磅净重），与实际账单完全同口径；合同改价后预览额 = 实际账单额。

**M2（对账折算口径）**：`buildReconciliation` 差异/损耗金额由"整单 × 合同当前单价"改为逐车次按快照单价折算（比对项新增 `price` 字段）；与结算口径一致，改价不追溯。

**M3（出库充足性守卫）**：`warehouseOut` 重写——
- 仓库有该商品批次但可发库存（normal）< 车次量 → 返回错误**拦截装货**（状态不变，明确提示可发量/需求量）；
- 仓库无该商品批次记录（外采/过路，如煤场站对应矿石仓）→ 不做出库联动（与原口径一致，不拦截）；
- 充足 → 跨批次按入库时间 FIFO 扣减（修复原"只扣最早批次、不足静默扣到 0"的库存丢失）；
- 守卫置于 `doConfirmLoad` 状态流转之前，拦截时车次保持"待装货"。

**M4（消息定向）**：
- `notify` 新增 `to` 参数（目标角色名数组，null=广播）；新增 `rolesWithAction`/`toRoles`（按 RBAC 操作码推导目标角色，与 `operatorCan` 判定顺序一致）；
- 21 处运行期消息 + 6 类种子消息全部定向：审批→审批人+合同经办、结算→结算角色、异常→异常处理角色、调度→调度执行角色、需求→合同经办、导入→对应模块角色、系统通知保持广播；
- 新增 `visibleMessages()`（平台管理员可见全部，其余按 `to` 过滤）；消息中心页与顶栏通知/角标改用可见消息；`markAllMessagesRead` 只标记当前用户可见消息（避免把他人定向消息标读）；
- 快照版本 8→9（消息 `to` 字段 + 对账逐车次价）。

### M5-M8 修复记录（2026-08-17）

**M5（发票金额陈旧 + 强制红冲流程）**：
- 新增 `markInvoiceStale(s, reason)`：账单金额变化且存在已开具发票时，发票标记 `stale` + `staleReason`，写审计日志并定向通知结算/发票角色；
- 触发点覆盖全部账单额变化路径：`closeException` 异常补扣、`recalcSettlement` 重算（仅已开票时标记）；
- **强制流程**：`recordPayment` 在存在"金额陈旧"发票时拦截收款（票款一致），须先红冲（`redFlushInvoiceRow`）→ 重开（`issueInvoice` 按当前账单额生成新发票）后收款恢复；
- UI：发票管理页状态列"金额陈旧"标签（悬停显示原因）+ 已开具统计卡陈旧张数 + 预览弹窗警示；结算详情页发票面板警示（含"红冲前不可登记收款"）。

**M6（司机端身份守卫）**：
- 新增 `requireDriverApp(d)`（等价后端司机 App 独立鉴权）：司机角色须为该车次指派司机（`operator.driverId === d.driverId`）；持 `dispatch` 执行权限的角色放行（场站代操作/演示切换）；其余 PC 角色（结算/客户/只读等）服务层拦截；
- 覆盖全部 6 个司机端入口：`acceptDispatch`/`signReceipt`（M6 点名的两个）+ `driverDepart`/`driverArrive`/`scanConfirmLoad`/`scanConfirmUnload`（同一缺口，一并补齐，避免半修）；
- `setOperator` 增记 `driverId`（司机账号绑定档案）；N-1 口径不变：司机端入口仍不做 PC 端 RBAC，状态机守卫照旧。

**M7（登出清 operator）**：
- 新增 `clearOperator()`：operator 置为"未登录"（role 空 → 默认拒绝），登出后服务调用不再记在旧用户名下；
- `useUserStore.logout()` 调用 `clearOperator()`；
- **关联修复（刷新态）**：原实现刷新页面后 operator 恒为默认管理员（审计日志记错人），`main.js` 启动时按持久化登录态（`userStore.userInfo`）恢复 operator。

**M8（登录失败锁定）**：
- 连续 5 次密码错误 → 该账号锁定 5 分钟；按账号独立计数（锁一个账号不影响其他账号），登录成功清零；
- 失败计数存 localStorage（`blms_login_fail`），刷新后锁定仍生效；锁定期按钮禁用 + 秒级倒计时 + 错误提示，剩余次数逐次提示；
- 密码明文存储维持演示口径（审计原文"演示可接受"），对接后端时换 JWT/短信鉴权。

### 环节 1-3 补充记录（2026-08-17）

**环节1（签收硬拦截 + 补签入口）**：
- `confirmSettle` 新增硬闸门：账单内存在未签收公路车次（`isRoadMode && !d.receipt`，实时口径）时拦截确认结算，报错列出车次号；**非公路豁免**：铁路/水运/管道按运输单元执行无签收凭证，不参与拦截（与对账 `hasReceipt: null` 口径一致）；
- 新增 `supplementReceipt(d, signer, reason)`（RBAC：dispatch）：仅已完成公路车次、未签收可补签；签收单带 `supplement: true` + 原因（码 `QS-B` 前缀区分正常签收）；补签后若车次已入账单且已有对账结果，自动 `buildReconciliation` 重建清除"未签收"标记；
- `signReceipt` 补强守卫：卸货完成前不可签收、已有签收单不可重复签收（原实现无状态守卫，服务层即后端等价物）；
- 种子数据：已完成公路车次 90% 带电子签收（`dispatch.js`，确定性 rng），留约 10% 缺失供"补签"演示；
- 关联修复（种子数据质量，rng 序列变化后暴露）：`exception.js` 已关闭异常挂到**已完成**车次的损失以车次价值为限（≤8000 元）——原口径高/中等级损失 1-20 万挂已完成车次，结算 `exceptionLoss` 扣减后账单总额可为负（实测出现 -13255 元账单）；大额损失仅保留在在途/异常车次；
- `ROAD_MODES`/`isRoadMode` 下沉 `base.js`（`flow.js` re-export 保持既有导入不变）：种子模块（dispatch）与服务层共用同一公路口径，避免 dispatch→flow 循环导入（flow 模块级 `recalcAll()` 会在 dispatch 种子前执行，破坏种子状态分布）；
- UI：调度详情"补签"按钮（已完成未签收公路车次）+ 补签弹窗（签收人+原因）+ 签收"补签"标记/未签收红字提示；结算详情对账明细"操作"列逐车次"补签"；确认结算弹窗文案由"建议补齐"改为"未补齐前无法确认结算"。

**环节2（客户异议流程）**：
- 新增 `customerObjection(s, reason)`（RBAC：customer-confirm）：仅"对账中"且未确认的账单可异议；异议单记 `s.objections`（时间+原因+状态），账单回"待对账"并清除 `customerConfirmed`，定向通知结算角色；
- 重新对账（`startReconcile`）→ 客户再确认（`customerConfirm`）后异议单自动关闭（`resolved` + `resolveTime`）；
- `customerConfirm` 收紧：仅"对账中"可确认（原实现只看 `reconciliation` 存在，异议回到待对账后客户可跳过重新对账直接确认——服务层漏洞）；已确认账单不可撤销、不可再异议；
- UI：客户门户"对账确认"列"异议"按钮（与"确认对账"并列）+ 异议弹窗（原因必填）+ "已异议 · 待重新对账"标签；结算详情对账明细上方异议警示 + 对账流程步骤"客户异议 · 待重新对账"描述。

**环节3（合同改价审批）**：
- `changeContract` 拆分：单价变更（`fields.unitPrice` 变化）不即时生效，转 `c.pendingChange`（fields + 原因 + 提交时间 + 审批链，复用 `buildApprovalChain` 部门审批 → 公司审批）；仅数量/截止日期变更仍即时生效；待批期间拦截新变更与延期；
- 新增 `approveContractChange`（推进审批层级，末级通过应用变更：`applyContractFields` 抽取共用 + 变更历史 + 审计 + 通知）、`rejectContractChange`（当前层级驳回即作废申请，单价维持不变，后续层级取消）；RBAC：contract-approve；
- 口径显式声明：已派车车次结算用派车时快照单价（`d.unitPrice`），改价仅影响未派车批次、不追溯（快照机制本已保证，M1/M2 同口径）；
- UI：合同详情"变更待审批"面板（变更内容/原因/审批链可视化/审批按钮）+ 变更审批弹窗（通过/驳回）；变更弹窗警示"单价变更须审批，改价仅影响未派车批次"；列表页变更提交提示同步。

### 环节 4-6 补充记录（2026-08-18）

**环节4（质量/水分扣重）**：
- `doConfirmUnload` 卸货时生成质检记录 `d.quality = { moisture, ash, time }`（水分 8-14% / 灰分 12-20%，演示口径）；种子数据已完成公路车次 100% 带质检（`dispatch.js`，确定性 rng）；
- 新增 `QUALITY_STANDARD`（标准水分 10% / 标准灰分 15%）、`QUALITY_RATE`（水分 1.5%/1%、灰分 1%/1%）与 `qualityDeductionQty(d)`：超标部分按**出磅净重**比例扣减，无质检记录（非公路/未质检）= 0；
- `calcSettlementFees` 新增 `qualityQty`（扣重吨数）/ `qualityDeduction`（扣减金额，逐车次快照单价折算，与 M1/M2 同口径）；`totalAmount` 公式三处同步（`doGenerateSettlements`/`recalcSettlement`/`settlement.js` 种子）：`… - lossDeduction - qualityDeduction - exceptionLoss`；
- `buildReconciliation` 逐车次新增 `qualityQty` 列 + 汇总 `qualityQty`/`qualityAmount`；对账"结算量 vs 磅单"差异口径不变（质量扣重是结算规则而非差异）；
- UI：调度详情"质检（水分/灰分）"项（超标显示"扣重 X 吨"+口径提示）；结算详情费用明细"质量扣减"行、对账明细"质量扣重(吨)"列、对账汇总与确认结算弹窗提示。

**环节5（预付款管理）**：
- 新增 `db.prepayments` 台账（`{ id: YF-xxxx, customerId, amount, used, time, method, remark }`，可用 = amount - used）；种子 CUS001/CUS003 各一笔（`customer.js`）；
- 新增 `prepaymentOf`/`prepaymentAvailable`（台账/可用余额）、`collectPrepayment`（收取，RBAC settlement；守卫：客户存在且未冻结、金额 > 0）、`applyPrepayment`（抵扣，RBAC settlement）；
- `applyPrepayment` 与 `recordPayment` 同口径：仅"已结算/逾期"且有未付余额的账单；存在"金额陈旧"发票时拦截（票款一致，M5 同口径）；**FIFO** 按收取时间依次抵扣，超额按 min(抵扣额, 未付余额, 可用预付款) 截断；抵扣记入收款流水（方式"预付款抵扣"，备注含预付款编号）并触发逾期重算；
- `creditCheck` 口径升级：`（未付余额 - 可用预付款）+ 订单额 vs 授信额度`——预付款为客户预付货款，冲减信用占用（超额预付可覆盖新订单）；客户详情/门户"授信占用"展示同步该口径；
- UI：客户详情"预付款台账"面板（收取/已抵扣/可用/状态）+ "收取预付款"弹窗；结算详情"预付款抵扣"按钮 + 弹窗（未付余额/可用预付/抵扣金额）；客户门户新增"可用预付款"概览卡（5 卡布局）。

**环节6（消息免打扰，M4 定向的补充）**：
- 新增 `db.dnd`（按登录账号：`{ enabled, quietStart, quietEnd, mutedTypes }`，随快照持久化）；`getDnd`/`setDnd`（未登录态拒绝保存）/`isMuted`（类型屏蔽，或消息时间落在免打扰时段——支持跨零点如 22:00-08:00）/`unreadCount`（未读且未被免打扰）；
- 顶栏未读角标与消息中心未读数改用 `unreadCount`（免打扰消息不打扰）；消息中心列表保留全部可见消息，被免打扰的行显示"免打扰"标记；
- UI：消息中心"免打扰"设置弹窗（启用开关 + 免打扰时段 + 屏蔽消息类型多选）。

### 环节 7-8 补充记录（2026-08-18）

**环节7（安全库存预警，M3 充足性守卫的补充）**：
- 新增 `db.safetyStocks` 台账（`{ id: SQ-xxxx, warehouseId, commodityId, minQty }`，仓库×商品 可发库存下限）；种子覆盖全部仓库×商品组合（确定性派生，不消耗全局 rng，避免扰动下游种子序列），并强制 1 号煤仓 动力煤 低于下限（预警展示口径）；
- 新增 `safetyStockOf`/`availableStockOf`（可发库存 = normal 批次合计，与 M3 出库守卫同口径）/`inventoryAlerts`（可发 < 下限的实时预警列表，含缺口）/`setSafetyStock`（设置，RBAC warehouse；守卫：仓库/商品存在、下限 ≥ 0；按仓库×商品 upsert）；
- **穿越阈值告警**（`checkInventoryAlert`）：可发库存由 ≥ 下限 跌破 < 下限 时写审计日志 + 定向通知仓储角色（`toRoles('warehouse')`）；已处于低于下限状态不重复告警（避免同一缺口反复打扰）；触发点覆盖两条减少可发库存的路径：`warehouseOut` 出库、`setInventoryStatus` 锁定/标记临期；
- UI：库存管理"低于安全库存"统计卡（5 卡布局）+ "安全库存预警"面板（仓库/商品/可发/下限/缺口）+ 批次表"安全库存"列 + "安全库存设置"弹窗（仓库×商品×下限，upsert）。

**环节8（数据权限，RBAC 功能权限之外的行级数据权限）**：
- 新增 `db.dataScopes`（按登录账号：`username → { regions: [...] }`，空/缺省 = 全量数据，随快照持久化）；区域枚举 `DATA_REGIONS` 由场站 region 派生（华北/西北/华东/东北，单一来源）；
- **口径：按装货侧场站区域过滤**（调度员只看本区线路）——`recordRegion` 调度单/计划直接取 `loadTerminalId`，合同/结算单经合同派生；`inDataScope`/`visibleDispatches`/`visiblePlans` 行级过滤（无范围=全量；无区域归属记录可见，防御口径）；
- `setDataScope`（RBAC user）：守卫——账号存在、区域合法（含无效区域整体拒绝）、**平台管理员恒全量且不可被限制**；`regions=[]` 清除范围恢复全量；
- 列表统一口径：调度管理/运输计划/在途监控三处列表（含统计卡、分页、导出、地图点位/线路）改用行级过滤；调度/计划/在途页头与顶栏用户名旁显示"数据范围：X（装货侧）"标签；
- UI：用户管理"数据范围"列（区域标签/全量数据）+ "数据范围"按钮 + 设置弹窗（区域多选，空=全量）；
- 种子：调度员 user02 仅华北（登录页演示账号提示同步），供行级权限演示与 e2e 断言。

### 环节 9-10 补充记录（2026-08-18）

**环节9（登录安全，M8 失败锁定的补充：验证码 + 密码加密）**：
- **密码哈希**：`src/utils/index.js` 新增纯 JS 同步 `sha256Hex`（FIPS 180-4 口径，浏览器/Node 同口径，3 组标准测试向量验证）+ `hashPassword`（加 `blms:` 命名空间前缀）；用户表 `password` 明文改 `passwordHash`（种子 98 账号全量哈希，`saveUser` 新建同口径），登录按哈希比对不落明文；快照版本 9→10（用户结构变更，旧快照自动丢弃）；
- **图形验证码**：`generateCaptcha`（4 位、60 秒有效、一次性，SVG 渲染——字符为 `<text>` 元素带随机位移/旋转/颜色 + 干扰线，e2e 可读字符）+ `verifyCaptcha`（消费式校验，不存在/过期/不符均拒）；验证码存运行态 `captchaStore`（不随快照持久化，瞬时凭证）；
- **登录服务层**：`login(username, password, captchaId, captchaCode)` 集中校验（验证码 → 密码哈希 → 账号状态），返回 `{ ok, user }` 或 `{ error, code }`（code: captcha/credential/disabled），审计日志下沉服务层；会话建立（`setOperator`/`userStore.login`）仍由视图完成（等价后端登录 endpoint + 客户端会话）；
- **与 M8 失败锁定衔接**：验证码/凭据失败计入锁定（停用账号不计），失败后自动刷新验证码供重试；空验证码交由服务层判定（服务层为唯一校验点，表单不设必填）；
- UI：登录页验证码输入框 + 可点击刷新 SVG 图片；提示文案同步。

**环节10（电子单证归档，磅单/签收单/发票的单据级审计追溯）**：
- 新增 `src/mock/document.js`（派生只读模块，同 report.js 口径，不进种子链、不消耗 rng）：`DOC_TYPES`（磅单/签收单/发票）+ `listDocuments`（三类电子单证统一聚合，按日期倒序）+ `documentOf`（按类型+单证号定位）+ `documentContent`（生成可下载/可打印 HTML 电子单证，含单证头/字段表/电子单证效力声明）；
- **聚合口径**：磅单=每条过磅记录一张（`db.weighings`）、签收单=已签收车次一份（`dispatch.receipt`，补签带原因）、发票=每张发票一份（`db.invoices`，含状态/关联账单/金额）；单证数与源记录数严格一致（冒烟断言）；
- **与操作日志互补**：单证归档=单据级审计追溯（这张磅单/签收单/发票长什么样、可下载留档），操作日志=动作级审计追溯（谁在何时做了什么）；
- UI：新增单证归档视图 `/document`（统计卡：磅单/签收单/发票/合计；类型 + 关键字筛选 + 分页；单张预览 iframe / 下载 Blob / 批量导出 HTML）；路由注册于经营管理组，菜单授予调度员/结算专员/场站操作员（平台管理员/只读用户全量），`MENU_OPTIONS` 同步。

## 三、流程合理性评价

**合理的部分（保留的设计决策）**：
- 状态机集中 + 前置守卫 + 回卷联动（车次→计划→合同进度自动回卷），杜绝页面各改各的；
- 客户确认作为结算**硬闸门**、结算按**车次快照单价**（改价不追溯）、异常关闭**补扣结算**防损失漏扣——真实业务中最易出资金事故的三处都处理正确；
- 围栏/遥测/逾期由全局定时任务驱动（`src/mock/scheduler.js`），不依赖页面打开，等价后端 cron；
- 乐观锁"选择时版本快照 + 提交前二次校验"是后端事务的正确前端等价物。

**流程设计薄弱点（口径决策，非 bug）**：
- 在途推进只到 95%，**到达/卸货永远需要人工点击**——演示可接受，对接 GPS 后需定义自动到达判定；
- 合同量=计划量×1.1~1.3 的预留口径导致合同几乎不可能自动到 100%，必须走手动完结（已有入口，逻辑自洽）；
- 磅单固定 1.5% 损耗、过路费随机数——演示口径，对接后应为真实磅差与票据。

## 四、需要补充的环节（按闭环贡献排序）

1. ✅ **已补充（2026-08-17）签收硬拦截 + 补签入口**：`confirmSettle` 存在未签收公路车次时硬拦截（非公路豁免）；新增 `supplementReceipt` 补签入口（调度详情 + 结算详情对账明细，RBAC dispatch），补签后自动重建对账；`signReceipt` 补强"卸货完成前不可签收、不可重复签收"守卫；
2. ✅ **已补充（2026-08-17）客户异议流程**：新增 `customerObjection`（客户门户"异议"按钮）——异议单记录后账单回"待对账"并清除客户确认，须重新对账 + 客户再确认（确认时异议单自动关闭）；`customerConfirm` 收紧为仅"对账中"可确认，杜绝异议后跳过重新对账直接确认；
3. ✅ **已补充（2026-08-17）合同改价审批**：`changeContract` 单价变更转"变更审批"（部门审批 → 公司审批，复用审批链），新增 `approveContractChange`/`rejectContractChange`，全链通过才生效、驳回即作废；数量/截止日期变更仍即时生效；口径显式声明"已派车车次按派车时快照单价结算，改价仅影响未派车批次"（快照机制本已保证不追溯）；
4. ✅ **已补充（2026-08-18）质量/水分扣重**：卸货生成质检记录（水分/灰分），结算新增"质量扣减"扣减项（标准水分 10% / 灰分 15%，水分每超 1% 扣出磅净重 1.5%、灰分每超 1% 扣 1%），对账明细逐车次展示质量扣重并汇总；
5. ✅ **已补充（2026-08-18）预付款管理**：新增预付款台账（`db.prepayments`，收取/抵扣），`collectPrepayment` 收取（RBAC settlement）、`applyPrepayment` FIFO 抵扣账单未付余额（记收款流水，与 recordPayment 同守卫：已结算/逾期 + 票款一致拦截）；`creditCheck` 口径改为"（未付余额 - 可用预付款）+ 订单额 vs 授信"，预付冲减信用占用；
6. ✅ **已补充（2026-08-18）消息定向与免打扰**（对应 M4）：M4 定向已修复；本轮补免打扰（DND）——按登录账号设置（免打扰时段支持跨零点 + 消息类型屏蔽），免打扰消息不计入顶栏未读角标/消息中心未读数，列表内保留"免打扰"标记，设置存 `db.dnd` 随快照持久化；
7. ✅ **已补充（2026-08-18）库存预警**：新增安全库存台账（`db.safetyStocks`，仓库×商品 可发库存下限），`inventoryAlerts` 实时预警列表；出库/锁定/标记临期使可发库存**跌破下限（穿越阈值）**时写审计日志并定向通知仓储角色（已低于下限不重复告警）；`setSafetyStock` 设置入口（RBAC warehouse，upsert）；库存管理页"低于安全库存"统计卡 + 预警面板 + 安全库存设置弹窗；
8. ✅ **已补充（2026-08-18）数据权限**：RBAC 功能权限之外新增**行级数据权限**（`db.dataScopes` 按登录账号，按装货侧场站区域过滤）；`visibleDispatches`/`visiblePlans` 行级过滤（调度/计划/在途监控列表统一口径），合同/结算单经合同装货侧区域派生；`setDataScope` 设置入口（RBAC user，平台管理员恒全量、不可被限制）；用户管理"数据范围"列 + 设置弹窗；调度/计划/在途列表与顶栏显示数据范围标签；种子调度员 user02 仅华北（登录页提示）；
9. ✅ **已补充（2026-08-18）登录安全**：失败锁定已修复（M8）；本轮补验证码 + 密码加密——登录页图形验证码（`generateCaptcha` 一次性/60 秒有效/SVG 渲染，`verifyCaptcha` 消费式校验）+ 密码哈希（用户表 `password` 改 `passwordHash`，SHA-256 不落明文，`login` 服务层按哈希比对 + 验证码 + 账号状态，审计日志下沉服务层）；`saveUser` 新建用户同口径哈希；快照版本 9→10；
10. ✅ **已补充（2026-08-18）电子单证归档**：新增单证归档视图（`/document`，磅单/签收单/发票三类电子单证统一聚合，类型/关键字筛选 + 分页），`document.js` 派生服务层（`listDocuments`/`documentOf`/`documentContent` 生成可下载/可打印 HTML 电子单证，与操作日志互补——单证归档=单据级、操作日志=动作级审计追溯）；支持单张预览（iframe）/下载（Blob）/批量导出；菜单授予调度员/结算专员/场站操作员（平台管理员/只读用户全量）。

## 五、对接 API 阶段的提醒

前两轮"架构下沉"结论经实测基本成立（flow.js 每函数≈一 endpoint），补充两点：
- **先修 N-1 / N-2 再对接**：这两个缺陷在服务层，直接照搬 flow.js 会把 bug 带进后端（均已修复）；
- `operator` 默认 admin（`flow.js:55`）的兜底口径对接后必须改为"无登录态拒绝"（M7 已实现登出 `clearOperator` + 刷新按登录态恢复，默认 admin 兜底现仅用于冒烟测试无登录态直调服务层），定时任务类调用应使用独立的系统身份。

## 六、追溯索引

- 第一/二轮审计发现的闭环断点（N1-N5）、产品完整度缺口（G1-G8）、架构下沉（P2）均已于 2026-08-16 修复并回归，明细见 git 历史（`feat: P0/P1/P2` 系列提交）与本文档历史版本；
- **2026-08-17（N-1 修复，a 方案）**：`npm run build` 通过；lint 无错误；冒烟测试 231/231 通过（223→231，新增第 16 节 8 项 N-1 断言）；UI e2e 46/46 通过（39→46，新增场景 14：司机手机号登录全链路扫码）。改动文件：`src/mock/flow.js`（`doDepart`/`doArrive` 内部核心拆分、`scanConfirmLoad/Unload` 改调内部核心、新增 `driverDepart`/`driverArrive` 司机端入口、模块头注释）、`src/views/driver/app.vue`（改用司机端入口）、`scripts/verify-flow.mjs`（第 16 节）、`scripts/verify-ui.mjs`（场景 14）。口径：司机端入口（扫码/发车/到达/接单/签收）走内部核心，状态机守卫与 PC 端一致，不做登录用户 RBAC（等价后端司机 App 独立鉴权）；PC 端入口 RBAC 不变。
- **2026-08-17（N-2 修复，推荐方案）**：`npm run build` 通过；lint 无错误；冒烟测试 238/238 通过（231→238，新增第 17 节 7 项 N-2 断言）；UI e2e 46/46 通过。改动文件：`src/mock/flow.js`（`BUSY_STATUSES` 扩为全部非终态、`recalcAll` 新增车辆/司机状态与实际执行对齐）、`src/mock/persist.js`（VERSION 7→8）、`src/views/plan/list.vue`、`src/views/plan/detail.vue`（选车下拉改用 `BUSY_STATUSES` 常量）、`scripts/verify-flow.mjs`（第 17 节）。口径：未完结=全部非终态（待装货/装货中/在途/卸货中/异常），与 `releaseResource` 的 `ACTIVE` 口径互补（占用判定含待装货/异常，释放判定看执行中）；种子状态校准只对齐"执行中↔占用"，不触碰维修/报废/停用。
- **2026-08-17（M1-M4 修复）**：`npm run build` 通过；lint 无错误；冒烟测试 252/252 通过（238→252，新增第 18 节 14 项 M1-M4 断言）；UI e2e 46/46 通过。改动文件：`src/mock/flow.js`（`settlementCandidates` 预览运费改 `calcSettlementFees` 同口径、`buildReconciliation` 逐车次快照价折算（比对项增 `price`）、`warehouseOut` 充足性守卫 + 跨批次 FIFO（守卫前置到状态流转前）、`notify` 增 `to` 定向 + `rolesWithAction`/`toRoles`/`visibleMessages`、`markMessageRead`/`markAllMessagesRead` 可见性守卫、21 处运行期消息定向）、`src/mock/message.js`（种子消息定向）、`src/views/message/index.vue` + `src/layout/components/Navbar.vue`（改用 `visibleMessages`）、`src/mock/persist.js`（VERSION 8→9）、`scripts/verify-flow.mjs`（第 18 节）。口径：预览/对账/结算三处金额统一"车次快照单价 × 出磅净重"，合同改价不追溯；出库守卫"有批次才联动，联动则须充足，充足则 FIFO"；消息定向按 RBAC 操作码推导角色（审批→contract-approve+contract、结算→settlement、异常→exception、调度→dispatch、需求→contract、导入→对应模块），系统通知广播，平台管理员可见全部。
- **2026-08-17（M5-M8 修复）**：`npm run build` 通过；lint 无错误；冒烟测试 267/267 通过（252→267，新增第 19 节 15 项 M5-M8 断言）；UI e2e 48/48 通过（46→48，新增场景 15：登录失败锁定）。改动文件：`src/mock/flow.js`（`markInvoiceStale` + `closeException`/`recalcSettlement` 触发 + `recordPayment` 陈旧发票拦截收款、`requireDriverApp` 司机端身份守卫覆盖 6 个入口、`setOperator` 增记 `driverId`、新增 `clearOperator`）、`src/store/index.js`（`logout` 调 `clearOperator`）、`src/main.js`（启动按持久化登录态恢复 operator）、`src/views/login/index.vue`（M8 失败锁定：5 次/5 分钟、按账号持久化、倒计时 UI）、`src/views/settlement/invoice.vue` + `src/views/settlement/detail.vue`（金额陈旧标记展示）、`scripts/alias-loader.mjs`（支持 `@/` 子路径别名，store 引入 `@/mock/flow` 后 Node 冒烟可解析）、`scripts/verify-flow.mjs`（第 19 节）、`scripts/verify-ui.mjs`（场景 15）。口径：票款一致——陈旧发票未红冲重开前不可收款，红冲重开后新发票按当前账单额开具；司机端入口=司机 App 独立鉴权（本人司机或持 dispatch 权限的演示切换），PC 角色一律拦截；登出=未登录态默认拒绝，刷新恢复真实登录人；快照版本维持 9（M5-M8 均为增量字段/运行态，无结构破坏）。
- **2026-08-17（环节 1-3 补充）**：`npm run build` 通过；lint 无错误；冒烟测试 288/288 通过（267→288，新增第 20 节 18 项环节 1-3 断言 + 既有节适配：第 2 节签收、P3-5 卸货前不可签收守卫、第 8 节补签前置、第 10 节"对账中"口径、N3/M1 改价走审批）；UI e2e 56/56 通过（48→56，新增场景 16：补签入口全链路、改价提交→待批面板→两级审批生效、客户异议提交→"已异议·待重新对账"）。改动文件：`src/mock/flow.js`（`confirmSettle` 签收硬拦截、`supplementReceipt` 补签、`signReceipt` 状态/重复守卫、`customerObjection` 异议 + `customerConfirm` 收紧"对账中"且确认时关闭异议单、`changeContract` 改价转审批 + `applyContractFields` 抽取 + `approveContractChange`/`rejectContractChange` + `extendContract` 待批守卫）、`src/mock/base.js`（`ROAD_MODES`/`isRoadMode` 下沉，flow re-export）、`src/mock/dispatch.js`（种子电子签收 90%）、`src/mock/exception.js`（已完成车次异常损失上限，修复负账单）、`src/views/dispatch/detail.vue`（补签按钮/弹窗/标记）、`src/views/settlement/detail.vue`（对账明细补签列/异议警示/文案）、`src/views/settlement/list.vue`（文案）、`src/views/portal/index.vue`（异议按钮/弹窗/标签）、`src/views/contract/detail.vue`（变更待审批面板/审批弹窗/变更提示）、`src/views/contract/list.vue`（变更提示/待批消息）、`scripts/verify-flow.mjs`（第 20 节 + 既有节适配）、`scripts/verify-ui.mjs`（场景 16）。口径：签收=结算收货依据（公路硬拦截、非公路豁免、补签带原因留痕）；异议=重新对账（回待对账+清确认，再确认后异议单关闭，确认仅"对账中"可执行）；改价=审批制（部门→公司，驳回作废，快照价保证不追溯）；快照版本维持 9（均为增量字段/运行态）。
- **2026-08-18（环节 4-6 补充）**：`npm run build` 通过；lint 无错误；冒烟测试 317/317 通过（288→317，新增第 21 节 29 项环节 4-6 断言 + 既有节适配：结算单金额恒等式含质量扣减）；UI e2e 66/66 通过（56→66，新增场景 17：质量扣减费用项/对账列、预付款台账+收取+抵扣、消息免打扰设置+标记+持久化）。改动文件：`src/mock/flow.js`（`QUALITY_STANDARD`/`QUALITY_RATE`/`qualityDeductionQty`、`doConfirmUnload` 质检记录、`calcSettlementFees` 质量扣减项、`totalAmount` 公式×2、`buildReconciliation` 质量扣重列+汇总、`db.prepayments` 台账函数 `prepaymentOf`/`prepaymentAvailable`/`collectPrepayment`/`applyPrepayment`（FIFO+票款一致守卫）、`creditCheck` 预付冲减口径、`db.dnd` 免打扰 `getDnd`/`setDnd`/`isMuted`/`unreadCount`）、`src/mock/base.js`（`db.prepayments`/`db.dnd`）、`src/mock/dispatch.js`（种子质检记录）、`src/mock/customer.js`（种子预付款台账）、`src/mock/settlement.js`（种子总额公式）、`src/views/dispatch/detail.vue`（质检展示）、`src/views/settlement/detail.vue`（质量扣减费用行/对账列/确认提示 + 预付款抵扣按钮/弹窗）、`src/views/customer/detail.vue`（预付款台账面板/收取弹窗/授信占用口径）、`src/views/portal/index.vue`（可用预付款卡/授信占用口径）、`src/views/message/index.vue`（免打扰设置弹窗/免打扰标记/未读口径）、`src/layout/components/Navbar.vue`（角标 DND 口径）、`scripts/verify-flow.mjs`（第 21 节 + 恒等式适配）、`scripts/verify-ui.mjs`（场景 17）。口径：质量扣重=出磅净重×超标系数（水分 1.5%/1%、灰分 1%/1%，标准 10%/15%），非公路/未质检不扣；预付款=客户预付货款（FIFO 抵扣账单、冲减信用占用，与收款同守卫）；免打扰=按账号（时段跨零点+类型屏蔽），免打扰消息不计未读角标、列表留标记；快照版本维持 9（均为增量字段/运行态）。
- **2026-08-18（环节 7-8 补充）**：`npm run build` 通过；lint 无错误；冒烟测试 341/341 通过（317→341，新增第 22 节 24 项环节 7-8 断言）；UI e2e 74/74 通过（66→74，新增场景 18：安全库存预警面板+设置持久化、user02 华北行级过滤标签+分页总数）。改动文件：`src/mock/flow.js`（`safetyStockOf`/`availableStockOf`/`inventoryAlerts`/`setSafetyStock` + `checkInventoryAlert` 穿越阈值告警（`warehouseOut`/`setInventoryStatus` 触发）、`DATA_REGIONS`/`dataScopeOf`/`recordRegion`/`inDataScope`/`visibleDispatches`/`visiblePlans`/`setDataScope`）、`src/mock/base.js`（`db.safetyStocks`/`db.dataScopes`）、`src/mock/warehouse.js`（种子安全库存台账，确定性派生不消耗 rng + 强制 1 组合低于下限）、`src/mock/system.js`（种子 user02 华北数据范围）、`src/views/warehouse/inventory.vue`（低于安全库存卡/预警面板/安全库存列/设置弹窗）、`src/views/dispatch/list.vue` + `src/views/plan/list.vue` + `src/views/track/index.vue`（行级过滤 + 数据范围标签）、`src/views/system/user.vue`（数据范围列/设置弹窗）、`src/layout/components/Navbar.vue`（顶栏数据范围标签）、`src/views/login/index.vue`（演示账号提示）、`scripts/verify-flow.mjs`（第 22 节）、`scripts/verify-ui.mjs`（场景 18）。口径：安全库存=仓库×商品可发库存下限，跌破（穿越阈值）才告警且定向仓储角色，已低于不重复；数据权限=按账号行级（装货侧区域），平台管理员恒全量不可限制，空范围=全量，合同/结算经合同装货侧派生；快照版本维持 9（均为增量字段/运行态）。
- **2026-08-18（环节 9-10 补充）**：`npm run build` 通过；lint 无错误；冒烟测试 361/361 通过（341→361，新增第 23 节 20 项环节 9-10 断言）；UI e2e 82/82 通过（74→82，新增场景 19：登录验证码渲染/错误拒绝/正确登录、单证归档页+菜单+类型筛选+预览+下载 Blob）。改动文件：`src/utils/index.js`（`sha256Hex` 纯 JS 同步 SHA-256 + `hashPassword`）、`src/mock/flow.js`（`generateCaptcha`/`verifyCaptcha`/`login` 登录服务层 + `saveUser` 密码哈希）、`src/mock/system.js`（种子用户 `password`→`passwordHash`）、`src/mock/persist.js`（VERSION 9→10）、`src/views/login/index.vue`（验证码输入框 + 刷新 SVG + 服务层登录 + M8 衔接）、`src/mock/document.js`（新增：`DOC_TYPES`/`listDocuments`/`documentOf`/`documentContent` 电子单证派生服务层）、`src/views/document/archive.vue`（新增：单证归档视图，统计卡/筛选/分页/预览/下载/批量导出）、`src/router/index.js`（`/document` 路由）、`src/permission-table.js`（`/document` 菜单授予调度员/结算专员/场站操作员 + `MENU_OPTIONS`）、`scripts/verify-flow.mjs`（第 23 节）、`scripts/verify-ui.mjs`（场景 19 + login 工具自动填验证码）。口径：密码=SHA-256 哈希不落明文（`blms:` 前缀），验证码=一次性/60 秒/SVG 渲染（运行态不持久化），登录=服务层单点校验（验证码→哈希→账号状态，审计下沉），验证码/凭据失败计入 M8 锁定（停用不计）；单证归档=磅单/签收单/发票派生聚合（单证数=源记录数），`documentContent` 生成可下载/可打印 HTML 电子单证，与操作日志互补（单据级 vs 动作级审计追溯）；快照版本 9→10（用户结构变更）。
- 当前验证基线（2026-08-18）：`npm run build` 通过；lint 无错误；冒烟测试 361/361 通过；UI e2e 82/82 通过；N-1、N-2、M1-M8 均已修复并回归，第四节待补充环节 1-10 已全部补充并回归（登录安全：验证码+密码哈希；电子单证归档：磅单/签收单/发票统一归档可下载）。
