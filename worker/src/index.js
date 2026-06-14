const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export default {
  async fetch(request, env, ctx) {
    try {
      if (request.method === 'OPTIONS') return withCors(request, env, new Response(null, { status: 204 }));
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';
      let response;

      if (path === '/' || path === '/health') {
        response = json({ ok: true, service: 'cost-bank-api', version: '2026.06.14' });
      } else if (path === '/api/activate' && request.method === 'POST') {
        response = await activate(request, env);
      } else if (path === '/api/verify' && request.method === 'POST') {
        response = await verifyChallenge(request, env);
      } else if (path === '/api/me' && request.method === 'GET') {
        const auth = await requireStudent(request, env, ctx);
        response = json({ student: publicStudent(auth) });
      } else if (path === '/api/chapters' && request.method === 'GET') {
        const auth = await requireStudent(request, env, ctx);
        response = await listChapters(env, auth);
      } else if (path === '/api/questions' && request.method === 'GET') {
        const auth = await requireStudent(request, env, ctx);
        response = await listQuestions(url, env, auth);
      } else if (path === '/api/submit' && request.method === 'POST') {
        const auth = await requireStudent(request, env, ctx);
        response = await submitAnswers(request, env, auth);
      } else if (path === '/api/logout' && request.method === 'POST') {
        response = await logout(request, env);
      } else if (path === '/api/admin/login' && request.method === 'POST') {
        response = await adminLogin(request, env);
      } else if (path === '/api/admin/seed' && request.method === 'POST') {
        await requireAdmin(request, env);
        response = await seedQuestions(request, env);
      } else if (path === '/api/admin/codes' && request.method === 'POST') {
        await requireAdmin(request, env);
        response = await createCodes(request, env);
      } else if (path === '/api/admin/codes' && request.method === 'GET') {
        await requireAdmin(request, env);
        response = await listCodes(url, env);
      } else if (path === '/api/admin/stats' && request.method === 'GET') {
        await requireAdmin(request, env);
        response = await adminStats(env);
      } else {
        const resetMatch = path.match(/^\/api\/admin\/codes\/(\d+)\/reset$/);
        const toggleMatch = path.match(/^\/api\/admin\/codes\/(\d+)\/toggle$/);
        if (resetMatch && request.method === 'POST') {
          await requireAdmin(request, env);
          response = await resetCode(Number(resetMatch[1]), env);
        } else if (toggleMatch && request.method === 'POST') {
          await requireAdmin(request, env);
          response = await toggleCode(Number(toggleMatch[1]), env);
        } else {
          response = json({ error: 'NOT_FOUND', message: 'المسار غير موجود.' }, 404);
        }
      }
      return withCors(request, env, response);
    } catch (error) {
      const status = Number(error?.status) || 500;
      const code = error?.code || 'SERVER_ERROR';
      const message = status === 500 ? 'حدث خطأ في الخادم.' : (error?.message || 'تعذر تنفيذ الطلب.');
      console.error(code, error?.stack || error);
      return withCors(request, env, json({ error: code, message }, status));
    }
  },
};

function withCors(request, env, response) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allowOrigin = allowed.includes(origin) || local ? origin : (allowed[0] || 'null');
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', allowOrigin);
  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Device-Time, X-Device-Nonce, X-Device-Signature');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Max-Age', '86400');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

async function readJson(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.includes('application/json')) fail(415, 'JSON_REQUIRED', 'يجب إرسال بيانات JSON.');
  try { return await request.json(); } catch { fail(400, 'BAD_JSON', 'بيانات JSON غير صالحة.'); }
}

function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function cleanName(name) {
  return String(name || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 80);
}

function nowIso() { return new Date().toISOString(); }
function futureIso(ms) { return new Date(Date.now() + ms).toISOString(); }

function bytesToB64Url(bytes) {
  let binary = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64UrlToBytes(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(value).length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function sha256(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  return bytesToB64Url(await crypto.subtle.digest('SHA-256', bytes));
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesToB64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(String(value))));
}

