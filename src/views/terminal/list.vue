<template>
  <div class="page">
    <PageHeader title="场站管理" desc="装/卸货场站运行状态、吞吐量与排队情况">
      <el-button v-if="can('terminal')" type="primary" :icon="Plus" @click="openDialog()">新增场站</el-button>
      <el-button type="primary" :icon="ScaleToOriginal" @click="$router.push('/terminal/weighing')">
        磅单记录
      </el-button>
    </PageHeader>

    <div class="stat-row">
      <StatCard title="场站总数" :value="terminals.length" unit="个" icon="OfficeBuilding" color="var(--color-primary)" :sub="'运营中 ' + operatingCount + ' 个'" />
      <StatCard title="今日总吞吐" :value="formatNum(totalThroughput)" unit="吨" icon="DataLine" color="var(--color-success)" :trend="8.6" trend-label="较昨日" />
      <StatCard title="排队车辆" :value="totalQueue" unit="辆" icon="Van" color="var(--color-warning)" :sub="'全部场站合计'" />
      <StatCard title="场站利用率" :value="utilization" unit="%" icon="PieChart" color="var(--color-info)" :trend="3.2" trend-label="较昨日" />
    </div>

    <div class="terminal-grid">
      <div v-for="t in terminals" :key="t.id" class="terminal-card panel">
        <div class="terminal-card__head">
          <div class="terminal-card__type" :class="'type--' + t.type">
            {{ typeMap[t.type] }}
          </div>
          <StatusTag :status="t.status" :map="statusMap" />
        </div>
        <div class="terminal-card__name">{{ t.name }}</div>
        <div class="terminal-card__addr">
          <el-icon :size="13"><Location /></el-icon>
          {{ t.address }}
        </div>
        <div class="terminal-card__stats">
          <div class="terminal-card__stat">
            <div class="terminal-card__num num">{{ formatNum(t.todayThroughput) }}</div>
            <div class="terminal-card__label">今日吞吐(吨)</div>
          </div>
          <div class="terminal-card__stat">
            <div class="terminal-card__num num">{{ t.queueVehicles }}</div>
            <div class="terminal-card__label">排队车辆</div>
          </div>
          <div class="terminal-card__stat">
            <div class="terminal-card__num num">{{ formatNum(t.capacity) }}</div>
            <div class="terminal-card__label">日能力(吨)</div>
          </div>
        </div>
        <el-progress
          :percentage="Math.round((t.todayThroughput / t.capacity) * 100)"
          :stroke-width="8"
          :color="progressColor(t)"
        />
        <div class="terminal-card__footer">
          <span class="terminal-card__contact">
            <el-icon :size="13"><Phone /></el-icon>
            {{ t.contact }} {{ t.phone }}
          </span>
          <span>
            <el-button v-if="can('terminal')" size="small" text @click="openDialog(t)">编辑</el-button>
            <el-button size="small" text type="primary" @click="$router.push('/terminal/weighing')">
              磅单
            </el-button>
          </span>
        </div>
      </div>
    </div>

    <!-- F6a：新增/编辑场站（RBAC terminal，服务层守卫 + 审计） -->
    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑场站' : '新增场站'" width="520px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="场站名称" required>
          <el-input v-model="form.name" placeholder="如：XX 港煤炭码头" />
        </el-form-item>
        <el-form-item label="类型" required>
          <el-select v-model="form.type" style="width: 100%">
            <el-option label="装卸一体" value="both" />
            <el-option label="装货场" value="loading" />
            <el-option label="卸货场" value="unloading" />
          </el-select>
        </el-form-item>
        <el-form-item label="区域">
          <el-select v-model="form.region" style="width: 100%">
            <el-option v-for="r in regionOptions" :key="r" :label="r" :value="r" />
          </el-select>
        </el-form-item>
        <el-form-item label="日能力(吨)" required>
          <el-input-number v-model="form.capacity" :min="1" :step="1000" controls-position="right" style="width: 100%" />
        </el-form-item>
        <el-form-item label="配套仓库">
          <el-select v-model="form.warehouseId" clearable placeholder="无（装卸货不联动仓储）" style="width: 100%">
            <el-option v-for="w in db.warehouses" :key="w.id" :label="`${w.name}（${w.type}）`" :value="w.id" />
          </el-select>
          <div class="form-tip">绑定后该场站装卸货将联动仓储出入库（装货 FIFO 出库、卸货按出磅净重入库）</div>
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="form.address" placeholder="详细地址" />
        </el-form-item>
        <el-form-item label="联系人">
          <el-input v-model="form.contact" placeholder="如：王站长" />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="form.phone" placeholder="联系电话" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
defineOptions({ name: 'Terminal' })
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { ScaleToOriginal, Location, Phone, Plus } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import StatCard from '@/components/StatCard.vue'
import StatusTag from '@/components/StatusTag.vue'
import { db } from '@/mock'
import { saveTerminal } from '@/mock/flow'
import { useCollection } from '@/composables/useCollection'
import { isProduction } from '@/mode'
import { api } from '@/api'
import { formatNum } from '@/utils'
import { useTokens } from '@/utils/tokens'
import { usePerm } from '@/permission'

