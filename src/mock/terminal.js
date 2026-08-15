import { db, randomPhone, randInt } from './base'

const terminals = [
  { id: 'T001', name: '秦皇岛港煤炭码头', type: 'both', region: '华北', address: '河北省秦皇岛市海港区港东大街', capacity: 50000 },
  { id: 'T002', name: '黄骅港煤炭码头', type: 'both', region: '华北', address: '河北省沧州市黄骅市', capacity: 45000 },
  { id: 'T003', name: '天津港矿石码头', type: 'both', region: '华北', address: '天津市滨海新区', capacity: 60000 },
  { id: 'T004', name: '曹妃甸港散货码头', type: 'both', region: '华北', address: '河北省唐山市曹妃甸区', capacity: 40000 },
  { id: 'T005', name: '大同煤运装车站', type: 'loading', region: '华北', address: '山西省大同市云州区', capacity: 15000 },
  { id: 'T006', name: '鄂尔多斯煤运站', type: 'loading', region: '西北', address: '内蒙古鄂尔多斯市东胜区', capacity: 20000 },
  { id: 'T007', name: '神府煤运装车站', type: 'loading', region: '西北', address: '陕西省榆林市神木市', capacity: 18000 },
  { id: 'T008', name: '兖州煤运装车站', type: 'loading', region: '华东', address: '山东省济宁市兖州区', capacity: 12000 },
  { id: 'T009', name: '宝钢原料场', type: 'unloading', region: '华东', address: '上海市宝山区富锦路 333 号', capacity: 30000 },
  { id: 'T010', name: '鞍钢原料场', type: 'unloading', region: '东北', address: '辽宁省鞍山市立山区', capacity: 25000 },
  { id: 'T011', name: '河钢原料场', type: 'unloading', region: '华北', address: '河北省唐山市路北区', capacity: 22000 },
  { id: 'T012', name: '日照港散货码头', type: 'both', region: '华东', address: '山东省日照市东港区', capacity: 35000 }
]

db.terminals = terminals.map((t, i) => ({
  ...t,
  contact: ['王', '张', '刘', '陈', '杨', '赵', '周', '吴', '徐', '孙', '马', '朱'][i] + '站长',
  phone: randomPhone(),
  status: i === 7 ? 'maintenance' : 'operating',
  todayThroughput: randInt(800, 4200),
  queueVehicles: randInt(0, 35),
  remark: ''
}))