function randomBytes(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

function randomId(size = 24) { return bytesToB64Url(randomBytes(size)); }

async function codeHash(code, env) {
  if (!env.CODE_PEPPER) fail(500, 'MISSING_SECRET', 'CODE_PEPPER غير مضبوط.');
  return hmac(normalizeCode(code), env.CODE_PEPPER);
}

async function tokenHash(token, env) {
  if (!env.SESSION_SECRET) fail(500, 'MISSING_SECRET', 'SESSION_SECRET غير مضبوط.');
  return hmac(token, env.SESSION_SECRET);
}

function bearer(request) {
  const header = request.headers.get('Authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function requestIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
}

async function rateLimit(env, key, max, windowSeconds) {
  const now = Date.now();
  const row = await env.DB.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').bind(key).first();
  if (!row || Number(row.reset_at) <= now) {
    await env.DB.prepare('INSERT INTO rate_limits(key,count,reset_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count, reset_at=excluded.reset_at')
      .bind(key, 1, now + windowSeconds * 1000).run();
    return;
  }
  if (Number(row.count) >= max) fail(429, 'RATE_LIMITED', 'محاولات كثيرة. حاول لاحقاً.');
  await env.DB.prepare('UPDATE rate_limits SET count=count+1 WHERE key=?').bind(key).run();
}

function validatePublicJwk(jwk) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    fail(400, 'BAD_DEVICE_KEY', 'مفتاح الجهاز غير صالح.');
  }
  return { kty: 'EC', crv: 'P-256', x: String(jwk.x), y: String(jwk.y), ext: true, key_ops: ['verify'] };
}

async function deviceFingerprint(jwk) {
  return sha256(`${jwk.kty}|${jwk.crv}|${jwk.x}|${jwk.y}`);
}

async function activate(request, env) {
  const ip = requestIp(request);
  await rateLimit(env, `activate:${ip}`, 20, 15 * 60);
  const body = await readJson(request);
  const code = normalizeCode(body.code);
  const name = cleanName(body.name);
  const publicKey = validatePublicJwk(body.publicKeyJwk);
  if (code.length < 12) fail(400, 'BAD_CODE', 'كود التفعيل غير صالح.');
  if (name.length < 2) fail(400, 'BAD_NAME', 'اكتب اسم الطالب.');

  const hash = await codeHash(code, env);
  const license = await env.DB.prepare('SELECT * FROM licenses WHERE code_hash=?').bind(hash).first();
  if (!license) fail(401, 'INVALID_CODE', 'كود التفعيل غير صحيح.');
  if (license.status !== 'active') fail(403, 'CODE_DISABLED', 'هذا الكود موقوف.');
  if (license.expires_at && new Date(license.expires_at).getTime() < Date.now()) fail(403, 'CODE_EXPIRED', 'انتهت صلاحية الكود.');
  if (license.locked_until && new Date(license.locked_until).getTime() > Date.now()) fail(423, 'CODE_LOCKED', 'الكود مقفل مؤقتاً بسبب محاولات فاشلة.');

  const fingerprint = await deviceFingerprint(publicKey);
  if (license.device_fingerprint && license.device_fingerprint !== fingerprint) {
    fail(403, 'DEVICE_MISMATCH', 'الكود مرتبط بجهاز آخر. اطلب من المدرس إعادة ربط الجهاز.');
  }

  if (!license.device_fingerprint) {
    await env.DB.prepare(`UPDATE licenses SET student_name=?, device_key_jwk=?, device_fingerprint=?, activated_at=?, updated_at=? WHERE id=?`)
      .bind(name, JSON.stringify(publicKey), fingerprint, nowIso(), nowIso(), license.id).run();
  } else if (!license.student_name) {
    await env.DB.prepare('UPDATE licenses SET student_name=?, updated_at=? WHERE id=?').bind(name, nowIso(), license.id).run();
  }

  await env.DB.prepare('DELETE FROM challenges WHERE license_id=? OR expires_at < ?').bind(license.id, nowIso()).run();
  const challengeId = randomId(18);
  const nonce = randomId(32);
  await env.DB.prepare('INSERT INTO challenges(id,license_id,nonce,expires_at,used,created_at) VALUES(?,?,?,?,0,?)')
    .bind(challengeId, license.id, nonce, futureIso(5 * 60 * 1000), nowIso()).run();

  return json({ challengeId, challenge: `${challengeId}.${nonce}`, deviceFingerprint: fingerprint, codeHint: license.code_hint });
}

