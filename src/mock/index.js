/**
 * 数据入口（薄客户端，Phase 4 F3）
 *
 * 内存引擎与种子数据已移除：db 由后端 /api/snapshot 填充（refreshDb / hydrate），
 * 后端为唯一权威态。本入口仅保留 db、看板聚合（dashboard，历史趋势为种子随机、
 * 实时指标为 getter）与常用查找函数（find，基于后端填充的 db）。
 */
import { db } from './base'
import { dashboard, workbenchTodos, weatherOf, workbenchStats, workbenchTodoList, announcements } from './dashboard'

export { db, dashboard, workbenchTodos, weatherOf, workbenchStats, workbenchTodoList, announcements }
export { MAP_NODES, ROUTES } from './base'

/** 常用查找函数（基于后端 hydrate 后的 db） */
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
