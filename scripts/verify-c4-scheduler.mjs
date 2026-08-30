
const BASE = 'http://127.0.0.1:8081/api';
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, detail ? '→ ' + detail : ''); }
}
// login (admin)
const cap = (await (await fetch(BASE + '/auth/captcha')).json()).data;
const lr = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: '123456', captchaId: cap.id, captchaCode: cap.code }) });
const ld = await lr.json();
if (!ld.ok) { console.log('LOGIN FAILED', JSON.stringify(ld)); process.exit(1); }
const token = ld.data.token;
console.log('logged in as', ld.data.user.username);
const auth = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

// 1. 手动 /api/scheduler/tick 仍工作（doTick，不受 leader 租约限制）
const t = await (await fetch(BASE + '/scheduler/tick', { method: 'POST', headers: auth })).json();
check('C4：手动 tick 返回统计（fenceCreated/overdueChanged/escalated/reminded）', t.ok && t.data && 'fenceCreated' in t.data && 'overdueChanged' in t.data, JSON.stringify(t.data).slice(0, 100));
check('C4：手动 tick 非 skipped（doTick 不受 leader 限制）', t.data && !t.data.skipped, JSON.stringify(t.data).slice(0, 100));

// 2. reset-demo 自恢复：note 提及 leader 租约清空
const rd = await (await fetch(BASE + '/admin/reset-demo', { method: 'POST', headers: auth })).json();
check('C4：reset-demo 200', rd.ok, JSON.stringify(rd).slice(0, 100));
check('C4：reset-demo note 提及 leader 租约自恢复', rd.data && rd.data.note && rd.data.note.includes('leader'), rd.data && rd.data.note);

// 3. reset-demo 后 leader 租约键已清空（redis-cli 直查）
//    通过后端间接验证：reset-demo 已调 leader.clear()（redis delete blms:scheduler:leader）
//    此处用一次新的 tick 确认系统仍正常（租约清空未破坏定时任务）
const t2 = await (await fetch(BASE + '/scheduler/tick', { method: 'POST', headers: auth })).json();
check('C4：reset-demo 后 tick 仍正常（租约清空未破坏）', t2.ok && t2.data && !t2.data.skipped, JSON.stringify(t2.data).slice(0, 100));

console.log('\n=== C4 服务端定时任务 E2E ===');
console.log('PASS=' + pass + ' FAIL=' + fail);
console.log(fail === 0 ? 'ALL PASS' : 'HAS FAILURES');
process.exit(fail === 0 ? 0 : 1);
