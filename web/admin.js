const CONFIG = window.COST_BANK_CONFIG || {};
const API_BASE = String(CONFIG.API_BASE || '').replace(/\/$/, '');
const ADMIN_TOKEN_KEY = 'cost_bank_admin_session_v1';
const AUTO_REFRESH_MS = 60 * 1000;

let token = sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
let latestCodes = [];
let refreshTimer = null;

const $ = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[character]));
}

function toast(text) {
  const element = $('toast');
  element.textContent = text;
  element.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.add('hidden'), 3000);
}

function msg(id, text, type='error') {
  const element = $(id);
  element.textContent = text;
  element.className = `message ${type}`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ar-JO', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

async function api(path, { method='GET', body=null, auth=true }={}) {
  if (!API_BASE || API_BASE.includes('YOUR-WORKER')) {
    throw new Error('اضبط API_BASE في config.js أولاً.');
  }

  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === null ? null : JSON.stringify(body),
    cache: 'no-store',
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || 'فشل الطلب');
    error.code = data.error;
    error.status = response.status;
    if (response.status === 401 && auth) logout(false);
    throw error;
  }

  return data;
}

async function login(event) {
  event.preventDefault();
  const button = $('adminLoginBtn');
  button.disabled = true;
  button.textContent = 'جاري الدخول...';

  try {
    const data = await api('/api/admin/login', {
      method: 'POST',
      auth: false,
      body: { password: $('adminPassword').value },
    });

    token = data.token;
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    await enter();
  } catch (error) {
    msg('adminLoginMsg', error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'دخول';
  }
}

async function enter() {
  $('adminLogin').classList.add('hidden');
  $('adminApp').classList.remove('hidden');
  await refreshDashboard();

  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (!document.hidden && token) refreshDashboard(false);
  }, AUTO_REFRESH_MS);
}

function logout(reload=true) {
  clearInterval(refreshTimer);
  token = '';
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  if (reload) location.reload();
}

async function refreshDashboard(showError=true) {
  try {
    await Promise.all([loadStats(), loadCodes()]);
    $('lastRefresh').textContent = `آخر تحديث: ${new Date().toLocaleTimeString('ar-JO')}`;
  } catch (error) {
    if (showError) toast(error.message);
  }
}

async function loadStats() {
  const stats = await api('/api/admin/stats');

  const items = [
    ['الطلاب المتصلون الآن', stats.onlineStudents],
    ['إجمالي الأكواد', stats.totalCodes],
    ['أكواد فعالة', stats.activeCodes],
    ['أجهزة مرتبطة', stats.boundDevices],
    ['الأسئلة', stats.questions],
    ['المحاولات', stats.attempts],
  ];

  $('statsGrid').innerHTML = items.map(([label,value],index) => `
    <article class="stat-card ${index === 0 ? 'online-stat' : ''}">
      <strong>${Number(value || 0)}</strong>
      <span>${label}</span>
    </article>
  `).join('');
}

