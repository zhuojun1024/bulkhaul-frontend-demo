
const BASE = 'http://127.0.0.1:8081/api';
const FAKE_IP = '10.77.77.77'; // 测试专用 IP（经 X-Forwarded-For 注入，不污染真实 127.0.0.1 限流计数）
// dev 默认登录档 120/min/IP：连发 121 次验证码（GET，快速）→ 第 121 次应 429 + Retry-After
let last = null;
for (let i = 1; i <= 121; i++) {
  const res = await fetch(BASE + '/auth/captcha', { headers: { 'X-Forwarded-For': FAKE_IP } });
  last = { i, status: res.status, retryAfter: res.headers.get('Retry-After') };
  let body; try { body = await res.json(); } catch (e) { body = { raw: 1 }; }
  last.body = body;
  if (res.status === 429) break;
}
console.log('FAKE_IP 第 ' + last.i + ' 次:', last.status, 'Retry-After=' + last.retryAfter, JSON.stringify(last.body));
const pass429 = last.status === 429 && last.body.code === 'rate_limited' && last.retryAfter != null && Number(last.retryAfter) >= 1 && Number(last.retryAfter) <= 60;
console.log('A3：超限 → 429 + Retry-After + code=rate_limited :', pass429 ? 'PASS' : 'FAIL');

// 真实 IP（127.0.0.1）不受假 IP 影响：仍能正常登录（admin）
const cap = (await (await fetch(BASE + '/auth/captcha')).json()).data;
const login = (await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: '123456', captchaId: cap.id, captchaCode: cap.code }) })).json();
const l = await login;
const passReal = l.ok === true && l.data && l.data.token;
console.log('A3：真实 IP 不受假 IP 影响（admin 仍正常登录）:', passReal ? 'PASS' : 'FAIL', passReal ? '' : JSON.stringify(l).slice(0, 120));

// reset-demo 自恢复：清空限流计数后，假 IP 重新放行
const tok = passReal ? l.data.token : null;
let resetOk = false;
if (tok) {
  const rr = await fetch(BASE + '/admin/reset-demo', { method: 'POST', headers: { Authorization: 'Bearer ' + tok } });
  const rb = await rr.json();
  resetOk = rr.status === 200 && rb.ok === true;
  // reset 后假 IP 重新放行（验证码 200）
  const again = await fetch(BASE + '/auth/captcha', { headers: { 'X-Forwarded-For': FAKE_IP } });
  console.log('A3：reset-demo 自恢复（清空后假 IP 重新放行）:', again.status === 200 ? 'PASS' : 'FAIL', 'status=' + again.status);
  resetOk = resetOk && again.status === 200;
}
console.log('\n=== A3 全局限流 E2E ===');
console.log(pass429 && passReal && resetOk ? 'ALL PASS' : 'HAS FAILURES');
process.exit(pass429 && passReal && resetOk ? 0 : 1);
