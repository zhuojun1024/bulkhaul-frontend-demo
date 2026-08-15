import { db } from './base'

const list = [
  {
    id: 'CM001', name: '动力煤', category: '煤炭', unit: '吨', density: 0.75, price: 580,
    indicators: [
      { name: '发热量', value: '5500 kcal/kg' },
      { name: '全硫', value: '≤1.0%' },
      { name: '水分', value: '≤12%' }
    ]
  },
  {
    id: 'CM002', name: '焦煤', category: '煤炭', unit: '吨', density: 0.82, price: 1450,
    indicators: [
      { name: '粘结指数', value: '≥70' },
      { name: '挥发分', value: '26-30%' },
      { name: '灰分', value: '≤10%' }
    ]
  },
  {
    id: 'CM003', name: '喷吹煤', category: '煤炭', unit: '吨', density: 0.8, price: 980,
    indicators: [
      { name: '发热量', value: '≥6000 kcal/kg' },
      { name: '灰分', value: '≤15%' },
      { name: '粒度', value: '-0.5mm 占 80%' }
    ]
  },
  {
    id: 'CM004', name: '铁矿石粉', category: '矿石', unit: '吨', density: 3.2, price: 720,
    indicators: [
      { name: '品位 Fe', value: '≥62%' },
      { name: '粒度', value: '-10mm' },
      { name: '水分', value: '≤8%' }
    ]
  },
  {
    id: 'CM005', name: '球团矿', category: '矿石', unit: '吨', density: 3.5, price: 860,
    indicators: [
      { name: '品位 Fe', value: '≥57%' },
      { name: '抗压强度', value: '≥2500 N/个' },
      { name: '粒度', value: '8-16mm' }
    ]
  },
  {
    id: 'CM006', name: '玉米', category: '粮食', unit: '吨', density: 0.72, price: 2400,
    indicators: [
      { name: '水分', value: '≤14.5%' },
      { name: '容重', value: '≥710 g/L' },
      { name: '杂质', value: '≤1.0%' }
    ]
  },
  {
    id: 'CM007', name: '大豆', category: '粮食', unit: '吨', density: 0.78, price: 4600,
    indicators: [
      { name: '蛋白', value: '≥38%' },
      { name: '水分', value: '≤13%' },
      { name: '杂质', value: '≤1.0%' }
    ]
  },
  {
    id: 'CM008', name: '豆粕', category: '粮食', unit: '吨', density: 0.6, price: 3200,
    indicators: [
      { name: '蛋白', value: '≥43%' },
      { name: '水分', value: '≤12%' },
      { name: '油脂', value: '≤1.0%' }
    ]
  },
  {
    id: 'CM009', name: '尿素', category: '化工', unit: '吨', density: 1.3, price: 1900,
    indicators: [
      { name: '总氮', value: '≥46.0%' },
      { name: '水分', value: '≤1.0%' },
      { name: '粒度', value: '1.0-2.8mm' }
    ]
  },
  {
    id: 'CM010', name: '水泥', category: '建材', unit: '吨', density: 1.2, price: 380,
    indicators: [
      { name: '强度等级', value: 'P.O 42.5' },
      { name: '细度', value: '比表面积 ≥300' },
      { name: '凝结时间', value: '初凝 ≥45min' }
    ]
  },
  {
    id: 'CM011', name: '石灰石', category: '建材', unit: '吨', density: 2.7, price: 65,
    indicators: [
      { name: 'CaCO3', value: '≥95%' },
      { name: '粒度', value: '20-40mm' },
      { name: '水分', value: '≤5%' }
    ]
  },
  {
    id: 'CM012', name: '螺纹钢', category: '钢材', unit: '吨', density: 7.85, price: 3600,
    indicators: [
      { name: '牌号', value: 'HRB400E' },
      { name: '规格', value: 'Φ12-Φ32' },
      { name: '屈服强度', value: '≥400 MPa' }
    ]
  },
  {
    id: 'CM013', name: '原油', category: '能源', unit: '吨', density: 0.86, price: 5200,
    indicators: [
      { name: '密度', value: '0.85-0.87 g/cm³' },
      { name: '硫含量', value: '≤0.5%' },
      { name: '运输方式', value: '管道/船运' }
    ]
  },
  {
    id: 'CM014', name: 'LNG', category: '能源', unit: '吨', density: 0.45, price: 4800,
    indicators: [
      { name: '甲烷含量', value: '≥90%' },
      { name: '温度', value: '-162℃' },
      { name: '运输方式', value: '低温罐车/管道' }
    ]
  }
]

db.commodities = list.map((c, i) => ({
  ...c,
  id: `CM${String(i + 1).padStart(3, '0')}`,
  status: i === 13 ? 'inactive' : 'active',
  totalVolume: 0, // 由 dashboard 汇总
  remark: ''
}))