async function verifyChallenge(request, env) {
  const ip = requestIp(request);
  await rateLimit(env, `verify:${ip}`, 30, 15 * 60);
  const body = await readJson(request);
  const challengeId = String(body.challengeId || '');
  const signature = String(body.signature || '');
  if (!challengeId || !signature) fail(400, 'MISSING_SIGNATURE', 'بيانات التحقق ناقصة.');

  const row = await env.DB.prepare(`SELECT c.*, l.status, l.student_name, l.device_key_jwk, l.code_hint, l.failed_attempts, l.locked_until
    FROM challenges c JOIN licenses l ON l.id=c.license_id WHERE c.id=?`).bind(challengeId).first();
  if (!row || row.used) fail(401, 'BAD_CHALLENGE', 'طلب التحقق غير صالح.');
  if (new Date(row.expires_at).getTime() < Date.now()) fail(401, 'CHALLENGE_EXPIRED', 'انتهت مهلة التحقق.');
  if (row.status !== 'active') fail(403, 'CODE_DISABLED', 'الكود موقوف.');
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) fail(423, 'CODE_LOCKED', 'الكود مقفل مؤقتاً.');

  const publicKey = await crypto.subtle.importKey('jwk', JSON.parse(row.device_key_jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, b64UrlToBytes(signature), encoder.encode(`${challengeId}.${row.nonce}`));
  if (!ok) {
    const failures = Number(row.failed_attempts || 0) + 1;
    const locked = failures >= 8 ? futureIso(30 * 60 * 1000) : null;
    await env.DB.prepare('UPDATE licenses SET failed_attempts=?, locked_until=?, updated_at=? WHERE id=?')
      .bind(failures, locked, nowIso(), row.license_id).run();
    fail(401, 'SIGNATURE_FAILED', 'تعذر إثبات ملكية الجهاز.');
  }

  await env.DB.batch([
    env.DB.prepare('UPDATE challenges SET used=1 WHERE id=?').bind(challengeId),
    env.DB.prepare('UPDATE licenses SET failed_attempts=0, locked_until=NULL, last_login_at=?, updated_at=? WHERE id=?').bind(nowIso(), nowIso(), row.license_id),
    env.DB.prepare('DELETE FROM sessions WHERE license_id=?').bind(row.license_id),
  ]);

  const token = randomId(32);
  const hash = await tokenHash(token, env);
  const uaHash = await sha256(request.headers.get('User-Agent') || '');
  const ipHash = await sha256(requestIp(request));
  const expiresAt = futureIso(8 * 60 * 60 * 1000);
  await env.DB.prepare('INSERT INTO sessions(token_hash,license_id,expires_at,created_at,last_seen_at,ip_hash,ua_hash) VALUES(?,?,?,?,?,?,?)')
    .bind(hash, row.license_id, expiresAt, nowIso(), nowIso(), ipHash, uaHash).run();

  return json({ token, expiresAt, student: { name: row.student_name || 'طالب', codeHint: row.code_hint } });
}

