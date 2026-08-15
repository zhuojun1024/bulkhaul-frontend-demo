import { db, randInt, pick, randomName, NOW } from './base'
import dayjs from 'dayjs'

/**
 * 异常单：与调度单关联
 * 类型：delay 延误 / accident 事故 / damage 货损 / quality 质量 / overload 超载 / other 其他
 * 状态：pending 待处理 / handling 处理中 / closed 已关闭
 */
const exceptionDispatches = db.dispatches.filter((d) => d.status === 'exception')
const normalDispatches = db.dispatches.filter((d) => d.status === 'completed' || d.status === 'intransit')

const typePool = ['delay', 'delay', 'delay', 'delay', 'accident', 'accident', 'damage', 'damage', 'damage', 'quality', 'quality', 'quality', 'overload', 'other']
const descPool = {
  delay: ['车辆故障导致滞留', '道路管制绕行延误', '场站排队超 4 小时', '恶劣天气封路', '等待装货超时'],
  accident: ['高速追尾，车辆受损', '侧翻，部分货物洒落', '与护栏碰撞，轮胎损坏', '刹车失灵紧急制动'],
  damage: ['篷布破损货物淋湿', '装卸过程撒漏', '包装破损', '货物混入杂质'],
  quality: ['水分超标 2.3%', '发热量低于合同要求', '粒度不达标', '含硫量超标'],
  overload: ['过磅超载 3.2 吨', '轴重超限', '装载量超出核定'],
  other: ['司机突发疾病送医', 'GPS 信号丢失 2 小时', '证件检查滞留', '其他']
}
const resultPool = ['已协调备用车辆转运，延误 6 小时', '保险已报案，定损中', '场站重新过磅，扣减货损部分', '与货主协商降价 2% 处理', '车辆送修 2 天，恢复后继续执行', '已关闭，无进一步损失']

db.exceptions = Array.from({ length: 25 }, (_, i) => {
  const type = typePool[i % typePool.length]
  const level = i < 4 ? 'high' : i < 14 ? 'medium' : 'low'
  const status = i < 12 ? 'closed' : i < 20 ? 'handling' : 'pending'
  const dispatch =
    i < exceptionDispatches.length
      ? exceptionDispatches[i]
      : normalDispatches[randInt(0, normalDispatches.length - 1)]
  const occurTime = dayjs(NOW).subtract(randInt(1, 14 * 24), 'hour').minute(randInt(0, 59))

  return {
    id: `YC-${String(i + 1).padStart(4, '0')}`,
    dispatchId: dispatch.id,
    type,
    level,
    status,
    occurTime: occurTime.format('YYYY-MM-DD HH:mm'),
    handler: status === 'pending' ? '' : randomName(),
    description: pick(descPool[type]),
    result: status === 'closed' ? pick(resultPool) : '',
    cost: level === 'high' ? randInt(5, 20) * 10000 : level === 'medium' ? randInt(1, 5) * 10000 : randInt(0, 8000)
  }
})
