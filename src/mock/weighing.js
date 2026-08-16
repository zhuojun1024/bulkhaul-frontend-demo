import { db, rng, randomName, tareOf } from './base'
import { round } from '@/utils'

/**
 * 磅单：进磅（装货场站）+ 出磅（卸货场站）
 * 已完成/在途/卸货中的调度单生成进磅，已完成/卸货中生成出磅
 */
let bzSeq = 0
function nextBz() {
  bzSeq += 1
  return `BZ-${String(bzSeq).padStart(5, '0')}`
}

db.weighings = []

for (const d of db.dispatches) {
  const vehicle = db.vehicles.find((v) => v.id === d.vehicleId)
  const tare = tareOf(vehicle) // 皮重按车辆确定性派生，与运行时补录口径一致

  if (d.loadTime) {
    db.weighings.push({
      id: nextBz(),
      dispatchId: d.id,
      plate: vehicle ? vehicle.plate : '-',
      terminalId: d.loadTerminalId,
      type: '进磅',
      gross: round(tare + d.quantity, 2),
      tare,
      net: d.quantity,
      time: d.loadTime,
      operator: randomName()
    })
  }
  if (d.unloadTime) {
    const loss = round(d.quantity * (0.01 + rng() * 0.02), 2) // 运输损耗 1-3%
    db.weighings.push({
      id: nextBz(),
      dispatchId: d.id,
      plate: vehicle ? vehicle.plate : '-',
      terminalId: d.unloadTerminalId,
      type: '出磅',
      gross: round(tare + d.quantity - loss, 2),
      tare,
      net: round(d.quantity - loss, 2),
      time: d.unloadTime,
      operator: randomName()
    })
  }
}

// 按时间倒序
db.weighings.sort((a, b) => (a.time < b.time ? 1 : -1))
