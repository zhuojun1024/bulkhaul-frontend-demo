<template>
  <div class="page" v-loading="loading">
    <!-- 欢迎横幅 -->
    <div class="welcome">
      <div class="welcome__info">
        <h2 class="welcome__hello">{{ greeting }}，{{ userStore.userInfo.name }}</h2>
        <p class="welcome__date">
          {{ todayStr }} · {{ weekStr }}
          <el-tag size="small" effect="dark" class="welcome__weather">
            <el-icon><Sunny /></el-icon>
            北京 26℃ 晴 · 适宜运输
          </el-tag>
        </p>
        <div class="welcome__stats">
          <div class="welcome__stat">
            <b class="num">{{ dashboard.kpi.executingContracts }}</b>
            <span>执行中合同</span>
          </div>
          <div class="welcome__divider" />
          <div class="welcome__stat">
            <b class="num">{{ dashboard.kpi.intransitCount }}</b>
            <span>在途车辆</span>
          </div>
          <div class="welcome__divider" />
          <div class="welcome__stat">
            <b class="num">{{ formatNum(dashboard.kpi.monthVolume) }}</b>
            <span>本月运量(吨)</span>
          </div>
          <div class="welcome__divider" />
          <div class="welcome__stat">
            <b class="num text-danger">{{ workbenchTodos.pendingExceptions }}</b>
            <span>待处理异常</span>
          </div>
        </div>
      </div>
      <div class="welcome__actions">
        <el-button type="primary" :icon="Plus" @click="$router.push('/contract/create')">新建合同</el-button>
        <el-button plain :icon="Position" @click="$router.push('/dispatch')">调度管理</el-button>
        <el-button plain :icon="MapLocation" @click="$router.push('/track')">在途监控</el-button>
      </div>
    </div>

    <!-- 指标卡 -->
    <div class="stat-row">
      <StatCard title="今日调度" :value="todayDispatches" unit="车次" icon="Position" color="var(--color-primary)" :trend="10.2" trend-label="较昨日" />
      <StatCard title="今日装货" :value="formatNum(todayLoad)" unit="吨" icon="Box" color="var(--color-success)" :trend="6.8" trend-label="较昨日" />
      <StatCard title="今日卸货" :value="formatNum(todayUnload)" unit="吨" icon="DeleteFilled" color="var(--color-warning)" :trend="-3.4" trend-label="较昨日" />
      <StatCard title="本月结算" :value="formatMoney(monthSettled, false) + ' 万'" unit="" icon="Wallet" color="var(--color-info)" :trend="12.6" trend-label="较上月" />
    </div>

    <el-row :gutter="16">
      <!-- 待办事项 -->
      <el-col :span="8">
        <div class="panel todo-panel">
          <div class="panel__header">
            <span class="panel__title">我的待办</span>
            <el-tag size="small" type="danger" effect="light">{{ todoList.length }} 项</el-tag>
          </div>
          <div class="panel__body">
            <div v-for="t in todoList" :key="t.id" class="todo-item" @click="goTodo(t)">
              <div class="todo-item__icon" :style="{ background: t.bg, color: t.color }">
                <el-icon :size="18"><component :is="t.icon" /></el-icon>
              </div>
              <div class="todo-item__body">
                <div class="todo-item__title">{{ t.title }}</div>
                <div class="todo-item__desc">{{ t.desc }}</div>
              </div>
              <el-icon class="todo-item__arrow"><ArrowRight /></el-icon>
            </div>
            <el-empty v-if="!todoList.length" description="太棒了，没有待办事项" :image-size="60" />
          </div>
        </div>
      </el-col>

      <!-- 7日装卸趋势 -->
      <el-col :span="8">
        <ChartCard title="近 7 日装卸量趋势（吨）" :option="trendOption" fluid />
      </el-col>

      <!-- 公告 -->
      <el-col :span="8">
        <div class="panel notice-panel">
          <div class="panel__header">
            <span class="panel__title">平台公告</span>
            <el-link type="primary" :underline="false" @click="$router.push('/system/log')">更多</el-link>
          </div>
          <div class="panel__body">
            <div v-for="n in notices" :key="n.id" class="notice-item">
              <el-tag size="small" :type="noticeTagType(n.tag)" effect="light" class="notice-item__tag">
                {{ n.tag }}
              </el-tag>
              <span class="notice-item__title">{{ n.title }}</span>
              <span class="notice-item__date">{{ n.date }}</span>
            </div>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 最新调度 -->
    <div class="panel">
      <div class="panel__header">
        <span class="panel__title">最新调度动态</span>
        <el-link type="primary" :underline="false" @click="$router.push('/dispatch')">查看全部</el-link>
      </div>
      <div class="panel__body">
        <el-table :data="latestDispatches" stripe size="small">
          <el-table-column prop="id" label="调度单号" width="110" />
          <el-table-column label="车牌号" width="120">
            <template #default="{ row }">{{ find.vehicle(row.vehicleId)?.plate }}</template>
          </el-table-column>
          <el-table-column label="司机" width="90">
            <template #default="{ row }">{{ find.driver(row.driverId)?.name }}</template>
          </el-table-column>
          <el-table-column label="商品" width="90" align="center">
            <template #default="{ row }">{{ find.commodity(row.commodityId)?.name }}</template>
          </el-table-column>
          <el-table-column label="线路" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              {{ find.terminal(row.loadTerminalId)?.name }} → {{ find.terminal(row.unloadTerminalId)?.name }}
            </template>
          </el-table-column>
          <el-table-column label="数量" width="80" align="right">
            <template #default="{ row }">{{ row.quantity }}t</template>
          </el-table-column>
          <el-table-column prop="dispatchTime" label="下发时间" width="150" />
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <StatusTag :status="row.status" :map="dispatchStatusMap" />
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup>
defineOptions({ name: 'Workbench' })
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, Position, MapLocation, ArrowRight, Sunny } from '@element-plus/icons-vue'
import StatCard from '@/components/StatCard.vue'
import ChartCard from '@/components/ChartCard.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find, dashboard, workbenchTodos, notices } from '@/mock'
import { useUserStore } from '@/store'
import { formatMoney, formatNum } from '@/utils'
import dayjs from 'dayjs'
import { useTokens } from '@/utils/tokens'

