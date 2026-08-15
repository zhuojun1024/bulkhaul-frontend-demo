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

          <el-alert v-if="contract" type="success" :closable="false" show-icon>
            <template #title>
              已带出合同信息：{{ find.commodity(contract.commodityId)?.name }} ·
              {{ find.terminal(contract.loadTerminalId)?.name }} →
              {{ find.terminal(contract.unloadTerminalId)?.name }} ·
              单价 {{ contract.unitPrice }} 元/吨
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
                <el-input-number v-model="form.quantity" :min="100" :max="50000" :step="100" style="width: 100%" />
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
        <el-button type="primary" :loading="submitting" @click="submit">创建计划</el-button>
      </div>
    </el-form>
  </div>
</template>

<script setup>
defineOptions({ name: 'PlanCreate' })
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import { db, find } from '@/mock'
import { formatMoney } from '@/utils'
import dayjs from 'dayjs'

const router = useRouter()
const formRef = ref()
const submitting = ref(false)

const executableContracts = db.contracts.filter((c) => c.status === 'executing')

const form = reactive({
  contractId: '',
  planDate: dayjs().add(1, 'day').format('YYYY-MM-DD'),
  quantity: 1000,
  remark: ''
})

const rules = {
  contractId: [{ required: true, message: '请选择合同', trigger: 'change' }],
  planDate: [{ required: true, message: '请选择计划日期', trigger: 'change' }],
  quantity: [{ required: true, message: '请输入批次数量', trigger: 'blur' }]
}

const contract = computed(() => find.contract(form.contractId))
const amount = computed(() => Math.round(form.quantity * (contract.value?.unitPrice || 0)))

function onContractChange() {
  // 信息自动带出，无需额外处理
}

function submit() {
  formRef.value.validate((valid) => {
    if (!valid) return
    submitting.value = true
    setTimeout(() => {
      const id = `YH-${String(db.plans.length + 1).padStart(4, '0')}`
      const c = contract.value
      db.plans.unshift({
        id,
        contractId: c.id,
        commodityId: c.commodityId,
        quantity: form.quantity,
        loadTerminalId: c.loadTerminalId,
        unloadTerminalId: c.unloadTerminalId,
        mode: c.mode,
        planDate: form.planDate,
        unitPrice: c.unitPrice,
        status: 'pending',
        progress: 0,
        remark: form.remark
      })
      submitting.value = false
      ElMessage.success(`计划 ${id} 创建成功`)
      router.push(`/plan/${id}`)
    }, 400)
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

.create-form__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 4px 0 20px;
}
</style>
