<template>
  <div class="page">
    <PageHeader title="报表中心" desc="按业务口径实时汇总（月度运营 / 客户经营 / 商品运量 / 场站吞吐），支持导出">
      <el-button :icon="Download" @click="exportCurrent">导出当前报表</el-button>
    </PageHeader>

    <el-tabs v-model="activeTab">
      <!-- 月度运营 -->
      <el-tab-pane label="月度运营" name="monthly">
        <el-row :gutter="16">
          <el-col :span="10">
            <ChartCard title="结算与收款金额（万元）" :option="monthlyOption" height="300" />
          </el-col>
          <el-col :span="14">
            <div class="panel">
              <div class="panel__body">
                <el-table :data="monthly" stripe size="small">
                  <el-table-column prop="month" label="月份" min-width="100" />
                  <el-table-column prop="trips" label="完成车次" width="90" align="right" />
                  <el-table-column label="运量(吨)" width="110" align="right">
                    <template #default="{ row }"><span class="num">{{ formatNum(row.volume) }}</span></template>
                  </el-table-column>
                  <el-table-column label="结算金额" width="130" align="right">
                    <template #default="{ row }"><span class="num amount">{{ formatMoney(row.settleAmount) }}</span></template>
                  </el-table-column>
                  <el-table-column label="收款金额" width="130" align="right">
                    <template #default="{ row }"><span class="num">{{ formatMoney(row.paidAmount) }}</span></template>
                  </el-table-column>
                  <el-table-column label="逾期账单" width="90" align="center">
                    <template #default="{ row }">
                      <el-tag v-if="row.overdueCount" size="small" type="danger" effect="light">{{ row.overdueCount }}</el-tag>
                      <span v-else class="text-muted">0</span>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </div>
          </el-col>
        </el-row>
      </el-tab-pane>

      <!-- 客户经营 -->
      <el-tab-pane label="客户经营" name="customer">
        <div class="panel">
          <div class="panel__body">
            <el-table :data="customer" stripe size="small">
              <el-table-column prop="name" label="客户" min-width="180" show-overflow-tooltip />
              <el-table-column prop="contracts" label="合同数" width="80" align="center" />
              <el-table-column prop="trips" label="完成车次" width="90" align="right" />
              <el-table-column label="运量(吨)" width="110" align="right">
                <template #default="{ row }"><span class="num">{{ formatNum(row.volume) }}</span></template>
              </el-table-column>
              <el-table-column label="结算金额" width="130" align="right">
                <template #default="{ row }"><span class="num amount">{{ formatMoney(row.settleAmount) }}</span></template>
              </el-table-column>
              <el-table-column label="未付余额" width="130" align="right">
                <template #default="{ row }"><span class="num text-danger">{{ formatMoney(row.outstanding) }}</span></template>
              </el-table-column>
              <el-table-column label="授信占用" min-width="140">
                <template #default="{ row }">
                  <el-progress
                    :percentage="Math.min(100, row.creditPct)"
                    :stroke-width="8"
                    :color="row.creditPct >= 100 ? 'var(--color-danger)' : row.creditPct >= 80 ? 'var(--color-warning)' : 'var(--color-success)'"
                  />
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>

      <!-- 商品运量 -->
      <el-tab-pane label="商品运量" name="commodity">
        <div class="panel">
          <div class="panel__body">
            <el-table :data="commodity" stripe size="small">
              <el-table-column prop="name" label="商品" min-width="140" />
              <el-table-column prop="category" label="类别" width="100" align="center" />
              <el-table-column prop="trips" label="完成车次" width="100" align="right" />
              <el-table-column label="运量(吨)" width="120" align="right">
                <template #default="{ row }"><span class="num">{{ formatNum(row.volume) }}</span></template>
              </el-table-column>
              <el-table-column label="磅单损耗率" width="120" align="center">
                <template #default="{ row }">
                  <span :class="{ 'text-danger': row.lossRate > 3 }">{{ row.lossRate }}%</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>

      <!-- 场站吞吐 -->
      <el-tab-pane label="场站吞吐" name="terminal">
        <div class="panel">
          <div class="panel__body">
            <el-table :data="terminal" stripe size="small">
              <el-table-column prop="name" label="场站" min-width="180" show-overflow-tooltip />
              <el-table-column prop="loadTrips" label="装货车次" width="100" align="right" />
              <el-table-column label="装货量(吨)" width="120" align="right">
                <template #default="{ row }"><span class="num">{{ formatNum(row.loadVolume) }}</span></template>
              </el-table-column>
              <el-table-column prop="unloadTrips" label="卸货车次" width="100" align="right" />
              <el-table-column label="卸货量(吨)" width="120" align="right">
                <template #default="{ row }"><span class="num">{{ formatNum(row.unloadVolume) }}</span></template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>

      <!-- 成本利润 -->
      <el-tab-pane label="成本利润" name="cost">
        <div class="cost-tab">
          <div class="stat-row">
            <StatCard title="总成本" :value="formatMoney(cost.summary.cost)" icon="Money" color="var(--color-danger)" :sub="cost.summary.trips + ' 个完成车次'" />
            <StatCard title="总收入" :value="formatMoney(cost.summary.revenue)" icon="Coin" color="var(--color-success)" sub="按出磅净重结算" />
            <StatCard
              title="毛利"
              :value="formatMoney(cost.summary.profit)"
              icon="TrendCharts"
              :color="cost.summary.profit >= 0 ? 'var(--color-primary)' : 'var(--color-danger)'"
            />
            <StatCard
              title="毛利率"
              :value="cost.summary.margin"
              unit="%"
              icon="PieChart"
              :color="cost.summary.margin >= 0 ? 'var(--color-success)' : 'var(--color-danger)'"
            />
          </div>

          <el-row :gutter="16">
            <el-col :span="10">
              <ChartCard title="月度成本与收入（万元）" :option="costOption" height="300" />
            </el-col>
            <el-col :span="14">
              <div class="panel">
                <div class="panel__header"><span class="panel__title">月度成本利润</span></div>
                <div class="panel__body">
                  <el-table :data="cost.byMonth" stripe size="small">
                    <el-table-column prop="month" label="月份" min-width="100" />
                    <el-table-column prop="trips" label="完成车次" width="90" align="right" />
                    <el-table-column label="成本" width="110" align="right">
                      <template #default="{ row }"><span class="num">{{ formatMoney(row.cost) }}</span></template>
                    </el-table-column>
                    <el-table-column label="收入" width="110" align="right">
                      <template #default="{ row }"><span class="num">{{ formatMoney(row.revenue) }}</span></template>
                    </el-table-column>
                    <el-table-column label="毛利" width="110" align="right">
                      <template #default="{ row }">
                        <span class="num" :class="row.profit < 0 ? 'text-danger' : 'amount'">{{ formatMoney(row.profit) }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="毛利率" width="80" align="right">
                      <template #default="{ row }">
                        <span :class="{ 'text-danger': row.margin < 0 }">{{ row.margin }}%</span>
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
              </div>
            </el-col>
          </el-row>

          <el-row :gutter="16">
            <el-col :span="12">
              <div class="panel">
                <div class="panel__header">
                  <span class="panel__title">单车效益</span>
                  <el-tag size="small" type="info" effect="plain">公路车次 · 按车次降序</el-tag>
                </div>
                <div class="panel__body">
                  <el-table :data="cost.byVehicle" stripe size="small" max-height="360">
                    <el-table-column prop="plate" label="车牌" min-width="110" />
                    <el-table-column prop="type" label="车型" width="110" />
                    <el-table-column prop="trips" label="车次" width="70" align="right" />
                    <el-table-column label="成本" width="100" align="right">
                      <template #default="{ row }"><span class="num">{{ formatMoney(row.cost) }}</span></template>
                    </el-table-column>
                    <el-table-column label="收入" width="100" align="right">
                      <template #default="{ row }"><span class="num">{{ formatMoney(row.revenue) }}</span></template>
                    </el-table-column>
                    <el-table-column label="毛利" width="100" align="right">
                      <template #default="{ row }">
                        <span class="num" :class="row.profit < 0 ? 'text-danger' : 'amount'">{{ formatMoney(row.profit) }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="毛利率" width="80" align="right">
                      <template #default="{ row }">
                        <span :class="{ 'text-danger': row.margin < 0 }">{{ row.margin }}%</span>
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
              </div>
            </el-col>
            <el-col :span="12">
              <div class="panel">
                <div class="panel__header">
                  <span class="panel__title">单线效益</span>
                  <el-tag size="small" type="info" effect="plain">按线路车次降序</el-tag>
                </div>
                <div class="panel__body">
                  <el-table :data="cost.byRoute" stripe size="small" max-height="360">
                    <el-table-column prop="route" label="线路" min-width="180" show-overflow-tooltip />
                    <el-table-column prop="trips" label="车次" width="70" align="right" />
                    <el-table-column label="成本" width="100" align="right">
                      <template #default="{ row }"><span class="num">{{ formatMoney(row.cost) }}</span></template>
                    </el-table-column>
                    <el-table-column label="收入" width="100" align="right">
                      <template #default="{ row }"><span class="num">{{ formatMoney(row.revenue) }}</span></template>
                    </el-table-column>
                    <el-table-column label="毛利" width="100" align="right">
                      <template #default="{ row }">
                        <span class="num" :class="row.profit < 0 ? 'text-danger' : 'amount'">{{ formatMoney(row.profit) }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="毛利率" width="80" align="right">
                      <template #default="{ row }">
                        <span :class="{ 'text-danger': row.margin < 0 }">{{ row.margin }}%</span>
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
              </div>
            </el-col>
          </el-row>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
defineOptions({ name: 'Report' })
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Download } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import ChartCard from '@/components/ChartCard.vue'
import StatCard from '@/components/StatCard.vue'
import { api } from '@/api'
import { formatMoney, formatNum } from '@/utils'
import dayjs from 'dayjs'
import { useTokens } from '@/utils/tokens'

const tokens = useTokens()


const activeTab = ref('monthly')
/* ===== 薄客户端：报表读后端 /api/report/*（只读聚合，无写后断言） ===== */
const monthlyData = ref([])
const customerData = ref([])
const commodityData = ref([])
const terminalData = ref([])
const costData = ref({ byMonth: [], byVehicle: [], byRoute: [] })
async function loadReports() {
  const [m, c, cm, t, co] = await Promise.all([
    api('GET', '/report/monthly'),
    api('GET', '/report/customer'),
    api('GET', '/report/commodity'),
    api('GET', '/report/terminal'),
    api('GET', '/report/cost')
  ])
  if (m.ok) monthlyData.value = m.data
  if (c.ok) customerData.value = c.data
  if (cm.ok) commodityData.value = cm.data
  if (t.ok) terminalData.value = t.data
  if (co.ok) costData.value = co.data
}
onMounted(loadReports)
const monthly = computed(() => monthlyData.value)
const customer = computed(() => customerData.value)
const commodity = computed(() => commodityData.value)
const terminal = computed(() => terminalData.value)
const cost = computed(() => costData.value)

const monthlyOption = computed(() => ({
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  legend: { data: ['结算金额', '收款金额'], bottom: 0 },
  grid: { left: 55, right: 20, top: 30, bottom: 40 },
  xAxis: {
    type: 'category',
    data: monthly.value.map((m) => m.month),
    axisLine: { lineStyle: { color: tokens.border } },
    axisLabel: { color: tokens.info }
  },
  yAxis: {
    type: 'value',
    name: '万元',
    splitLine: { lineStyle: { color: tokens.neutral100 } },
    axisLabel: { color: tokens.info }
  },
  series: [
    {
      name: '结算金额',
      type: 'bar',
      data: monthly.value.map((m) => Math.round(m.settleAmount / 10000)),
      itemStyle: { color: tokens.primary, borderRadius: [4, 4, 0, 0] },
      barWidth: 18
    },
    {
      name: '收款金额',
      type: 'bar',
      data: monthly.value.map((m) => Math.round(m.paidAmount / 10000)),
      itemStyle: { color: tokens.success, borderRadius: [4, 4, 0, 0] },
      barWidth: 18
    }
  ]
}))

const costOption = computed(() => ({
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  legend: { data: ['成本', '收入'], bottom: 0 },
  grid: { left: 55, right: 20, top: 30, bottom: 40 },
  xAxis: {
    type: 'category',
    data: cost.value.byMonth.map((m) => m.month),
    axisLine: { lineStyle: { color: tokens.border } },
    axisLabel: { color: tokens.info }
  },
  yAxis: {
    type: 'value',
    name: '万元',
    splitLine: { lineStyle: { color: tokens.neutral100 } },
    axisLabel: { color: tokens.info }
  },
  series: [
    {
      name: '成本',
      type: 'bar',
      data: cost.value.byMonth.map((m) => Math.round(m.cost / 10000)),
      itemStyle: { color: tokens.danger, borderRadius: [4, 4, 0, 0] },
      barWidth: 18
    },
    {
      name: '收入',
      type: 'bar',
      data: cost.value.byMonth.map((m) => Math.round(m.revenue / 10000)),
      itemStyle: { color: tokens.success, borderRadius: [4, 4, 0, 0] },
      barWidth: 18
    }
  ]
}))

/* ===== 导出当前页签 ===== */
const exportConfigs = {
  monthly: {
    title: '月度运营报表',
    headers: ['月份', '完成车次', '运量(吨)', '结算金额(元)', '收款金额(元)', '逾期账单数'],
    rows: () => monthly.value.map((m) => [m.month, m.trips, m.volume, m.settleAmount, m.paidAmount, m.overdueCount])
  },
  customer: {
    title: '客户经营报表',
    headers: ['客户', '合同数', '完成车次', '运量(吨)', '结算金额(元)', '未付余额(元)', '授信额度(元)', '授信占用(%)'],
    rows: () => customer.value.map((c) => [c.name, c.contracts, c.trips, c.volume, c.settleAmount, c.outstanding, c.creditLimit, c.creditPct])
  },
  commodity: {
    title: '商品运量报表',
    headers: ['商品', '类别', '完成车次', '运量(吨)', '磅单损耗率(%)'],
    rows: () => commodity.value.map((c) => [c.name, c.category, c.trips, c.volume, c.lossRate])
  },
  terminal: {
    title: '场站吞吐报表',
    headers: ['场站', '装货车次', '装货量(吨)', '卸货车次', '卸货量(吨)'],
    rows: () => terminal.value.map((t) => [t.name, t.loadTrips, t.loadVolume, t.unloadTrips, t.unloadVolume])
  },
  cost: {
    title: '成本利润报表',
    headers: ['维度', '名称', '完成车次', '成本(元)', '收入(元)', '毛利(元)', '毛利率(%)'],
    rows: () => [
      ...cost.value.byMonth.map((m) => ['月度', m.month, m.trips, m.cost, m.revenue, m.profit, m.margin]),
      ...cost.value.byRoute.map((r) => ['单线', r.route, r.trips, r.cost, r.revenue, r.profit, r.margin]),
      ...cost.value.byVehicle.map((v) => ['单车', v.plate, v.trips, v.cost, v.revenue, v.profit, v.margin])
    ]
  }
}

function exportCurrent() {
  const cfg = exportConfigs[activeTab.value]
  const rows = cfg.rows()
  const csv =
    '﻿' +
    [cfg.headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${cfg.title}_${dayjs().format('YYYYMMDD')}.csv`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${rows.length} 行`)
}
</script>

<style scoped>
.cost-tab {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.amount {
  font-weight: 600;
  color: var(--text-primary);
}

.text-danger {
  color: var(--color-danger);
}

.text-muted {
  color: var(--text-secondary);
}
</style>
