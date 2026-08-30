
const BASE = 'http://127.0.0.1:8081/api';
async function j(path, body, token, method) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const opts = { method: method || (body !== undefined ? 'POST' : 'GET'), headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  let data; try { data = await res.json(); } catch (e) { data = { raw: await res.text() }; }
  return { status: res.status, data };
}
// 1. login (captcha)
const cap = (await j('/auth/captcha')).data.data;
const login = (await j('/auth/login', { username: 'admin', password: '123456', captchaId: cap.id, captchaCode: cap.code })).data;
if (!login.ok) { console.log('LOGIN FAILED', JSON.stringify(login)); process.exit(1); }
const token = login.data.token;
console.log('logged in as', login.data.user.username, '(' + login.data.user.role + ')');

const D = 'PD-00067';
// Session A: reassign to V001/D001 with expectedVersion=1 (current) -> expect ok, version 1->2
const a = await j('/dispatch/' + D + '/reassign', { vehicleId: 'V001', driverId: 'D001', expectedVersion: 1 }, token);
console.log('SESSION A: http', a.status, JSON.stringify(a.data));
// read back version
const snap = (await j('/snapshot', undefined, token)).data;
const recA = snap.data.dispatches.find(x => x.id === D);
console.log('after A: version =', recA.version, 'vehicleId =', recA.vehicleId, 'driverId =', recA.driverId);

// Session B: reassign to V005/D005 with STALE expectedVersion=1 -> expect 409 conflict
const b = await j('/dispatch/' + D + '/reassign', { vehicleId: 'V005', driverId: 'D005', expectedVersion: 1 }, token);
console.log('SESSION B (stale v1): http', b.status, JSON.stringify(b.data));
// read back: should be session A's state (V001/D001, version 2), NOT B's V005/D005
const snap2 = (await j('/snapshot', undefined, token)).data;
const recB = snap2.data.dispatches.find(x => x.id === D);
console.log('after B: version =', recB.version, 'vehicleId =', recB.vehicleId, 'driverId =', recB.driverId);

const pass409 = b.status === 409 && b.data.code === 'conflict';
const noSilent = recB.vehicleId === 'V001' && recB.driverId === 'D001' && recB.version === 2;
console.log('\n=== B3 HTTP 409 ACCEPTANCE ===');
console.log('two sessions edit same dispatch, latter -> 409 :', pass409 ? 'PASS' : 'FAIL');
console.log('no silent overwrite (DB keeps session A)      :', noSilent ? 'PASS' : 'FAIL');
process.exit(pass409 && noSilent ? 0 : 1);
