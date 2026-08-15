<template>
  <div class="page" v-loading="loading">
    <div class="panel dispatch-detail__header">
      <div class="dispatch-detail__head">
        <el-button :icon="ArrowLeft" circle @click="$router.back()" />
        <div>
          <div class="dispatch-detail__name">
            调度单 {{ dispatch?.id }}
            <StatusTag v-if="dispatch" :status="dispatch.status" :map="statusMap" />
          </div>
          <div class="dispatch-detail__meta">
            计划 {{ dispatch?.planId }} · 合同 {{ dispatch?.contractId }} · 下发于 {{ dispatch?.dispatchTime }}
          </div>
        </div>
        <div class="dispatch-detail__actions">
          <el-button v-if="dispatch?.status === 'pending' && can('dispatch')" type="warning" :icon="Box" @click="confirmLoad">
            确认装货
          </el-button>
          <el-button v-if="dispatch?.status === 'loading' && can('dispatch')" type="primary" :icon="Position" @click="depart">
            发车
          </el-button>
          <el-button v-if="dispatch?.status === 'intransit' && can('dispatch')" type="success" plain :icon="Position" @click="arrive">
            到达
          </el-button>
          <el-button v-if="dispatch?.status === 'unloading' && can('dispatch')" type="success" :icon="CircleCheck" @click="confirmUnload">
            确认卸货
          </el-button>
          <el-button v-if="dispatch?.status === 'exception' && can('dispatch')" type="warning" plain :icon="RefreshRight" @click="resume">
            恢复运输
          </el-button>
          <el-button v-if="dispatch && ['pending', 'loading', 'intransit'].includes(dispatch.status) && can('exception')" type="danger" plain :icon="Warning" @click="reportException">
            上报异常
          </el-button>
          <el-button :icon="Printer" @click="printDispatch">打印调度单</el-button>
        </div>
      </div>
    </div>

    <el-row :gutter="16">
      <!-- 左侧：执行时间线 + 信息 -->
      <el-col :span="14">
        <div class="panel">
          <div class="panel__header"><span class="panel__title">执行时间线</span></div>
          <div class="panel__body">
            <el-timeline>
              <el-timeline-item
                v-for="step in timeline"
                :key="step.title"
                :type="step.type"
                :timestamp="step.time"
                :hollow="!step.done"
              >
                <div class="timeline-title">{{ step.title }}</div>
                <div class="timeline-desc">{{ step.desc }}</div>
              </el-timeline-item>
            </el-timeline>
          </div>
        </div>

        <div class="panel">
          <div class="panel__header"><span class="panel__title">运输信息</span></div>
          <div class="panel__body">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="商品">{{ commodity?.name }}（{{ commodity?.category }}）</el-descriptions-item>
              <el-descriptions-item label="数量">
                <span class="num">{{ dispatch?.quantity }} 吨</span>
              </el-descriptions-item>
              <el-descriptions-item label="装货场站">{{ find.terminal(dispatch?.loadTerminalId)?.name }}</el-descriptions-item>
              <el-descriptions-item label="卸货场站">{{ find.terminal(dispatch?.unloadTerminalId)?.name }}</el-descriptions-item>
              <el-descriptions-item label="运输距离">
                <span class="num">{{ dispatch?.distance }} km</span>
              </el-descriptions-item>
              <el-descriptions-item label="预计运费">
                <span class="num amount">{{ formatMoney(dispatch?.fee) }}</span>
              </el-descriptions-item>
              <el-descriptions-item label="当前进度">
                <el-progress :percentage="dispatch?.progress || 0" :stroke-width="8" />
              </el-descriptions-item>
              <el-descriptions-item label="预计到达">{{ dispatch?.eta || '—' }}</el-descriptions-item>
            </el-descriptions>
          </div>
        </div>
      </el-col>

      <!-- 右侧：车辆司机 + 磅单 -->
      <el-col :span="10">
        <div class="panel">
          <div class="panel__header"><span class="panel__title">车辆与司机</span></div>
          <div class="panel__body">
            <div class="vehicle-card">
              <div class="vehicle-card__icon">
                <el-icon :size="28" color="var(--color-primary)"><Truck /></el-icon>
              </div>
              <div class="vehicle-card__info">
                <div class="vehicle-card__plate">{{ vehicle?.plate }}</div>
                <div class="vehicle-card__sub">{{ vehicle?.type }} · 核定载重 {{ vehicle?.capacity }} 吨 · {{ vehicle?.owner }}</div>
              </div>
            </div>
            <el-divider />
            <div class="vehicle-card">
              <div class="vehicle-card__icon">
                <el-icon :size="28" color="var(--color-success)"><User /></el-icon>
              </div>
              <div class="vehicle-card__info">
                <div class="vehicle-card__plate">{{ driver?.name }}</div>
                <div class="vehicle-card__sub">{{ driver?.phone }} · {{ driver?.licenseType }} 证 · 累计 {{ driver?.totalTrips }} 趟</div>
              </div>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel__header"><span class="panel__title">磅单记录</span></div>
          <div class="panel__body">
            <el-table :data="weighings" size="small" stripe>
              <el-table-column prop="id" label="磅单号" width="100" />
              <el-table-column prop="type" label="类型" width="70" align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.type === '进磅' ? 'primary' : 'success'" effect="light">
                    {{ row.type }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="毛重" width="80" align="right">
                <template #default="{ row }">{{ row.gross }}t</template>
              </el-table-column>
              <el-table-column label="净重" width="80" align="right">
                <template #default="{ row }"><span class="num net">{{ row.net }}t</span></template>
              </el-table-column>
              <el-table-column prop="time" label="时间" min-width="130" />
            </el-table>
            <el-empty v-if="!weighings.length" description="暂无磅单" :image-size="60" />
          </div>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
defineOptions({ name: 'DispatchDetail' })
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Box, CircleCheck, Warning, Printer, Position, RefreshRight } from '@element-plus/icons-vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, find } from '@/mock'
import {
  confirmLoad as flowConfirmLoad,
  depart as flowDepart,
  arrive as flowArrive,
  confirmUnload as flowConfirmUnload,
  reportException as flowReportException,
  resumeDispatch
} from '@/mock/flow'
import { formatMoney } from '@/utils'
import dayjs from 'dayjs'
import { usePerm } from '@/permission'

