<template>
  <div class="page">
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
          <el-button v-if="dispatch && ['pending', 'loading', 'intransit'].includes(dispatch.status) && can('exception')" type="danger" plain :icon="Warning" @click="openReport">
            上报异常
          </el-button>
          <el-button
            v-if="dispatch?.status === 'completed' && isRoad && !dispatch.receipt && can('dispatch')"
            type="warning"
            plain
            :icon="EditPen"
            @click="openSupplement"
          >
            补签
          </el-button>
          <el-button v-if="dispatch?.driverId" type="primary" plain :icon="Cellphone" @click="openDriverApp">
            司机端视图
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
              <el-descriptions-item label="装货场站">{{ loadTerminal?.name }}</el-descriptions-item>
              <el-descriptions-item label="卸货场站">{{ unloadTerminal?.name }}</el-descriptions-item>
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
              <el-descriptions-item label="装货码">
                <span class="num scan-code">{{ dispatch ? loadCodeOf(dispatch) : '—' }}</span>
                <span class="receipt-text">装货场扫码确认装货</span>
              </el-descriptions-item>
              <el-descriptions-item label="卸货码">
                <span class="num scan-code">{{ dispatch ? unloadCodeOf(dispatch) : '—' }}</span>
                <span class="receipt-text">卸货场扫码确认卸货</span>
              </el-descriptions-item>
              <el-descriptions-item label="电子签收">
                <template v-if="dispatch?.receipt">
                  <el-tag size="small" type="success" effect="light">{{ dispatch.receipt.code }}</el-tag>
                  <el-tooltip v-if="dispatch.receipt.supplement" :content="'补签：' + (dispatch.receipt.reason || '与收货方核实后补开')" placement="top">
                    <el-tag size="small" type="warning" effect="plain" style="margin-left: 4px">补签</el-tag>
                  </el-tooltip>
                  <span class="receipt-text">{{ dispatch.receipt.signer }} · {{ dispatch.receipt.time }}</span>
                </template>
                <span v-else-if="dispatch?.status === 'completed' && isRoad" class="text-danger">未签收（结算收货凭证缺失，需补签）</span>
                <span v-else>—</span>
              </el-descriptions-item>
              <el-descriptions-item label="质检（水分/灰分）">
                <template v-if="dispatch?.quality">
                  <span class="num">{{ dispatch.quality.moisture }}% / {{ dispatch.quality.ash }}%</span>
                  <el-tooltip
                    v-if="qualityDeduct > 0"
                    :content="'标准水分 10% / 灰分 15%，超标部分按出磅净重扣减（水分 1.5%/1%、灰分 1%/1%）'"
                    placement="top"
                  >
                    <el-tag size="small" type="warning" effect="plain" style="margin-left: 4px">扣重 {{ qualityDeduct }} 吨</el-tag>
                  </el-tooltip>
                  <span class="receipt-text">{{ dispatch.quality.time }}</span>
                </template>
                <span v-else>—</span>
              </el-descriptions-item>
            </el-descriptions>
          </div>
        </div>
      </el-col>

      <!-- 右侧：车辆司机 + 磅单 -->
      <el-col :span="10">
        <div class="panel">
          <div class="panel__header"><span class="panel__title">{{ isRoad ? '车辆与司机' : '运输单元' }}</span></div>
          <div class="panel__body">
            <template v-if="isRoad">
              <div class="vehicle-card">
                <div class="vehicle-card__icon">
                  <el-icon :size="28" color="var(--color-primary)"><Van /></el-icon>
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
            </template>
            <div v-else class="vehicle-card">
              <div class="vehicle-card__icon">
                <el-icon :size="28" color="var(--color-primary)"><Box /></el-icon>
              </div>
              <div class="vehicle-card__info">
                <div class="vehicle-card__plate">{{ dispatch?.unitNo || '—' }}</div>
                <div class="vehicle-card__sub">{{ dispatch?.mode }} · 按运输单元执行，不占用车辆与司机资源</div>
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
              <el-table-column label="净重" width="110" align="right">
                <template #default="{ row }">
                  <span class="num net">{{ row.net }}t</span>
                  <el-tag v-if="row.corrected" size="small" type="warning" effect="light" style="margin-left: 4px">已复磅</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="time" label="时间" min-width="130" />
            </el-table>
            <el-empty v-if="!weighings.length" :description="isRoad ? '暂无磅单' : '该方式无公路磅单，结算按调度量执行'" :image-size="60" />
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 上报异常（类型 + 级别 + 描述） -->
    <el-dialog v-model="excDialog" title="上报异常" width="480px">
      <div v-if="dispatch">
        <el-alert :title="'调度单 ' + dispatch.id + '（' + unitText + '）'" type="warning" :closable="false" show-icon />
        <el-form label-width="80px" style="margin-top: 16px">
          <el-form-item label="异常类型" required>
            <el-select v-model="excForm.type" style="width: 100%">
              <el-option v-for="(v, k) in excTypeMap" :key="k" :label="v" :value="k" />
            </el-select>
          </el-form-item>
          <el-form-item label="级别" required>
            <el-select v-model="excForm.level" style="width: 100%">
              <el-option v-for="(v, k) in excLevelMap" :key="k" :label="v.label" :value="k" />
            </el-select>
          </el-form-item>
          <el-form-item label="描述" required>
            <el-input v-model="excForm.description" type="textarea" :rows="3" maxlength="200" show-word-limit placeholder="请简述异常情况" />
          </el-form-item>
        </el-form>
        <div v-if="excForm.type === 'accident'" class="exc-tip">事故类异常将同步生成事故记录，进入安全管理模块跟踪。</div>
      </div>
      <template #footer>
        <el-button @click="excDialog = false">取消</el-button>
        <el-button type="danger" @click="submitException">上报</el-button>
      </template>
    </el-dialog>

    <!-- 补签（环节1：已完成公路车次缺失签收凭证，与收货方核实后补开） -->
    <el-dialog v-model="supDialog" title="补签电子签收单" width="480px">
      <div v-if="dispatch">
        <el-alert
          :title="'调度单 ' + dispatch.id + ' 已完成但无电子签收单（收货凭证），补签后方可确认结算'"
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
defineOptions({ name: 'DispatchDetail' })
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Box, CircleCheck, Warning, Printer, Position, RefreshRight, Cellphone, EditPen } from '@element-plus/icons-vue'
import StatusTag from '@/components/StatusTag.vue'
import { db } from '@/mock'
// 本视图交叉引用查找（原 @/mock find 下沉，仅声明本视图用到的键）
const find = {
  commodity: (id) => db.commodities.find((c) => c.id === id),
  terminal: (id) => db.terminals.find((t) => t.id === id),
  vehicle: (id) => db.vehicles.find((v) => v.id === id),
  driver: (id) => db.drivers.find((d) => d.id === id),
  dispatch: (id) => db.dispatches.find((d) => d.id === id),
}
import { api, refreshDb } from '@/api'
import { isRoadMode, loadCodeOf, unloadCodeOf, qualityDeductionQty } from '@/mock/derived'
import { formatMoney } from '@/utils'
import dayjs from 'dayjs'
import { usePerm } from '@/permission'

