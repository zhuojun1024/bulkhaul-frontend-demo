<template>
  <div class="page">
    <PageHeader title="安全管理" desc="安全运行监控、事故管理、安全培训与车辆检查" />

    <div class="stat-row">
      <StatCard title="安全运行天数" :value="safeDays" unit="天" icon="Medal" color="var(--color-success)" :sub="'上次重大事故后累计'" />
      <StatCard title="本年事故" :value="yearAccidents" unit="起" icon="Warning" color="var(--color-danger)" :trend="accidentTrend" trend-label="较上年" />
      <StatCard title="培训覆盖率" :value="trainingCoverage" unit="%" icon="Reading" color="var(--color-primary)" :sub="'近 90 天参训司机占比'" />
      <StatCard title="车辆检查合格率" :value="inspectionPassRate" unit="%" icon="CircleCheck" color="var(--color-warning)" :sub="'近 30 天检查'" />
    </div>

    <el-tabs v-model="activeTab" class="safety-tabs">
      <!-- 事故记录 -->
      <el-tab-pane label="事故记录" name="accident">
        <div class="panel">
          <div class="panel__header">
            <span class="panel__title">事故记录</span>
            <el-button v-if="can('safety')" size="small" type="primary" :icon="Plus" @click="openAccident">登记事故</el-button>
          </div>
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
              <el-table-column v-if="can('safety')" label="操作" width="80" align="center" fixed="right">
                <template #default="{ row }">
                  <el-button
                    v-if="row.status === 'handling'"
                    link type="success" size="small"
                    @click="closeAccidentRow(row)"
                  >结案</el-button>
                  <span v-else class="text-muted">—</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>

      <!-- 安全培训 -->
      <el-tab-pane label="安全培训" name="training">
        <div class="panel">
          <div class="panel__header">
            <span class="panel__title">安全培训</span>
            <el-button v-if="can('safety')" size="small" type="primary" :icon="Plus" @click="openTraining">培训计划</el-button>
          </div>
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
              <el-table-column v-if="can('safety')" label="操作" width="100" align="center" fixed="right">
                <template #default="{ row }">
                  <el-button
                    v-if="row.status === 'scheduled'"
                    link type="success" size="small"
                    :disabled="row.date > todayStr"
                    @click="openCompleteTraining(row)"
                  >标记完成</el-button>
                  <span v-else class="text-muted">—</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>

      <!-- 车辆检查 -->
      <el-tab-pane label="车辆检查" name="inspection">
        <div class="panel">
          <div class="panel__header">
            <span class="panel__title">车辆检查</span>
            <el-button v-if="can('safety')" size="small" type="primary" :icon="Plus" @click="openInspection">登记检查</el-button>
          </div>
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

    <!-- 登记事故 -->
    <el-dialog v-model="accidentDialog" title="登记事故" width="520px">
      <el-form label-width="90px">
        <el-form-item label="发生日期" required>
          <el-date-picker v-model="accidentForm.time" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="事故类型" required>
          <el-select v-model="accidentForm.type" style="width: 100%">
            <el-option v-for="t in accidentTypes" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="事故级别" required>
          <el-select v-model="accidentForm.level" style="width: 100%">
            <el-option v-for="l in ['一般', '较大', '重大']" :key="l" :label="l" :value="l" />
          </el-select>
        </el-form-item>
        <el-form-item label="涉及车辆">
          <el-select v-model="accidentForm.vehicleId" filterable placeholder="请选择车辆（可留空）" style="width: 100%">
            <el-option v-for="v in db.vehicles" :key="v.id" :label="v.plate + '（' + v.type + '）'" :value="v.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="发生地点">
          <el-input v-model="accidentForm.location" placeholder="如：G6 京藏高速 K234" />
        </el-form-item>
        <el-form-item label="事故描述" required>
          <el-input v-model="accidentForm.description" type="textarea" :rows="2" maxlength="200" show-word-limit />
        </el-form-item>
        <el-form-item label="直接损失">
          <el-input-number v-model="accidentForm.loss" :min="0" :step="1000" style="width: 100%" />
        </el-form-item>
        <el-form-item label="处理情况">
          <el-input v-model="accidentForm.handling" placeholder="如：保险理赔中" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="accidentDialog = false">取消</el-button>
        <el-button type="primary" @click="submitAccident">确认登记</el-button>
      </template>
    </el-dialog>

    <!-- 培训计划 -->
    <el-dialog v-model="trainingDialog" title="培训计划" width="440px">
      <el-form label-width="90px">
        <el-form-item label="培训主题" required>
          <el-input v-model="trainingForm.title" maxlength="60" show-word-limit />
        </el-form-item>
        <el-form-item label="培训日期" required>
          <el-date-picker v-model="trainingForm.date" type="date" :disabled-date="disablePastDate" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="讲师">
          <el-input v-model="trainingForm.trainer" placeholder="讲师姓名" />
        </el-form-item>
      </el-form>
      <div class="form-tip">培训完成后在列表"标记完成"并登记实际参训司机。</div>
      <template #footer>
        <el-button @click="trainingDialog = false">取消</el-button>
        <el-button type="primary" @click="submitTraining">确认计划</el-button>
      </template>
    </el-dialog>

    <!-- 培训完成（登记参训司机） -->
    <el-dialog v-model="completeDialog" title="标记培训完成" width="480px">
      <div v-if="completeTarget">
        <el-alert :title="'培训 ' + completeTarget.id + '：' + completeTarget.title + '（' + completeTarget.date + '）'" type="info" :closable="false" show-icon />
        <el-form label-width="90px" style="margin-top: 16px">
          <el-form-item label="参训司机">
            <el-select v-model="completeDriverIds" multiple filterable collapse-tags collapse-tags-tooltip placeholder="选择实际参训司机" style="width: 100%">
              <el-option v-for="d in db.drivers" :key="d.id" :label="d.name + '（' + d.licenseType + '）'" :value="d.id" />
            </el-select>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="completeDialog = false">取消</el-button>
        <el-button type="primary" @click="submitCompleteTraining">确认完成</el-button>
      </template>
    </el-dialog>

    <!-- 登记车辆检查 -->
    <el-dialog v-model="inspectionDialog" title="登记车辆检查" width="480px">
      <el-form label-width="90px">
        <el-form-item label="被检车辆" required>
          <el-select v-model="inspectionForm.vehicleId" filterable placeholder="请选择车辆" style="width: 100%">
            <el-option v-for="v in db.vehicles" :key="v.id" :label="v.plate + '（' + v.type + '）'" :value="v.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="检查日期" required>
          <el-date-picker v-model="inspectionForm.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="检查项目" required>
          <el-select v-model="inspectionForm.item" style="width: 100%">
            <el-option v-for="i in inspectionItems" :key="i" :label="i" :value="i" />
          </el-select>
        </el-form-item>
        <el-form-item label="检查结果" required>
          <el-radio-group v-model="inspectionForm.result">
            <el-radio value="pass">合格</el-radio>
            <el-radio value="fail">不合格</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="检查人">
          <el-input v-model="inspectionForm.inspector" placeholder="检查人姓名" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="inspectionForm.remark" type="textarea" :rows="2" maxlength="200" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="inspectionDialog = false">取消</el-button>
        <el-button type="primary" @click="submitInspection">确认登记</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'Safety' })