const route = useRoute()
const { can } = usePerm()
const loading = ref(true)
onMounted(() => setTimeout(() => (loading.value = false), 200))

const dispatch = computed(() => find.dispatch(route.params.id))
const commodity = computed(() => find.commodity(dispatch.value?.commodityId))
const vehicle = computed(() => find.vehicle(dispatch.value?.vehicleId))
const driver = computed(() => find.driver(dispatch.value?.driverId))
const weighings = computed(() => db.weighings.filter((w) => w.dispatchId === dispatch.value?.id))

const statusMap = {
  pending: { label: '待装货', type: 'info' },
  loading: { label: '装货中', type: 'warning' },
  intransit: { label: '在途', type: 'primary' },
  unloading: { label: '卸货中', type: 'warning' },
  completed: { label: '已完成', type: 'success' },
  exception: { label: '异常', type: 'danger' }
}

const timeline = computed(() => {
  const d = dispatch.value
  if (!d) return []
  const steps = [
    { title: '调度下发', time: d.dispatchTime, desc: `调度员向 ${vehicle.value?.plate}（司机 ${driver.value?.name}）下发运输指令`, done: true, type: 'primary' },
    { title: '装货过磅', time: d.loadTime, desc: d.loadTime ? `于${find.terminal(d.loadTerminalId)?.name}完成装货，净重 ${d.quantity} 吨` : '车辆到达装货场站排队中', done: !!d.loadTime, type: d.loadTime ? 'primary' : 'info' },
    { title: '在途运输', time: d.eta ? `预计 ${d.eta} 到达` : '', desc: d.status === 'intransit' ? `当前进度 ${d.progress}%，实时车速 ${d.speed} km/h` : d.status === 'pending' ? '等待装货' : '运输中', done: d.status === 'intransit' || d.status === 'unloading' || d.status === 'completed', type: 'primary' },
    { title: '卸货完成', time: d.unloadTime, desc: d.unloadTime ? `于${find.terminal(d.unloadTerminalId)?.name}完成卸货` : '—', done: !!d.unloadTime, type: d.unloadTime ? 'success' : 'info' }
  ]
  if (d.status === 'exception') {
    steps.splice(3, 0, { title: '异常发生', time: dayjs().format('YYYY-MM-DD HH:mm'), desc: '运输过程中发生异常，已上报处理', done: true, type: 'danger' })
  }
  return steps
})

