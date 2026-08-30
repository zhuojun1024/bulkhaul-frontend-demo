
const BASE = 'http://127.0.0.1:8081';
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, detail ? '→ ' + detail : ''); }
}
// login (admin) for the metrics-authenticated case
const cap = (await (await fetch(BASE + '/api/auth/captcha')).json()).data;
const lr = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: '123456', captchaId: cap.id, captchaCode: cap.code }) });
const ld = await lr.json();
if (!ld.ok) { console.log('LOGIN FAILED', JSON.stringify(ld)); process.exit(1); }
const token = ld.data.token;
console.log('logged in as', ld.data.user.username);

// 1. /actuator/health 公开 200 UP
const h = await fetch(BASE + '/actuator/health');
const hb = await h.text();
check('C3：/actuator/health 公开 200', h.status === 200, 'status=' + h.status);
check('C3：/actuator/health UP', hb.includes('"status":"UP"'), hb.slice(0, 120));

// 2. /actuator/info 公开 200
const info = await fetch(BASE + '/actuator/info');
check('C3：/actuator/info 公开 200', info.status === 200, 'status=' + info.status);

// 3. /actuator/metrics 未认证 401（受保护）
const m1 = await fetch(BASE + '/actuator/metrics');
check('C3：/actuator/metrics 未认证 401', m1.status === 401, 'status=' + m1.status);

// 4. /actuator/metrics 已认证 200（可抓取）
const m2 = await fetch(BASE + '/actuator/metrics', { headers: { Authorization: 'Bearer ' + token } });
const m2b = await m2.text();
check('C3：/actuator/metrics 已认证 200（可抓取）', m2.status === 200, 'status=' + m2.status);
check('C3：metrics 含 JVM 指标', m2b.includes('jvm') || m2b.includes('process'), m2b.slice(0, 120));

// 5. 既有 /api/health 向后兼容（200 + tables）
const ah = await fetch(BASE + '/api/health');
const ahb = await ah.text();
check('C3：既有 /api/health 向后兼容 200', ah.status === 200 && ahb.includes('"status":"UP"'), ahb.slice(0, 120));

// 6. traceId：上游 X-Request-Id 回写（关联）
const t1 = await fetch(BASE + '/api/health', { headers: { 'X-Request-Id': 'c3-test-trace-abc123' } });
check('C3：X-Request-Id 回写（上游注入关联）', t1.headers.get('X-Request-Id') === 'c3-test-trace-abc123', 'got=' + t1.headers.get('X-Request-Id'));

// 7. traceId：缺失则生成（16 位）
const t2 = await fetch(BASE + '/api/health');
const gen = t2.headers.get('X-Request-Id');
check('C3：缺失 X-Request-Id 则生成（16 位）', gen !== null && gen.length === 16, 'got=' + gen);

console.log('\n=== C3 可观测性 E2E ===');
console.log('PASS=' + pass + ' FAIL=' + fail);
console.log(fail === 0 ? 'ALL PASS' : 'HAS FAILURES');
process.exit(fail === 0 ? 0 : 1);