async function requireStudent(request, env, ctx) {
  const token = bearer(request);
  if (!token) fail(401, 'AUTH_REQUIRED', 'يجب تسجيل الدخول.');
  const hash = await tokenHash(token, env);
  const row = await env.DB.prepare(`SELECT s.token_hash,s.expires_at,s.license_id,l.student_name,l.code_hint,l.status,l.device_fingerprint,l.device_key_jwk
    FROM sessions s JOIN licenses l ON l.id=s.license_id WHERE s.token_hash=?`).bind(hash).first();
  if (!row) fail(401, 'SESSION_INVALID', 'الجلسة غير صالحة.');
  if (row.status !== 'active') fail(403, 'CODE_DISABLED', 'الكود موقوف.');
  if (new Date(row.expires_at).getTime() < Date.now()) {
    ctx?.waitUntil(env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(hash).run());
    fail(401, 'SESSION_EXPIRED', 'انتهت الجلسة. سجل الدخول مجدداً.');
  }

  const time = Number(request.headers.get('X-Device-Time') || 0);
  const nonce = String(request.headers.get('X-Device-Nonce') || '');
  const signature = String(request.headers.get('X-Device-Signature') || '');
  if (!time || !nonce || !signature || Math.abs(Date.now() - time) > 120000) {
    fail(401, 'DEVICE_PROOF_REQUIRED', 'تعذر التحقق من الجهاز. أعد تسجيل الدخول.');
  }
  const url = new URL(request.url);
  const canonical = `${time}.${nonce}.${request.method.toUpperCase()}.${url.pathname}${url.search}`;
  const publicKey = await crypto.subtle.importKey('jwk', JSON.parse(row.device_key_jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const verified = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, b64UrlToBytes(signature), encoder.encode(canonical));
  if (!verified) fail(401, 'DEVICE_PROOF_FAILED', 'فشل إثبات الجهاز.');
  const nonceHash = await sha256(`${row.license_id}.${nonce}`);
  const seen = await env.DB.prepare('SELECT nonce_hash FROM request_nonces WHERE nonce_hash=?').bind(nonceHash).first();
  if (seen) fail(409, 'REPLAY_BLOCKED', 'تم رفض طلب مكرر.');
  await env.DB.prepare('INSERT INTO request_nonces(nonce_hash,license_id,expires_at) VALUES(?,?,?)').bind(nonceHash, row.license_id, futureIso(5 * 60 * 1000)).run();
  ctx?.waitUntil(env.DB.batch([
    env.DB.prepare('UPDATE sessions SET last_seen_at=? WHERE token_hash=?').bind(nowIso(), hash),
    env.DB.prepare('DELETE FROM request_nonces WHERE expires_at < ?').bind(nowIso()),
  ]));
  return row;
}

function publicStudent(auth) {
  return { name: auth.student_name || 'طالب', codeHint: auth.code_hint, deviceFingerprint: auth.device_fingerprint };
}

async function logout(request, env) {
  const token = bearer(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await tokenHash(token, env)).run();
  return json({ ok: true });
}

async function listChapters(env, auth) {
  const rows = await env.DB.prepare('SELECT chapter, COUNT(*) AS count FROM questions WHERE active=1 GROUP BY chapter ORDER BY chapter').all();
  const titles = {
    1: ['المحاسبة الإدارية: نظرة عامة', 'المستخدمون، الفروق، الأنشطة، المهارات وأخلاقيات IMA'],
    2: ['مفاهيم التكلفة', 'تصنيف التكلفة وسلوكها والقرارات وطريقة الأعلى والأدنى'],
    3: ['نظام تكاليف أوامر الإنتاج', 'بطاقة الأمر ومعدل التحميل وتدفق تكاليف التصنيع'],
  };
  return json({ student: publicStudent(auth), chapters: (rows.results || []).map(r => ({ id: Number(r.chapter), title: titles[r.chapter]?.[0] || `الفصل ${r.chapter}`, description: titles[r.chapter]?.[1] || '', count: Number(r.count) })) });
}

async function listQuestions(url, env) {
  const chapter = Math.max(1, Math.min(3, Number(url.searchParams.get('chapter') || 1)));
  const requested = Number(url.searchParams.get('limit') || 0);
  const limit = requested > 0 ? Math.max(1, Math.min(60, requested)) : 60;
  const difficulty = String(url.searchParams.get('difficulty') || 'all');
  let sql = 'SELECT id,chapter,topic,difficulty,type,text,options_json,source FROM questions WHERE active=1 AND chapter=?';
  const binds = [chapter];
  if (['سهل', 'متوسط', 'صعب'].includes(difficulty)) { sql += ' AND difficulty=?'; binds.push(difficulty); }
  sql += ' ORDER BY RANDOM() LIMIT ?'; binds.push(limit);
  const rows = await env.DB.prepare(sql).bind(...binds).all();
  const questions = (rows.results || []).map(r => ({ ...r, chapter: Number(r.chapter), options: JSON.parse(r.options_json) }));
  return json({ chapter, questions });
}

async function submitAnswers(request, env, auth) {
  const body = await readJson(request);
  const answers = Array.isArray(body.answers) ? body.answers.slice(0, 80) : [];
  if (!answers.length) fail(400, 'NO_ANSWERS', 'لا توجد إجابات للتصحيح.');
  const ids = [...new Set(answers.map(a => String(a.id || '')).filter(Boolean))];
  if (!ids.length) fail(400, 'NO_ANSWERS', 'لا توجد إجابات صالحة.');
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(`SELECT id,chapter,correct_index,explanation FROM questions WHERE active=1 AND id IN (${placeholders})`).bind(...ids).all();
  const map = new Map((rows.results || []).map(r => [r.id, r]));
  let correct = 0;
  const results = [];
  for (const answer of answers) {
    const row = map.get(String(answer.id));
    if (!row) continue;
    const selected = Number(answer.selectedIndex);
    const isCorrect = selected === Number(row.correct_index);
    if (isCorrect) correct += 1;
    results.push({ id: row.id, selectedIndex: selected, correctIndex: Number(row.correct_index), correct: isCorrect, explanation: row.explanation });
  }
  const total = results.length;
  const score = total ? Math.round(correct * 100 / total) : 0;
  const attemptId = randomId(18);
  const chapter = Number(body.chapter || rows.results?.[0]?.chapter || 0);
  await env.DB.prepare('INSERT INTO attempts(id,license_id,chapter,score,total,answers_json,created_at) VALUES(?,?,?,?,?,?,?)')
    .bind(attemptId, auth.license_id, chapter, correct, total, JSON.stringify(answers), nowIso()).run();
  return json({ attemptId, correct, total, score, results });
}

async function adminLogin(request, env) {
  const ip = requestIp(request);
  await rateLimit(env, `admin-login:${ip}`, 8, 15 * 60);
  const body = await readJson(request);
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) fail(500, 'MISSING_SECRET', 'أسرار الإدارة غير مضبوطة.');
  const expected = await hmac(String(env.ADMIN_PASSWORD), env.SESSION_SECRET);
  const supplied = await hmac(String(body.password || ''), env.SESSION_SECRET);
  if (expected !== supplied) fail(401, 'ADMIN_LOGIN_FAILED', 'كلمة مرور الإدارة غير صحيحة.');
  const token = randomId(32);
  await env.DB.prepare('INSERT INTO admin_sessions(token_hash,expires_at,created_at) VALUES(?,?,?)')
    .bind(await tokenHash(token, env), futureIso(4 * 60 * 60 * 1000), nowIso()).run();
  return json({ token, expiresAt: futureIso(4 * 60 * 60 * 1000) });
}