const tokens = useTokens()

const router = useRouter()
const userStore = useUserStore()
const loading = ref(true)
onMounted(() => setTimeout(() => (loading.value = false), 300))

/* ===== 欢迎区 ===== */
const greeting = computed(() => {
  const h = dayjs().hour()
  if (h < 6) return '凌晨好'
  if (h < 12) return '上午好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
})
const todayStr = computed(() => dayjs().format('YYYY 年 MM 月 DD 日'))
const weekStr = computed(() => '星期' + '日一二三四五六'[dayjs().day()])

/* ===== 指标 ===== */
const todayDispatches = computed(() =>
  db.dispatches.filter((d) => d.dispatchTime.slice(0, 10) === dayjs().format('YYYY-MM-DD')).length
)
const todayLoad = computed(() =>
  db.weighings
    .filter((w) => w.type === '进磅' && w.time.slice(0, 10) === dayjs().format('YYYY-MM-DD'))
    .reduce((s, w) => s + w.net, 0)
)
const todayUnload = computed(() =>
  db.weighings
    .filter((w) => w.type === '出磅' && w.time.slice(0, 10) === dayjs().format('YYYY-MM-DD'))
    .reduce((s, w) => s + w.net, 0)
)
const monthSettled = computed(() =>
  db.settlements
    .filter((s) => s.status === 'settled' && s.settleDate && s.settleDate.slice(0, 7) === dayjs().format('YYYY-MM'))
    .reduce((s, x) => s + x.totalAmount, 0) / 10000
)

/* ===== 待办 ===== */
const todoList = computed(() => {
  const list = []
  const pendingContracts = db.contracts.filter((c) => c.status === 'pending')
  if (pendingContracts.length)
    list.push({
      id: 'todo-contract',
      icon: 'Document',
      color: tokens.primary,
      bg: 'rgba(43,92,230,0.1)',
      title: `${pendingContracts.length} 份合同待审批`,
      desc: pendingContracts[0].name,
      path: '/contract'
    })
  const pendingDispatches = db.dispatches.filter((d) => d.status === 'pending')
  if (pendingDispatches.length)
    list.push({
      id: 'todo-dispatch',
      icon: 'Position',
      color: tokens.warning,
      bg: 'rgba(255,125,0,0.1)',
      title: `${pendingDispatches.length} 张调度单待装货`,
      desc: `最早下发：${pendingDispatches[0].dispatchTime}`,
      path: '/dispatch'
    })
  const pendingExceptions = db.exceptions.filter((e) => e.status === 'pending')
  if (pendingExceptions.length)
    list.push({
      id: 'todo-exception',
      icon: 'Warning',
      color: tokens.danger,
      bg: 'rgba(245,63,63,0.1)',
      title: `${pendingExceptions.length} 条异常待处理`,
      desc: pendingExceptions[0].description,
      path: '/exception'
    })
  const pendingSettlements = db.settlements.filter((s) => s.status === 'pending')
  if (pendingSettlements.length)
    list.push({
      id: 'todo-settlement',
      icon: 'Wallet',
      color: tokens.success,
      bg: 'rgba(0,180,42,0.1)',
      title: `${pendingSettlements.length} 笔结算待对账`,
      desc: `合计 ${formatMoney(pendingSettlements.reduce((s, x) => s + x.totalAmount, 0))}`,
      path: '/settlement'
    })
  const overdue = db.settlements.filter((s) => s.status === 'overdue')
  if (overdue.length)
    list.push({
      id: 'todo-overdue',
      icon: 'AlarmClock',
      color: tokens.danger,
      bg: 'rgba(245,63,63,0.1)',
      title: `${overdue.length} 笔结算已逾期`,
      desc: `最早周期：${overdue[0].period}`,
      path: '/settlement'
    })
  return list
})

