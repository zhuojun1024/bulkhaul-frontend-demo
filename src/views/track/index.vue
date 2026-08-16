<template>
  <div class="page">
    <PageHeader title="在途监控" desc="基于 GPS 的运输过程实时监控（示意地图，数据每 3 秒刷新）">
      <el-tag effect="light" round>
        <el-icon class="live-dot"><VideoPlay /></el-icon>
        实时监控中
      </el-tag>
    </PageHeader>

    <!-- 顶部指标 -->
    <div class="stat-row">
      <StatCard title="在途车辆" :value="intransitList.length" unit="辆" icon="Van" color="var(--color-primary)" :trend="12.5" trend-label="较昨日" />
      <StatCard title="平均车速" :value="avgSpeed" unit="km/h" icon="Odometer" color="var(--color-success)" :trend="-2.1" trend-label="较昨日" />
      <StatCard title="延误车辆" :value="delayedList.length" unit="辆" icon="AlarmClock" color="var(--color-warning)" :trend="delayedList.length ? 8.3 : 0" trend-label="较昨日" />
      <StatCard title="今日完成" :value="todayDone" unit="车次" icon="CircleCheck" color="var(--color-info)" :trend="5.2" trend-label="较昨日" />
    </div>

    <!-- 异常预警条 -->
    <el-alert
      v-if="activeExceptions.length"
      class="track-alert"
      type="warning"
      :closable="false"
      show-icon
    >
      <template #title>
        <b>{{ activeExceptions.length }}</b> 条异常预警：
        <span v-for="(e, i) in activeExceptions.slice(0, 2)" :key="e.id">
          [{{ e.dispatchId }}] {{ e.description }}<span v-if="i === 0 && activeExceptions.length > 2">、</span>
        </span>
        <el-link type="primary" :underline="false" @click="$router.push('/exception')">去处理</el-link>
      </template>
    </el-alert>

    <el-row :gutter="16">
      <!-- 地图 -->
      <el-col :span="16">
        <div class="panel track-map-panel">
          <div class="panel__header">
            <span class="panel__title">运输线路图</span>
            <div class="track-legend">
              <span class="legend-item"><i class="dot dot--blue" />在途</span>
              <span class="legend-item"><i class="dot dot--orange" />延误</span>
              <span class="legend-item"><i class="dot dot--red" />异常</span>
              <span class="legend-item"><i class="dot dot--gray" />场站</span>
              <span class="legend-item"><i class="dot dot--fence" />电子围栏</span>
            </div>
          </div>
          <div class="track-map-wrap">
            <svg class="track-map" viewBox="0 0 1000 620" preserveAspectRatio="xMidYMid meet">
              <!-- 网格背景 -->
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" style="stroke: var(--color-neutral-200)" stroke-width="1" />
                </pattern>
                <radialGradient id="terminalGlow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" style="stop-color: var(--color-primary)" stop-opacity="0.25" />
                  <stop offset="100%" style="stop-color: var(--color-primary)" stop-opacity="0" />
                </radialGradient>
              </defs>
              <rect width="1000" height="620" fill="url(#grid)" />

              <!-- 线路 -->
              <g>
                <line
                  v-for="r in routeLines"
                  :key="r.key"
                  :x1="r.x1" :y1="r.y1" :x2="r.x2" :y2="r.y2"
                  style="stroke: var(--color-neutral-300)"
                  stroke-width="2"
                  stroke-dasharray="6 6"
                />
                <!-- 有车辆的线路高亮 -->
                <line
                  v-for="r in activeRouteLines"
                  :key="'a' + r.key"
                  :x1="r.x1" :y1="r.y1" :x2="r.x2" :y2="r.y2"
                  style="stroke: var(--color-primary-400)"
                  stroke-width="2.5"
                  opacity="0.6"
                />
              </g>

              <!-- 场站节点 -->
              <g v-for="t in terminals" :key="t.id">
                <circle :cx="t.x" :cy="t.y" r="16" fill="url(#terminalGlow)" />
                <circle
                  :cx="t.x" :cy="t.y" r="7"
                  style="fill: var(--bg-card)"
                  :stroke="t.type === 'loading' ? tokens.success : t.type === 'unloading' ? tokens.warning : tokens.primary"
                  stroke-width="2.5"
                />
                <text :x="t.x" :y="t.y - 14" text-anchor="middle" class="map-label">{{ t.label }}</text>
              </g>

              <!-- 电子围栏（选中车辆的卸货场范围） -->
              <circle
                v-if="destNode"
                :cx="destNode.x" :cy="destNode.y" :r="FENCE_RADIUS"
                class="fence-circle"
                :class="{ 'fence-circle--in': inFence }"
              />

              <!-- 轨迹回放：已走过轨迹 + 回放点 -->
              <polyline v-if="playTrail" :points="playTrail" class="replay-trail" />
              <g v-if="playPoint">
                <circle :cx="playPoint.x" :cy="playPoint.y" r="11" :fill="tokens.primary" opacity="0.22" />
                <circle
                  :cx="playPoint.x" :cy="playPoint.y" r="5.5"
                  :fill="tokens.primary"
                  style="stroke: var(--text-inverse)"
                  stroke-width="1.5"
                />
              </g>

              <!-- 车辆 -->
              <g
                v-for="v in vehicleDots"
                :key="v.id"
                class="map-vehicle"
                :class="{ 'map-vehicle--selected': v.id === selectedId }"
                @click="selectedId = v.id"
              >
                <circle :cx="v.x" :cy="v.y" r="14" :fill="v.color" opacity="0.18" />
                <circle
                  :cx="v.x" :cy="v.y" r="8"
                  :fill="v.color"
                  style="stroke: var(--text-inverse)"
                  stroke-width="2"
                />
                <text :x="v.x" :y="v.y + 24" text-anchor="middle" class="map-plate">{{ v.plate }}</text>
              </g>
            </svg>

            <!-- 选中车辆浮层 -->
            <div v-if="selected" class="track-float">
              <div class="track-float__head">
                <b>{{ selected.plate }}</b>
                <el-tag size="small" :type="selected.delayed ? 'warning' : 'primary'" effect="light">
                  {{ selected.delayed ? '已延误' : '正常在途' }}
                </el-tag>
                <el-icon class="track-float__close" @click="selectedId = null"><Close /></el-icon>
              </div>
              <div class="track-float__grid">
                <div><span>司机</span>{{ selected.driverName }}</div>
                <div><span>商品</span>{{ selected.commodityName }}</div>
                <div><span>数量</span>{{ selected.quantity }} 吨</div>
                <div><span>车速</span>{{ selected.speed }} km/h</div>
                <div><span>进度</span>{{ selected.progress }}%</div>
                <div><span>预计到达</span>{{ selected.eta }}</div>
              </div>
              <el-progress :percentage="selected.progress" :stroke-width="8" :color="selected.color" />

              <!-- 轨迹回放控制 -->
              <div class="track-float__replay">
                <div class="track-float__replay-head">
                  <span>轨迹回放</span>
                  <el-select v-model="play.speed" size="small" style="width: 62px">
                    <el-option :value="1" label="1x" />
                    <el-option :value="2" label="2x" />
                    <el-option :value="4" label="4x" />
                  </el-select>
                </div>
                <div class="track-float__replay-bar">
                  <el-button size="small" :icon="play.playing ? VideoPause : VideoPlay" circle @click="togglePlay" />
                  <el-slider v-model="play.index" :min="0" :max="20" :show-tooltip="false" class="replay-slider" />
                  <span class="replay-index num">{{ play.index + 1 }}/21</span>
                </div>
              </div>

              <!-- 电子围栏预警 -->
              <div class="track-float__fences">
                <div v-if="deviated" class="fence-alert fence-alert--warn">
                  <el-icon><Warning /></el-icon>轨迹偏离线路 {{ maxDeviation }}m，请核查
                </div>
                <div v-else class="fence-alert fence-alert--ok">
                  <el-icon><CircleCheck /></el-icon>轨迹处于线路电子围栏内
                </div>
                <div v-if="selected.delayed" class="fence-alert fence-alert--warn">
                  <el-icon><AlarmClock /></el-icon>已超预计到达时间（ETA {{ selected.eta }}）
                </div>
                <div v-if="inFence" class="fence-alert fence-alert--ok">
                  <el-icon><Aim /></el-icon>已进入卸货场电子围栏
                </div>
              </div>

              <div class="track-float__actions">
                <el-button size="small" type="primary" plain @click="$router.push(`/dispatch/${selected.dispatchId}`)">
                  调度详情
                </el-button>
                <el-button size="small" type="danger" plain @click="$router.push('/exception')">
                  异常处理
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </el-col>

      <!-- 右侧车辆列表 -->
      <el-col :span="8">
        <div class="panel track-list-panel">
          <div class="panel__header">
            <span class="panel__title">车辆列表</span>
            <el-select v-model="listFilter" size="small" style="width: 110px">
              <el-option label="全部" value="" />
              <el-option label="在途" value="intransit" />
              <el-option label="延误" value="delayed" />
              <el-option label="异常" value="exception" />
            </el-select>
          </div>
          <el-scrollbar max-height="560px">
            <div class="track-list">
              <div
                v-for="v in filteredVehicles"
                :key="v.id"
                class="track-list__item"
                :class="{ active: v.id === selectedId }"
                @click="selectedId = v.id"
              >
                <div class="track-list__head">
                  <span class="track-list__plate">{{ v.plate }}</span>
                  <el-tag size="small" :type="v.delayed ? 'warning' : v.status === 'exception' ? 'danger' : 'primary'" effect="light">
                    {{ v.status === 'exception' ? '异常' : v.delayed ? '延误' : '在途' }}
                  </el-tag>
                </div>
                <div class="track-list__sub">
                  {{ v.driverName }} · {{ v.commodityName }} {{ v.quantity }}t
                </div>
                <el-progress :percentage="v.progress" :stroke-width="6" :show-text="false" :color="v.color" />
                <div class="track-list__meta">
                  <span>进度 {{ v.progress }}%</span>
                  <span>{{ v.speed }} km/h</span>
                  <span>ETA {{ v.eta.slice(11, 16) }}</span>
                </div>
              </div>
              <el-empty v-if="!filteredVehicles.length" description="暂无车辆" :image-size="60" />
            </div>
          </el-scrollbar>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
