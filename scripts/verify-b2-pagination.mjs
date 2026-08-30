
const BASE = 'http://127.0.0.1:8081/api';
async function j(path, token) {
  const headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + path, { headers });
  return { status: res.status, data: await res.json() };
}
// login
const cap2 = (await (await fetch(BASE + '/auth/captcha')).json()).data;
const lr = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: '123456', captchaId: cap2.id, captchaCode: cap2.code }) });
const ld = await lr.json();
if (!ld.ok) { console.log('LOGIN FAILED', JSON.stringify(ld)); process.exit(1); }
const token = ld.data.token;
console.log('logged in as', ld.data.user.username);

// 1. backward-compat: no page → full list (array)
const full = (await j('/coll/dispatches', token)).data;
const fullList = full.data;
const isFullArray = Array.isArray(fullList);
console.log('B2：不带 page → 全量数组（向后兼容）:', isFullArray ? 'PASS' : 'FAIL', 'len=' + (isFullArray ? fullList.length : typeof fullList));

// 2. page=1 size=20 → {list:20, total}
const p1 = (await j('/coll/dispatches?page=1&size=20', token)).data;
const d1 = p1.data;
const ok2 = d1 && Array.isArray(d1.list) && d1.list.length === Math.min(20, fullList.length) && d1.total === fullList.length && d1.page === 1 && d1.size === 20;
console.log('B2：page=1 size=20 → list ' + (d1 && d1.list ? d1.list.length : '?') + ' 条 + total=' + (d1 && d1.total) + ':', ok2 ? 'PASS' : 'FAIL');

// 3. page=2 → different first record, same total
let ok3 = true;
if (fullList.length > 20) {
  const p2 = (await j('/coll/dispatches?page=2&size=20', token)).data;
  ok3 = p2.data && p2.data.list.length === 20 && p2.data.total === fullList.length
    && p2.data.list[0].id !== d1.list[0].id;
} else {
  const p2 = (await j('/coll/dispatches?page=2&size=20', token)).data;
  ok3 = p2.data && p2.data.list.length === 0 && p2.data.total === fullList.length;
}
console.log('B2：page=2 → 无重叠 + total 一致:', ok3 ? 'PASS' : 'FAIL');

// 4. out-of-range page → empty list + total unchanged
const po = (await j('/coll/dispatches?page=99999&size=20', token)).data;
const ok4 = po.data && po.data.list.length === 0 && po.data.total === fullList.length;
console.log('B2：超范围页 → 空 list + total 不变:', ok4 ? 'PASS' : 'FAIL');

// 5. size cap 200
const ps = (await j('/coll/dispatches?page=1&size=1000', token)).data;
const ok5 = ps.data && ps.data.size === 200;
console.log('B2：size 上限 200:', ok5 ? 'PASS' : 'FAIL');

// 6. row-scope + pagination (user02 华北)
const cap3 = (await (await fetch(BASE + '/auth/captcha')).json()).data;
const lr2 = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'user02', password: '123456', captchaId: cap3.id, captchaCode: cap3.code }) });
const ld2 = await lr2.json();
const token2 = ld2.ok ? ld2.data.token : null;
let ok6 = true;
if (token2) {
  const up = (await j('/coll/dispatches?page=1&size=20', token2)).data;
  const adminTotal = fullList.length;
  ok6 = up.data && up.data.total < adminTotal && up.data.list.length === Math.min(20, up.data.total);
  console.log('B2：行级+分页（user02 total=' + up.data.total + ' < admin ' + adminTotal + '）:', ok6 ? 'PASS' : 'FAIL');
} else {
  ok6 = false;
  console.log('B2：user02 登录失败:', JSON.stringify(ld2).slice(0, 100));
}

const all = isFullArray && ok2 && ok3 && ok4 && ok5 && ok6;
console.log('\n=== B2 分页 E2E ===');
console.log(all ? 'ALL PASS' : 'HAS FAILURES');
process.exit(all ? 0 : 1);