function goTodo(t) {
  router.push(t.path)
}

/* ===== 趋势图 ===== */
const trendOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  legend: { data: ['装货量', '卸货量'], bottom: 0 },
  grid: { left: 45, right: 20, top: 20, bottom: 40 },
  xAxis: {
    type: 'category',
    data: dashboard.dailyTrend.map((d) => d.date),
    axisLine: { lineStyle: { color: tokens.border } },
    axisLabel: { color: tokens.info }
  },
  yAxis: {
    type: 'value',
    splitLine: { lineStyle: { color: tokens.neutral100 } },
    axisLabel: { color: tokens.info }
  },
  series: [
    {
      name: '装货量',
      type: 'line',
      smooth: true,
      data: dashboard.dailyTrend.map((d) => d.load),
      itemStyle: { color: tokens.primary },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(43,92,230,0.25)' },
            { offset: 1, color: 'rgba(43,92,230,0.02)' }
          ]
        }
      }
    },
    {
      name: '卸货量',
      type: 'line',
      smooth: true,
      data: dashboard.dailyTrend.map((d) => d.unload),
      itemStyle: { color: tokens.success },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(0,180,42,0.2)' },
            { offset: 1, color: 'rgba(0,180,42,0.02)' }
          ]
        }
      }
    }
  ]
}))

/* ===== 公告 ===== */
function noticeTagType(tag) {
  return { 重要: 'danger', 场站: 'warning', 系统: 'primary', 安全: 'success', 结算: 'info' }[tag] || 'info'
}

/* ===== 最新调度 ===== */
const latestDispatches = computed(() => [...db.dispatches].sort((a, b) => (a.dispatchTime < b.dispatchTime ? 1 : -1)).slice(0, 8))

const dispatchStatusMap = {
  pending: { label: '待装货', type: 'info' },
  loading: { label: '装货中', type: 'warning' },
  intransit: { label: '在途', type: 'primary' },
  unloading: { label: '卸货中', type: 'warning' },
  completed: { label: '已完成', type: 'success' },
  exception: { label: '异常', type: 'danger' }
}
</script>

<style scoped>
.welcome {
  background: linear-gradient(120deg, var(--color-primary-900) 0%, var(--color-primary-800) 60%, var(--color-primary) 100%);
  border-radius: 12px;
  padding: 24px 28px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  color: var(--text-inverse);
  position: relative;
  overflow: hidden;
}

.welcome::after {
  content: '';
  position: absolute;
  right: -60px;
  top: -60px;
  width: 220px;
  height: 220px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
}

.welcome__hello {
  font-size: 22px;
  font-weight: 700;
  margin: 0;
}

.welcome__date {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  margin: 8px 0 16px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.welcome__weather {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.12) !important;
  border: none;
  color: var(--text-inverse);
}

.welcome__stats {
  display: flex;
  align-items: center;
  gap: 24px;
}

.welcome__stat b {
  font-size: 22px;
  display: block;
}

.welcome__stat span {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
}

.welcome__stat .text-danger {
  color: var(--color-danger-200);
}

.welcome__divider {
  width: 1px;
  height: 30px;
  background: rgba(255, 255, 255, 0.15);
}

.welcome__actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}

.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.todo-panel,
.notice-panel {
  height: 100%;
}

.todo-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.todo-item:hover {
  background: var(--bg-page);
}

.todo-item__icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.todo-item__body {
  flex: 1;
  min-width: 0;
}

.todo-item__title {
  font-size: 14px;
  font-weight: 600;
}

.todo-item__desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.todo-item__arrow {
  color: var(--text-secondary);
}

.notice-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 4px;
  border-bottom: 1px dashed var(--border-color);
}

.notice-item:last-child {
  border-bottom: none;
}

.notice-item__tag {
  flex-shrink: 0;
}

.notice-item__title {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notice-item__date {
  font-size: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
</style>
