import { db, randomPhone, randInt, NOW } from './base'
import dayjs from 'dayjs'

const companies = [
  { name: '晋能控股煤业集团', type: 'shipper', region: '山西', address: '山西省太原市小店区' },
  { name: '中煤华晋能源', type: 'shipper', region: '山西', address: '山西省大同市云州区' },
  { name: '潞安化工集团', type: 'shipper', region: '山西', address: '山西省潞州区' },
  { name: '陕西煤业化工集团', type: 'shipper', region: '陕西', address: '陕西省榆林市神木市' },
  { name: '鄂尔多斯能源集团', type: 'shipper', region: '内蒙古', address: '内蒙古鄂尔多斯市' },
  { name: '内蒙古伊泰集团', type: 'shipper', region: '内蒙古', address: '内蒙古鄂尔多斯市' },
  { name: '兖矿能源集团', type: 'shipper', region: '山东', address: '山东省济宁市兖州区' },
  { name: '山西焦煤集团', type: 'shipper', region: '山西', address: '山西省太原市尖草坪区' },
  { name: '宝钢集团', type: 'consignee', region: '上海', address: '上海市宝山区富锦路' },
  { name: '鞍钢集团', type: 'consignee', region: '辽宁', address: '辽宁省鞍山市立山区' },
  { name: '首钢集团', type: 'consignee', region: '北京', address: '北京市石景山区' },
  { name: '河钢集团', type: 'consignee', region: '河北', address: '河北省唐山市' },
  { name: '沙钢集团', type: 'consignee', region: '江苏', address: '江苏省张家港市' },
  { name: '华能国际电力', type: 'consignee', region: '北京', address: '北京市西城区' },
  { name: '大唐发电', type: 'consignee', region: '北京', address: '北京市西城区' },
  { name: '华电集团', type: 'consignee', region: '北京', address: '北京市西城区' },
  { name: '国家能源集团', type: 'both', region: '北京', address: '北京市西城区' },
  { name: '中化化肥', type: 'consignee', region: '北京', address: '北京市朝阳区' },
  { name: '中粮集团', type: 'consignee', region: '北京', address: '北京市朝阳区' },
  { name: '建龙钢铁', type: 'consignee', region: '河北', address: '河北省唐山市迁安市' },
  { name: '日照钢铁', type: 'consignee', region: '山东', address: '山东省日照市' },
  { name: '方大特钢', type: 'consignee', region: '江西', address: '江西省南昌市' },
  { name: '中石油管道局', type: 'both', region: '北京', address: '北京市东城区' },
  { name: '河北港口集团', type: 'both', region: '河北', address: '河北省秦皇岛市' }
]

db.customers = companies.map((c, i) => {
  const level = i < 6 ? 'A' : i < 14 ? 'B' : 'C'
  return {
    id: `CUS${String(i + 1).padStart(3, '0')}`,
    name: c.name,
    type: c.type,
    region: c.region,
    address: c.address,
    level,
    contact: '李' + ['经理', '主管', '部长', '主任'][i % 4],
    phone: randomPhone(),
    creditLimit: level === 'A' ? 5000000 : level === 'B' ? 2000000 : 500000,
    totalBusiness: randInt(800, 9000) * 10000,
    joinDate: dayjs(NOW).subtract(randInt(1, 5), 'year').format('YYYY-MM-DD'),
    status: i === 21 ? 'frozen' : 'active',
    remark: ''
  }
})
