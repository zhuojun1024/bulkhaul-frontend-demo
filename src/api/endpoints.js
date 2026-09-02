/**
 * 写端点映射（薄客户端核心资产，verify-api.mjs 单测）：写操作名 → { method, path(args), body(args) }。
 */
/* ===== 写端点映射：写操作名 → { method, path(args), body(args) } =====
 * args 为原始位置参数数组。path/body 按 args[i] 取参（内存引擎移除 F3 后，
 * 写操作名沿用原 flow.js 写函数名作为 W 映射键，afterWrite 按名查表 POST 后端）。 */
const W = {
  /* 调度（/api/dispatch） */
  confirmLoad: { path: (a) => `/dispatch/${a[0].id}/confirmLoad` },
  depart: { path: (a) => `/dispatch/${a[0].id}/depart` },
  arrive: { path: (a) => `/dispatch/${a[0].id}/arrive` },
  confirmUnload: { path: (a) => `/dispatch/${a[0].id}/confirmUnload` },
  cancelDispatch: { path: (a) => `/dispatch/${a[0].id}/cancel`, body: (a) => ({ reason: a[1] || '' }) },
  reassignDispatch: { path: (a) => `/dispatch/${a[0].id}/reassign`, body: (a) => ({ vehicleId: a[1], driverId: a[2] }) },
  reportException: { path: (a) => `/dispatch/${a[0].id}/reportException`, body: (a) => ({ description: a[1], type: a[2] || 'other', level: a[3] || 'medium' }) },
  driverReportException: { path: (a) => `/dispatch/${a[0].id}/reportException`, body: (a) => ({ description: a[1], type: a[2] || 'other', level: a[3] || 'medium' }) },
  resumeDispatch: { path: (a) => `/dispatch/${a[0].id}/resume` },
  createDispatches: { path: () => '/dispatch/create', body: (a) => ({ planId: a[0].id, count: a[1], vehicleIds: a[2] || [] }) },
  acceptDispatch: { path: (a) => `/dispatch/${a[0].id}/accept` },
  driverDepart: { path: (a) => `/dispatch/${a[0].id}/driver/depart` },
  driverArrive: { path: (a) => `/dispatch/${a[0].id}/driver/arrive` },
  signReceipt: { path: (a) => `/dispatch/${a[0].id}/driver/signReceipt`, body: (a) => ({ signer: a[1] || '' }) },
  supplementReceipt: { path: (a) => `/dispatch/${a[0].id}/supplementReceipt`, body: (a) => ({ signer: a[1] || '', reason: a[2] || '' }) },
  scanConfirmLoad: { path: (a) => `/dispatch/${a[0].id}/scan/load`, body: (a) => ({ code: a[1] || '' }) },
  scanConfirmUnload: { path: (a) => `/dispatch/${a[0].id}/scan/unload`, body: (a) => ({ code: a[1] || '' }) },

  /* 磅单（/api/weighing） */
  manualWeighing: { path: () => '/weighing/manual', body: (a) => ({ dispatchId: a[0], type: a[1], net: a[2] }) },
  correctWeighing: { path: (a) => `/weighing/${a[0]}/correct`, body: (a) => ({ newNet: a[1], reason: a[2] || '' }) },

  /* 仓储（/api/warehouse） */
  manualInbound: { path: () => '/warehouse/inbound', body: (a) => ({ warehouseId: a[0], commodityId: a[1], quantity: a[2], batch: a[3] || '', remark: a[4] || '' }) },
  setSafetyStock: { path: () => '/warehouse/safetyStock', body: (a) => ({ warehouseId: a[0], commodityId: a[1], minQty: a[2] }) },
  setInventoryStatus: { path: (a) => `/warehouse/inventory/${a[0].id}/status`, body: (a) => ({ status: a[1] }) },

  /* 异常（/api/exception） */
  acceptException: { path: (a) => `/exception/${a[0].id}/accept`, body: (a) => ({ handler: a[1] || '' }) },
  finishException: { path: (a) => `/exception/${a[0].id}/finish`, body: (a) => ({ result: a[1] || '', cost: a[2] || 0 }) },
  closeException: { path: (a) => `/exception/${a[0].id}/close` },

  /* 安全（/api/safety） */
  registerAccident: { path: () => '/safety/accident', body: (a) => a[0] },
  closeAccident: { path: (a) => `/safety/accident/${a[0].id}/close` },
  addTraining: { path: () => '/safety/training', body: (a) => a[0] },
  completeTraining: { path: (a) => `/safety/training/${a[0].id}/complete`, body: (a) => ({ driverIds: a[1] || [] }) },
  addInspection: { path: () => '/safety/inspection', body: (a) => a[0] },

  /* 保险（/api/insurance） */
  fileInsuranceClaim: { path: () => '/insurance/claim', body: (a) => ({ ...(a[1] || {}), accidentId: a[0] || '' }) },
  assessInsuranceClaim: { path: (a) => `/insurance/claim/${a[0].id}/assess`, body: (a) => a[1] || {} },
  settleInsuranceClaim: { path: (a) => `/insurance/claim/${a[0].id}/settle`, body: (a) => a[1] || {} },
  rejectInsuranceClaim: { path: (a) => `/insurance/claim/${a[0].id}/reject`, body: (a) => ({ reason: a[1] || '' }) },

  /* 结算（/api/settlement） */
  generateSettlements: { path: () => '/settlement/generate', body: (a) => ({ keys: a[0] || [] }) },
  startReconcile: { path: (a) => `/settlement/${a[0].id}/startReconcile` },
  recalcSettlement: { path: (a) => `/settlement/${a[0].id}/recalc` },
  confirmSettle: { path: (a) => `/settlement/${a[0].id}/confirmSettle` },
  recordPayment: { path: (a) => `/settlement/${a[0].id}/recordPayment`, body: (a) => ({ amount: a[1], method: a[2] || '银行转账' }) },
  revertPayment: { path: (a) => `/settlement/${a[0].id}/revertPayment/${a[1]}`, body: (a) => ({ reason: a[2] || '' }) },
  dunning: { path: (a) => `/settlement/${a[0].id}/dunning`, body: (a) => ({ level: a[1] || 'reminder' }) },
  customerConfirm: { path: (a) => `/settlement/${a[0].id}/customerConfirm` },
  customerObjection: { path: (a) => `/settlement/${a[0].id}/customerObjection`, body: (a) => ({ reason: a[1] || '' }) },
  applyPrepayment: { path: (a) => `/settlement/${a[0].id}/applyPrepayment`, body: (a) => ({ amount: a[1] }) },
  collectPrepayment: { path: () => '/settlement/prepayment/collect', body: (a) => ({ customerId: a[0], amount: a[1], method: a[2] || '银行转账', remark: a[3] || '' }) },
  issueInvoice: { path: (a) => `/settlement/${a[0].id}/issueInvoice` },
  issueInvoiceRow: { path: (a) => `/settlement/${a[0].settlementId}/issueInvoice` },
  redFlushInvoiceRow: { path: (a) => `/settlement/invoice/${a[0].id}/redFlush`, body: (a) => ({ reason: a[1] || '' }) },

  /* 财务核销（/api/finance） */
  generatePayables: { path: () => '/finance/payables/generate' },
  payPayable: { path: (a) => `/finance/payables/${a[0].id}/pay`, body: (a) => ({ method: a[1] || '银行转账' }) },
  addBankStatement: { path: () => '/finance/bank/statement', body: (a) => a[0] },
  matchBankRecord: { path: (a) => `/finance/bank/${a[0].id}/match`, body: (a) => ({ settlementId: a[1] }) },
  autoMatchBank: { path: () => '/finance/bank/autoMatch' },

  /* 合同/计划（/api） */
  createContract: { path: () => '/contract', body: (a) => ({ ...(a[0] || {}), status: a[1] || 'draft' }) },
  createPlan: { path: () => '/plan', body: (a) => a[0] },
  cancelPlan: { path: (a) => `/plan/${a[0].id}/cancel` },
  submitContractApproval: { path: (a) => `/contract/${a[0].id}/submitApproval` },
  approveContract: { path: (a) => `/contract/${a[0].id}/approve`, body: (a) => ({ comment: a[1] || '' }) },
  rejectContract: { path: (a) => `/contract/${a[0].id}/reject`, body: (a) => ({ reason: a[1] || '' }) },
  changeContract: { path: (a) => `/contract/${a[0].id}/change`, body: (a) => ({ fields: a[1] || {}, reason: a[2] || '' }) },
  approveContractChange: { path: (a) => `/contract/${a[0].id}/approveChange`, body: (a) => ({ comment: a[1] || '' }) },
  rejectContractChange: { path: (a) => `/contract/${a[0].id}/rejectChange`, body: (a) => ({ reason: a[1] || '' }) },
  extendContract: { path: (a) => `/contract/${a[0].id}/extend`, body: (a) => ({ newDate: a[1], reason: a[2] || '' }) },
  terminateContract: { path: (a) => `/contract/${a[0].id}/terminate`, body: (a) => ({ reason: a[1] || '', settleNow: a[2] !== false }) },
  completeContract: { path: (a) => `/contract/${a[0].id}/complete` },
  archiveContract: { path: (a) => `/contract/${a[0].id}/archive` },
  submitTransportRequest: { path: () => '/contract/request', body: (a) => ({ ...(a[1] || {}), customerId: a[0] }) },
  convertRequestToContract: { path: (a) => `/contract/request/${a[0].id}/convert`, body: (a) => a[1] || {} },
  rejectTransportRequest: { path: (a) => `/contract/request/${a[0].id}/reject`, body: (a) => ({ reason: a[1] || '' }) },

  /* 管理后台（/api/admin） */
  saveCommodity: { path: () => '/admin/commodity', body: (a) => a[0] },
  toggleCommodityStatus: { path: (a) => `/admin/commodity/${a[0].id}/toggle` },
  saveTerminal: { path: () => '/admin/terminal', body: (a) => a[0] },
  saveWarehouse: { path: () => '/admin/warehouse', body: (a) => a[0] },
  saveDriver: { path: () => '/admin/driver', body: (a) => a[0] },
  toggleDriverStatus: { path: (a) => `/admin/driver/${a[0].id}/toggle` },
  toggleCustomerStatus: { path: (a) => `/admin/customer/${a[0].id}/toggle` },
  importCommodities: { path: () => '/admin/commodity/import', body: (a) => a[0] || [] },
  importCustomers: { path: () => '/admin/customer/import', body: (a) => a[0] || [] },
  importDrivers: { path: () => '/admin/driver/import', body: (a) => a[0] || [] },
  importVehicles: { path: () => '/admin/vehicle/import', body: (a) => a[0] || [] },
  sendVehicleRepair: { path: (a) => `/admin/vehicle/${a[0].id}/repair`, body: (a) => ({ reason: a[1] || '' }) },
  resumeVehicle: { path: (a) => `/admin/vehicle/${a[0].id}/resume` },
  saveUser: { path: () => '/admin/user', body: (a) => a[0] },
  removeUser: { method: 'DELETE', path: (a) => `/admin/user/${a[0].id}` },
  toggleUserStatus: { path: (a) => `/admin/user/${a[0].id}/toggle`, body: (a) => ({ active: !!a[1] }) },
  resetPassword: { path: (a) => `/admin/user/${a[0]}/resetPassword`, body: (a) => ({ password: a[1] }) },
  saveRole: { path: () => '/admin/role', body: (a) => a[0] },
  removeRole: { method: 'DELETE', path: (a) => `/admin/role/${a[0].id}` },
  updateRolePerms: { method: 'PUT', path: (a) => `/admin/role/${a[0]}/perms`, body: (a) => a[1] || {} },
  setDataScope: { method: 'PUT', path: (a) => `/admin/user/${a[0]}/dataScope`, body: (a) => ({ regions: a[1] || [] }) },
  setDnd: { method: 'PUT', path: () => '/admin/dnd', body: (a) => a[0] || {} },
  createRateCard: { path: () => '/admin/rateCard', body: (a) => a[0] },
  updateRateCard: { method: 'PUT', path: (a) => `/admin/rateCard/${a[0]}`, body: (a) => a[1] || {} },
  toggleRateCard: { path: (a) => `/admin/rateCard/${a[0]}/toggle` },
  recalcAll: { path: () => '/admin/recalc' },

  /* 消息（/api/admin） */
  markMessageRead: { path: (a) => `/admin/messages/${a[0].id}/read` },
  markAllMessagesRead: { path: () => '/admin/messages/readAll' }
}

// 导出 W 端点契约供单元测试（verify-api.mjs）：前端↔后端 API 契约（method/path/body）是薄客户端核心资产
export { W }