import { ref, reactive, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db, dashboard } from '@/mock'
import { registerAccident, closeAccident, addTraining, completeTraining, addInspection } from '@/mock/flow'
import { formatMoney } from '@/utils'
import dayjs from 'dayjs'
import { usePerm } from '@/permission'

const { can } = usePerm()
const activeTab = ref('accident')
const todayStr = dayjs().format('YYYY-MM-DD')

const accidents = computed(() => db.accidents)
const trainings = computed(() => db.trainings)
const inspections = computed(() => db.inspections)

/** 安全运行天数（与看板同口径：距最近一次重大事故） */
const safeDays = computed(() => dashboard.kpi.safeDays)

const yearAccidents = computed(() =>
  db.accidents.filter((a) => dayjs(a.time).isAfter(dayjs().subtract(1, 'year'))).length
)
/** 较上年：近 365 天 vs 前 365 天；基期为 0 时不显示趋势 */
const accidentTrend = computed(() => {
  const lastYear = yearAccidents.value
  const prevYear = db.accidents.filter(
    (a) => dayjs(a.time).isAfter(dayjs().subtract(2, 'year')) && !dayjs(a.time).isAfter(dayjs().subtract(1, 'year'))
  ).length
  return prevYear ? Math.round(((lastYear - prevYear) / prevYear) * 1000) / 10 : null
})
/** 培训覆盖率：近 90 天已完成培训的参训司机（去重）/ 全部司机 */
const trainingCoverage = computed(() => {
  const ids = new Set()
  for (const t of db.trainings) {
    if (t.status === 'completed' && dayjs(t.date).isAfter(dayjs().subtract(90, 'day'))) {
      for (const id of t.driverIds || []) ids.add(id)
    }
  }
  return db.drivers.length ? Math.round((ids.size / db.drivers.length) * 1000) / 10 : 0
})
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

