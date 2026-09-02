<template>
  <div class="page">
    <div class="panel settlement-detail__header">
      <div class="settlement-detail__head">
        <el-button :icon="ArrowLeft" circle @click="$router.back()" />
        <div>
          <div class="settlement-detail__name">
            结算单 {{ settlement?.billNo }}
            <StatusTag v-if="settlement" :status="settlement.status" :map="statusMap" />
          </div>
          <div class="settlement-detail__meta">
            合同
            <span class="link" @click="$router.push(`/contract/${settlement?.contractId}`)">{{ settlement?.contractId }}</span>
            · 结算周期 {{ settlement?.period }} · 客户 {{ customer?.name }}
            <template v-if="paymentDays">· 账期 {{ paymentDays }} 天</template>
          </div>
        </div>
        <div class="settlement-detail__actions">
          <el-button
            v-if="settlement?.status === 'pending' && can('settlement')"
            type="warning" :icon="DocumentChecked" @click="startReconcile"
          >
            发起对账
          </el-button>
          <el-button
            v-if="settlement?.status === 'pending' && can('settlement')"
            :icon="Refresh" @click="recalc"
          >
            重算
          </el-button>
          <el-button
            v-if="settlement?.status === 'reconciling' && can('settlement')"
            type="success" :icon="CircleCheck" @click="settle"
          >
            确认结算
          </el-button>
          <el-button :icon="Printer" @click="printBill">打印对账单</el-button>
        </div>
      </div>
    </div>

    <el-row :gutter="16">
      <el-col :span="14">
        <!-- 费用明细 -->
        <div class="panel">
          <div class="panel__header"><span class="panel__title">费用明细</span></div>
          <div class="panel__body">
            <el-table :data="feeRows" stripe size="small">
              <el-table-column prop="name" label="费用项" width="140" />
              <el-table-column prop="rule" label="计费规则" min-width="200" />
              <el-table-column label="金额(元)" width="150" align="right">
                <template #default="{ row }">
                  <span class="num">{{ formatNum(row.amount) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="占比" width="100" align="right">
                <template #default="{ row }">
                  {{ settlement ? Math.round((row.amount / settlement.totalAmount) * 1000) / 10 : 0 }}%
                </template>
              </el-table-column>
            </el-table>
            <div class="fee-total">
              <span>结算总额</span>
              <b class="num fee-total__value">{{ formatMoney(settlement?.totalAmount) }}</b>
            </div>
            <div class="fee-total">
              <span>已付金额</span>
              <b class="num fee-total__value text-success">{{ formatMoney(settlement?.paidAmount) }}</b>
            </div>
            <div class="fee-total">
              <span>未付余额</span>
              <b class="num fee-total__value text-danger">{{ formatMoney(unpaid) }}</b>
            </div>
          </div>
        </div>

        <!-- 调整记录（异常关闭补扣 / 重算） -->
        <div v-if="settlement?.adjustments?.length" class="panel" style="margin-top: 16px">
          <div class="panel__header"><span class="panel__title">调整记录</span></div>
          <div class="panel__body">
            <el-table :data="settlement.adjustments" stripe size="small">
              <el-table-column prop="time" label="时间" width="150" />
              <el-table-column prop="reason" label="调整原因" min-width="220" />
              <el-table-column label="调整金额(元)" width="140" align="right">
                <template #default="{ row }">
                  <span class="num" :class="row.amount < 0 ? 'text-danger' : 'text-success'">
                    {{ row.amount > 0 ? '+' : '' }}{{ formatNum(row.amount) }}
                  </span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-col>

      <el-col :span="10">
        <!-- 对账流程 -->
        <div class="panel">
          <div class="panel__header"><span class="panel__title">对账结算流程</span></div>
          <div class="panel__body">
            <el-steps direction="vertical" :active="stepActive">
              <el-step title="数据归集" :description="`${settlement?.dispatchCount} 车次 / ${formatNum(settlement?.totalQuantity)} 吨`" />
              <el-step title="发起对账" :description="settlement?.status === 'pending' ? '待发起' : '已完成'" />
              <el-step title="客户确认" :description="customerConfirmDesc" />
              <el-step
                title="结算收款"
                :description="settlement?.settleDate ? `结算日 ${settlement.settleDate} · 已付 ${formatNum(settlement.paidAmount)} / ${formatNum(settlement.totalAmount)}` : '—'"
              />
            </el-steps>
          </div>
        </div>

        <!-- 发票 -->
        <div class="panel">
          <div class="panel__header"><span class="panel__title">发票信息</span></div>
          <div class="panel__body">
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="开票状态">
                <el-tag size="small" :type="invoiceType(settlement?.invoiceStatus)" effect="light">
                  {{ invoiceMap[settlement?.invoiceStatus] }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="发票号码">
                {{ invoice?.invoiceNo || '—' }}
              </el-descriptions-item>
              <el-descriptions-item label="发票类型">{{ invoice?.type || '—' }}</el-descriptions-item>
              <el-descriptions-item label="开票日期">{{ invoice?.issueDate || '—' }}</el-descriptions-item>
            </el-descriptions>
            <el-alert
              v-if="invoice?.stale && invoice.status === 'issued'"
              type="warning"
              :closable="false"
              show-icon
              style="margin-top: 12px"
              :title="`发票金额与账单金额不一致（${invoice.staleReason || '账单金额已变化'}），需红冲重开；红冲前不可登记收款`"
            />
            <el-button
              v-if="settlement?.status === 'settled' && ['not-issued', 'pending'].includes(settlement?.invoiceStatus) && can('invoice')"
              type="primary"
              size="small"
              style="margin-top: 12px"
              @click="issueInvoice"
            >开具发票</el-button>
          </div>
        </div>

        <!-- 收款记录 -->
        <div class="panel">
          <div class="panel__header">
            <span class="panel__title">收款记录</span>
            <el-button v-if="canRecordPayment && can('settlement')" type="primary" size="small" :icon="Money" @click="openPayDialog">
              登记收款
            </el-button>
            <el-button
              v-if="canRecordPayment && can('settlement') && prepayAvail > 0"
              type="success"
              size="small"
              @click="openPrepayDialog"
            >
              预付款抵扣
            </el-button>
          </div>
          <div class="panel__body">
            <el-table v-if="payments.length" :data="payments" stripe size="small">
              <el-table-column prop="payTime" label="收款时间" width="130" />
              <el-table-column label="金额(元)" width="100" align="right">
                <template #default="{ row }">
                  <span class="num" :class="{ 'text-muted': row.reversed }">{{ formatMoney(row.amount) }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="method" label="方式" width="80" />
              <el-table-column label="状态" width="80" align="center">
                <template #default="{ row }">
                  <el-tag v-if="row.reversed" size="small" type="info" effect="plain">已冲正</el-tag>
                  <span v-else class="text-muted">正常</span>
                </template>
              </el-table-column>
              <el-table-column prop="remark" label="备注" min-width="70" />
              <ActionColumn v-if="can('settlement')" width="70">
                <template #default="{ row }">
                  <el-button v-if="!row.reversed && canRevert" link type="danger" size="small" @click="openRevert(row)">
                    冲正
                  </el-button>
                  <span v-else class="text-muted">—</span>
                </template>
              </ActionColumn>
            </el-table>
            <el-empty v-else description="暂无收款记录，结算确认后可登记收款" :image-size="60" />
          </div>
        </div>

        <!-- 催收记录（P1 逾期催收：提醒 → 正式催收 → 法务函） -->
        <div class="panel">
          <div class="panel__header">
            <span class="panel__title">催收记录</span>
            <el-button v-if="canDunning && can('settlement')" type="warning" size="small" @click="openDunning">发起催收</el-button>
          </div>
          <div class="panel__body">
            <el-table v-if="dunnings.length" :data="dunnings" stripe size="small">
              <el-table-column label="轮次" width="70" align="center">
                <template #default="{ row }">第 {{ row.round }} 轮</template>
              </el-table-column>
              <el-table-column label="级别" width="90" align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="dunningLevelType(row.level)" effect="light">{{ row.levelName }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="content" label="内容" min-width="180" show-overflow-tooltip />
              <el-table-column prop="time" label="时间" width="130" />
              <el-table-column prop="by" label="发起人" width="90" align="center" />
            </el-table>
            <el-empty v-else :description="canDunning ? '暂无催收记录，可发起催收' : '暂无催收记录'" :image-size="60" />
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 对账明细：调度量 vs 磅单净重 vs 结算量 -->
    <div class="panel" style="margin-top: 16px">
      <div class="panel__header">
        <span class="panel__title">对账明细</span>
        <span v-if="settlement?.reconciliation" class="recon-summary">
          对账时间 {{ settlement.reconciliation.date }} · 共 {{ settlement.reconciliation.items.length }} 车次
          · 损耗合计 {{ settlement.reconciliation.lossQty }} 吨（约 {{ formatMoney(settlement.reconciliation.lossAmount) }}，已扣减）
          <template v-if="settlement.reconciliation.qualityQty > 0">
            · 质量扣重 {{ settlement.reconciliation.qualityQty }} 吨（约 {{ formatMoney(settlement.reconciliation.qualityAmount) }}，已扣减）
          </template>
          <template v-if="settlement.reconciliation.diffCount">
            · <span class="text-warning">{{ settlement.reconciliation.diffCount }} 车次进磅与调度量存在差异，需确认</span>
          </template>
          <template v-else>· <span class="text-success">结算量与磅单一致</span></template>
        </span>
      </div>
      <div class="panel__body">
        <el-alert
          v-if="openObjections.length"
          type="error"
          :closable="false"
          show-icon
          style="margin-bottom: 12px"
          :title="`客户提出异议（${openObjections[0].time}）：${openObjections[0].reason}——请处理差异后重新发起对账，客户再次确认后方可结算`"
        />
        <el-table v-if="settlement?.reconciliation" :data="settlement.reconciliation.items" stripe size="small">
          <el-table-column prop="dispatchId" label="调度单号" width="110" />
          <el-table-column prop="plate" label="车牌" width="120" />
          <el-table-column label="调度量(吨)" width="110" align="right">
            <template #default="{ row }"><span class="num">{{ row.dispatchQty }}</span></template>
          </el-table-column>
          <el-table-column label="进磅净重(吨)" width="120" align="right">
            <template #default="{ row }"><span class="num">{{ row.inNet ?? '—' }}</span></template>
          </el-table-column>
          <el-table-column label="出磅净重(吨)" width="120" align="right">
            <template #default="{ row }"><span class="num">{{ row.outNet ?? '—' }}</span></template>
          </el-table-column>
          <el-table-column label="结算量(吨)" width="110" align="right">
            <template #default="{ row }"><span class="num">{{ row.settleQty }}</span></template>
          </el-table-column>
          <el-table-column label="损耗(吨)" width="100" align="right">
            <template #default="{ row }">
              <span class="num" :class="row.loss > 0.5 ? 'text-warning' : ''">{{ row.loss }}</span>
            </template>
          </el-table-column>
          <el-table-column label="质量扣重(吨)" width="110" align="right">
            <template #default="{ row }">
              <span class="num" :class="row.qualityQty > 0 ? 'text-warning' : ''">{{ row.qualityQty || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="差异(吨)" width="100" align="right">
            <template #default="{ row }">
              <span class="num" :class="row.status === 'diff' ? 'text-danger' : ''">{{ row.diff > 0 ? '+' : '' }}{{ row.diff }}</span>
            </template>
          </el-table-column>
          <el-table-column label="签收" width="90" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.hasReceipt === null" size="small" type="info" effect="plain">不适用</el-tag>
              <el-tag v-else-if="row.hasReceipt" size="small" type="success" effect="plain">已签收</el-tag>
              <el-tag v-else size="small" type="danger" effect="plain">未签收</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="结果" width="100" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === 'diff' ? 'warning' : 'success'" effect="plain">
                {{ row.status === 'diff' ? '需确认' : '一致' }}
              </el-tag>
            </template>
          </el-table-column>
          <ActionColumn v-if="can('dispatch')" width="90">
            <template #default="{ row }">
              <el-button
                v-if="row.hasReceipt === false"
                link
                type="warning"
                size="small"
                @click="openSupplement(row.dispatchId)"
              >
                补签
              </el-button>
              <span v-else class="text-muted">—</span>
            </template>
          </ActionColumn>
        </el-table>
        <el-empty
          v-else
          description="尚未发起对账，发起后将展示调度量、磅单净重、结算量三方比对结果"
          :image-size="60"
        />
      </div>
    </div>

    <!-- 登记收款 -->
    <el-dialog v-model="payDialog" title="登记收款" width="440px">
      <el-form label-width="90px">
        <el-form-item label="未付余额">
          <span class="num amount">{{ formatMoney(unpaid) }}</span>
        </el-form-item>
        <el-form-item label="收款金额">
          <el-input-number v-model="payAmount" :min="1" :max="unpaid" :precision="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="收款方式">
          <el-select v-model="payMethod" style="width: 100%">
            <el-option v-for="m in payMethods" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="payDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmPay">确认收款</el-button>
      </template>
    </el-dialog>

    <!-- 环节5：预付款抵扣（FIFO 抵扣客户可用预付款，记入收款流水） -->
    <el-dialog v-model="prepayDialog" title="预付款抵扣" width="440px">
      <el-form label-width="90px">
        <el-form-item label="未付余额">
          <span class="num amount">{{ formatMoney(unpaid) }}</span>
        </el-form-item>
        <el-form-item label="可用预付款">
          <span class="num text-success">{{ formatMoney(prepayAvail) }}</span>
        </el-form-item>
        <el-form-item label="抵扣金额">
          <el-input-number v-model="prepayAmount" :min="1" :max="Math.min(unpaid, prepayAvail)" :precision="0" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="prepayDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmPrepay">确认抵扣</el-button>
      </template>
    </el-dialog>

    <!-- 收款冲正/退款：撤销误登记收款，回退已付金额（预付款抵扣流水同步释放占用） -->
    <el-dialog v-model="revertDialog" title="收款冲正" width="460px">
      <div v-if="revertTarget">
        <el-alert
          :title="`冲正流水 ${revertTarget.id}（${formatMoney(revertTarget.amount)} · ${revertTarget.method}）后，已付金额将回退，剩余未付 ${formatMoney(unpaid + revertTarget.amount)}。${revertTarget.method === '预付款抵扣' ? '对应预付款占用将同步释放。' : ''}该操作不可撤销。`"
          type="warning"
          :closable="false"
          show-icon
        />
        <el-form label-width="90px" style="margin-top: 16px">
          <el-form-item label="冲正原因" required>
            <el-input
              v-model="revertReason"
              type="textarea"
              :rows="2"
              maxlength="200"
              show-word-limit
              placeholder="如：客户重复付款、金额登记错误、退款等"
            />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="revertDialog = false">取消</el-button>
        <el-button type="danger" @click="confirmRevert">确认冲正</el-button>
      </template>
    </el-dialog>

    <!-- 发起催收（P1 逾期催收） -->
    <el-dialog v-model="dunningDialog" title="发起催收" width="440px">
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        :title="`账单 ${settlement?.billNo} 未付余额 ${formatMoney(unpaid)}，催收将提醒客户尽快付款并留痕。`"
        style="margin-bottom: 16px"
      />
      <el-form label-width="90px">
        <el-form-item label="催收级别">
          <el-radio-group v-model="dunningLevel">
            <el-radio-button value="reminder">付款提醒</el-radio-button>
            <el-radio-button v-if="settlement?.status === 'overdue'" value="formal">正式催收</el-radio-button>
            <el-radio-button v-if="settlement?.status === 'overdue'" value="legal">法务函</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dunningDialog = false">取消</el-button>
        <el-button type="warning" @click="confirmDunning">确认催收</el-button>
      </template>
    </el-dialog>

    <!-- 补签（环节1：对账明细中未签收公路车次，与收货方核实后补开） -->
    <el-dialog v-model="supDialog" title="补签电子签收单" width="480px">
      <div v-if="supTarget">
        <el-alert
          :title="'调度单 ' + supTarget + ' 无电子签收单（收货凭证），补签前不可确认结算'"
          type="warning"
          :closable="false"
          show-icon
        />
        <el-form label-width="90px" style="margin-top: 16px">
          <el-form-item label="签收人" required>
            <el-input v-model="supForm.signer" maxlength="20" placeholder="收货方签收人姓名" />
          </el-form-item>
          <el-form-item label="补签原因">
            <el-input v-model="supForm.reason" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="如：签收单遗失，已与收货方核实" />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="supDialog = false">取消</el-button>
        <el-button type="primary" @click="submitSupplement">确认补签</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'SettlementDetail' })
import ActionColumn from '@/components/ActionColumn.vue'
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, DocumentChecked, CircleCheck, Printer, Money, Refresh } from '@element-plus/icons-vue'
import StatusTag from '@/components/StatusTag.vue'
import { db } from '@/mock'
// 本视图交叉引用查找（原 @/mock find 下沉，仅声明本视图用到的键）
const find = {
  customer: (id) => db.customers.find((c) => c.id === id),
  contract: (id) => db.contracts.find((c) => c.id === id),
  settlement: (id) => db.settlements.find((s) => s.id === id),
}
import { prepaymentAvailable } from '@/mock/derived'
import { api, refreshDb } from '@/api'
import { usePerm } from '@/permission'
import { formatMoney, formatNum } from '@/utils'

const route = useRoute()
const { can } = usePerm()

/* ===== Phase 4 灰度：生产模式（薄客户端）——结算详情读后端 /api/coll/settlements/{id} + invoices/payments/dunnings ===== */
const settlementRec = ref(null)
async function loadDetail() {
  const r = await api('GET', '/coll/settlements/' + route.params.id)
  settlementRec.value = r.ok ? r.data : null
}
const settlement = computed(() => settlementRec.value || find.settlement(route.params.id))
const customer = computed(() => find.customer(settlement.value?.customerId))
/** 发票：优先取最新一张非红冲发票（红冲后重开时不展示旧红冲票） */
const invoice = computed(() => {
  const list = db.invoices.filter((i) => i.settlementId === settlement.value?.id)
  if (!list.length) return null
  return list.find((i) => i.status !== 'red-flushed') || list[list.length - 1]
})
onMounted(loadDetail)
watch(() => route.params.id, loadDetail)

/* ===== Phase 4 引擎移除：生产模式写操作 = 后端权威（POST 落库）+ 快照重取 + 重取主记录 =====
 * 不再依赖本地乐观改态；后端为完整状态机（返回 real/amount/round/diffCount/delta/invoiceNo/code 与 flow 同形）。
 * 成功返回 r.data，失败 ElMessage.error 返回 null。refreshDb 联动收款/催收/发票集合，loadDetail 重取权威账单。 */
async function prodWrite(path, body) {
  const r = await api('POST', path, body)
  if (!r.ok || (r.data && r.data.error)) {
    ElMessage.error((r.data && r.data.error) || r.error || '操作失败')
    return null
  }
  await refreshDb()
  await loadDetail()
  return r.data
}

const statusMap = {
  pending: { label: '待对账', type: 'info' },
  reconciling: { label: '对账中', type: 'warning' },
  settled: { label: '已结算', type: 'success' },
  overdue: { label: '已逾期', type: 'danger' }
}
const invoiceMap = { 'not-issued': '未开票', issued: '已开票', pending: '开票中' }

const feeRows = computed(() => {
  const s = settlement.value
  if (!s) return []
  const price = find.contract(s.contractId)?.unitPrice || '-'
  const rows = [
    { name: '运输费', rule: `结算量 ${formatNum(s.totalQuantity)} 吨 × 合同单价（${price} 元/吨，按出磅净重）`, amount: s.freight },
    { name: '装货费', rule: '结算量 × 8 元/吨', amount: s.loadingFee },
    { name: '卸货费', rule: '结算量 × 6 元/吨', amount: s.unloadingFee },
    { name: '过路过桥费', rule: '按实际发生', amount: s.tollFee },
    { name: '附加费', rule: '加急/夜间/特殊作业', amount: s.surcharge }
  ]
  if (s.lossDeduction > 0) {
    rows.push({ name: '损耗扣减', rule: `损耗 ${s.lossQty} 吨 × ${price} 元/吨（磅单结算）`, amount: -s.lossDeduction })
  }
  if (s.qualityDeduction > 0) {
    rows.push({
      name: '质量扣减',
      rule: `水分/灰分超标扣重 ${s.qualityQty} 吨 × ${price} 元/吨（标准水分 10% / 灰分 15%）`,
      amount: -s.qualityDeduction
    })
  }
  if (s.exceptionLoss > 0) {
    rows.push({ name: '异常损失', rule: '关联已关闭异常成本扣减', amount: -s.exceptionLoss })
  }
  return rows
})

const unpaid = computed(() => (settlement.value ? settlement.value.totalAmount - settlement.value.paidAmount : 0))
const paymentDays = computed(() => find.contract(settlement.value?.contractId)?.paymentDays)
const payments = computed(() => db.payments.filter((p) => p.settlementId === settlement.value?.id))
const canRecordPayment = computed(() => {
  const s = settlement.value
  return s && (s.status === 'settled' || s.status === 'overdue') && s.totalAmount - s.paidAmount > 0
})
/** 冲正可用：账单处于已结算/逾期（收款阶段） */
const canRevert = computed(() => {
  const s = settlement.value
  return s && (s.status === 'settled' || s.status === 'overdue')
})

/* ===== 登记收款 ===== */
const payDialog = ref(false)
const payAmount = ref(0)
const payMethod = ref('银行转账')
const payMethods = ['银行转账', '支票', '承兑汇票']

function openPayDialog() {
  payAmount.value = settlement.value.totalAmount - settlement.value.paidAmount
  payMethod.value = '银行转账'
  payDialog.value = true
}

async function confirmPay() {
  const d = await prodWrite('/settlement/' + settlement.value.id + '/recordPayment', { amount: payAmount.value, method: payMethod.value })
  if (!d) return
  payDialog.value = false
  ElMessage.success(`已登记收款 ${formatMoney(d.amount != null ? d.amount : payAmount.value)}`)
}

/* ===== 环节5：预付款抵扣 ===== */
const prepayDialog = ref(false)
const prepayAmount = ref(0)
const prepayAvail = computed(() => prepaymentAvailable(settlement.value?.customerId))

function openPrepayDialog() {
  prepayAmount.value = Math.min(settlement.value.totalAmount - settlement.value.paidAmount, prepayAvail.value)
  prepayDialog.value = true
}

async function confirmPrepay() {
  const d = await prodWrite('/settlement/' + settlement.value.id + '/applyPrepayment', { amount: prepayAmount.value })
  if (!d) return
  prepayDialog.value = false
  ElMessage.success(`预付款抵扣 ${formatMoney(d.amount != null ? d.amount : prepayAmount.value)}，剩余未付 ${formatMoney(unpaid.value)}`)
}

/* ===== 收款冲正/退款 ===== */
const revertDialog = ref(false)
const revertTarget = ref(null)
const revertReason = ref('')

function openRevert(row) {
  revertTarget.value = row
  revertReason.value = ''
  revertDialog.value = true
}

async function confirmRevert() {
  if (!revertReason.value.trim()) {
    ElMessage.warning('请填写冲正原因')
    return
  }
  const d = await prodWrite('/settlement/' + settlement.value.id + '/revertPayment/' + revertTarget.value.id, { reason: revertReason.value.trim() })
  if (!d) return
  revertDialog.value = false
  ElMessage.success(`已冲正 ${formatMoney(d.amount != null ? d.amount : 0)}，剩余未付 ${formatMoney(unpaid.value)}`)
}

/* ===== 催收（P1 逾期催收） ===== */
const dunnings = computed(() => db.dunnings.filter((x) => x.settlementId === settlement.value?.id))
/** 可催收：账单处于已结算/逾期且有未付余额 */
const canDunning = computed(() => {
  const s = settlement.value
  return !!s && ['settled', 'overdue'].includes(s.status) && s.totalAmount - s.paidAmount > 0
})
const dunningDialog = ref(false)
const dunningLevel = ref('reminder')

function dunningLevelType(level) {
  return { reminder: 'info', formal: 'warning', legal: 'danger' }[level] || 'info'
}

function openDunning() {
  dunningLevel.value = settlement.value?.status === 'overdue' ? 'formal' : 'reminder'
  dunningDialog.value = true
}

async function confirmDunning() {
  const d = await prodWrite('/settlement/' + settlement.value.id + '/dunning', { level: dunningLevel.value })
  if (!d) return
  dunningDialog.value = false
  ElMessage.success(`已发起第 ${d.round != null ? d.round : 1} 轮催收，已提醒客户`)
}

const stepActive = computed(() => {
  const s = settlement.value
  if (!s) return 0
  if (s.status === 'pending') return 1
  if (s.status === 'reconciling') return 2
  return 4
})

/** 未关闭的客户异议单（环节2：异议后账单回待对账，重新对账 + 客户再确认后自动关闭） */
const openObjections = computed(() => (settlement.value?.objections || []).filter((o) => o.status === 'open'))

/** 客户确认状态：按客户门户实际确认记录（customerConfirmed），不再按账单状态推断 */
const customerConfirmDesc = computed(() => {
  const s = settlement.value
  if (s?.customerConfirmed) return `已确认 · ${s.customerConfirmed.time}`
  if (openObjections.value.length) return `客户异议 · 待重新对账（${openObjections.value[0].time}）`
  return '待客户确认（客户门户可确认）'
})

/* ===== 补签（环节1：对账明细未签收公路车次，与收货方核实后补开） ===== */
const supDialog = ref(false)
const supTarget = ref('')
const supForm = reactive({ signer: '', reason: '' })

function openSupplement(dispatchId) {
  supTarget.value = dispatchId
  supForm.signer = ''
  supForm.reason = ''
  supDialog.value = true
}

async function submitSupplement() {
  if (!supForm.signer.trim()) {
    ElMessage.warning('请填写签收人')
    return
  }
  const d = await prodWrite('/dispatch/' + supTarget.value + '/supplementReceipt', { signer: supForm.signer.trim(), reason: supForm.reason.trim() })
  if (!d) return
  supDialog.value = false
  ElMessage.success(`补签成功：${(d.receipt && d.receipt.code) || ''}（签收人 ${supForm.signer.trim()}），对账结果已刷新`)
}

function invoiceType(status) {
  return { issued: 'success', pending: 'warning', 'not-issued': 'info' }[status] || 'info'
}

function startReconcile() {
  ElMessageBox.confirm('确认发起对账？将执行调度量 vs 磅单净重 vs 结算量三方比对。', '发起对账', { type: 'info' }).then(async () => {
    const d = await prodWrite('/settlement/' + settlement.value.id + '/startReconcile')
    if (!d) return
    const dc = (d.reconciliation && d.reconciliation.diffCount) || d.diffCount || 0
    ElMessage.success(dc ? `对账完成：${dc} 车次存在差异` : '对账完成：无差异')
  }).catch(() => {})
}

function recalc() {
  ElMessageBox.confirm(
    '重算将按当前磅单净重与已关闭异常损失刷新结算金额（适用于生成账单后磅单补录、异常损失变化），差异记入调整记录。',
    '重算结算',
    { type: 'info', confirmButtonText: '确认重算' }
  ).then(async () => {
    const d = await prodWrite('/settlement/' + settlement.value.id + '/recalc')
    if (!d) return
    ElMessage.success(d.delta ? `重算完成：结算金额调整 ${d.delta > 0 ? '+' : ''}${formatMoney(d.delta)}` : '重算完成：金额无变化')
  }).catch(() => {})
}

function settle() {
  const s = settlement.value
  const r = s.reconciliation
  const lossWarn =
    r && r.lossQty > 0
      ? `<br/><span style="color:var(--color-warning)">本期损耗合计 ${r.lossQty} 吨（约 ${formatMoney(r.lossAmount)}），按出磅净重结算，损耗已扣减。</span>`
      : ''
  const qualityWarn =
    r && r.qualityQty > 0
      ? `<br/><span style="color:var(--color-warning)">本期质量扣重合计 ${r.qualityQty} 吨（约 ${formatMoney(r.qualityAmount)}，水分/灰分超标扣减），已扣减。</span>`
      : ''
  const diffWarn =
    r && r.diffCount
      ? `<br/><span style="color:var(--color-danger)">${r.diffCount} 车次进磅与调度量存在差异，请确认后再结算。</span>`
      : ''
  const receiptWarn =
    r && r.missingReceiptCount
      ? `<br/><span style="color:var(--color-danger)">${r.missingReceiptCount} 车次公路车次尚无电子签收单（收货凭证），签收是结算依据，未补齐前无法确认结算（对账明细可"补签"）。</span>`
      : ''
  const confirmWarn = s.customerConfirmed
    ? ''
    : `<br/><span style="color:var(--color-danger)">客户尚未确认对账结果，需客户在客户门户确认后方可结算。</span>`
  ElMessageBox.confirm(
    `确认结算 ${s.billNo}？结算金额 ${formatMoney(s.totalAmount)}，账期 ${paymentDays.value || 30} 天，到期未付清将标记逾期。${lossWarn}${qualityWarn}${diffWarn}${receiptWarn}${confirmWarn}`,
    '确认结算',
    { dangerouslyUseHTMLString: true, type: 'success', confirmButtonText: '确认结算' }
  ).then(async () => {
    const d = await prodWrite('/settlement/' + s.id + '/confirmSettle')
    if (d) ElMessage.success('结算完成，进入收款')
  }).catch(() => {})
}

async function issueInvoice() {
  const d = await prodWrite('/settlement/' + settlement.value.id + '/issueInvoice')
  if (!d) return
  ElMessage.success(`发票已开具：${d.invoiceNo || ''}`)
}

function printBill() {
  const s = settlement.value
  const rows = feeRows.value
    .map((f) => `<tr><td>${f.name}</td><td>${f.rule}</td><td style="text-align:right">${formatNum(f.amount)}</td></tr>`)
    .join('')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>对账单 ${s.billNo}</title>
  <style>
    body{font-family:'Microsoft YaHei',sans-serif;padding:40px;color:#1d2129}
    h1{text-align:center;font-size:22px}
    .meta{text-align:center;color:#86909c;margin-bottom:20px}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    td,th{border:1px solid #e5e6eb;padding:10px;font-size:14px}
    th{background:#f7f8fa;text-align:left}
    .total{margin-top:16px;font-size:16px;display:flex;justify-content:space-between}
    .sign{display:flex;justify-content:space-between;margin-top:60px}
  </style></head><body>
  <h1>运费结算对账单</h1>
  <div class="meta">账单编号：${s.billNo} &nbsp; 结算周期：${s.period} &nbsp; 客户：${customer.value?.name}</div>
  <table>
    <tr><th>费用项</th><th>计费规则</th><th style="text-align:right">金额(元)</th></tr>
    ${rows}
  </table>
  <div class="total"><span>结算总额</span><b>${formatMoney(s.totalAmount)}</b></div>
  <div class="sign">
    <div>供方（盖章）：__________________</div>
    <div>需方（盖章）：__________________</div>
  </div>
  </body></html>`
  const win = window.open('', '_blank')
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 300)
}
</script>

<style scoped>
.settlement-detail__header {
  padding: 16px 20px;
}

.settlement-detail__head {
  display: flex;
  align-items: center;
  gap: 16px;
}

.settlement-detail__name {
  font-size: 17px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 10px;
}

.settlement-detail__meta {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.settlement-detail__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.link {
  color: var(--color-primary);
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
}

.fee-total {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-top: 1px dashed var(--border-color);
  margin-top: 8px;
  font-size: 14px;
  color: var(--text-secondary);
}

.fee-total__value {
  font-size: 16px;
  color: var(--text-primary);
}

.text-success {
  color: var(--color-success) !important;
}

.text-warning {
  color: var(--color-warning) !important;
}

.text-danger {
  color: var(--color-danger) !important;
}

.text-muted {
  color: var(--text-secondary);
}

.recon-summary {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
