<template>
  <div class="page" v-loading="loading">
    <PageHeader title="安全管理" desc="安全运行监控、事故管理、安全培训与车辆检查" />

    <div class="stat-row">
      <StatCard title="安全运行天数" :value="386" unit="天" icon="Medal" color="var(--color-success)" :sub="'上次重大事故后累计'" />
      <StatCard title="本年事故" :value="yearAccidents" unit="起" icon="Warning" color="var(--color-danger)" :trend="-18.2" trend-label="较上年" />
      <StatCard title="培训覆盖率" :value="96.5" unit="%" icon="Reading" color="var(--color-primary)" :sub="'近 90 天参训司机占比'" />
      <StatCard title="车辆检查合格率" :value="inspectionPassRate" unit="%" icon="CircleCheck" color="var(--color-warning)" :sub="'近 30 天检查'" />
    </div>

    <el-tabs v-model="activeTab" class="safety-tabs">
      <!-- 事故记录 -->
      <el-tab-pane label="事故记录" name="accident">
        <div class="panel">
          <div class="panel__body">
            <el-table :data="accidents" stripe>
              <el-table-column prop="id" label="编号" width="80" fixed />
              <el-table-column prop="time" label="发生日期" width="110" />
              <el-table-column prop="type" label="类型" width="90" align="center">
                <template #default="{ row }">
                  <el-tag size="small" effect="plain">{{ row.type }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="级别" width="90" align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="levelType(row.level)" effect="dark">{{ row.level }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="plate" label="涉及车辆" width="120" />
              <el-table-column prop="location" label="发生地点" min-width="150" show-overflow-tooltip />
              <el-table-column prop="description" label="事故描述" min-width="180" show-overflow-tooltip />
              <el-table-column label="直接损失" width="110" align="right">
                <template #default="{ row }">
                  <span class="num text-danger">{{ formatMoney(row.loss) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="90" align="center">
                <template #default="{ row }">
                  <StatusTag :status="row.status" :map="accidentStatusMap" />
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>

      <!-- 安全培训 -->
      <el-tab-pane label="安全培训" name="training">
        <div class="panel">
          <div class="panel__body">
            <el-table :data="trainings" stripe>
              <el-table-column prop="id" label="编号" width="80" />
              <el-table-column prop="title" label="培训主题" min-width="200" />
              <el-table-column prop="date" label="培训日期" width="120" />
              <el-table-column prop="trainer" label="讲师" width="100" align="center" />
              <el-table-column label="参训人数" width="100" align="right">
                <template #default="{ row }">{{ row.participants }} 人</template>
              </el-table-column>
              <el-table-column label="状态" width="100" align="center">
                <template #default="{ row }">
                  <StatusTag :status="row.status" :map="trainingStatusMap" />
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>

      <!-- 车辆检查 -->
      <el-tab-pane label="车辆检查" name="inspection">
        <div class="panel">
          <div class="panel__body">
            <el-table :data="inspections" stripe>
              <el-table-column prop="id" label="编号" width="80" />
              <el-table-column prop="plate" label="车牌号" width="130" />
              <el-table-column prop="date" label="检查日期" width="120" />
              <el-table-column prop="item" label="检查项目" min-width="180" />
              <el-table-column label="结果" width="100" align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.result === 'pass' ? 'success' : 'danger'" effect="light">
                    {{ row.result === 'pass' ? '合格' : '不合格' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="inspector" label="检查人" width="100" align="center" />
              <el-table-column prop="remark" label="备注" min-width="180" show-overflow-tooltip />
            </el-table>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
defineOptions({ name: 'Safety' })
import { ref, computed, onMounted } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db } from '@/mock'
import { formatMoney } from '@/utils'
import dayjs from 'dayjs'

const loading = ref(true)
const activeTab = ref('accident')
onMounted(() => setTimeout(() => (loading.value = false), 300))

const accidents = computed(() => db.accidents)
const trainings = computed(() => db.trainings)
const inspections = computed(() => db.inspections)

const yearAccidents = computed(() =>
  db.accidents.filter((a) => dayjs(a.time).isAfter(dayjs().subtract(1, 'year'))).length
)
const inspectionPassRate = computed(() => {
  if (!db.inspections.length) return 0
  return Math.round((db.inspections.filter((i) => i.result === 'pass').length / db.inspections.length) * 1000) / 10
})

const accidentStatusMap = {
  closed: { label: '已结案', type: 'success' },
  handling: { label: '处理中', type: 'warning' }
}
const trainingStatusMap = {
  completed: { label: '已完成', type: 'success' },
  scheduled: { label: '计划中', type: 'primary' }
}

function levelType(level) {
  return { 重大: 'danger', 较大: 'warning', 一般: 'info' }[level] || 'info'
}
</script>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.safety-tabs {
  background: var(--bg-card);
  border-radius: 8px;
  padding: 8px 20px 20px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
}

.text-danger {
  color: var(--color-danger);
  font-weight: 600;
}
</style>
