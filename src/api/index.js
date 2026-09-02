/**
 * API 层门面（薄客户端）：统一出口，导入方一律 from '@/api'（38 处导入零改动）。
 * 拆分：client（HTTP 客户端）/ snapshot（快照同步）/ endpoints（W 写端点映射）/ write（写钩子 + 乐观锁 + 写后失效）。
 */
export { USE_API, api } from './client'
export { refreshDb, hydrate } from './snapshot'
export { W } from './endpoints'
export { afterWrite } from './write'