defineOptions({ name: 'Track' })
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { VideoPlay, VideoPause, Close, Warning, CircleCheck, AlarmClock, Aim } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import { db, find, MAP_NODES, ROUTES } from '@/mock'
import dayjs from 'dayjs'
import { useTokens } from '@/utils/tokens'

const tokens = useTokens()

const selectedId = ref(null)
const listFilter = ref('')

/* ===== 线路与场站 ===== */
const terminals = computed(() =>
  db.terminals
    .filter((t) => MAP_NODES[t.id])
    .map((t) => ({ id: t.id, label: MAP_NODES[t.id].label, x: MAP_NODES[t.id].x, y: MAP_NODES[t.id].y, type: t.type }))
)

const routeLines = computed(() =>
  ROUTES.map((r) => ({
    key: r.from + r.to,
    x1: MAP_NODES[r.from].x,
    y1: MAP_NODES[r.from].y,
    x2: MAP_NODES[r.to].x,
    y2: MAP_NODES[r.to].y
  }))
)

const activeRouteKeys = computed(() => {
  const set = new Set()
  for (const d of db.dispatches) {
    if (d.status === 'intransit') set.add(d.loadTerminalId + d.unloadTerminalId)
  }
  return set
})

const activeRouteLines = computed(() =>
  routeLines.value.filter((l) => activeRouteKeys.value.has(l.key))
)

