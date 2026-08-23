import { db, rng, randomName, tareOf, loadVarianceOf } from './base'
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
  // P2 进磅实际过磅：装货过磅净重 = 调度量 × (1 ± 0.5%)（实际过磅值，非恒等于调度量）
  const inNet = round(d.quantity * (1 + loadVarianceOf(d.id)), 2)

  if (d.loadTime) {
    db.weighings.push({
      id: nextBz(),
      dispatchId: d.id,
      plate: vehicle ? vehicle.plate : '-',
      terminalId: d.loadTerminalId,
      type: '进磅',
      gross: round(tare + inNet, 2),
      tare,
      net: inNet,
      time: d.loadTime,
      operator: randomName()
    })
  }
  if (d.unloadTime) {
    const loss = round(inNet * (0.01 + rng() * 0.02), 2) // 运输损耗 1-3%（按进磅净重）
    const outNet = round(inNet - loss, 2)
    db.weighings.push({
      id: nextBz(),
      dispatchId: d.id,
      plate: vehicle ? vehicle.plate : '-',
      terminalId: d.unloadTerminalId,
      type: '出磅',
      gross: round(tare + outNet, 2),
      tare,
      net: outNet,
      time: d.unloadTime,
      operator: randomName()
    })
  }
}

// 按时间倒序
db.weighings.sort((a, b) => (a.time < b.time ? 1 : -1))