/* ===== 登记入口（走 flow 中枢：状态守卫 + 审计日志） ===== */
const accidentTypes = ['碰撞', '侧翻', '火灾', '泄漏', '其他']
const inspectionItems = ['出车前例行检查', '月度安全检测', '制动系统专项检查', '轮胎磨损检查', 'GPS 设备检测']

/* ---- 事故登记 / 结案 ---- */
const accidentDialog = ref(false)
const accidentForm = reactive({
  time: todayStr,
  type: '碰撞',
  level: '一般',
  vehicleId: '',
  location: '',
  description: '',
  loss: 0,
  handling: ''
})

function openAccident() {
  Object.assign(accidentForm, { time: todayStr, type: '碰撞', level: '一般', vehicleId: '', location: '', description: '', loss: 0, handling: '' })
  accidentDialog.value = true
}

function submitAccident() {
  if (!accidentForm.time) {
    ElMessage.warning('请选择发生日期')
    return
  }
  if (!accidentForm.description.trim()) {
    ElMessage.warning('请填写事故描述')
    return
  }
  const a = registerAccident({ ...accidentForm, description: accidentForm.description.trim() })
  accidentDialog.value = false
  ElMessage.success(`事故 ${a.id} 已登记`)
}

function closeAccidentRow(row) {
  ElMessageBox.confirm(`确认事故 ${row.id} 结案？`, '事故结案', { type: 'warning', confirmButtonText: '确认结案' })
    .then(() => {
      const r = closeAccident(row)
      if (r && r.error) {
        ElMessage.error(r.error)
        return
      }
      ElMessage.success(`事故 ${row.id} 已结案`)
    })
    .catch(() => {})
}

/* ---- 培训计划 / 完成 ---- */
const trainingDialog = ref(false)
const trainingForm = reactive({ title: '', date: '', trainer: '' })

function openTraining() {
  trainingForm.title = ''
  trainingForm.date = ''
  trainingForm.trainer = ''
  trainingDialog.value = true
}

function disablePastDate(date) {
  return date < dayjs().startOf('day')
}

function submitTraining() {
  if (!trainingForm.title.trim()) {
    ElMessage.warning('请填写培训主题')
    return
  }
  if (!trainingForm.date) {
    ElMessage.warning('请选择培训日期')
    return
  }
  const r = addTraining(trainingForm)
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  trainingDialog.value = false
  ElMessage.success(`培训 ${r.id} 已计划`)
}

const completeDialog = ref(false)
const completeTarget = ref(null)
const completeDriverIds = ref([])

function openCompleteTraining(row) {
  completeTarget.value = row
  completeDriverIds.value = []
  completeDialog.value = true
}

function submitCompleteTraining() {
  const r = completeTraining(completeTarget.value, completeDriverIds.value)
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  completeDialog.value = false
  ElMessage.success(`培训 ${completeTarget.value.id} 已完成，${completeDriverIds.value.length} 名司机参训`)
}

/* ---- 车辆检查登记 ---- */
const inspectionDialog = ref(false)
const inspectionForm = reactive({
  vehicleId: '',
  date: todayStr,
  item: '出车前例行检查',
  result: 'pass',
  inspector: '',
  remark: ''
})

function openInspection() {
  Object.assign(inspectionForm, { vehicleId: '', date: todayStr, item: '出车前例行检查', result: 'pass', inspector: '', remark: '' })
  inspectionDialog.value = true
}

function submitInspection() {
  if (!inspectionForm.vehicleId) {
    ElMessage.warning('请选择被检车辆')
    return
  }
  if (!inspectionForm.date) {
    ElMessage.warning('请选择检查日期')
    return
  }
  const i = addInspection(inspectionForm)
  if (i && i.error) {
    ElMessage.error(i.error)
    return
  }
  inspectionDialog.value = false
  ElMessage.success(`车辆 ${i.plate} 检查已登记（${i.result === 'pass' ? '合格' : '不合格'}）`)
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

.text-muted {
  color: var(--text-secondary);
}

.form-tip {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