const route = useRoute()
const router = useRouter()
const { can } = usePerm()

/* ===== Phase 4 阶段 4：薄客户端读聚合端点（单次往返取详情读面） =====
 * onMounted/换单时 GET /api/dispatch/{id}/detail 取权威读面（dispatch/commodity/
 *   vehicle/driver/loadTerminal/unloadTerminal），写入仍走 flow（乐观改 detail.dispatch +
 *   afterWrite 落库）；磅单读 db.weighings（flow 乐观 push + refreshDb 同步，与端点同源）。
 *   不监听 blms:refreshed 重取，避免 200ms 防抖刷新早于 PUT 落库而回写种子态覆盖乐观态
 *   （与阶段 3 同口径，导航时重取权威态）。 */
const detail = ref(null)
async function loadDetail() {
  const r = await api('GET', '/dispatch/' + route.params.id + '/detail')
  if (r.ok && r.data) detail.value = r.data
}

const dispatch = computed(() => (detail.value ? detail.value.dispatch : find.dispatch(route.params.id)))
const commodity = computed(() => (detail.value ? detail.value.commodity : find.commodity(dispatch.value?.commodityId)))
const vehicle = computed(() => (detail.value ? detail.value.vehicle : find.vehicle(dispatch.value?.vehicleId)))
const driver = computed(() => (detail.value ? detail.value.driver : find.driver(dispatch.value?.driverId)))
const loadTerminal = computed(() => (detail.value ? detail.value.loadTerminal : find.terminal(dispatch.value?.loadTerminalId)))
const unloadTerminal = computed(() => (detail.value ? detail.value.unloadTerminal : find.terminal(dispatch.value?.unloadTerminalId)))
const weighings = computed(() => db.weighings.filter((w) => w.dispatchId === dispatch.value?.id))

