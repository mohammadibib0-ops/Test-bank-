import { getOrCreateDeviceKey, signChallenge } from './crypto-device.js';

const CONFIG = window.COST_BANK_CONFIG || {};
const API_BASE = String(CONFIG.API_BASE || '').replace(/\/$/, '');
const TOKEN_KEY = 'cost_bank_session_v1';
const STUDENT_KEY = 'cost_bank_student_v1';
const LETTERS = ['أ','ب','ج','د','هـ','و'];
const HEARTBEAT_MS = 60 * 1000;

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  student: JSON.parse(localStorage.getItem(STUDENT_KEY) || 'null'),
  device: null,
  chapters: [],
  selectedChapter: null,
  questions: [],
  answers: {},
  index: 0,
  lastResults: null,
  heartbeatTimer: null,
};

const $ = id => document.getElementById(id);
const views = ['homePanel','setupPanel','quizPanel','resultPanel'];

function setView(id) {
  views.forEach(view => $(view).classList.toggle('hidden', view !== id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showMessage(text, type='error') {
  const element = $('loginMsg');
  element.textContent = text;
  element.className = `message ${type}`;
}

function toast(text) {
  const element = $('toast');
  element.textContent = text;
  element.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.add('hidden'), 3200);
}

function randomNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2,'0')).join('');
}

async function signedHeaders(method, url) {
  if (!state.device?.pair?.privateKey) {
    state.device = await getOrCreateDeviceKey();
  }

  const time = Date.now();
  const nonce = randomNonce();
  const parsed = new URL(url);
  const canonical = `${time}.${nonce}.${method.toUpperCase()}.${parsed.pathname}${parsed.search}`;
  const signature = await signChallenge(state.device.pair.privateKey, canonical);

  return {
    Authorization: `Bearer ${state.token}`,
    'X-Device-Time': String(time),
    'X-Device-Nonce': nonce,
    'X-Device-Signature': signature,
  };
}

async function api(path, { method='GET', body=null, auth=true }={}) {
  if (!API_BASE || API_BASE.includes('YOUR-WORKER')) {
    throw new Error('لم يتم ضبط رابط خادم التفعيل في ملف config.js.');
  }

  const url = `${API_BASE}${path}`;
  const headers = { 'Content-Type': 'application/json' };

  if (auth) Object.assign(headers, await signedHeaders(method, url));

  const response = await fetch(url, {
    method,
    headers,
    body: body === null ? null : JSON.stringify(body),
    cache: 'no-store',
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || 'تعذر الاتصال بالخادم.');
    error.code = data.error;
    error.status = response.status;
    if (response.status === 401 && auth) clearSession(false);
    throw error;
  }

  return data;
}

function stopHeartbeat() {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
}

function clearSession(reload=true) {
  stopHeartbeat();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(STUDENT_KEY);
  state.token = '';
  state.student = null;
  if (reload) location.reload();
}

function startHeartbeat() {
  stopHeartbeat();

  const sendHeartbeat = async () => {
    if (!state.token || document.hidden) return;
    try {
      await api('/api/ping');
    } catch (error) {
      if (error.status === 401) clearSession(true);
    }
  };

  state.heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.token) sendHeartbeat();
  }, { passive: true });
}

function formatCodeInput(value) {
  let raw = value.toUpperCase().replace(/[^A-Z0-9]/g,'');
  if (raw.startsWith('COST')) raw = raw.slice(4);
  raw = raw.slice(0,12);
  const groups = raw.match(/.{1,4}/g) || [];
  return raw ? `COST-${groups.join('-')}` : '';
}

