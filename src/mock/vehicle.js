import { db, randInt, pick, randomPlate, NOW } from './base'
import dayjs from 'dayjs'

const VEHICLE_TYPES = ['重型半挂车', '重型自卸车', '罐式运输车', '铁路敞车', '散货船']

db.vehicles = Array.from({ length: 60 }, (_, i) => {
  const isRoad = i < 44
  const type = isRoad ? pick(['重型半挂车', '重型自卸车', '罐式运输车']) : pick(VEHICLE_TYPES.slice(3))
  const status =
    i < 22 ? 'inuse' : i < 40 ? 'idle' : i < 48 ? 'maintenance' : i < 55 ? 'overload' : 'scrapped'
  const purchaseDate = dayjs(NOW).subtract(randInt(3, 120), 'month').format('YYYY-MM-DD')
  return {
    id: `V${String(i + 1).padStart(3, '0')}`,
    plate: isRoad ? randomPlate() : type === '铁路敞车' ? `C80-${1000 + i}` : `冀货${2000 + i}号`,
    type,
    capacity: isRoad ? pick([30, 32, 35, 40]) : type === '铁路敞车' ? 80 : 5000,
    owner: i % 3 === 0 ? '自有' : '外协',
    fuelType: isRoad ? pick(['柴油', 'LNG']) : type === '铁路敞车' ? '电力' : '重油',
    status,
    version: 1, // 乐观锁版本（P2：派车占用提交前二次校验，防并发超占）
    purchaseDate,
    nextInspection: dayjs(NOW).add(randInt(10, 300), 'day').format('YYYY-MM-DD'),
    mileage: randInt(2, 45) * 10000,
    monthlyCost: isRoad ? randInt(8000, 22000) : 0,
    remark: ''
  }
})