function confirmLoad() {
  ElMessageBox.confirm('确认已完成装货并登记进磅单？', '确认装货', { type: 'info' }).then(() => {
    flowConfirmLoad(dispatch.value)
    ElMessage.success('装货确认成功')
  }).catch(() => {})
}

function depart() {
  ElMessageBox.confirm(`确认 ${vehicle.value?.plate} 发车开始运输？`, '发车确认', { type: 'info' }).then(() => {
    flowDepart(dispatch.value)
    ElMessage.success('已发车，进入在途状态')
  }).catch(() => {})
}

function arrive() {
  ElMessageBox.confirm(`确认 ${vehicle.value?.plate} 已到达卸货场站，开始卸货？`, '到达确认', { type: 'info' }).then(() => {
    flowArrive(dispatch.value)
    ElMessage.success('已到达，进入卸货状态')
  }).catch(() => {})
}

function confirmUnload() {
  ElMessageBox.confirm('确认已完成卸货？', '确认卸货', { type: 'success' }).then(() => {
    flowConfirmUnload(dispatch.value)
    ElMessage.success('卸货确认成功，本次运输完成')
  }).catch(() => {})
}

function resume() {
  ElMessageBox.confirm(`确认调度单 ${dispatch.value.id} 恢复运输？`, '恢复运输', { type: 'warning' }).then(() => {
    resumeDispatch(dispatch.value)
    ElMessage.success('已恢复运输')
  }).catch(() => {})
}

function reportException() {
  ElMessageBox.prompt('请简述异常情况', '上报异常', {
    inputPattern: /.{2,}/,
    inputErrorMessage: '描述至少 2 个字符'
  }).then(({ value }) => {
    flowReportException(dispatch.value, value)
    ElMessage.warning('异常已上报')
  }).catch(() => {})
}

function printDispatch() {
  const d = dispatch.value
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>调度单 ${d.id}</title>
  <style>
    body{font-family:'Microsoft YaHei',sans-serif;padding:40px;color:#1d2129}
    h1{text-align:center;font-size:22px;letter-spacing:4px}
    .no{text-align:center;color:#86909c;margin-bottom:20px}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    td,th{border:1px solid #e5e6eb;padding:10px;font-size:14px}
    th{background:#f7f8fa;width:110px;text-align:left}
    .sign{display:flex;justify-content:space-between;margin-top:60px;font-size:14px}
  </style></head><body>
  <h1>大宗货物运输调度单</h1>
  <div class="no">单号：${d.id} &nbsp; 下发时间：${d.dispatchTime}</div>
  <table>
    <tr><th>车牌号</th><td>${vehicle.value?.plate}</td><th>司机</th><td>${driver.value?.name} ${driver.value?.phone}</td></tr>
    <tr><th>商品</th><td>${commodity.value?.name}</td><th>数量</th><td>${d.quantity} 吨</td></tr>
    <tr><th>装货场站</th><td>${find.terminal(d.loadTerminalId)?.name}</td><th>卸货场站</th><td>${find.terminal(d.unloadTerminalId)?.name}</td></tr>
    <tr><th>装货时间</th><td>${d.loadTime || '待装货'}</td><th>卸货时间</th><td>${d.unloadTime || '—'}</td></tr>
  </table>
  <div class="sign">
    <div>调度员签字：____________</div>
    <div>司机签字：____________</div>
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
.dispatch-detail__header {
  padding: 16px 20px;
}

.dispatch-detail__head {
  display: flex;
  align-items: center;
  gap: 16px;
}

.dispatch-detail__name {
  font-size: 17px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 10px;
}

.dispatch-detail__meta {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.dispatch-detail__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.timeline-title {
  font-weight: 600;
  font-size: 14px;
}

.timeline-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.vehicle-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px;
  background: var(--color-neutral-50);
  border-radius: 10px;
}

.vehicle-card__icon {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  background: var(--bg-card);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 4px rgba(16, 24, 40, 0.08);
}

.vehicle-card__plate {
  font-size: 16px;
  font-weight: 700;
}

.vehicle-card__sub {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 3px;
}

.amount {
  font-weight: 600;
}

.net {
  font-weight: 700;
  color: var(--color-primary);
}
</style>
