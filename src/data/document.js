import { db } from './base'
import { formatMoney, formatWeight } from '@/utils'

/**
 * 环节10：电子单证归档
 * 磅单 / 签收单 / 发票 统一为电子单证，提供列表聚合与内容生成（可下载 / 可打印 HTML）。
 * 派生视图：不新增存储、不消耗种子随机序列，实时从 weighings / dispatches.receipt / invoices 聚合，
 * 与操作日志互补——单证归档给"单据级"审计追溯，操作日志给"动作级"审计追溯。
 * 只读查询模块，由视图/测试直接引入，不进 data/index 门面。
 */

export const DOC_TYPES = [
  { key: 'dispatch', label: '调度单' },
  { key: 'weighing', label: '磅单' },
  { key: 'quality', label: '质检报告' },
  { key: 'receipt', label: '签收单' },
  { key: 'reconciliation', label: '对账单' },
  { key: 'invoice', label: '发票' }
]

const terminalName = (id) => db.terminals.find((t) => t.id === id)?.name || '-'
const commodityName = (id) => db.commodities.find((c) => c.id === id)?.name || '-'
const customerName = (id) => db.customers.find((c) => c.id === id)?.name || '-'
const vehicleOf = (id) => db.vehicles.find((v) => v.id === id)
const dispatchOf = (id) => db.dispatches.find((d) => d.id === id)
const contractOf = (id) => db.contracts.find((c) => c.id === id)
const settlementOf = (id) => db.settlements.find((s) => s.id === id)
const planOf = (id) => db.plans.find((p) => p.id === id)
const driverOf = (id) => db.drivers.find((d) => d.id === id)

/** 磅单单证（每条过磅记录一张） */
function weighingDocs() {
  return db.weighings.map((w) => {
    const d = dispatchOf(w.dispatchId)
    return {
      id: w.id,
      type: 'weighing',
      typeName: '磅单',
      refId: w.dispatchId,
      title: `磅单 ${w.id}`,
      date: w.time,
      summary: `${w.plate} ${w.type} 净重 ${w.net} t`,
      fields: [
        ['磅单号', w.id],
        ['调度单号', w.dispatchId],
        ['运输方式', d?.mode || '-'],
        ['车牌号', w.plate],
        ['商品', d ? commodityName(d.commodityId) : '-'],
        ['过磅场站', terminalName(w.terminalId)],
        ['过磅类型', w.type],
        ['毛重', formatWeight(w.gross)],
        ['皮重', formatWeight(w.tare)],
        ['净重', formatWeight(w.net)],
        ['过磅时间', w.time],
        ['操作员', w.operator]
      ]
    }
  })
}

/** 签收单单证（已签收车次一份） */
function receiptDocs() {
  return db.dispatches
    .filter((d) => d.receipt)
    .map((d) => {
      const v = vehicleOf(d.vehicleId)
      const c = contractOf(d.contractId)
      const fields = [
        ['签收单号', d.receipt.code],
        ['调度单号', d.id],
        ['合同号', d.contractId],
        ['客户', c ? customerName(c.shipperId) : '-'],
        ['车牌号', v?.plate || '-'],
        ['商品', commodityName(d.commodityId)],
        ['签收数量', formatWeight(d.quantity)],
        ['装货场站', terminalName(d.loadTerminalId)],
        ['卸货场站', terminalName(d.unloadTerminalId)],
        ['签收人', d.receipt.signer],
        ['签收时间', d.receipt.time]
      ]
      if (d.receipt.supplement) fields.push(['补签原因', d.receipt.reason || '-'])
      return {
        id: d.receipt.code,
        type: 'receipt',
        typeName: '签收单',
        refId: d.id,
        title: `签收单 ${d.receipt.code}`,
        date: d.receipt.time,
        summary: `${v?.plate || '-'} 签收 ${formatWeight(d.quantity)}`,
        fields
      }
    })
}

/** 发票单证（每张发票一份） */
function invoiceDocs() {
  const statusText = { issued: '已开具', 'red-flushed': '已红冲', pending: '待开具' }
  return db.invoices.map((inv) => {
    const s = settlementOf(inv.settlementId)
    return {
      id: inv.id,
      type: 'invoice',
      typeName: '发票',
      refId: inv.settlementId,
      title: `发票 ${inv.invoiceNo || inv.id}`,
      date: inv.issueDate || s?.settleDate || '-',
      summary: `${s ? customerName(s.customerId) : '-'} ${formatMoney(inv.amount)}`,
      fields: [
        ['发票号码', inv.invoiceNo || '-'],
        ['发票类型', inv.type],
        ['关联账单', s?.billNo || '-'],
        ['客户', s ? customerName(s.customerId) : '-'],
        ['发票金额', formatMoney(inv.amount)],
        ['开票日期', inv.issueDate || '-'],
        ['状态', statusText[inv.status] || inv.status],
        ['备注', inv.remark || '-']
      ]
    }
  })
}

/** 调度单单证（每张调度单一份） */
function dispatchDocs() {
  const statusText = { pending: '待装货', loading: '装货中', intransit: '在途', unloading: '卸货中', completed: '已完成', exception: '异常', cancelled: '已取消' }
  return db.dispatches.map((d) => {
    const v = vehicleOf(d.vehicleId)
    const c = contractOf(d.contractId)
    const mode = d.mode || planOf(d.planId)?.mode || '-'
    return {
      id: d.id,
      type: 'dispatch',
      typeName: '调度单',
      refId: d.id,
      title: `调度单 ${d.id}`,
      date: d.dispatchTime || d.loadTime || '-',
      summary: `${v?.plate || '-'} ${commodityName(d.commodityId)} ${formatWeight(d.quantity)}`,
      fields: [
        ['调度单号', d.id],
        ['合同号', d.contractId],
        ['客户', c ? customerName(c.shipperId) : '-'],
        ['商品', commodityName(d.commodityId)],
        ['运输方式', mode],
        ['车牌号', v?.plate || '-'],
        ['司机', driverOf(d.driverId)?.name || '-'],
        ['装货场站', terminalName(d.loadTerminalId)],
        ['卸货场站', terminalName(d.unloadTerminalId)],
        ['调度量', formatWeight(d.quantity)],
        ['单价', d.unitPrice != null ? `${d.unitPrice} 元/吨` : '-'],
        ['状态', statusText[d.status] || d.status]
      ]
    }
  })
}

