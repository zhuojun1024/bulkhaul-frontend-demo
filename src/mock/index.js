/**
 * Mock 数据入口
 * 按依赖顺序导入各业务域，最终统一导出 db 与聚合数据
 */
import { db } from './base'
import './commodity'
import './customer'
import './terminal'
import './vehicle'
import './driver'
import './contract'
import './request' // 客户运输需求（依赖 customers/contracts）
import './plan'
import './dispatch'
import './weighing'
import './warehouse'
import './exception'
import './settlement' // 依赖异常单（异常损失扣减），需在 exception 之后
import './bank' // 银行流水（依赖 settlements/payments，G8 收款核销）
import './safety'
import './system'
import './message' // 消息中心种子（依赖 contracts/settlements/exceptions/dispatches，G6）
import './flow' // 业务流转中枢：导入时执行全量校准（计划/合同进度对齐实际执行）
import { dashboard, workbenchTodos, weatherOf, workbenchStats, workbenchTodoList } from './dashboard'
import { hydrateDb } from './persist'

// 持久化：种子数据加载完成后，若存在同版本快照则恢复（刷新不丢数据）
hydrateDb()

export { db, dashboard, workbenchTodos, weatherOf, workbenchStats, workbenchTodoList }
export { MAP_NODES, ROUTES } from './base'

/** 常用查找函数 */
export const find = {
  commodity: (id) => db.commodities.find((c) => c.id === id),
  customer: (id) => db.customers.find((c) => c.id === id),
  terminal: (id) => db.terminals.find((t) => t.id === id),
  vehicle: (id) => db.vehicles.find((v) => v.id === id),
  driver: (id) => db.drivers.find((d) => d.id === id),
  contract: (id) => db.contracts.find((c) => c.id === id),
  plan: (id) => db.plans.find((p) => p.id === id),
  dispatch: (id) => db.dispatches.find((d) => d.id === id),
  warehouse: (id) => db.warehouses.find((w) => w.id === id),
  settlement: (id) => db.settlements.find((s) => s.id === id),
  exception: (id) => db.exceptions.find((e) => e.id === id)
}
