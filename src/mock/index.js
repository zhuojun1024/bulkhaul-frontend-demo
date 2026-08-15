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
import './plan'
import './dispatch'
import './weighing'
import './warehouse'
import './settlement'
import './exception'
import './safety'
import './system'
import { dashboard, workbenchTodos, notices } from './dashboard'

export { db, dashboard, workbenchTodos, notices }
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
