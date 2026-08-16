import { db, randInt, pick, randomName, randomPhone, NOW } from './base'
import dayjs from 'dayjs'
import { mulberry32, round } from '@/utils'

// 独立的评分随机源，避免与主序列耦合
const rng2 = mulberry32(99)

db.drivers = Array.from({ length: 80 }, (_, i) => {
  const status = i < 22 ? 'onduty' : i < 55 ? 'available' : i < 65 ? 'rest' : 'disabled'
  const licenseExpire = dayjs(NOW).add(randInt(-30, 700), 'day').format('YYYY-MM-DD')
  return {
    id: `D${String(i + 1).padStart(3, '0')}`,
    name: randomName(),
    phone: randomPhone(),
    licenseType: pick(['A2', 'B2']),
    licenseNo: '140101' + String(randInt(19600101, 19991231)),
    licenseExpire,
    status,
    version: 1, // 乐观锁版本（P2：派车占用提交前二次校验，防并发超占）
    rating: round(4 + rng2(), 1),
    totalTrips: randInt(50, 2000),
    totalMileage: randInt(5, 300) * 10000,
    joinDate: dayjs(NOW).subtract(randInt(3, 60), 'month').format('YYYY-MM-DD'),
    emergencyContact: randomName() + ' ' + randomPhone(),
    remark: ''
  }
})