/** 公路口径（公路/多式联运）才有车辆司机与公路磅单 */
const isRoad = computed(() => isRoadMode(dispatch.value?.mode))
/** 环节4：质量扣重吨数（水分/灰分超标按出磅净重比例扣减） */
const qualityDeduct = computed(() => qualityDeductionQty(dispatch.value))
/** 执行主体：车牌优先，非公路口径取运输单元号 */
const unitText = computed(() => vehicle.value?.plate || dispatch.value?.unitNo || '—')

// 生产模式：进入/换单时取权威详情
onMounted(loadDetail)
watch(() => route.params.id, loadDetail)

/** 司机端视图：携带司机与聚焦单号进入 H5 演示页 */
function openDriverApp() {
  router.push({ path: '/driver-app', query: { driverId: dispatch.value.driverId, focus: dispatch.value.id } })
}

const statusMap = {
  pending: { label: '待装货', type: 'info' },
  loading: { label: '装货中', type: 'warning' },
  intransit: { label: '在途', type: 'primary' },
  unloading: { label: '卸货中', type: 'warning' },
  completed: { label: '已完成', type: 'success' },
  exception: { label: '异常', type: 'danger' },
  cancelled: { label: '已取消', type: 'info' }
}

const timeline = computed(() => {
  const d = dispatch.value
  if (!d) return []
  const steps = [
    {
      title: '调度下发',
      time: d.dispatchTime,
      desc: isRoad.value
        ? `调度员向 ${vehicle.value?.plate}（司机 ${driver.value?.name}）下发运输指令`
        : `调度员向 ${d.unitNo} 下发运输指令（按运输单元执行）`,
      done: true,
      type: 'primary'
    },
    {
      title: isRoad.value ? '装货过磅' : '装货确认',
      time: d.loadTime,
      desc: d.loadTime ? `于${loadTerminal.value?.name}完成装货，净重 ${d.quantity} 吨` : isRoad.value ? '车辆到达装货场站排队中' : '运输单元到达装货场站排队中',
      done: !!d.loadTime,
      type: d.loadTime ? 'primary' : 'info'
    },
    { title: '在途运输', time: d.eta ? `预计 ${d.eta} 到达` : '', desc: d.status === 'intransit' ? `当前进度 ${d.progress}%，实时车速 ${d.speed} km/h` : d.status === 'pending' ? '等待装货' : '运输中', done: d.status === 'intransit' || d.status === 'unloading' || d.status === 'completed', type: 'primary' },
    { title: '卸货完成', time: d.unloadTime, desc: d.unloadTime ? `于${unloadTerminal.value?.name}完成卸货` : '—', done: !!d.unloadTime, type: d.unloadTime ? 'success' : 'info' }
  ]
  if (d.status === 'exception') {
    steps.splice(3, 0, { title: '异常发生', time: dayjs().format('YYYY-MM-DD HH:mm'), desc: '运输过程中发生异常，已上报处理', done: true, type: 'danger' })
  }
  return steps
})

/* ===== Phase 4 引擎移除：写操作 = 后端权威（POST 落库）+ 重取权威详情 =====
 * 不再依赖本地乐观改态（内存引擎已移除 F3，写路径纯后端）。
 * 后端为完整状态机（doConfirmLoad 等价前端，联动磅单/计划/结算），重取后 UI 与后端同源。 */
async function prodWrite(path, successMsg, body) {
  const r = await api('POST', path, body)
  if (!r.ok || (r.data && r.data.error)) {
    ElMessage.error((r.data && r.data.error) || r.error || '操作失败')
    return false
  }
  // 后端已提交（await 落库）→ 拉权威快照（联动磅单/计划等集合 + 通知列表页重取）+ 重取本单详情
  await refreshDb()
  await loadDetail()
  ElMessage.success(successMsg)
  return true
}

