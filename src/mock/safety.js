import { db, randInt, pick, pickN, randomName, NOW } from './base'
import dayjs from 'dayjs'

/** 事故记录（近一年） */
const accidentTypes = ['碰撞', '侧翻', '火灾', '泄漏', '其他']
db.accidents = Array.from({ length: 15 }, (_, i) => {
  const level = i < 3 ? '重大' : i < 9 ? '较大' : '一般'
  const vehicle = db.vehicles[randInt(0, db.vehicles.length - 1)]
  const time = dayjs(NOW).subtract(randInt(10, 350), 'day')
  return {
    id: `SG-${String(i + 1).padStart(3, '0')}`,
    time: time.format('YYYY-MM-DD'),
    type: pick(accidentTypes),
    level,
    vehicleId: vehicle.id,
    plate: vehicle.plate,
    location: pick(['G6 京藏高速 K234', 'G18 荣乌高速 K89', 'G55 二广高速 K412', '场站内', 'S30 省道', 'G25 长深高速 K156']),
    description: pick([
      '夜间视线不良追尾前车',
      '弯道超速侧翻，货物洒落',
      '制动系统故障导致事故',
      '罐体泄漏，紧急疏散',
      '装载物固定不牢散落'
    ]),
    handling: pick([
      '已赔付并结案，车辆返厂检修',
      '保险理赔中',
      '已整改，司机停岗培训',
      '已结案，列入安全警示案例'
    ]),
    loss: level === '重大' ? randInt(30, 120) * 10000 : level === '较大' ? randInt(8, 30) * 10000 : randInt(1, 8) * 10000,
    status: i < 12 ? 'closed' : 'handling'
  }
})

/** 种子联动：事故类异常单与事故记录双向关联（exceptionId/accidentId），对齐车辆/级别/时间，消除两模块孤岛 */
const levelToAccident = { high: '重大', medium: '较大', low: '一般' }
db.exceptions
  .filter((e) => e.type === 'accident' && !e.accidentId)
  .forEach((e, i) => {
    const a = db.accidents[i]
    if (!a || a.exceptionId) return
    const d = db.dispatches.find((x) => x.id === e.dispatchId)
    a.exceptionId = e.id
    e.accidentId = a.id
    a.time = e.occurTime.slice(0, 10)
    a.level = levelToAccident[e.level] || a.level
    a.loss = e.cost || a.loss
    if (e.status === 'closed') {
      a.status = 'closed'
      a.handling = e.result || a.handling
    }
    if (d && d.vehicleId) {
      a.vehicleId = d.vehicleId
      a.plate = db.vehicles.find((v) => v.id === d.vehicleId)?.plate || a.plate
    }
  })

/** 安全培训（driverIds 记录实际参训司机，供培训覆盖率按真实口径计算） */
db.trainings = Array.from({ length: 12 }, (_, i) => {
  const date = dayjs(NOW).add(i < 8 ? -randInt(5, 180) : randInt(3, 45), 'day')
  const completed = !date.isAfter(dayjs(NOW))
  const driverIds = completed ? pickN(db.drivers, randInt(15, 60)).map((d) => d.id) : []
  return {
    id: `PX-${String(i + 1).padStart(3, '0')}`,
    title: pick([
      '防御性驾驶专项培训',
      '危化品运输安全培训',
      '恶劣天气行车安全',
      '车辆日常检查规范',
      '应急处置与消防演练',
      '疲劳驾驶危害教育',
      '新司机入职安全培训',
      '高速行车安全注意事项'
    ]),
    date: date.format('YYYY-MM-DD'),
    trainer: randomName(),
    participants: driverIds.length,
    driverIds,
    status: completed ? 'completed' : 'scheduled'
  }
})

/** 车辆安全检查 */
db.inspections = Array.from({ length: 10 }, (_, i) => {
  const vehicle = db.vehicles[i]
  return {
    id: `JC-${String(i + 1).padStart(3, '0')}`,
    vehicleId: vehicle.id,
    plate: vehicle.plate,
    date: dayjs(NOW).subtract(randInt(1, 30), 'day').format('YYYY-MM-DD'),
    item: pick(['出车前例行检查', '月度安全检测', '制动系统专项检查', '轮胎磨损检查', 'GPS 设备检测']),
    result: i === 4 || i === 7 ? 'fail' : 'pass',
    inspector: randomName(),
    remark: i === 4 ? '前制动片磨损超限，已送修' : i === 7 ? '右后轮胎纹深度不足' : '各项指标正常'
  }
})
