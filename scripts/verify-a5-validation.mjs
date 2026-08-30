
const BASE = 'http://127.0.0.1:8081/api';
async function postJson(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
// login (admin) for the pass-through case
const cap = (await (await fetch(BASE + '/auth/captcha')).json()).data;
const lr = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: '123456', captchaId: cap.id, captchaCode: cap.code }) });
const ld = await lr.json();
if (!ld.ok) { console.log('LOGIN FAILED', JSON.stringify(ld)); process.exit(1); }
const token = ld.data.token;
console.log('logged in as', ld.data.user.username);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, detail ? '→ ' + detail : ''); }
}

// 1. contract 缺 name + quantity → 400 + fieldErrors（字段级）
const c1 = await postJson('/contract', { shipperId: 'C1', consigneeId: 'C2', commodityId: 'M1', loadTerminalId: 'T1', unloadTerminalId: 'T2', unitPrice: 100 }, token);
check('A5：contract 缺必填 → 400', c1.status === 400, 'status=' + c1.status);
check('A5：contract code=validation_error', c1.data.code === 'validation_error', JSON.stringify(c1.data).slice(0, 120));
check('A5：contract fieldErrors.name 字段级', c1.data.data && c1.data.data.fieldErrors && c1.data.data.fieldErrors.name === '合同名称不能为空', JSON.stringify(c1.data.data && c1.data.data.fieldErrors));
check('A5：contract fieldErrors.quantity 字段级', c1.data.data && c1.data.data.fieldErrors && c1.data.data.fieldErrors.quantity === '计划数量不能为空');

// 2. contract quantity=0 → 400 @Positive
const c2 = await postJson('/contract', { name: '测试合同', shipperId: 'C1', consigneeId: 'C2', commodityId: 'M1', loadTerminalId: 'T1', unloadTerminalId: 'T2', quantity: 0, unitPrice: 100 }, token);
check('A5：contract quantity=0 → 400', c2.status === 400, 'status=' + c2.status);
check('A5：contract quantity 须>0 字段级', c2.data.data && c2.data.data.fieldErrors && c2.data.data.fieldErrors.quantity === '计划数量须大于 0');

// 3. plan 缺 contractId → 400
const p1 = await postJson('/plan', { quantity: 10 }, token);
check('A5：plan 缺 contractId → 400', p1.status === 400, 'status=' + p1.status);
check('A5：plan fieldErrors.contractId', p1.data.data && p1.data.data.fieldErrors && p1.data.data.fieldErrors.contractId === '请选择合同');

// 4. dispatch/create 缺 planId → 400
const d1 = await postJson('/dispatch/create', { count: 2 }, token);
check('A5：dispatch 缺 planId → 400', d1.status === 400, 'status=' + d1.status);
check('A5：dispatch fieldErrors.planId', d1.data.data && d1.data.data.fieldErrors && d1.data.data.fieldErrors.planId === '请选择运输计划');

// 5. dispatch/create count=0 → 400 @Min
const d2 = await postJson('/dispatch/create', { planId: 'YH-1', count: 0 }, token);
check('A5：dispatch count=0 → 400', d2.status === 400, 'status=' + d2.status);
check('A5：dispatch count 须至少 1 字段级', d2.data.data && d2.data.data.fieldErrors && d2.data.data.fieldErrors.count === '车次数量须至少 1');

// 6. 必填齐全（占位 ID）→ 通过 @Valid（非 validation_error；业务校验在 service 层，HTTP 200）
const c3 = await postJson('/contract', { name: '测试合同', shipperId: 'C1', consigneeId: 'C2', commodityId: 'M1', loadTerminalId: 'T1', unloadTerminalId: 'T2', quantity: 10, unitPrice: 100 }, token);
check('A5：必填齐全 → 通过 @Valid（非 400 validation_error）', c3.status !== 400 || c3.data.code !== 'validation_error', 'status=' + c3.status + ' code=' + c3.data.code);

console.log('\n=== A5 输入校验 E2E ===');
console.log('PASS=' + pass + ' FAIL=' + fail);
console.log(fail === 0 ? 'ALL PASS' : 'HAS FAILURES');
process.exit(fail === 0 ? 0 : 1);
