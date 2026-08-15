<template>
  <div class="page" v-loading="loading">
    <PageHeader title="数据看板" desc="平台运营核心指标与趋势分析（数据每日更新）">
      <el-radio-group v-model="range" size="small">
        <el-radio-button value="12">近 12 月</el-radio-button>
        <el-radio-button value="6">近 6 月</el-radio-button>
        <el-radio-button value="3">近 3 月</el-radio-button>
      </el-radio-group>
    </PageHeader>

    <!-- KPI -->
    <div class="kpi-row">
      <StatCard title="累计运量" :value="formatNum(kpi.totalVolume / 10000, 1)" unit="万吨" icon="DataLine" color="var(--color-primary)" :trend="8.4" trend-label="同比" />
      <StatCard title="累计运费收入" :value="formatNum(kpi.totalRevenue / 100000000, 2)" unit="亿元" icon="Money" color="var(--color-success)" :trend="11.2" trend-label="同比" />
      <StatCard title="车辆利用率" :value="kpi.utilization" unit="%" icon="Van" color="var(--color-warning)" :trend="2.8" trend-label="较上月" />
      <StatCard title="准时交付率" :value="kpi.onTimeRate" unit="%" icon="Timer" color="var(--color-info)" :trend="0.6" trend-label="较上月" />
      <StatCard title="安全运行" :value="kpi.safeDays" unit="天" icon="Umbrella" color="var(--color-danger)" :sub="'连续无重大事故'" />
      <StatCard title="合作客户" :value="kpi.customerCount" unit="家" icon="Avatar" color="var(--color-primary)" :sub="'A 级 6 家'" />
    </div>

    <!-- 图表区 -->
    <el-row :gutter="16">
      <el-col :span="16">
        <ChartCard title="运量与运费收入趋势" :option="volumeOption" height="320" />
      </el-col>
      <el-col :span="8">
        <ChartCard title="商品结构（按类别）" :option="commodityOption" height="320" />
      </el-col>
    </el-row>

    <el-row :gutter="16">
      <el-col :span="8">
        <ChartCard title="运输方式占比" :option="modeOption" height="300" />
      </el-col>
      <el-col :span="8">
        <ChartCard title="场站今日吞吐量 TOP8" :option="terminalOption" height="300" />
      </el-col>
      <el-col :span="8">
        <ChartCard title="车辆状态分布" :option="vehicleOption" height="300" />
      </el-col>
    </el-row>

    <el-row :gutter="16">
      <el-col :span="12">
        <ChartCard title="近 30 天异常趋势" :option="exceptionOption" height="280" />
      </el-col>
      <el-col :span="12">
        <ChartCard title="结算金额分布（按周期）" :option="settlementOption" height="280" />
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
defineOptions({ name: 'Monitor' })
import { ref, computed, onMounted } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import ChartCard from '@/components/ChartCard.vue'
import { db, dashboard } from '@/mock'
import { formatNum } from '@/utils'
import { useTokens } from '@/utils/tokens'

const tokens = useTokens()

const loading = ref(true)
const range = ref('12')
onMounted(() => setTimeout(() => (loading.value = false), 300))

const kpi = dashboard.kpi

const palette = [tokens.primary, tokens.success, tokens.warning, tokens.danger, tokens.info, tokens.chartPurple, tokens.chartCyan, tokens.chartPink]

/* ===== 运量趋势 ===== */
const volumeOption = computed(() => {
  const data = dashboard.volumeTrend.slice(-range.value)
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['运量(万吨)', '运费收入(万元)'], bottom: 0 },
    grid: { left: 55, right: 60, top: 30, bottom: 45 },
    xAxis: {
      type: 'category',
      data: data.map((d) => d.month),
      axisLine: { lineStyle: { color: tokens.border } },
      axisLabel: { color: tokens.info }
    },
    yAxis: [
      {
        type: 'value',
        name: '万吨',
        splitLine: { lineStyle: { color: tokens.neutral100 } },
        axisLabel: { color: tokens.info }
      },
      {
        type: 'value',
        name: '万元',
        splitLine: { show: false },
        axisLabel: { color: tokens.info }
      }
    ],
    series: [
      {
        name: '运量(万吨)',
        type: 'bar',
        data: data.map((d) => Math.round(d.volume / 1000) / 10),
        itemStyle: { color: tokens.primary, borderRadius: [4, 4, 0, 0] },
        barWidth: 18
      },
      {
        name: '运费收入(万元)',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        data: data.map((d) => Math.round(d.revenue / 10000)),
        itemStyle: { color: tokens.warning },
        lineStyle: { width: 3 }
      }
    ]
  }
})

