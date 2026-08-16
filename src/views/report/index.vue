<template>
  <div class="page" v-loading="loading">
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
                  <el-table-column prop="month" label="月份" width="100" />
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
import { monthlyReport, customerReport, commodityReport, terminalReport } from '@/mock/report'
import { formatMoney, formatNum } from '@/utils'
import dayjs from 'dayjs'
import { useTokens } from '@/utils/tokens'

const tokens = useTokens()

const loading = ref(true)
onMounted(() => setTimeout(() => (loading.value = false), 300))

const activeTab = ref('monthly')
const monthly = computed(() => monthlyReport())
const customer = computed(() => customerReport())
const commodity = computed(() => commodityReport())
const terminal = computed(() => terminalReport())

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