const tokens = useTokens()
const { can } = usePerm()


const typeMap = { loading: '装货场', unloading: '卸货场', both: '装卸一体' }
const statusMap = {
  operating: { label: '运营中', type: 'success' },
  maintenance: { label: '检修中', type: 'warning' }
}

/* ===== Phase 4 灰度：生产模式（薄客户端）——场站列表读后端 /api/coll/terminals ===== */
const PROD = isProduction()
const listCol = useCollection('terminals', () => ({ key: 'terminals:list' }))
const terminals = computed(() => PROD ? listCol.data.value : db.terminals)
const operatingCount = computed(() => terminals.value.filter((t) => t.status === 'operating').length)
const totalThroughput = computed(() => terminals.value.reduce((s, t) => s + t.todayThroughput, 0))
const totalQueue = computed(() => terminals.value.reduce((s, t) => s + t.queueVehicles, 0))
const utilization = computed(() => {
  const cap = terminals.value.reduce((s, t) => s + t.capacity, 0)
  return Math.round((totalThroughput.value / cap) * 1000) / 10
})

if (PROD) {
  onMounted(() => { listCol.refresh() })
  const onRefreshed = () => { listCol.refresh() }
  window.addEventListener('blms:refreshed', onRefreshed)
  onUnmounted(() => window.removeEventListener('blms:refreshed', onRefreshed))
}

/* ===== Phase 4 引擎移除：生产模式写操作 = 后端权威（POST 落库）+ 列表重取 =====
 * 后端业务错误经 ApiResult.success 包装为 data.error（HTTP 200），须检查 r.data.error。 */
async function prodWrite(path, body) {
  const r = await api('POST', path, body)
  if (!r.ok || (r.data && r.data.error)) {
    ElMessage.error((r.data && r.data.error) || r.error || '操作失败')
    return null
  }
  await listCol.refresh()
  return r.data
}

function progressColor(t) {
  const ratio = t.todayThroughput / t.capacity
  if (ratio > 0.85) return tokens.danger
  if (ratio > 0.6) return tokens.warning
  return tokens.success
}

/* ===== F6a：新增/编辑场站（RBAC terminal，服务层守卫 + 审计） ===== */
const dialogVisible = ref(false)
const form = reactive({
  id: '',
  name: '',
  type: 'both',
  region: '',
  capacity: 10000,
  warehouseId: null,
  address: '',
  contact: '',
  phone: '',
  remark: ''
})
const regionOptions = computed(() => [...new Set(terminals.value.map((t) => t.region))])

function openDialog(t) {
  if (t) {
    Object.assign(form, {
      id: t.id,
      name: t.name,
      type: t.type,
      region: t.region,
      capacity: t.capacity,
      warehouseId: t.warehouseId || null,
      address: t.address,
      contact: t.contact,
      phone: t.phone,
      remark: t.remark
    })
  } else {
    Object.assign(form, {
      id: '',
      name: '',
      type: 'both',
      region: regionOptions.value[0] || '',
      capacity: 10000,
      warehouseId: null,
      address: '',
      contact: '',
      phone: '',
      remark: ''
    })
  }
  dialogVisible.value = true
}

async function save() {
  if (!form.name.trim()) {
    ElMessage.warning('请输入场站名称')
    return
  }
  // Phase 4 引擎移除：生产模式写操作 = 后端权威（RBAC + 重名守卫 + 审计）
  if (PROD) {
    const d = await prodWrite('/admin/terminal', { ...form })
    if (!d) return
    dialogVisible.value = false
    ElMessage.success(form.id ? '场站已更新' : '场站已新增')
    return
  }
  const r = saveTerminal({ ...form })
  if (r && r.error) {
    ElMessage.error(r.error)
    return
  }
  dialogVisible.value = false
  ElMessage.success(form.id ? '场站已更新' : '场站已新增')
}
</script>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.terminal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.terminal-card {
  padding: 18px 20px;
  transition: all 0.2s;
}

.terminal-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 20px rgba(16, 24, 40, 0.1);
}

.terminal-card__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.terminal-card__type {
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 20px;
}

.type--loading {
  background: rgba(0, 180, 42, 0.1);
  color: var(--color-success);
}

.type--unloading {
  background: rgba(255, 125, 0, 0.1);
  color: var(--color-warning);
}

.type--both {
  background: rgba(43, 92, 230, 0.1);
  color: var(--color-primary);
}

.terminal-card__name {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 6px;
}

.terminal-card__addr {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 14px;
}

.terminal-card__stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}

.terminal-card__stat {
  text-align: center;
  background: var(--color-neutral-50);
  border-radius: 8px;
  padding: 10px 4px;
}

.terminal-card__num {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
}

.terminal-card__label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.terminal-card__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
}

.terminal-card__contact {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}

.form-tip {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-top: 2px;
}
</style>
