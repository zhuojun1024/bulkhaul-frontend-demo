
const BASE = 'http://127.0.0.1:8081';
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, detail ? '→ ' + detail : ''); }
}
// 1. 同源请求（无 Origin）→ 正常 200（CORS 不阻塞同源）
const s1 = await fetch(BASE + '/api/health');
check('C5：同源请求（无 Origin）200', s1.status === 200, 'status=' + s1.status);
check('C5：同源请求无 ACAO 头（无需 CORS）', !s1.headers.get('Access-Control-Allow-Origin'), 'ACAO=' + s1.headers.get('Access-Control-Allow-Origin'));

// 2. 跨域请求（Origin=evil.com，不在白名单）→ 无 ACAO 头（浏览器拦截，默认拒绝）
const s2 = await fetch(BASE + '/api/health', { headers: { Origin: 'http://evil.com' } });
check('C5：跨域（未授权 Origin）无 Access-Control-Allow-Origin（默认拒绝）', !s2.headers.get('Access-Control-Allow-Origin'), 'ACAO=' + s2.headers.get('Access-Control-Allow-Origin'));

// 3. 预检 OPTIONS（Origin=evil.com）→ 无 ACAO 头（预检被拒，浏览器不发实际请求）
const s3 = await fetch(BASE + '/api/auth/captcha', { method: 'OPTIONS', headers: { Origin: 'http://evil.com', 'Access-Control-Request-Method': 'GET' } });
check('C5：预检 OPTIONS（未授权 Origin）无 ACAO（预检被拒）', !s3.headers.get('Access-Control-Allow-Origin'), 'ACAO=' + s3.headers.get('Access-Control-Allow-Origin') + ' status=' + s3.status);

// 4. 功能回归：跨域拒绝不影响同源登录（captcha 仍可取）
const cap = await fetch(BASE + '/api/auth/captcha');
const capb = await cap.json();
check('C5：跨域拒绝不影响同源功能（captcha 200 + code）', cap.status === 200 && capb.ok && capb.data && capb.data.code, JSON.stringify(capb).slice(0, 80));

console.log('\n=== C5 CORS / 部署拓扑 E2E ===');
console.log('PASS=' + pass + ' FAIL=' + fail);
console.log(fail === 0 ? 'ALL PASS' : 'HAS FAILURES');
process.exit(fail === 0 ? 0 : 1);