/* ===== 商品结构 ===== */
const commodityOption = computed(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} 吨 ({d}%)' },
  legend: { bottom: 0 },
  color: palette,
  series: [
    {
      type: 'pie',
      radius: ['42%', '68%'],
      center: ['50%', '45%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: tokens.card, borderWidth: 2 },
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold' } },
      data: dashboard.commodityStructure
    }
  ]
}))

/* ===== 运输方式 ===== */
const modeOption = computed(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} 吨 ({d}%)' },
  legend: { bottom: 0 },
  color: palette,
  series: [
    {
      type: 'pie',
      radius: '65%',
      center: ['50%', '45%'],
      roseType: 'radius',
      itemStyle: { borderRadius: 6, borderColor: tokens.card, borderWidth: 2 },
      label: { formatter: '{b}\n{d}%', fontSize: 11 },
      data: dashboard.modeShare
    }
  ]
}))

/* ===== 场站吞吐 ===== */
const terminalOption = computed(() => ({
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  grid: { left: 100, right: 40, top: 10, bottom: 20 },
  xAxis: {
    type: 'value',
    splitLine: { lineStyle: { color: tokens.neutral100 } },
    axisLabel: { color: tokens.info }
  },
  yAxis: {
    type: 'category',
    data: dashboard.terminalThroughput.map((t) => t.name).reverse(),
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: tokens.textRegular, fontSize: 11 }
  },
  series: [
    {
      type: 'bar',
      data: dashboard.terminalThroughput.map((t) => t.value).reverse(),
      itemStyle: {
        borderRadius: [0, 4, 4, 0],
        color: {
          type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
          colorStops: [
            { offset: 0, color: tokens.primary400 },
            { offset: 1, color: tokens.primary }
          ]
        }
      },
      barWidth: 14,
      label: { show: true, position: 'right', color: tokens.info, fontSize: 11 }
    }
  ]
}))

/* ===== 车辆状态 ===== */
const vehicleOption = computed(() => ({
  tooltip: { trigger: 'item' },
  legend: { bottom: 0 },
  color: [tokens.primary, tokens.success, tokens.warning, tokens.danger, tokens.neutral300],
  series: [
    {
      type: 'pie',
      radius: ['42%', '68%'],
      center: ['50%', '45%'],
      itemStyle: { borderRadius: 6, borderColor: tokens.card, borderWidth: 2 },
      label: { formatter: '{b} {c}辆', fontSize: 11 },
      data: dashboard.vehicleStatus
    }
  ]
}))

/* ===== 异常趋势 ===== */
const exceptionOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 40, right: 20, top: 30, bottom: 30 },
  xAxis: {
    type: 'category',
    data: dashboard.exceptionTrend.map((d) => d.date),
    axisLabel: { color: tokens.info, interval: 4 },
    axisLine: { lineStyle: { color: tokens.border } }
  },
  yAxis: {
    type: 'value',
    minInterval: 1,
    splitLine: { lineStyle: { color: tokens.neutral100 } },
    axisLabel: { color: tokens.info }
  },
  series: [
    {
      name: '异常数',
      type: 'bar',
      data: dashboard.exceptionTrend.map((d) => d.count),
      itemStyle: {
        borderRadius: [4, 4, 0, 0],
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: tokens.warning },
            { offset: 1, color: tokens.warning200 }
          ]
        }
      },
      barWidth: 12
    }
  ]
}))

/* ===== 结算分布 ===== */
const settlementOption = computed(() => {
  const map = {}
  for (const s of db.settlements) {
    map[s.period] = (map[s.period] || 0) + s.totalAmount
  }
  const entries = Object.entries(map).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 6)
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v) => `¥${Number(v).toLocaleString()}` },
    grid: { left: 70, right: 30, top: 20, bottom: 30 },
    xAxis: {
      type: 'category',
      data: entries.map((e) => e[0]),
      axisLabel: { color: tokens.info },
      axisLine: { lineStyle: { color: tokens.border } }
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
        data: entries.map((e) => Math.round(e[1] / 10000)),
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: tokens.success },
              { offset: 1, color: tokens.success200 }
            ]
          }
        },
        barWidth: 26,
        label: { show: true, position: 'top', color: tokens.info, fontSize: 11 }
      }
    ]
  }
})
</script>

<style scoped>
.kpi-row {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
}
</style>
