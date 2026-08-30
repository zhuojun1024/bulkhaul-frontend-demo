
const BASE = 'http://127.0.0.1:8081';
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, detail ? '→ ' + detail : ''); }
}
// 1. /v3/api-docs 可访问（dev 公开）
const ad = await fetch(BASE + '/v3/api-docs');
check('D1：/v3/api-docs 200（dev 公开）', ad.status === 200, 'status=' + ad.status);
let spec = null;
try { spec = await ad.json(); } catch (e) { console.log('  parse err', e.message); }
check('D1：api-docs 是 OpenAPI 3.x（openapi 字段）', spec && /^3\./.test(spec.openapi || ''), 'openapi=' + (spec && spec.openapi));
check('D1：api-docs 含 bulkhaul-server API 标题', spec && spec.info && spec.info.title === 'bulkhaul-server API', spec && spec.info && spec.info.title);

// 2. 118 端点有 schema（paths 数量）
const paths = spec && spec.paths ? Object.keys(spec.paths) : [];
check('D1：paths 数量 ≥ 100（118 端点覆盖）', paths.length >= 100, 'paths=' + paths.length);
console.log('  端点路径样例:', paths.slice(0, 6).join(', '));

// 3. 关键端点有 @Operation summary（/api/auth/login + /api/contract）
const loginOp = spec && spec.paths['/api/auth/login'] && spec.paths['/api/auth/login'].post;
check('D1：/api/auth/login 有 @Operation summary', loginOp && loginOp.summary && loginOp.summary.includes('登录'), loginOp && loginOp.summary);
const ctrOp = spec && spec.paths['/api/contract'] && spec.paths['/api/contract'].post;
check('D1：/api/contract 有 @Operation summary（A5 校验）', ctrOp && ctrOp.summary && ctrOp.summary.includes('新建合同'), ctrOp && ctrOp.summary);

// 4. A5 DTO 有 @Schema（CreateContractRequest schema 含 name/quantity）
const schemas = spec && spec.components && spec.components.schemas || {};
const ccr = schemas['CreateContractRequest'];
check('D1：CreateContractRequest schema 存在', !!ccr, 'schemas=' + Object.keys(schemas).length);
check('D1：CreateContractRequest 含 name+quantity 字段', ccr && ccr.properties && ccr.properties.name && ccr.properties.quantity, ccr && ccr.properties && Object.keys(ccr.properties).slice(0, 5).join(','));
check('D1：CreateContractRequest name 标记 required', ccr && ccr.required && ccr.required.includes('name'), ccr && ccr.required && ccr.required.join(','));

// 5. Swagger UI 可访问（/swagger-ui/index.html 302/200）
const ui = await fetch(BASE + '/swagger-ui/index.html');
check('D1：Swagger UI 可访问（/swagger-ui/index.html）', ui.status === 200 || ui.status === 302, 'status=' + ui.status);

// 6. 安全回归：/v3/api-docs 公开不影响 /api 需认证（无 token 401）
const sec = await fetch(BASE + '/api/coll/contracts');
check('D1：/api 仍需认证（无 token 401，OpenAPI 公开未放行业务）', sec.status === 401, 'status=' + sec.status);

console.log('\n=== D1 OpenAPI/Swagger E2E ===');
console.log('PASS=' + pass + ' FAIL=' + fail);
console.log(fail === 0 ? 'ALL PASS' : 'HAS FAILURES');
process.exit(fail === 0 ? 0 : 1);
