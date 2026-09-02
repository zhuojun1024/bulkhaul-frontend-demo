<template>
  <div class="page">
    <PageHeader title="新建合同" desc="填写合同基本信息与商务条款，提交后进入审批流程">
      <el-button :icon="ArrowLeft" @click="$router.back()">返回</el-button>
    </PageHeader>

    <el-form ref="formRef" :model="form" :rules="rules" label-width="110px" class="create-form">
      <!-- 基本信息 -->
      <div class="panel">
        <div class="panel__header"><span class="panel__title">基本信息</span></div>
        <div class="panel__body">
          <el-row :gutter="24">
            <el-col :span="8">
              <el-form-item label="合同名称" prop="name">
                <el-input v-model="form.name" placeholder="如：晋能控股→秦皇岛港 动力煤运输合同" maxlength="60" show-word-limit />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="发货方" prop="shipperId">
                <el-select v-model="form.shipperId" placeholder="请选择发货方" filterable style="width: 100%">
                  <el-option
                    v-for="c in shippers"
                    :key="c.id"
                    :label="c.name"
                    :value="c.id"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="客户等级">
                <el-tag v-if="shipper" :type="levelType(shipper.level)" effect="light">
                  {{ shipper.level }} 级客户
                </el-tag>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="收货方" prop="consigneeId">
                <el-select v-model="form.consigneeId" placeholder="请选择收货方" filterable style="width: 100%">
                  <el-option
                    v-for="c in consignees"
                    :key="c.id"
                    :label="c.name"
                    :value="c.id"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="联系人">
                <el-input v-model="form.contact" placeholder="联系人" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="联系电话">
                <el-input v-model="form.phone" placeholder="联系电话" />
              </el-form-item>
            </el-col>
          </el-row>
        </div>
      </div>

      <!-- 运输方案 -->
      <div class="panel">
        <div class="panel__header"><span class="panel__title">运输方案</span></div>
        <div class="panel__body">
          <el-row :gutter="24">
            <el-col :span="8">
              <el-form-item label="商品" prop="commodityId">
                <el-select v-model="form.commodityId" placeholder="请选择商品" filterable style="width: 100%">
                  <el-option
                    v-for="c in commodities.filter((x) => x.status === 'active')"
                    :key="c.id"
                    :label="c.name + '（' + c.category + '）'"
                    :value="c.id"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="运输方式" prop="mode">
                <el-radio-group v-model="form.mode">
                  <el-radio-button v-for="m in modes" :key="m" :value="m">{{ m }}</el-radio-button>
                </el-radio-group>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="装货场站" prop="loadTerminalId">
                <el-select v-model="form.loadTerminalId" placeholder="请选择" filterable style="width: 100%">
                  <el-option
                    v-for="t in terminals.filter((x) => x.type !== 'unloading' && x.status === 'operating')"
                    :key="t.id"
                    :label="t.name"
                    :value="t.id"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="卸货场站" prop="unloadTerminalId">
                <el-select v-model="form.unloadTerminalId" placeholder="请选择" filterable style="width: 100%">
                  <el-option
                    v-for="t in terminals.filter((x) => x.type !== 'loading' && x.status === 'operating')"
                    :key="t.id"
                    :label="t.name"
                    :value="t.id"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="开始日期" prop="startDate">
                <el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="结束日期" prop="endDate">
                <el-date-picker v-model="form.endDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
              </el-form-item>
            </el-col>
          </el-row>
        </div>
      </div>

      <!-- 商务条款 -->
      <div class="panel">
        <div class="panel__header"><span class="panel__title">商务条款</span></div>
        <div class="panel__body">
          <el-row :gutter="24">
            <el-col :span="8">
              <el-form-item label="计划数量(吨)" prop="quantity">
                <el-input-number v-model="form.quantity" :min="100" :max="1000000" :step="1000" style="width: 100%" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="合同单价(元/吨)" prop="unitPrice" label-width="120">
                <div style="display: flex; gap: 8px; width: 100%">
                  <el-input-number v-model="form.unitPrice" :min="1" :max="1000" :step="0.5" :precision="1" style="flex: 1" />
                  <el-button plain type="primary" @click="fillFromRate">按运价表取价</el-button>
                </div>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="合同金额">
                <div class="amount-preview num">{{ formatMoney(amount) }}</div>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="结算账期(天)" prop="paymentDays">
                <el-select v-model="form.paymentDays" style="width: 100%">
                  <el-option v-for="d in [30, 45, 60, 90]" :key="d" :label="`${d} 天`" :value="d" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="备注">
                <el-input v-model="form.remark" type="textarea" :rows="3" placeholder="结算方式、违约责任等补充条款" maxlength="200" show-word-limit />
              </el-form-item>
            </el-col>
          </el-row>
        </div>
      </div>

      <div class="create-form__footer">
        <el-button @click="$router.back()">取消</el-button>
        <el-button plain type="primary" @click="submit('draft')">保存草稿</el-button>
        <el-button type="primary" @click="submit('pending')">提交审批</el-button>
      </div>
    </el-form>
  </div>