/* ===== 车辆点位 ===== */
function hashOffset(id) {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 997
  return (h % 5) - 2
}

const vehicleDots = computed(() =>
  db.dispatches
    .filter((d) => ['intransit', 'exception'].includes(d.status))
    .map((d) => {
      const from = MAP_NODES[d.loadTerminalId]
      const to = MAP_NODES[d.unloadTerminalId]
      const p = d.progress / 100
      const off = hashOffset(d.id) * 5
      // 垂直于线路方向的偏移
      const dx = to.x - from.x
      const dy = to.y - from.y
      const len = Math.sqrt(dx * dx + dy * dy) || 1
      const nx = -dy / len
      const ny = dx / len
      const delayed = isDelayed(d)
      return {
        id: d.id,
        dispatchId: d.id,
        x: from.x + dx * p + nx * off,
        y: from.y + dy * p + ny * off,
        plate: find.vehicle(d.vehicleId)?.plate || '-',
        color: d.status === 'exception' ? tokens.danger : delayed ? tokens.warning : tokens.primary
      }
    })
)

function isDelayed(d) {
  return d.status === 'intransit' && d.eta && dayjs(d.eta).isBefore(dayjs())
}

/* ===== 列表 ===== */
const vehicleList = computed(() =>
  db.dispatches
    .filter((d) => ['intransit', 'exception'].includes(d.status))
    .map((d) => {
      const delayed = isDelayed(d)
      return {
        id: d.id,
        dispatchId: d.id,
        plate: find.vehicle(d.vehicleId)?.plate || '-',
        driverName: find.driver(d.driverId)?.name || '-',
        commodityName: find.commodity(d.commodityId)?.name || '-',
        quantity: d.quantity,
        speed: Math.round(d.speed),
        progress: Math.round(d.progress),
        eta: d.eta || '-',
        delayed,
        status: d.status,
        color: d.status === 'exception' ? tokens.danger : delayed ? tokens.warning : tokens.primary
      }
    })
)

