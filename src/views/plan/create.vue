<template>
  <div class="page">
    <PageHeader title="新建运输计划" desc="从执行中的合同拆分批次的运输计划">
      <el-button :icon="ArrowLeft" @click="$router.back()">返回</el-button>
    </PageHeader>

    <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
      <div class="panel">
        <div class="panel__header"><span class="panel__title">选择合同</span></div>
        <div class="panel__body">
          <el-form-item label="所属合同" prop="contractId">
            <el-select
              v-model="form.contractId"
              placeholder="选择执行中的合同（自动带出商品与线路）"
              filterable
              style="width: 100%"
              @change="onContractChange"
            >
              <el-option
                v-for="c in executableContracts"
                :key="c.id"
                :label="c.id + ' ' + c.name"
                :value="c.id"
              />
            </el-select>
          </el-form-item>

          <el-alert v-if="contract" :type="remaining > 0 ? 'success' : 'warning'" :closable="false" show-icon>
            <template #title>
              已带出合同信息：{{ find.commodity(contract.commodityId)?.name }} ·
              {{ find.terminal(contract.loadTerminalId)?.name }} →
              {{ find.terminal(contract.unloadTerminalId)?.name }} ·
              单价 {{ contract.unitPrice }} 元/吨 ·
              剩余可计划 <span class="remaining num">{{ formatNum(remaining) }}</span> 吨
            </template>
          </el-alert>
        </div>
      </div>

      <div class="panel">
        <div class="panel__header"><span class="panel__title">批次信息</span></div>
        <div class="panel__body">
          <el-row :gutter="24">
            <el-col :span="8">
              <el-form-item label="计划日期" prop="planDate">
                <el-date-picker v-model="form.planDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="批次数量(吨)" prop="quantity">
                <el-input-number v-model="form.quantity" :min="100" :max="remaining > 0 ? remaining : 50000" :step="100" style="width: 100%" />
                <div class="quantity-tip">不得超过合同剩余可计划量（{{ formatNum(remaining) }} 吨）</div>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="批次金额">
                <div class="amount-preview num">{{ formatMoney(amount) }}</div>
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="备注">
                <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="批次特殊要求（可选）" />
              </el-form-item>
            </el-col>
          </el-row>
        </div>
      </div>

      <div class="create-form__footer">
        <el-button @click="$router.back()">取消</el-button>
        <el-button type="primary" @click="submit">创建计划</el-button>
      </div>
    </el-form>
  </div>
</template>

<script setup>
defineOptions({ name: 'PlanCreate' })
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import { db, find } from '@/mock'
import { contractRemaining } from '@/mock/flow'
import { useCollection } from '@/composables/useCollection'
import { api } from '@/api'
import { formatMoney, formatNum } from '@/utils'
import dayjs from 'dayjs'

const router = useRouter()
const formRef = ref()

/* ===== Phase 4 灰度：生产模式（薄客户端）——执行中合同下拉读后端 /api/coll/contracts ===== */
const contractCol = useCollection('contracts', () => ({ key: 'contracts:form' }))
const contracts = computed(() => contractCol.data.value)

/** 执行中合同（响应式：合同审批通过/状态变化后候选自动刷新） */
const executableContracts = computed(() => contracts.value.filter((c) => c.status === 'executing'))

const form = reactive({
  contractId: '',
  planDate: dayjs().add(1, 'day').format('YYYY-MM-DD'),
  quantity: 1000,
  remark: ''
})

const rules = {
  contractId: [{ required: true, message: '请选择合同', trigger: 'change' }],
  planDate: [{ required: true, message: '请选择计划日期', trigger: 'change' }],
  quantity: [
    { required: true, message: '请输入批次数量', trigger: 'blur' },
    {
      // 剩余量校验：批次数量不得超过合同剩余可计划量
      validator: (rule, value, callback) => {
        if (contract.value && value > remaining.value) {
          callback(new Error(`超出合同剩余可计划量（剩余 ${remaining.value} 吨）`))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ]
}

const contract = computed(() => find.contract(form.contractId))
/** 合同剩余可计划量 = 合同总量 - 未取消计划量之和 */
const remaining = computed(() => (contract.value ? contractRemaining(contract.value.id) : 0))
const amount = computed(() => Math.round(form.quantity * (contract.value?.unitPrice || 0)))

function onContractChange() {
  // 信息自动带出；数量超出新合同剩余量时回落到剩余量
  if (remaining.value > 0 && form.quantity > remaining.value) {
    form.quantity = remaining.value
  }
}

onMounted(() => { contractCol.refresh() })
const onRefreshed = () => { contractCol.refresh() }
window.addEventListener('blms:refreshed', onRefreshed)
onUnmounted(() => window.removeEventListener('blms:refreshed', onRefreshed))

async function submit() {
  formRef.value.validate(async (valid) => {
    if (!valid) return
    // Phase 4 引擎移除：生产模式写操作 = 后端权威（POST /plan：合同执行中 + 剩余量守卫 + 审计）
    const r = await api('POST', '/plan', {
      contractId: form.contractId,
      planDate: form.planDate,
      quantity: form.quantity,
      remark: form.remark
    })
    if (!r.ok) {
      ElMessage.warning(r.error || '创建失败')
      return
    }
    ElMessage.success(`计划 ${r.data.id} 创建成功`)
    router.push(`/plan/${r.data.id}`)
  })
}
</script>

<style scoped>
.amount-preview {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-primary);
  line-height: 32px;
}

.remaining {
  font-weight: 700;
  color: var(--color-primary);
}

.quantity-tip {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
  margin-top: 2px;
}

.create-form__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 4px 0 20px;
}
</style>
