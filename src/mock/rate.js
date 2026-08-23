import { db, ROUTES, genId } from './base'

/**
 * P2 运价管理：线路运价表种子
 * 按 线路(装/卸场站) × 商品 × 公路 生成运价卡，单价由里程确定性派生（不消耗全局 RNG 流，
 * 避免扰动下游种子数据）。合同新建/变更可查表取价（rateOf），运价卡支持调价/启停（flow.js）。
 */

/** 里程 → 运价（元/吨）：基础 25 + 里程×0.035，保留 1 位（120km≈29，1200km≈67） */
function ratePriceOf(distance) {
  return Math.round((25 + distance * 0.035) * 10) / 10
}

export function seedRateCards() {
  const effectiveDate = '2026-01-01'
  for (const route of ROUTES) {
    for (const commodityId of route.commodityIds) {
      db.rateCards.push({
        id: genId('YJ-', 3, db.rateCards),
        commodityId,
        loadTerminalId: route.from,
        unloadTerminalId: route.to,
        mode: '公路',
        unitPrice: ratePriceOf(route.distance),
        effectiveDate,
        status: 'active',
        remark: `线路运价（${route.distance}km）`,
        history: []
      })
    }
  }
}

seedRateCards()