const filteredVehicles = computed(() => {
  if (listFilter.value === 'delayed') return vehicleList.value.filter((v) => v.delayed && v.status !== 'exception')
  if (listFilter.value === 'exception') return vehicleList.value.filter((v) => v.status === 'exception')
  if (listFilter.value === 'intransit') return vehicleList.value.filter((v) => v.status === 'intransit')
  return vehicleList.value
})

const selected = computed(() => vehicleList.value.find((v) => v.id === selectedId.value) || null)
const selectedDispatch = computed(() => db.dispatches.find((d) => d.id === selectedId.value) || null)

/* ===== 轨迹回放 + 电子围栏 ===== */
/** 电子围栏半径（地图坐标单位）与偏离阈值 */
const FENCE_RADIUS = 36
const DEVIATE_LIMIT = 15

/**
 * 轨迹点：沿线段均匀取 21 点，叠加按单号确定性派生的横向偏移（基础偏移 + 正弦波动），
 * 与实时点位同一口径（hashOffset 基础偏移），保证回放轨迹与实时位置一致
 */
function trackPointsOf(d) {
  const from = MAP_NODES[d.loadTerminalId]
  const to = MAP_NODES[d.unloadTerminalId]
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const base = hashOffset(d.id) * 5
  const phase = (hashOffset(d.id) % 6) * 0.7
  const pts = []
  for (let i = 0; i <= 20; i++) {
    const p = i / 20
    const off = base + 8 * Math.sin(i * 0.6 + phase)
    pts.push({ x: from.x + dx * p + nx * off, y: from.y + dy * p + ny * off })
  }
  return pts
}

const play = reactive({ index: 0, playing: false, speed: 1 })
let playTimer = null

watch(selectedId, (id) => {
  const d = db.dispatches.find((x) => x.id === id)
  // 回放游标初始对齐当前实时进度
  play.index = d ? Math.round((d.progress / 100) * 20) : 0
  play.playing = false
  syncPlayTimer()
})

function togglePlay() {
  if (!play.playing && play.index >= 20) play.index = 0
  play.playing = !play.playing
  syncPlayTimer()
}

function syncPlayTimer() {
  clearInterval(playTimer)
  if (play.playing) {
    playTimer = setInterval(() => {
      if (play.index >= 20) {
        play.playing = false
        syncPlayTimer()
        return
      }
      play.index += 1
    }, 300 / play.speed)
  }
}

const destNode = computed(() => (selectedDispatch.value ? MAP_NODES[selectedDispatch.value.unloadTerminalId] : null))

const playPoint = computed(() => {
  if (!selectedDispatch.value) return null
  const pts = trackPointsOf(selectedDispatch.value)
  return pts[Math.min(play.index, pts.length - 1)]
})

const playTrail = computed(() => {
  if (!selectedDispatch.value) return ''
  return trackPointsOf(selectedDispatch.value)
    .slice(0, play.index + 1)
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ')
})

/** 回放点是否进入卸货场电子围栏 */
const inFence = computed(() => {
  if (!playPoint.value || !destNode.value) return false
  const dx = playPoint.value.x - destNode.value.x
  const dy = playPoint.value.y - destNode.value.y
  return Math.sqrt(dx * dx + dy * dy) <= FENCE_RADIUS
})

/** 轨迹最大偏离：轨迹点到线路直线的最大垂直距离 */
const maxDeviation = computed(() => {
  const d = selectedDispatch.value
  if (!d) return 0
  const from = MAP_NODES[d.loadTerminalId]
  const to = MAP_NODES[d.unloadTerminalId]
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len2 = dx * dx + dy * dy || 1
  let max = 0
  for (const p of trackPointsOf(d)) {
    const t = ((p.x - from.x) * dx + (p.y - from.y) * dy) / len2
    const px = from.x + dx * t
    const py = from.y + dy * t
    max = Math.max(max, Math.sqrt((p.x - px) ** 2 + (p.y - py) ** 2))
  }
  return Math.round(max)
})

const deviated = computed(() => maxDeviation.value > DEVIATE_LIMIT)

