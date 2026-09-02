/**
 * 数据入口（薄客户端，Phase 4 F3）
 *
 * 内存引擎与种子数据已移除：db 由后端 /api/snapshot 填充（refreshDb / hydrate），
 * 后端为唯一权威态。本入口仅保留 db、看板聚合（dashboard，历史趋势为种子随机、
 * 实时指标为 getter）与地图常量（MAP_NODES/ROUTES）。
 * 交叉引用查找（find）已下沉到各视图（仅声明本视图用到的键）。
 */
import { db } from './base'
import { dashboard, workbenchTodos, weatherOf, workbenchStats, workbenchTodoList, announcements } from './dashboard'

export { db, dashboard, workbenchTodos, weatherOf, workbenchStats, workbenchTodoList, announcements }
export { MAP_NODES, ROUTES } from './base'
