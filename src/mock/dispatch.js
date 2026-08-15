import { db, rng, randInt, NOW, ROUTES } from './base'
import dayjs from 'dayjs'
import { round } from '@/utils'

/**
 * 调度单：计划按车次拆分下发到具体车辆/司机（每车 30-40 吨）
 * 车次状态与计划状态保持一致：
 *   计划已完成 → 车次全部完成
 *   计划执行中 → 部分完成 + 在途/装货/卸货 + 少量待装/异常
 *   计划已调度 → 车次全部待装货
 */
const roadVehicles = db.vehicles.filter((v) => v.type !== '铁路敞车' && v.type !== '散货船')
const inuseVehicles = roadVehicles.filter((v) => v.status === 'inuse')
const idleVehicles = roadVehicles.filter((v) => v.status === 'idle')
const ondutyDrivers = db.drivers.filter((d) => d.status === 'onduty')
const availableDrivers = db.drivers.filter((d) => d.status === 'available')

const executablePlans = db.plans.filter((p) => p.status !== 'cancelled' && p.status !== 'pending')

function routeOf(plan) {
  return ROUTES.find((r) => r.from === plan.loadTerminalId && r.to === plan.unloadTerminalId) || ROUTES[0]
}

let vi = 0
let di = 0
function takeVehicle(pool) {
  const v = pool[vi % pool.length]
  vi += 1
  return v
}
function takeDriver(pool) {
  const d = pool[di % pool.length]
  di += 1
  return d
}

/** 按车次状态取车辆/司机池 */
function poolFor(status) {
  if (['intransit', 'loading', 'unloading'].includes(status)) {
    return { v: inuseVehicles, d: ondutyDrivers }
  }
  if (status === 'completed' || status === 'exception') {
    return { v: roadVehicles, d: availableDrivers.length ? availableDrivers : ondutyDrivers }
  }
  return {
    v: idleVehicles.length ? idleVehicles : roadVehicles,
    d: availableDrivers.length ? availableDrivers : ondutyDrivers
  }
}

/** 计划执行中时，按随机权重分配单个车次状态 */
function statusOf(plan) {
  if (plan.status === 'completed') return 'completed'
  if (plan.status === 'dispatched') return 'pending'
  const r = rng()
  if (r < 0.4) return 'completed'
  if (r < 0.68) return 'intransit'
  if (r < 0.8) return 'loading'
  if (r < 0.9) return 'unloading'
  if (r < 0.97) return 'pending'
  return 'exception'
}

db.dispatches = []
let dSeq = 0

for (const plan of executablePlans) {
  const route = routeOf(plan)
  const n = Math.max(1, Math.round(plan.quantity / 35))
  const base = Math.round(plan.quantity / n)
  const speed = randInt(40, 68)
  const travelHours = round(route.distance / speed, 1)

  for (let i = 0; i < n; i++) {
    dSeq += 1
    const status = statusOf(plan)
    const quantity = Math.max(30, base + randInt(-2, 2))

    let dispatchTime
    let loadTime = null
    let unloadTime = null
    let progress = 0
    let eta = null

    if (status === 'completed') {
      dispatchTime = dayjs(NOW).subtract(randInt(1, 25), 'day').hour(randInt(6, 18)).minute(randInt(0, 59))
      loadTime = dispatchTime.add(40, 'minute')
      unloadTime = loadTime.add(Math.round(travelHours * 60) + randInt(10, 60), 'minute')
      progress = 100
    } else if (status === 'intransit') {
      dispatchTime = dayjs(NOW).subtract(randInt(2, 30), 'hour').minute(randInt(0, 59))
      loadTime = dispatchTime.add(40, 'minute')
      progress = randInt(10, 90)
      const remainHours = round((1 - progress / 100) * travelHours, 1)
      eta = dayjs(NOW).add(Math.round(remainHours * 60), 'minute')
    } else if (status === 'loading') {
      dispatchTime = dayjs(NOW).subtract(randInt(1, 5), 'hour').minute(randInt(0, 59))
      progress = 5
      eta = dispatchTime.add(Math.round((travelHours + 1) * 60), 'minute')
    } else if (status === 'pending') {
      dispatchTime = dayjs(NOW).hour(randInt(8, 18)).minute(randInt(0, 59))
      eta = dispatchTime.add(Math.round((travelHours + 2) * 60), 'minute')
    } else if (status === 'unloading') {
      dispatchTime = dayjs(NOW).subtract(randInt(8, 20), 'hour').minute(randInt(0, 59))
      loadTime = dispatchTime.add(40, 'minute')
      progress = 96
      eta = dayjs(NOW).add(randInt(20, 80), 'minute')
    } else {
      // exception
      dispatchTime = dayjs(NOW).subtract(randInt(2, 72), 'hour').minute(randInt(0, 59))
      loadTime = dispatchTime.add(40, 'minute')
      progress = randInt(10, 80)
    }

    const { v, d } = poolFor(status)
    const vehicle = takeVehicle(v)
    const driver = takeDriver(d)

    db.dispatches.push({
      id: `PD-${String(dSeq).padStart(5, '0')}`,
      planId: plan.id,
      contractId: plan.contractId,
      commodityId: plan.commodityId,
      quantity,
      loadTerminalId: plan.loadTerminalId,
      unloadTerminalId: plan.unloadTerminalId,
      vehicleId: vehicle.id,
      driverId: driver.id,
      distance: route.distance,
      status,
      dispatchTime: dispatchTime.format('YYYY-MM-DD HH:mm'),
      loadTime: loadTime ? loadTime.format('YYYY-MM-DD HH:mm') : null,
      unloadTime: unloadTime ? unloadTime.format('YYYY-MM-DD HH:mm') : null,
      progress,
      speed: status === 'intransit' ? speed : 0,
      eta: eta ? eta.format('YYYY-MM-DD HH:mm') : null,
      fee: Math.round(quantity * plan.unitPrice)
    })
  }
}

/** 演示兜底：保证在途/异常车次数量，供在途监控与异常处理模块展示（计划状态由 flow.recalcAll 自动校准） */
function toIntransit(d) {
  d.status = 'intransit'
  d.speed = randInt(40, 68)
  d.progress = randInt(10, 90)
  d.dispatchTime = dayjs(NOW).subtract(randInt(2, 12), 'hour').minute(randInt(0, 59)).format('YYYY-MM-DD HH:mm')
  d.loadTime = dayjs(d.dispatchTime).add(40, 'minute').format('YYYY-MM-DD HH:mm')
  d.eta = dayjs(NOW).add(randInt(1, 8), 'hour').format('YYYY-MM-DD HH:mm')
}
function ensureCount(status, min, fromStatuses, convert) {
  let count = db.dispatches.filter((d) => d.status === status).length
  for (const d of db.dispatches) {
    if (count >= min) break
    if (fromStatuses.includes(d.status)) {
      convert(d)
      count++
    }
  }
}
ensureCount('intransit', 15, ['pending', 'loading', 'unloading'], toIntransit)
ensureCount('exception', 7, ['intransit', 'loading', 'unloading'], (d) => {
  d.status = 'exception'
  d.speed = 0
})