/** 质检报告单证（已完成公路车次一份，卸货质检：水分/灰分） */
function qualityDocs() {
  return db.dispatches
    .filter((d) => d.quality)
    .map((d) => {
      const v = vehicleOf(d.vehicleId)
      const c = contractOf(d.contractId)
      return {
        id: `QC-${d.id}`,
        type: 'quality',
        typeName: '质检报告',
        refId: d.id,
        title: `质检报告 QC-${d.id}`,
        date: d.quality.time || d.unloadTime || '-',
        summary: `${v?.plate || '-'} 水分 ${d.quality.moisture}% 灰分 ${d.quality.ash}%`,
        fields: [
          ['报告编号', `QC-${d.id}`],
          ['调度单号', d.id],
          ['合同号', d.contractId],
          ['客户', c ? customerName(c.shipperId) : '-'],
          ['商品', commodityName(d.commodityId)],
          ['车牌号', v?.plate || '-'],
          ['卸货场站', terminalName(d.unloadTerminalId)],
          ['水分(%)', d.quality.moisture],
          ['灰分(%)', d.quality.ash],
          ['质检时间', d.quality.time || '-']
        ]
      }
    })
}

/** 对账单单证（已对账账单一份） */
function reconciliationDocs() {
  const statusText = { pending: '待对账', reconciling: '对账中', settled: '已结算', overdue: '逾期' }
  return db.settlements
    .filter((s) => s.reconciliation)
    .map((s) => {
      return {
        id: s.billNo,
        type: 'reconciliation',
        typeName: '对账单',
        refId: s.id,
        title: `对账单 ${s.billNo}`,
        date: s.reconciliation.date || s.settleDate || '-',
        summary: `${customerName(s.customerId)} ${formatMoney(s.totalAmount)}`,
        fields: [
          ['账单号', s.billNo],
          ['客户', customerName(s.customerId)],
          ['合同号', s.contractId],
          ['结算周期', s.period],
          ['车次', s.dispatchCount],
          ['调度量', formatWeight(s.dispatchQuantity)],
          ['结算量', formatWeight(s.totalQuantity)],
          ['损耗', formatWeight(s.lossQty)],
          ['质量扣重', formatWeight(s.qualityQty || 0)],
          ['差异车次', s.reconciliation.diffCount],
          ['账单金额', formatMoney(s.totalAmount)],
          ['已付金额', formatMoney(s.paidAmount)],
          ['状态', statusText[s.status] || s.status],
          ['对账时间', s.reconciliation.date]
        ]
      }
    })
}

/** 全部电子单证（调度单 + 磅单 + 质检报告 + 签收单 + 对账单 + 发票），按日期倒序 */
export function listDocuments() {
  const all = [...dispatchDocs(), ...weighingDocs(), ...qualityDocs(), ...receiptDocs(), ...reconciliationDocs(), ...invoiceDocs()]
  all.sort((a, b) => (a.date < b.date ? 1 : -1))
  return all
}

/** 按类型 + 单证号取单证 */
export function documentOf(type, id) {
  return listDocuments().find((d) => d.type === type && d.id === id) || null
}

/** 生成单证 HTML（可下载 / 可打印，电子单证与纸质单证同等效力） */
export function documentContent(doc) {
  const rows = doc.fields
    .map(([k, v]) => `<tr><td class="label">${k}</td><td>${v == null || v === '' ? '-' : v}</td></tr>`)
    .join('')
  const now = new Date().toLocaleString('zh-CN', { hour12: false })
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${doc.title}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Microsoft YaHei", "PingFang SC", "Helvetica Neue", Arial, sans-serif; color: #1f2937; margin: 0; padding: 40px; background: #fff; }
  .doc { max-width: 720px; margin: 0 auto; }
  .doc-header { text-align: center; border-bottom: 3px double #2b5ce6; padding-bottom: 16px; margin-bottom: 24px; }
  .doc-header .brand { font-size: 13px; color: #6b7280; letter-spacing: 3px; }
  .doc-header h1 { margin: 8px 0 4px; font-size: 26px; letter-spacing: 8px; color: #111827; }
  .doc-header .no { font-size: 13px; color: #374151; }
  table { width: 100%; border-collapse: collapse; }
  td { border: 1px solid #d1d5db; padding: 10px 14px; font-size: 14px; line-height: 1.5; }
  td.label { width: 140px; background: #f8fafc; color: #4b5563; font-weight: 500; }
  .doc-footer { margin-top: 28px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; color: #9ca3af; font-size: 12px; border-top: 1px solid #e5e7eb; padding-top: 14px; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
  <div class="doc">
    <div class="doc-header">
      <div class="brand">大宗物流综合管理平台</div>
      <h1>${doc.typeName}</h1>
      <div class="no">${doc.title}</div>
    </div>
    <table>${rows}</table>
    <div class="doc-footer">
      <span>单证编号：${doc.id}</span>
      <span>生成时间：${now}</span>
      <span>本单证为电子单证，与纸质单证具有同等效力</span>
    </div>
  </div>
</body>
</html>`
}