async function requireAdmin(request, env) {
  const token = bearer(request);
  if (!token) fail(401, 'ADMIN_REQUIRED', 'يلزم تسجيل دخول الإدارة.');
  const hash = await tokenHash(token, env);
  const row = await env.DB.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash=?').bind(hash).first();
  if (!row || new Date(row.expires_at).getTime() < Date.now()) fail(401, 'ADMIN_SESSION_EXPIRED', 'انتهت جلسة الإدارة.');
  return true;
}

function generateCode() {
  const bytes = randomBytes(12);
  let raw = '';
  for (let i = 0; i < 12; i++) raw += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `COST-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}`;
}

async function createCodes(request, env) {
  const body = await readJson(request);
  const count = Math.max(1, Math.min(100, Number(body.count || 1)));
  const label = String(body.label || '').trim().slice(0, 100);
  const expiresAt = body.expiresAt ? new Date(body.expiresAt).toISOString() : null;
  const codes = [];
  for (let i = 0; i < count; i++) {
    let code, hash;
    for (let tries = 0; tries < 5; tries++) {
      code = generateCode();
      hash = await codeHash(code, env);
      const exists = await env.DB.prepare('SELECT id FROM licenses WHERE code_hash=?').bind(hash).first();
      if (!exists) break;
    }
    await env.DB.prepare(`INSERT INTO licenses(code_hash,code_hint,label,status,expires_at,failed_attempts,created_at,updated_at)
      VALUES(?,?,?,'active',?,0,?,?)`).bind(hash, code.slice(-4), label, expiresAt, nowIso(), nowIso()).run();
    codes.push(code);
  }
  return json({ codes, warning: 'تظهر الأكواد الكاملة مرة واحدة فقط. خزّنها في مكان آمن.' }, 201);
}