function applyWatermark(student) {
  const name = (student?.name || 'طالب').replace(/[<>&"']/g,'');
  const hint = student?.codeHint || '••••';
  const stamp = `${name} • ${hint} • ${new Date().toLocaleDateString('ar')}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="190"><text x="25" y="100" transform="rotate(-24 180 95)" font-family="Arial" font-size="18" font-weight="700" fill="#173b57">${stamp}</text></svg>`;
  $('watermark').style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

async function login(event) {
  event.preventDefault();
  const button = $('loginBtn');
  button.disabled = true;
  button.textContent = 'جاري إثبات الجهاز...';
  $('loginMsg').classList.add('hidden');

  try {
    state.device = await getOrCreateDeviceKey();
    const name = $('studentName').value.trim();
    const code = $('activationCode').value.trim();

    const activation = await api('/api/activate', {
      method: 'POST',
      auth: false,
      body: { name, code, publicKeyJwk: state.device.publicKeyJwk },
    });

    const signature = await signChallenge(state.device.pair.privateKey, activation.challenge);

    const verified = await api('/api/verify', {
      method: 'POST',
      auth: false,
      body: { challengeId: activation.challengeId, signature },
    });

    state.token = verified.token;
    state.student = verified.student;
    localStorage.setItem(TOKEN_KEY, state.token);
    localStorage.setItem(STUDENT_KEY, JSON.stringify(state.student));
    await enterApp();
  } catch (error) {
    const friendly = {
      DEVICE_MISMATCH: 'هذا الكود مرتبط بجهاز آخر. اطلب من المدرس إعادة ربطه.',
      INVALID_CODE: 'كود التفعيل غير صحيح.',
      CODE_DISABLED: 'هذا الكود موقوف.',
      CODE_EXPIRED: 'انتهت صلاحية الكود.',
      RATE_LIMITED: 'تم تجاوز عدد المحاولات. حاول بعد قليل.',
    }[error.code] || error.message;

    showMessage(friendly);
  } finally {
    button.disabled = false;
    button.textContent = 'تفعيل وتسجيل الدخول';
  }
}

async function enterApp() {
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('studentDisplay').textContent = state.student?.name || 'طالب';
  $('codeDisplay').textContent = `الكود •••• ${state.student?.codeHint || ''}`;
  applyWatermark(state.student);

  const data = await api('/api/chapters');
  state.chapters = data.chapters || [];
  state.student = data.student || state.student;
  localStorage.setItem(STUDENT_KEY, JSON.stringify(state.student));

  renderChapters();
  setView('homePanel');
  $('pageTitle').textContent = 'الفصول الدراسية';
  startHeartbeat();
}

function renderChapters() {
  const cards = $('chapterCards');
  const nav = $('chapterNav');
  cards.innerHTML = '';
  nav.innerHTML = '<button class="nav-link active" data-home="1">⌂ الصفحة الرئيسية</button>';

  nav.querySelector('[data-home]').onclick = () => {
    setView('homePanel');
    $('pageTitle').textContent = 'الفصول الدراسية';
    closeSidebar();
  };

  for (const chapter of state.chapters) {
    const card = document.createElement('article');
    card.className = 'chapter-card';
    card.innerHTML = `<div class="num">${chapter.id}</div><h3>${chapter.title}</h3><p>${chapter.description}</p><footer><span>${chapter.count} سؤالاً</span><button class="btn secondary">فتح الفصل</button></footer>`;
    card.querySelector('button').onclick = () => openSetup(chapter.id);
    cards.appendChild(card);

    const button = document.createElement('button');
    button.className = 'nav-link';
    button.textContent = `الفصل ${chapter.id}: ${chapter.title}`;
    button.onclick = () => {
      openSetup(chapter.id);
      closeSidebar();
    };
    nav.appendChild(button);
  }
}

function openSetup(chapterId) {
  state.selectedChapter = state.chapters.find(chapter => chapter.id === Number(chapterId));
  if (!state.selectedChapter) return;

  $('setupChapterTitle').textContent = state.selectedChapter.title;
  $('pageTitle').textContent = state.selectedChapter.title;

  document.querySelectorAll('.nav-link').forEach((button,index) => {
    button.classList.toggle('active', index === Number(chapterId));
  });

  setView('setupPanel');
}

async function startQuiz() {
  const button = $('startBtn');
  button.disabled = true;
  button.textContent = 'جاري تحميل الأسئلة...';

  try {
    const limit = $('questionLimit').value;
    const difficulty = encodeURIComponent($('difficulty').value);
    const data = await api(`/api/questions?chapter=${state.selectedChapter.id}&limit=${limit}&difficulty=${difficulty}`);

    state.questions = data.questions || [];
    if (!state.questions.length) throw new Error('لا توجد أسئلة مطابقة للاختيار.');

    state.answers = {};
    state.index = 0;
    $('quizChapterTitle').textContent = state.selectedChapter.title;
    setView('quizPanel');
    renderQuestion();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'بدء الاختبار';
  }
}

function renderQuestion() {
  const question = state.questions[state.index];
  if (!question) return;

  $('quizTopic').textContent = question.topic;
  $('questionDifficulty').textContent = question.difficulty;
  $('questionSource').textContent = question.source || '';
  $('questionText').textContent = question.text;
  $('questionCounter').textContent = `${state.index + 1} / ${state.questions.length}`;
  $('progressBar').style.width = `${((state.index + 1) / state.questions.length) * 100}%`;

  const box = $('optionsBox');
  box.innerHTML = '';

  question.options.forEach((text,index) => {
    const button = document.createElement('button');
    button.className = `option-btn ${state.answers[question.id] === index ? 'selected' : ''}`;
    button.type = 'button';
    button.innerHTML = `<span class="option-letter">${LETTERS[index] || index + 1}</span><span>${text}</span>`;
    button.onclick = () => {
      state.answers[question.id] = index;
      renderQuestion();
    };
    box.appendChild(button);
  });

  $('prevBtn').disabled = state.index === 0;
  const last = state.index === state.questions.length - 1;
  $('nextBtn').classList.toggle('hidden', last);
  $('submitBtn').classList.toggle('hidden', !last);
}

function nextQuestion() {
  if (state.index < state.questions.length - 1) {
    state.index += 1;
    renderQuestion();
  }
}

function prevQuestion() {
  if (state.index > 0) {
    state.index -= 1;
    renderQuestion();
  }
}

async function submitQuiz() {
  const unanswered = state.questions.filter(question => state.answers[question.id] === undefined).length;

  if (unanswered && !confirm(`يوجد ${unanswered} سؤال دون إجابة. هل تريد التسليم؟`)) {
    return;
  }

  const button = $('submitBtn');
  button.disabled = true;
  button.textContent = 'جاري التصحيح...';

  try {
    const answers = state.questions.map(question => ({
      id: question.id,
      selectedIndex: state.answers[question.id] ?? -1,
    }));

    const result = await api('/api/submit', {
      method: 'POST',
      body: { chapter: state.selectedChapter.id, answers },
    });

    state.lastResults = result;
    localStorage.setItem('cost_bank_last_score', `${result.score}%`);
    $('overallScore').textContent = `${result.score}%`;
    renderResults(result);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'تسليم وتصحيح';
  }
}

function renderResults(result) {
  $('scorePercent').textContent = `${result.score}%`;
  $('scoreText').textContent = `${result.correct} إجابة صحيحة من ${result.total}`;
  $('scoreMessage').textContent = result.score >= 85
    ? 'أداء ممتاز. انتقل إلى فصل آخر أو جرّب مستوى أصعب.'
    : result.score >= 65
      ? 'أداء جيد. راجع الأسئلة غير الصحيحة ثم أعد المحاولة.'
      : 'تحتاج إلى مراجعة المفاهيم ثم إعادة التدريب.';

  const resultMap = new Map(result.results.map(item => [item.id, item]));
  const review = $('reviewList');
  review.innerHTML = '';

  state.questions.forEach((question,index) => {
    const itemResult = resultMap.get(question.id);
    if (!itemResult) return;

    const item = document.createElement('article');
    item.className = `review-item ${itemResult.correct ? 'ok' : ''}`;
    const selectedText = itemResult.selectedIndex >= 0
      ? question.options[itemResult.selectedIndex]
      : 'لم تتم الإجابة';

    item.innerHTML = `<h4>${index + 1}. ${question.text}</h4><p>إجابتك: <span class="answer">${selectedText}</span></p><p>الإجابة الصحيحة: <span class="answer">${question.options[itemResult.correctIndex]}</span></p><p>${itemResult.explanation}</p>`;
    review.appendChild(item);
  });

  setView('resultPanel');
}

async function logout() {
  stopHeartbeat();
  try {
    await api('/api/logout', { method: 'POST', body: {} });
  } catch {
    // حتى لو تعذر الاتصال، تُمسح الجلسة المحلية.
  }
  clearSession(true);
}

function closeSidebar() {
  document.querySelector('.sidebar').classList.remove('open');
}

function bindSecurity() {
  document.addEventListener('contextmenu', event => event.preventDefault());
  document.addEventListener('copy', event => {
    event.preventDefault();
    toast('النسخ غير متاح داخل البنك.');
  });
  document.addEventListener('cut', event => event.preventDefault());

  document.addEventListener('keydown', event => {
    const blocked = (event.ctrlKey || event.metaKey)
      && ['p','s','u','c','x'].includes(event.key.toLowerCase());

    if (blocked || event.key === 'PrintScreen') {
      event.preventDefault();
      toast('هذا الاختصار غير متاح.');
    }
  });

  window.addEventListener('beforeprint', () => $('securityCurtain').classList.remove('hidden'));
  window.addEventListener('afterprint', () => $('securityCurtain').classList.add('hidden'));
}

async function boot() {
  bindSecurity();
  $('loginForm').addEventListener('submit', login);
  $('activationCode').addEventListener('input', event => {
    event.target.value = formatCodeInput(event.target.value);
  });

  $('startBtn').onclick = startQuiz;
  $('nextBtn').onclick = nextQuestion;
  $('prevBtn').onclick = prevQuestion;
  $('submitBtn').onclick = submitQuiz;
  $('retryBtn').onclick = () => openSetup(state.selectedChapter.id);
  $('newExamBtn').onclick = () => state.selectedChapter
    ? openSetup(state.selectedChapter.id)
    : setView('homePanel');

  $('logoutBtn').onclick = () => {
    if (confirm('تسجيل الخروج من البنك؟')) logout();
  };

  $('menuBtn').onclick = () => document.querySelector('.sidebar').classList.toggle('open');
  $('overallScore').textContent = localStorage.getItem('cost_bank_last_score') || '—';

  if (state.token) {
    try {
      state.device = await getOrCreateDeviceKey();
      const me = await api('/api/me');
      state.student = me.student;
      await enterApp();
      return;
    } catch (error) {
      clearSession(false);
      showMessage(error.message || 'انتهت الجلسة. سجل الدخول مجدداً.');
    }
  }

  $('loginView').classList.remove('hidden');
}

boot();
