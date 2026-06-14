const CONFIG = window.COST_BANK_CONFIG || {};
const API_BASE = String(CONFIG.API_BASE || '').replace(/\/$/, '');
const ADMIN_TOKEN_KEY = 'cost_bank_admin_session_v1';
let token = sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
let latestCodes = [];
const $ = id => document.getElementById(id);

function toast(text){const el=$('toast');el.textContent=text;el.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.add('hidden'),3000)}
function msg(id,text,type='error'){const el=$(id);el.textContent=text;el.className=`message ${type}`}

async function api(path,{method='GET',body=null,auth=true}={}){
  if(!API_BASE||API_BASE.includes('YOUR-WORKER')) throw new Error('اضبط API_BASE في config.js أولاً.');
  const headers={'Content-Type':'application/json'};
  if(auth) headers.Authorization=`Bearer ${token}`;
  const r=await fetch(`${API_BASE}${path}`,{method,headers,body:body===null?null:JSON.stringify(body),cache:'no-store'});
  const data=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error(data.message||'فشل الطلب');e.code=data.error;e.status=r.status;if(r.status===401&&auth) logout(false);throw e}
  return data;
}

async function login(e){
  e.preventDefault();const b=$('adminLoginBtn');b.disabled=true;b.textContent='جاري الدخول...';
  try{const data=await api('/api/admin/login',{method:'POST',auth:false,body:{password:$('adminPassword').value}});token=data.token;sessionStorage.setItem(ADMIN_TOKEN_KEY,token);await enter()}
  catch(err){msg('adminLoginMsg',err.message)}finally{b.disabled=false;b.textContent='دخول'}
}

async function enter(){
  $('adminLogin').classList.add('hidden');$('adminApp').classList.remove('hidden');
  await Promise.all([loadStats(),loadCodes()]);
}

function logout(reload=true){token='';sessionStorage.removeItem(ADMIN_TOKEN_KEY);if(reload)location.reload()}

async function loadStats(){
  const s=await api('/api/admin/stats');
  const items=[['إجمالي الأكواد',s.totalCodes],['أكواد فعالة',s.activeCodes],['أجهزة مرتبطة',s.boundDevices],['الأسئلة',s.questions],['المحاولات',s.attempts]];
  $('statsGrid').innerHTML=items.map(([label,value])=>`<article class="stat-card"><strong>${value}</strong><span>${label}</span></article>`).join('');
}

async function seed(){
  const file=$('bankFile').files?.[0];
  if(!file){msg('seedMsg','اختر ملف بنك الأسئلة JSON أولاً.');return}
  const b=$('seedBtn');b.disabled=true;b.textContent='جاري الاستيراد...';
  try{const bank=JSON.parse(await file.text());const data=await api('/api/admin/seed',{method:'POST',body:{bank}});msg('seedMsg',`تم استيراد ${data.imported} سؤالاً - الإصدار ${data.version}`,'ok');await loadStats()}
  catch(err){msg('seedMsg',err.message)}finally{b.disabled=false;b.textContent='استيراد بنك الأسئلة'}
}

async function generate(){
  const count=Number($('codeCount').value||1);const label=$('codeLabel').value.trim();const expiry=$('codeExpiry').value;
  const b=$('generateBtn');b.disabled=true;b.textContent='جاري الإنشاء...';
  try{const data=await api('/api/admin/codes',{method:'POST',body:{count,label,expiresAt:expiry?new Date(expiry).toISOString():null}});latestCodes=data.codes;$('generatedCodes').textContent=latestCodes.join('\n');$('generatedBox').classList.remove('hidden');toast(`تم إنشاء ${latestCodes.length} كود`);await Promise.all([loadStats(),loadCodes()])}
  catch(err){toast(err.message)}finally{b.disabled=false;b.textContent='إنشاء الأكواد'}
}

function downloadCodes(){
  if(!latestCodes.length)return;const label=$('codeLabel').value.trim();
  const csv=['code,label',...latestCodes.map(c=>`"${c}","${label.replaceAll('"','""')}"`)].join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download=`activation-codes-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href)
}

async function loadCodes(){
  const data=await api('/api/admin/codes?limit=500');const tbody=$('codesTable');tbody.innerHTML='';
  for(const row of data.licenses){
    const tr=document.createElement('tr');const device=row.device_fingerprint?`${row.device_fingerprint.slice(0,8)}…`:'غير مرتبط';
    tr.innerHTML=`<td>${row.id}</td><td dir="ltr">••••-${row.code_hint}</td><td>${row.label||'—'}</td><td>${row.student_name||'—'}</td><td class="device-short">${device}</td><td><span class="status-chip ${row.status}">${row.status==='active'?'فعال':'موقوف'}</span></td><td>${row.last_login_at?new Date(row.last_login_at).toLocaleString('ar'):'—'}</td><td><div class="row-actions"><button data-reset>إعادة ربط</button><button data-toggle class="${row.status==='active'?'warn':''}">${row.status==='active'?'إيقاف':'تفعيل'}</button></div></td>`;
    tr.querySelector('[data-reset]').onclick=()=>resetCode(row.id,row.student_name);
    tr.querySelector('[data-toggle]').onclick=()=>toggleCode(row.id);
    tbody.appendChild(tr);
  }
}

async function resetCode(id,name){
  if(!confirm(`سيتم فصل الجهاز الحالي${name?' للطالب '+name:''}. متابعة؟`))return;
  try{await api(`/api/admin/codes/${id}/reset`,{method:'POST',body:{}});toast('تمت إعادة ربط الكود');await Promise.all([loadCodes(),loadStats()])}catch(e){toast(e.message)}
}
async function toggleCode(id){try{await api(`/api/admin/codes/${id}/toggle`,{method:'POST',body:{}});await Promise.all([loadCodes(),loadStats()])}catch(e){toast(e.message)}}

$('adminLoginForm').addEventListener('submit',login);$('seedBtn').onclick=seed;$('generateBtn').onclick=generate;$('downloadCodes').onclick=downloadCodes;$('refreshBtn').onclick=()=>Promise.all([loadCodes(),loadStats()]);$('adminLogout').onclick=()=>logout(true);
if(token)enter().catch(()=>logout(true));