function confirmLoad() {
  ElMessageBox.confirm('确认已完成装货并登记进磅单？', '确认装货', { type: 'info' }).then(async () => {
    await prodWrite('/dispatch/' + dispatch.value.id + '/confirmLoad', '装货确认成功')
  }).catch(() => {})
}

function depart() {
  ElMessageBox.confirm(`确认 ${unitText.value} 发车开始运输？`, '发车确认', { type: 'info' }).then(async () => {
    await prodWrite('/dispatch/' + dispatch.value.id + '/depart', '已发车，进入在途状态')
  }).catch(() => {})
}

function arrive() {
  ElMessageBox.confirm(`确认 ${unitText.value} 已到达卸货场站，开始卸货？`, '到达确认', { type: 'info' }).then(async () => {
    await prodWrite('/dispatch/' + dispatch.value.id + '/arrive', '已到达，进入卸货状态')
  }).catch(() => {})
}

function confirmUnload() {
  ElMessageBox.confirm('确认已完成卸货？', '确认卸货', { type: 'success' }).then(async () => {
    await prodWrite('/dispatch/' + dispatch.value.id + '/confirmUnload', '卸货确认成功，本次运输完成')
  }).catch(() => {})
}

function resume() {
  ElMessageBox.confirm(`确认调度单 ${dispatch.value.id} 恢复运输？`, '恢复运输', { type: 'warning' }).then(async () => {
    await prodWrite('/dispatch/' + dispatch.value.id + '/resume', '已恢复运输')
  }).catch(() => {})
}

/* ===== 上报异常（类型 + 级别 + 描述，事故类联动安全模块） ===== */
const excDialog = ref(false)
const excForm = reactive({ type: 'other', level: 'medium', description: '' })
const excTypeMap = { delay: '延误', accident: '事故', damage: '货损', quality: '质量', overload: '超载', other: '其他' }
const excLevelMap = {
  low: { label: '低', type: 'info' },
  medium: { label: '中', type: 'warning' },
  high: { label: '高', type: 'danger' }
}

function openReport() {
  excForm.type = 'other'
  excForm.level = 'medium'
  excForm.description = ''
  excDialog.value = true
}

async function submitException() {
  if (!excForm.description.trim() || excForm.description.trim().length < 2) {
    ElMessage.warning('描述至少 2 个字符')
    return
  }
  const ok = await prodWrite('/dispatch/' + dispatch.value.id + '/reportException', '异常已上报，请前往异常处理模块跟进', { description: excForm.description.trim(), type: excForm.type, level: excForm.level })
  if (ok) excDialog.value = false
}

/* ===== 补签（环节1：已完成公路车次缺失签收凭证，与收货方核实后补开） ===== */
const supDialog = ref(false)
const supForm = reactive({ signer: '', reason: '' })

function openSupplement() {
  supForm.signer = ''
  supForm.reason = ''
  supDialog.value = true
}

async function submitSupplement() {
  if (!supForm.signer.trim()) {
    ElMessage.warning('请填写签收人')
    return
  }
  const r = await api('POST', '/dispatch/' + dispatch.value.id + '/supplementReceipt', { signer: supForm.signer.trim(), reason: supForm.reason.trim() })
  if (!r.ok || (r.data && r.data.error)) { ElMessage.error((r.data && r.data.error) || r.error || '补签失败'); return }
  await loadDetail()
  supDialog.value = false
  ElMessage.success(`补签成功：${(r.data && r.data.receipt && r.data.receipt.code) || ''}（签收人 ${supForm.signer.trim()}）`)
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
    <tr><th>车辆/单元</th><td>${vehicle.value?.plate || d.unitNo || '—'}</td><th>司机</th><td>${driver.value ? driver.value.name + ' ' + driver.value.phone : '—（按运输单元执行）'}</td></tr>
    <tr><th>商品</th><td>${commodity.value?.name}</td><th>数量</th><td>${d.quantity} 吨</td></tr>
    <tr><th>装货场站</th><td>${loadTerminal.value?.name}</td><th>卸货场站</th><td>${unloadTerminal.value?.name}</td></tr>
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

.exc-tip {
  font-size: 12px;
  color: var(--text-secondary);
}

.text-danger {
  color: var(--color-danger);
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

.receipt-text {
  margin-left: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.scan-code {
  font-family: Consolas, Menlo, monospace;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--color-primary);
}
</style>