async function seed() {
  const file = $('bankFile').files?.[0];

  if (!file) {
    msg('seedMsg', 'اختر ملف بنك الأسئلة JSON أولاً.');
    return;
  }

  const button = $('seedBtn');
  button.disabled = true;
  button.textContent = 'جاري الاستيراد...';

  try {
    const bank = JSON.parse(await file.text());
    const data = await api('/api/admin/seed', {
      method: 'POST',
      body: { bank },
    });

    msg('seedMsg', `تم استيراد ${data.imported} سؤالاً - الإصدار ${data.version}`, 'ok');
    await loadStats();
  } catch (error) {
    msg('seedMsg', error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'استيراد بنك الأسئلة';
  }
}

async function generate() {
  const count = Number($('codeCount').value || 1);
  const label = $('codeLabel').value.trim();
  const expiry = $('codeExpiry').value;
  const button = $('generateBtn');

  button.disabled = true;
  button.textContent = 'جاري الإنشاء...';

  try {
    const data = await api('/api/admin/codes', {
      method: 'POST',
      body: {
        count,
        label,
        expiresAt: expiry ? new Date(expiry).toISOString() : null,
      },
    });

    latestCodes = data.codes;
    $('generatedCodes').textContent = latestCodes.join('\n');
    $('generatedBox').classList.remove('hidden');
    toast(`تم إنشاء ${latestCodes.length} كود`);
    await refreshDashboard(false);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'إنشاء الأكواد';
  }
}

function downloadCodes() {
  if (!latestCodes.length) return;

  const label = $('codeLabel').value.trim();
  const csv = [
    'code,label',
    ...latestCodes.map(code => `"${code}","${label.replaceAll('"','""')}"`),
  ].join('\n');

  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(new Blob(['\ufeff' + csv], {
    type: 'text/csv;charset=utf-8',
  }));
  anchor.download = `activation-codes-${new Date().toISOString().slice(0,10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function progressCell(row) {
  const progress = Number(row.progress_percent || 0);
  const answered = Number(row.unique_questions || 0);

  return `
    <div class="student-progress" title="${answered} سؤالاً مختلفاً تمت الإجابة عنه">
      <div class="progress-label"><b>${progress}%</b><small>${answered} سؤال</small></div>
      <div class="admin-progress-track"><i style="width:${progress}%"></i></div>
    </div>
  `;
}

async function loadCodes() {
  const data = await api('/api/admin/codes?limit=500');
  const tbody = $('codesTable');
  tbody.innerHTML = '';

  for (const row of data.licenses) {
    const tr = document.createElement('tr');
    if (row.is_online) tr.classList.add('online-row');

    const device = row.device_fingerprint
      ? `${String(row.device_fingerprint).slice(0,8)}…`
      : 'غير مرتبط';

    const online = row.student_name
      ? `<span class="presence-chip ${row.is_online ? 'online' : 'offline'}">${row.is_online ? 'متصل الآن' : 'غير متصل'}</span>`
      : '—';

    tr.innerHTML = `
      <td>${Number(row.id)}</td>
      <td dir="ltr">••••-${escapeHtml(row.code_hint)}</td>
      <td>${escapeHtml(row.label || '—')}</td>
      <td><b>${escapeHtml(row.student_name || '—')}</b></td>
      <td>${online}</td>
      <td>${progressCell(row)}</td>
      <td><b>${Number(row.average_score || 0)}%</b></td>
      <td>${Number(row.attempts_count || 0)}</td>
      <td>${formatDate(row.last_login_at)}</td>
      <td>${formatDate(row.last_seen_at)}</td>
      <td>${formatDate(row.last_logout_at)}</td>
      <td class="device-short">${escapeHtml(device)}</td>
      <td><span class="status-chip ${escapeHtml(row.status)}">${row.status === 'active' ? 'فعال' : 'موقوف'}</span></td>
      <td>
        <div class="row-actions">
          <button data-reset>إعادة ربط</button>
          <button data-toggle class="${row.status === 'active' ? 'warn' : ''}">
            ${row.status === 'active' ? 'إيقاف' : 'تفعيل'}
          </button>
        </div>
      </td>
    `;

    tr.querySelector('[data-reset]').onclick = () => resetCode(row.id, row.student_name);
    tr.querySelector('[data-toggle]').onclick = () => toggleCode(row.id);
    tbody.appendChild(tr);
  }

  $('studentsSummary').textContent = `يعرض ${data.licenses.length} كوداً — المتصل الآن يُحدّد من النشاط خلال آخر ${Math.round(Number(data.onlineWindowSeconds || 180) / 60)} دقائق.`;
}

async function resetCode(id, name) {
  const studentText = name ? ` للطالب ${name}` : '';

  if (!confirm(`سيتم فصل الجهاز ومسح سجل التقدم والمحاولات${studentText}. متابعة؟`)) {
    return;
  }

  try {
    await api(`/api/admin/codes/${id}/reset`, {
      method: 'POST',
      body: {},
    });

    toast('تمت إعادة ربط الكود ومسح بيانات الطالب السابقة');
    await refreshDashboard(false);
  } catch (error) {
    toast(error.message);
  }
}

async function toggleCode(id) {
  try {
    await api(`/api/admin/codes/${id}/toggle`, {
      method: 'POST',
      body: {},
    });
    await refreshDashboard(false);
  } catch (error) {
    toast(error.message);
  }
}

$('adminLoginForm').addEventListener('submit', login);
$('seedBtn').onclick = seed;
$('generateBtn').onclick = generate;
$('downloadCodes').onclick = downloadCodes;
$('refreshBtn').onclick = () => refreshDashboard();
$('adminLogout').onclick = () => logout(true);

if (token) {
  enter().catch(() => logout(true));
}
