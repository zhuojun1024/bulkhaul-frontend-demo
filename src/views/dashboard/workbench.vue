<template>
  <div class="page">
    <!-- 欢迎横幅 -->
    <div class="welcome">
      <div class="welcome__info">
        <h2 class="welcome__hello">{{ greeting }}，{{ userStore.userInfo.name }}</h2>
        <p class="welcome__date">
          {{ todayStr }} · {{ weekStr }}
          <el-tag size="small" effect="dark" class="welcome__weather">
            <el-icon><component :is="weatherIcon" /></el-icon>
            {{ weather.city }} {{ weather.temp }}℃ {{ weather.cond }} · {{ weather.tip }}
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

    <!-- 指标卡（趋势按昨日/上月实际数据计算，基期为 0 时不显示趋势） -->
    <div class="stat-row">
      <StatCard title="今日调度" :value="todayDispatches" unit="车次" icon="Position" color="var(--color-primary)" :trend="dispatchTrend" trend-label="较昨日" />
      <StatCard title="今日装货" :value="formatNum(todayLoad)" unit="吨" icon="Box" color="var(--color-success)" :trend="loadTrend" trend-label="较昨日" />
      <StatCard title="今日卸货" :value="formatNum(todayUnload)" unit="吨" icon="DeleteFilled" color="var(--color-warning)" :trend="unloadTrend" trend-label="较昨日" />
      <StatCard title="本月结算" :value="formatMoney(monthSettled, false) + ' 万'" unit="" icon="Wallet" color="var(--color-info)" :trend="settleTrend" trend-label="较上月" />
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
            <el-tag size="small" type="info" effect="plain">{{ db.announcements.length }} 条</el-tag>
          </div>
          <div class="panel__body">
            <div v-for="n in db.announcements" :key="n.id" class="notice-item">
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
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Plus, Position, MapLocation, ArrowRight } from '@element-plus/icons-vue'
import StatCard from '@/components/StatCard.vue'
import ChartCard from '@/components/ChartCard.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find, dashboard, workbenchTodos, workbenchStats, workbenchTodoList, weatherOf } from '@/mock'
import { useUserStore } from '@/store'
import { formatMoney, formatNum, round } from '@/utils'
import dayjs from 'dayjs'
import { useTokens } from '@/utils/tokens'

const tokens = useTokens()

const router = useRouter()
const userStore = useUserStore()

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
const weather = computed(() => weatherOf(dayjs().format('YYYY-MM-DD')))
const weatherIcon = computed(() => (['小雨', '雷阵雨'].includes(weather.value.cond) ? 'Umbrella' : weather.value.cond === '阴' ? 'Cloudy' : 'Sunny'))

/* ===== 指标（聚合下沉服务层 P2：workbenchStats 一次返回本期+基期） ===== */
const stats = computed(() => workbenchStats())
const todayDispatches = computed(() => stats.value.todayDispatches)
const todayLoad = computed(() => stats.value.todayLoad)
const todayUnload = computed(() => stats.value.todayUnload)
const monthSettled = computed(() => stats.value.monthSettled)

/* ===== 环比趋势（基期为 0 时不显示趋势） ===== */
const pctVs = (cur, prev) => (prev ? round(((cur - prev) / prev) * 100, 1) : null)
const dispatchTrend = computed(() => pctVs(stats.value.todayDispatches, stats.value.yesterdayDispatches))
const loadTrend = computed(() => pctVs(stats.value.todayLoad, stats.value.yesterdayLoad))
const unloadTrend = computed(() => pctVs(stats.value.todayUnload, stats.value.yesterdayUnload))
const settleTrend = computed(() => pctVs(stats.value.monthSettled, stats.value.prevMonthSettled))

/* ===== 待办（数据下沉服务层 P2：workbenchTodoList；图标配色为视图层关注点） ===== */
const TODO_META = {
  contract: { icon: 'Document', color: tokens.primary, bg: 'rgba(43,92,230,0.1)' },
  dispatch: { icon: 'Position', color: tokens.warning, bg: 'rgba(255,125,0,0.1)' },
  exception: { icon: 'Warning', color: tokens.danger, bg: 'rgba(245,63,63,0.1)' },
  settlement: { icon: 'Wallet', color: tokens.success, bg: 'rgba(0,180,42,0.1)' },
  overdue: { icon: 'AlarmClock', color: tokens.danger, bg: 'rgba(245,63,63,0.1)' }
}
const todoList = computed(() =>
  workbenchTodoList().map((t) => ({
    id: `todo-${t.key}`,
    title: t.title,
    desc: t.desc,
    path: t.path,
    ...TODO_META[t.key]
  }))
)

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
