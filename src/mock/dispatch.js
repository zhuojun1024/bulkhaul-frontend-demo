import { db, randInt, pick, NOW, ROUTES } from './base'
import dayjs from 'dayjs'
import { round } from '@/utils'

/**
 * 调度单：计划下发到具体车辆/司机
 * 状态分布：completed 45 / intransit 20 / loading 8 / pending 10 / unloading 5 / exception 7
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

const statusPlan = []
for (let i = 0; i < 45; i++) statusPlan.push('completed')
for (let i = 0; i < 20; i++) statusPlan.push('intransit')
for (let i = 0; i < 8; i++) statusPlan.push('loading')
for (let i = 0; i < 10; i++) statusPlan.push('pending')
for (let i = 0; i < 5; i++) statusPlan.push('unloading')
for (let i = 0; i < 7; i++) statusPlan.push('exception')

db.dispatches = statusPlan.map((status, i) => {
  const plan = executablePlans[i % executablePlans.length]
  const route = routeOf(plan)
  const quantity = pick([30, 32, 35, 38, 40])
  const speed = randInt(40, 68)

  let dispatchTime
  let loadTime = null
  let unloadTime = null
  let progress = 0
  let eta = null

  const travelHours = round(route.distance / speed, 1)

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

  const vehicle =
    status === 'intransit' || status === 'loading' || status === 'unloading'
      ? takeVehicle(inuseVehicles)
      : status === 'completed' || status === 'exception'
        ? takeVehicle(roadVehicles)
        : takeVehicle(idleVehicles.length ? idleVehicles : roadVehicles)
  const driver =
    status === 'intransit' || status === 'loading' || status === 'unloading'
      ? takeDriver(ondutyDrivers)
      : takeDriver(availableDrivers.length ? availableDrivers : ondutyDrivers)

  return {
    id: `PD-${String(i + 1).padStart(5, '0')}`,
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
  }
})