/* ===== 顶部指标 ===== */
const intransitList = computed(() => vehicleList.value.filter((v) => v.status === 'intransit'))
const delayedList = computed(() => vehicleList.value.filter((v) => v.delayed && v.status !== 'exception'))
const avgSpeed = computed(() => {
  const list = intransitList.value
  if (!list.length) return 0
  return Math.round(list.reduce((s, v) => s + v.speed, 0) / list.length)
})
const todayDone = computed(() =>
  db.dispatches.filter((d) => d.status === 'completed' && d.unloadTime && dayjs(d.unloadTime).isSame(dayjs(), 'day')).length
)
const activeExceptions = computed(() => db.exceptions.filter((e) => e.status !== 'closed'))

/* ===== 模拟移动 ===== */
let timer = null
onMounted(() => {
  timer = setInterval(() => {
    for (const d of db.dispatches) {
      if (d.status === 'intransit') {
        d.progress = Math.min(95, d.progress + Math.random() * 0.9)
        d.speed = Math.max(35, Math.min(75, d.speed + (Math.random() - 0.5) * 8))
      }
    }
  }, 3000)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  clearInterval(playTimer)
})
</script>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.track-alert {
  border-radius: 8px;
}

.track-map-panel {
  height: 100%;
}

.track-legend {
  display: flex;
  gap: 14px;
  font-size: 12px;
  color: var(--text-secondary);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
.dot--blue { background: var(--color-primary); }
.dot--orange { background: var(--color-warning); }
.dot--red { background: var(--color-danger); }
.dot--gray { background: var(--color-info); }
.dot--fence {
  background: transparent;
  border: 1.5px dashed var(--color-primary);
}

.track-map-wrap {
  position: relative;
  padding: 8px 12px 16px;
}

.track-map {
  width: 100%;
  height: 560px;
  border-radius: 8px;
  background: var(--color-primary-50);
}

.map-label {
  font-size: 13px;
  fill: var(--text-regular);
  font-weight: 500;
}

.map-plate {
  font-size: 11px;
  fill: var(--text-primary);
  font-weight: 600;
  paint-order: stroke;
  stroke: var(--bg-card);
  stroke-width: 3px;
}

.map-vehicle {
  cursor: pointer;
}

.map-vehicle--selected circle:nth-child(2) {
  stroke: var(--text-primary);
  stroke-width: 3;
}

/* 电子围栏 */
.fence-circle {
  fill: rgba(43, 92, 230, 0.06);
  stroke: var(--color-primary);
  stroke-width: 1.5;
  stroke-dasharray: 6 4;
}

.fence-circle--in {
  fill: rgba(43, 92, 230, 0.18);
}

/* 轨迹回放 */
.replay-trail {
  fill: none;
  stroke: var(--color-primary);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.65;
}

/* 选中浮层 */
.track-float {
  position: absolute;
  top: 20px;
  right: 24px;
  width: 280px;
  background: var(--bg-card);
  border-radius: 10px;
  box-shadow: 0 8px 30px rgba(16, 24, 40, 0.16);
  padding: 16px;
  z-index: 5;
}

.track-float__head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
}

.track-float__close {
  margin-left: auto;
  cursor: pointer;
  color: var(--text-secondary);
}

.track-float__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  margin: 12px 0;
  font-size: 13px;
}

.track-float__grid span {
  color: var(--text-secondary);
  margin-right: 6px;
}

.track-float__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

/* 轨迹回放控制 */
.track-float__replay {
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--color-neutral-50);
  border-radius: 8px;
}

.track-float__replay-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.track-float__replay-bar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.replay-slider {
  flex: 1;
}

.replay-index {
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 34px;
  text-align: right;
}

/* 电子围栏预警 */
.track-float__fences {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.fence-alert {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
}

.fence-alert--warn {
  background: color-mix(in srgb, var(--color-warning) 10%, var(--bg-card));
  color: var(--color-warning);
}

.fence-alert--ok {
  background: color-mix(in srgb, var(--color-success) 10%, var(--bg-card));
  color: var(--color-success);
}

/* 右侧列表 */
.track-list-panel {
  height: 100%;
}

.track-list {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.track-list__item {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  cursor: pointer;
  transition: all 0.2s;
}

.track-list__item:hover {
  border-color: var(--el-color-primary-light-7);
  box-shadow: 0 2px 8px rgba(43, 92, 230, 0.1);
}

.track-list__item.active {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}

.track-list__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.track-list__plate {
  font-weight: 700;
  font-size: 14px;
}

.track-list__sub {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 4px 0 8px;
}

.track-list__meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
}

.live-dot {
  margin-right: 4px;
  animation: blink 1.5s infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
</style>