</template>

<script setup>
defineOptions({ name: 'ContractCreate' })
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import { rateOf } from '@/data/derived'
import { useCollection } from '@/composables/useCollection'
import { api } from '@/api'
import { formatMoney } from '@/utils'
import dayjs from 'dayjs'

const router = useRouter()
const formRef = ref()

/* ===== Phase 4 灰度：生产模式（薄客户端）——创建表单下拉集合读后端 /api/coll ===== */
const custCol = useCollection('customers', () => ({ key: 'customers:form' }))
const commCol = useCollection('commodities', () => ({ key: 'commodities:form' }))
const termCol = useCollection('terminals', () => ({ key: 'terminals:form' }))
const customers = computed(() => custCol.data.value)
const commodities = computed(() => commCol.data.value)
const terminals = computed(() => termCol.data.value)

/** 候选客户（响应式：客户冻结/解冻后候选自动刷新） */
const shippers = computed(() => customers.value.filter((c) => (c.type === 'shipper' || c.type === 'both') && c.status === 'active'))
const consignees = computed(() => customers.value.filter((c) => (c.type === 'consignee' || c.type === 'both') && c.status === 'active'))
const modes = ['公路', '铁路', '水运', '多式联运', '管道']

const form = reactive({
  name: '',
  shipperId: '',
  consigneeId: '',
  contact: '',
  phone: '',
  commodityId: '',
  mode: '公路',
  loadTerminalId: '',
  unloadTerminalId: '',
  startDate: dayjs().format('YYYY-MM-DD'),
  endDate: dayjs().add(6, 'month').format('YYYY-MM-DD'),
  quantity: 10000,
  unitPrice: 50,
  paymentDays: 30,
  remark: ''
})

const rules = {
  name: [{ required: true, message: '请输入合同名称', trigger: 'blur' }],
  shipperId: [{ required: true, message: '请选择发货方', trigger: 'change' }],
  consigneeId: [{ required: true, message: '请选择收货方', trigger: 'change' }],
  commodityId: [{ required: true, message: '请选择商品', trigger: 'change' }],
  mode: [{ required: true, message: '请选择运输方式', trigger: 'change' }],
  loadTerminalId: [{ required: true, message: '请选择装货场站', trigger: 'change' }],
  unloadTerminalId: [{ required: true, message: '请选择卸货场站', trigger: 'change' }],
  startDate: [{ required: true, message: '请选择开始日期', trigger: 'change' }],
  endDate: [{ required: true, message: '请选择结束日期', trigger: 'change' }],
  quantity: [{ required: true, message: '请输入计划数量', trigger: 'blur' }],
  unitPrice: [{ required: true, message: '请输入合同单价', trigger: 'blur' }]
}

const shipper = computed(() => customers.value.find((c) => c.id === form.shipperId))
const amount = computed(() => Math.round(form.quantity * form.unitPrice))

function levelType(level) {
  return { A: 'danger', B: 'warning', C: 'info' }[level] || 'info'
}

/** 按运价表取价：按 商品+装/卸场站+方式 查启用中的运价卡，命中则回填单价 */
function fillFromRate() {
  if (!form.commodityId || !form.loadTerminalId || !form.unloadTerminalId) {
    ElMessage.warning('请先选择商品与装/卸货场站')
    return
  }
  const rc = rateOf(form.commodityId, form.loadTerminalId, form.unloadTerminalId, form.mode)
  if (!rc) {
    ElMessage.warning('运价表无该线路启用中的运价，请手工填写单价')
    return
  }
  form.unitPrice = rc.unitPrice
  ElMessage.success(`已按运价卡 ${rc.id} 取价：${rc.unitPrice} 元/吨`)
}

onMounted(() => { custCol.refresh(); commCol.refresh(); termCol.refresh() })
const onRefreshed = () => { custCol.refresh(); commCol.refresh(); termCol.refresh() }
window.addEventListener('blms:refreshed', onRefreshed)
onUnmounted(() => window.removeEventListener('blms:refreshed', onRefreshed))

async function submit(status) {
  formRef.value.validate(async (valid) => {
    if (!valid) {
      ElMessage.warning('请完善必填信息')
      return
    }
    // Phase 4 引擎移除：生产模式写操作 = 后端权威（POST /contract 落库：守卫 + 信用校验 + 审批链 + 审计）
    const r = await api('POST', '/contract', { ...form, status })
    if (!r.ok) {
      ElMessageBox.alert(r.error, status === 'pending' ? '提交失败' : '创建失败', { type: 'warning', confirmButtonText: '知道了' })
      return
    }
    ElMessage.success(status === 'draft' ? '草稿已保存' : `合同 ${r.data.id} 已提交审批（部门审批 → 公司审批）`)
    router.push('/contract')
  })
}
</script>

<style scoped>
.create-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

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