async function listCodes(url, env) {
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 200)));
  const rows = await env.DB.prepare(`SELECT id,code_hint,label,student_name,device_fingerprint,status,activated_at,last_login_at,expires_at,failed_attempts,locked_until,created_at
    FROM licenses ORDER BY id DESC LIMIT ?`).bind(limit).all();
  return json({ licenses: rows.results || [] });
}

async function resetCode(id, env) {
  await env.DB.batch([
    env.DB.prepare(`UPDATE licenses SET student_name=NULL,device_key_jwk=NULL,device_fingerprint=NULL,activated_at=NULL,last_login_at=NULL,failed_attempts=0,locked_until=NULL,updated_at=? WHERE id=?`).bind(nowIso(), id),
    env.DB.prepare('DELETE FROM sessions WHERE license_id=?').bind(id),
    env.DB.prepare('DELETE FROM challenges WHERE license_id=?').bind(id),
  ]);
  return json({ ok: true });
}

async function toggleCode(id, env) {
  const row = await env.DB.prepare('SELECT status FROM licenses WHERE id=?').bind(id).first();
  if (!row) fail(404, 'CODE_NOT_FOUND', 'الكود غير موجود.');
  const next = row.status === 'active' ? 'disabled' : 'active';
  await env.DB.prepare('UPDATE licenses SET status=?,updated_at=? WHERE id=?').bind(next, nowIso(), id).run();
  if (next === 'disabled') await env.DB.prepare('DELETE FROM sessions WHERE license_id=?').bind(id).run();
  return json({ ok: true, status: next });
}

async function adminStats(env) {
  const [licenses, active, bound, questions, attempts] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) c FROM licenses').first(),
    env.DB.prepare("SELECT COUNT(*) c FROM licenses WHERE status='active'").first(),
    env.DB.prepare('SELECT COUNT(*) c FROM licenses WHERE device_fingerprint IS NOT NULL').first(),
    env.DB.prepare('SELECT COUNT(*) c FROM questions WHERE active=1').first(),
    env.DB.prepare('SELECT COUNT(*) c FROM attempts').first(),
  ]);
  return json({ totalCodes:Number(licenses?.c||0), activeCodes:Number(active?.c||0), boundDevices:Number(bound?.c||0), questions:Number(questions?.c||0), attempts:Number(attempts?.c||0) });
}

async function seedQuestions(request, env) {
  const body = await readJson(request);
  const bank = body.bank;
  if (!Array.isArray(bank.questions)) fail(500, 'BAD_BANK', 'ملف بنك الأسئلة غير صالح.');
  const statements = bank.questions.map(q => env.DB.prepare(`INSERT INTO questions(id,chapter,topic,difficulty,type,text,options_json,correct_index,explanation,source,active,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET chapter=excluded.chapter,topic=excluded.topic,difficulty=excluded.difficulty,type=excluded.type,text=excluded.text,options_json=excluded.options_json,correct_index=excluded.correct_index,explanation=excluded.explanation,source=excluded.source,active=1,updated_at=excluded.updated_at`)
    .bind(q.id, q.chapter, q.topic, q.difficulty, q.type, q.text, JSON.stringify(q.options), q.correctIndex, q.explanation, q.source, nowIso()));
  for (let i = 0; i < statements.length; i += 40) await env.DB.batch(statements.slice(i, i + 40));
  return json({ ok: true, version: bank.version, imported: statements.length });
}
