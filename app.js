// ── 사업체 관리 ───────────────────────────────────────────
// 기존 데이터(prefix 없는 키) → default 사업체로 자동 마이그레이션
// 거래처/품목은 공유 키 그대로 유지, 거래내역/회사정보/견적만 사업체별 분리
(function migrateOldData() {
  if (localStorage.getItem('_biz_migrated')) return;
  ['acc_transactions','acc_company','acc_quotes'].forEach(k => {
    const old = localStorage.getItem(k);
    if (old && !localStorage.getItem(k + '__default')) {
      localStorage.setItem(k + '__default', old);
    }
  });
  localStorage.setItem('_biz_migrated', '1');
})();

let businesses   = JSON.parse(localStorage.getItem('acc_businesses') || '[{"id":"default","name":"기본 사업체"}]');
let currentBizId = localStorage.getItem('acc_current_biz') || 'default';

function saveBusinesses() { localStorage.setItem('acc_businesses', JSON.stringify(businesses)); }
function saveCurrentBiz() { localStorage.setItem('acc_current_biz', currentBizId); }
function bizKey(key)      { return key + '__' + currentBizId; }

// ── Storage ──────────────────────────────────────────────
const DB = {
  load(key, fallback = '[]') {
    try { return JSON.parse(localStorage.getItem(bizKey(key)) || fallback); } catch { return JSON.parse(fallback); }
  },
  save(key, data) { localStorage.setItem(bizKey(key), JSON.stringify(data)); }
};

// 거래처·품목은 사업체 공통 (prefix 없음), 나머지는 사업체별
const DBshared = {
  load(key, fallback = '[]') {
    try { return JSON.parse(localStorage.getItem(key) || fallback); } catch { return JSON.parse(fallback); }
  },
  save(key, data) { localStorage.setItem(key, JSON.stringify(data)); }
};

let vendors      = DBshared.load('acc_vendors');
let items        = DBshared.load('acc_items');
let transactions = DB.load('acc_transactions');
let companyInfo  = DB.load('acc_company', '{}');

function saveVendors()      { DBshared.save('acc_vendors', vendors);     scheduleSheetsBackup(); }
function saveItems()        { DBshared.save('acc_items', items);          scheduleSheetsBackup(); }
function saveTransactions() { DB.save('acc_transactions', transactions);  scheduleSheetsBackup(); }
function saveCompanyInfo()  { DB.save('acc_company', companyInfo);        scheduleSheetsBackup(); }
function saveQuotes()       { DB.save('acc_quotes', quotes);              scheduleSheetsBackup(); }

// ── 자동 구글시트 백업 ────────────────────────────────────
let _autoBackupTimer = null;

function scheduleSheetsBackup() {
  if (!APPS_SCRIPT_URL || !SHEETS_SECRET) return;
  clearTimeout(_autoBackupTimer);
  _autoBackupTimer = setTimeout(runAutoSheetsBackup, 3000);
}

async function runAutoSheetsBackup() {
  const storage = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('acc_') || key === '_biz_migrated') storage[key] = localStorage.getItem(key);
  }
  try {
    const res  = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ secretKey: SHEETS_SECRET, action: 'backupStorage', data: storage })
    });
    const json = await res.json();
    if (json.success) showSheetsBackupStatus('☁ 자동 백업 완료', 'success');
    else              showSheetsBackupStatus('☁ 백업 실패', 'error');
  } catch {
    showSheetsBackupStatus('☁ 백업 실패 (연결 오류)', 'error');
  }
}

function showSheetsBackupStatus(message, type) {
  let el = document.getElementById('sheets-auto-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sheets-auto-status';
    el.style.cssText = 'position:fixed;top:12px;right:16px;z-index:9999;font-size:12px;padding:5px 12px;border-radius:20px;opacity:0;transition:opacity 0.3s;pointer-events:none;font-family:inherit';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.background = type === 'success' ? '#f0fdf4' : '#fef2f2';
  el.style.color       = type === 'success' ? '#16a34a' : '#dc2626';
  el.style.border      = type === 'success' ? '1px solid #bbf7d0' : '1px solid #fecaca';
  el.style.opacity     = '1';
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.style.opacity = '0'; }, 3000);
}

// ── Google Sheets 연동 설정 ──────────────────────────────
// UI에서 ⚙ 시트설정 버튼으로 변경 가능 (localStorage에 저장됨)
let APPS_SCRIPT_URL = localStorage.getItem('acc_sheets_url') || '';
let SHEETS_SECRET   = localStorage.getItem('acc_sheets_key') || '';

async function backupToSheets() {
  if (!APPS_SCRIPT_URL) { openSheetsConfig(); return; }
  const storage = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('acc_') || key === '_biz_migrated') storage[key] = localStorage.getItem(key);
  }
  const btn = document.getElementById('sheets-backup-btn');
  if (btn) { btn.disabled = true; btn.textContent = '백업 중...'; }
  try {
    const res  = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ secretKey: SHEETS_SECRET, action: 'backupStorage', data: storage })
    });
    const json = await res.json();
    if (json.success) alert(`☁ 구글시트 백업 완료!\n${Object.keys(storage).length}개 항목 저장됨`);
    else              alert('백업 실패: ' + (json.message || '알 수 없는 오류'));
  } catch (err) {
    alert('연결 오류: ' + err.message + '\n\nURL이 올바른지 확인하세요.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '☁ 시트백업'; }
  }
}

async function restoreFromSheets() {
  if (!APPS_SCRIPT_URL) { openSheetsConfig(); return; }
  if (!confirm('구글시트에서 데이터를 불러옵니다.\n⚠ 기존 데이터가 모두 덮어쓰기 됩니다.\n계속할까요?')) return;
  const btn = document.getElementById('sheets-restore-btn');
  if (btn) { btn.disabled = true; btn.textContent = '불러오는 중...'; }
  try {
    const res  = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ secretKey: SHEETS_SECRET, action: 'restoreStorage' })
    });
    const json = await res.json();
    if (json.success && json.data) {
      const count = Object.keys(json.data).length;
      if (!count) { alert('구글시트에 저장된 데이터가 없습니다.'); return; }
      Object.entries(json.data).forEach(([k, v]) => localStorage.setItem(k, v));
      alert(`☁ 복원 완료! ${count}개 항목 불러왔습니다.\n앱을 새로고침합니다.`);
      location.reload();
    } else {
      alert('불러오기 실패: ' + (json.message || '알 수 없는 오류'));
    }
  } catch (err) {
    alert('연결 오류: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '☁ 시트복원'; }
  }
}

function openSheetsConfig() {
  const html = `
    <p style="font-size:13px;color:var(--gray-500);margin-bottom:16px">
      Google Apps Script 배포 URL과 인증 키를 입력하세요.<br>
      설정 방법은 <strong>GOOGLE_SHEETS_SETUP.md</strong> 파일을 참고하세요.
    </p>
    <div class="form-group" style="margin-bottom:14px">
      <label>Apps Script 배포 URL (/exec)</label>
      <input id="cfg-url" class="form-control" placeholder="https://script.google.com/macros/s/.../exec" value="${APPS_SCRIPT_URL}">
    </div>
    <div class="form-group" style="margin-bottom:14px">
      <label>Secret Key (Code.gs의 SECRET_KEY와 동일)</label>
      <input id="cfg-key" class="form-control" placeholder="my-secret-key-1234" value="${SHEETS_SECRET}">
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">취소</button>
      <button class="btn btn-ghost btn-sm" onclick="testSheetsConnection()">연결 테스트</button>
      <button class="btn btn-primary" onclick="saveSheetsConfig()">저장</button>
    </div>`;
  openModal('☁ 구글시트 연동 설정', html);
}

function saveSheetsConfig() {
  APPS_SCRIPT_URL = document.getElementById('cfg-url').value.trim();
  SHEETS_SECRET   = document.getElementById('cfg-key').value.trim();
  localStorage.setItem('acc_sheets_url', APPS_SCRIPT_URL);
  localStorage.setItem('acc_sheets_key', SHEETS_SECRET);
  closeModal();
  alert('설정이 저장됐습니다.');
}

async function testSheetsConnection() {
  const url = document.getElementById('cfg-url').value.trim();
  const key = document.getElementById('cfg-key').value.trim();
  if (!url) { alert('URL을 입력하세요.'); return; }
  try {
    const res  = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ secretKey: key, action: 'ping' })
    });
    const json = await res.json();
    if (json.success) alert('✅ 연결 성공! 구글시트와 정상적으로 통신됩니다.');
    else              alert('❌ 연결 실패: ' + (json.message || '응답 오류'));
  } catch (err) {
    alert('❌ 연결 오류: ' + err.message);
  }
}

// ── 전체 JSON 백업 / 복원 ─────────────────────────────────
function backupAll() {
  const storage = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith('acc_') || key === '_biz_migrated') {
      storage[key] = localStorage.getItem(key);
    }
  }
  const data = { version: 1, createdAt: new Date().toISOString(), app: 'accounting', storage };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const now  = new Date();
  const pad  = n => String(n).padStart(2, '0');
  a.href     = url;
  a.download = `accounting-full-backup-${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function restoreAll(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.app !== 'accounting' || !data.storage || typeof data.storage !== 'object') {
        alert('올바른 백업 파일이 아닙니다.\n(app: accounting, storage 필드가 필요합니다)');
        input.value = ''; return;
      }
      const backupDate = data.createdAt ? new Date(data.createdAt).toLocaleString('ko-KR') : '날짜 없음';
      const keyCount   = Object.keys(data.storage).length;
      if (!confirm(`백업 날짜: ${backupDate}\n복원 항목: ${keyCount}개\n\n⚠ 기존 데이터가 모두 덮어쓰기 됩니다.\n계속할까요?`)) {
        input.value = ''; return;
      }
      Object.entries(data.storage).forEach(([key, val]) => localStorage.setItem(key, val));
      alert('복원이 완료됐습니다. 앱을 새로고침합니다.');
      location.reload();
    } catch (err) {
      alert('파일 읽기 오류: ' + err.message);
      input.value = '';
    }
  };
  reader.readAsText(file);
}

function switchBusiness(id) {
  currentBizId = id;
  saveCurrentBiz();
  // 거래처·품목은 공유이므로 재로드 불필요
  transactions = DB.load('acc_transactions');
  companyInfo  = DB.load('acc_company', '{}');
  quotes       = DB.load('acc_quotes');
  renderSidebarBiz();
  renderTaxWidget();
  render(currentPage);
}

function renderSidebarBiz() {
  const el = document.getElementById('biz-switcher');
  if (!el) return;
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
      <span style="font-size:11px;color:#64748b;font-weight:600;letter-spacing:.5px">사업체</span>
      <button onclick="openBizManager()" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:11px;padding:2px 6px;border-radius:4px" onmouseover="this.style.background='#334155'" onmouseout="this.style.background='none'">+ 관리</button>
    </div>
    <select onchange="switchBusiness(this.value)" style="width:100%;padding:6px 8px;background:#0f172a;color:#f1f5f9;border:1px solid #334155;border-radius:6px;font-size:13px;font-family:inherit;cursor:pointer">
      ${businesses.map(b => `<option value="${b.id}" ${b.id === currentBizId ? 'selected' : ''}>${b.name}</option>`).join('')}
    </select>`;
}

function openBizManager() {
  const rows = businesses.map(b => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--gray-100)">
      <input class="form-control" style="flex:1" value="${b.name}" id="biz-name-${b.id}" onkeydown="if(event.key==='Enter')renameBiz('${b.id}')">
      <button class="btn btn-ghost btn-sm" onclick="renameBiz('${b.id}')">저장</button>
      ${b.id === 'default' ? '' : `<button class="btn btn-danger btn-sm" onclick="deleteBiz('${b.id}')">삭제</button>`}
      ${b.id !== currentBizId ? `<button class="btn btn-primary btn-sm" onclick="switchBusiness('${b.id}');closeModal()">전환</button>` : `<span class="badge" style="background:var(--primary-light);color:var(--primary)">현재</span>`}
    </div>`).join('');

  const html = `
    <div style="margin-bottom:16px">
      ${rows}
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <input class="form-control" id="new-biz-name" placeholder="새 사업체명" style="flex:1">
      <button class="btn btn-primary" onclick="addBiz()">+ 추가</button>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">닫기</button></div>`;
  openModal('사업체 관리', html);
}

function addBiz() {
  const name = document.getElementById('new-biz-name').value.trim();
  if (!name) { alert('사업체명을 입력하세요.'); return; }
  businesses.push({ id: uid(), name });
  saveBusinesses();
  openBizManager();
  renderSidebarBiz();
}

function renameBiz(id) {
  const name = document.getElementById('biz-name-' + id)?.value.trim();
  if (!name) return;
  const b = businesses.find(b => b.id === id);
  if (b) { b.name = name; saveBusinesses(); renderSidebarBiz(); openBizManager(); }
}

function deleteBiz(id) {
  const b = businesses.find(b => b.id === id);
  if (!b || id === 'default') return;
  if (!confirm(`"${b.name}" 사업체를 삭제하시겠습니까?\n※ 해당 사업체의 모든 데이터도 함께 삭제됩니다.`)) return;
  ['acc_transactions','acc_company','acc_quotes'].forEach(k =>
    localStorage.removeItem(k + '__' + id)
  );
  businesses = businesses.filter(b => b.id !== id);
  saveBusinesses();
  if (currentBizId === id) switchBusiness('default');
  else { renderSidebarBiz(); openBizManager(); }
}

function uid()  { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function debounce(fn, ms) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }
function fmt(n) { return Number(n || 0).toLocaleString('ko-KR'); }
function today(){ return new Date().toISOString().slice(0, 10); }

// ── Period ────────────────────────────────────────────────
let currentPeriod    = 'month';
let customDateFrom   = '';
let customDateTo     = '';

let summaryTab        = '거래처별';
let summaryAllBiz     = false;
let summaryPeriod     = 'month';
let summaryCustomFrom = '';
let summaryCustomTo   = '';
let summaryVendorSort   = 'total_desc';
let summaryVendorFilter = '';
let summarySalesSort    = 'date_desc';
let summarySalesType    = '';
let summarySalesVendorId = '';
let summaryAccountSort  = 'amt_desc';
let currentReportYear = new Date().getFullYear();

function getPeriodRange(period) {
  const now = new Date();
  const str = d => d.toISOString().slice(0, 10);
  switch (period) {
    case 'today':     { const d = str(now); return { start: d, end: d }; }
    case 'yesterday': { const y = new Date(now); y.setDate(y.getDate()-1); const d = str(y); return { start: d, end: d }; }
    case 'month':     return { start: str(new Date(now.getFullYear(), now.getMonth(), 1)), end: str(new Date(now.getFullYear(), now.getMonth()+1, 0)) };
    case 'lastmonth': return { start: str(new Date(now.getFullYear(), now.getMonth()-1, 1)), end: str(new Date(now.getFullYear(), now.getMonth(), 0)) };
    case 'custom':    return { start: customDateFrom || '0000-01-01', end: customDateTo || '9999-12-31' };
    default:          return { start: '0000-01-01', end: '9999-12-31' };
  }
}

function periodLabel(p) {
  return { today:'오늘', yesterday:'전일', month:'이달', lastmonth:'전달', all:'전체', custom:'직접입력' }[p] || '';
}

// ── Bulk Selection ────────────────────────────────────────
const _sel = { vendors: new Set(), items: new Set(), txRows: new Set(), quotes: new Set() };

function toggleSel(page, id) {
  _sel[page].has(id) ? _sel[page].delete(id) : _sel[page].add(id);
  _updateSelUI(page);
}
function selAll(page, chk) {
  document.querySelectorAll(`.sel-cb[data-page="${page}"]`).forEach(cb => {
    cb.checked = chk.checked;
    chk.checked ? _sel[page].add(cb.value) : _sel[page].delete(cb.value);
  });
  _updateSelUI(page);
}
function _updateSelUI(page) {
  const s   = _sel[page];
  const btn = document.getElementById(`sel-del-${page}`);
  if (btn) { btn.textContent = `선택 삭제 (${s.size}건)`; btn.style.display = s.size ? '' : 'none'; }
  const bulkBtn = document.getElementById(`sel-bulk-${page}`);
  if (bulkBtn) { bulkBtn.textContent = `✏ 일괄 변경 (${s.size}건)`; bulkBtn.style.display = s.size ? '' : 'none'; }
  const all = document.querySelectorAll(`.sel-cb[data-page="${page}"]`);
  const hdr = document.getElementById(`sel-all-${page}`);
  if (hdr && all.length) hdr.checked = s.size === all.length;
}
function deleteSelected(page) {
  const s = _sel[page];
  if (!s.size) return;
  const noun = {vendors:'거래처', items:'품목', txRows:'거래', quotes:'견적/발주'}[page];
  if (!confirm(`선택한 ${s.size}개 ${noun}를 삭제하시겠습니까?`)) return;
  if (page==='vendors')  { vendors      = vendors.filter(v=>!s.has(v.id));      saveVendors(); }
  if (page==='items')    { items        = items.filter(i=>!s.has(i.id));         saveItems(); }
  if (page==='txRows')   { transactions = transactions.filter(t=>!s.has(t.id)); saveTransactions(); }
  if (page==='quotes')   { quotes       = quotes.filter(q=>!s.has(q.id));        saveQuotes(); }
  s.clear();
  render(currentPage);
}

function bulkEditTxModal() {
  const count = _sel.txRows.size;
  if (!count) return;
  openModal(`선택 ${count}건 일괄 변경`, `
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="form-group">
        <label>사업 구분 변경 <span style="font-size:11px;color:var(--gray-400)">(비워두면 변경 안 함)</span></label>
        <select id="bulk-biz-cat" class="form-control">
          <option value="">-- 변경 안 함 --</option>
          ${['제조업','유통업','기타'].map(o=>`<option value="${o}">${o}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>계정 구분 변경 <span style="font-size:11px;color:var(--gray-400)">(비워두면 변경 안 함)</span></label>
        <select id="bulk-ac-cat" class="form-control">
          <option value="">-- 변경 안 함 --</option>
          ${['매출','매입(상품)','매입(경비)','매입(원재료)','매입(기타)'].map(o=>`<option value="${o}">${o}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="doBulkEditTx()">적용</button>
      </div>
    </div>
  `);
}

function doBulkEditTx() {
  const bizCat = document.getElementById('bulk-biz-cat').value;
  const acCat  = document.getElementById('bulk-ac-cat').value;
  if (!bizCat && !acCat) { closeModal(); return; }
  const ids = _sel.txRows;
  transactions.forEach(t => {
    if (!ids.has(t.id)) return;
    if (bizCat) t.bizCategory = bizCat;
    if (acCat)  t.accountCategory = acCat;
  });
  saveTransactions();
  _sel.txRows.clear();
  closeModal();
  render(currentPage);
}

// ── Router ────────────────────────────────────────────────
let currentPage = 'home';

function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  document.querySelectorAll('.page').forEach(el => el.classList.toggle('hidden', el.id !== 'page-' + page));
  render(page);
}

function render(page) {
  const el = document.getElementById('page-' + page);
  if (!el) return;
  if (page === 'home')         renderHome(el);
  if (page === 'summary')      renderSummary(el);
  if (page === 'vendors')      renderVendors(el);
  if (page === 'items')        renderItems(el);
  if (page === 'transactions') renderTransactions(el);
  if (page === 'quotes')       renderQuotes(el);
  if (page === 'tax')          renderTaxPage(el);
  if (page === 'candidates')   renderCandidatesPage(el);
}

// ── Modal ─────────────────────────────────────────────────
function openModal(title, bodyHtml, large = false) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-box').className = 'modal-box' + (large ? ' modal-lg' : '');
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-body').innerHTML = '';
}

// ── HOME PAGE ─────────────────────────────────────────────
function renderHome(el) {
  // 전체 기간 기준 카드 표시
  const allTx = transactions;
  let totalSales = 0, totalPurchase = 0, unpaidSales = 0, unpaidPurchase = 0;
  allTx.forEach(t => {
    const total = t.items.reduce((s, i) => s + i.amount + i.tax, 0);
    if (t.type === '매출') { totalSales += total; if (!t.isPaid) unpaidSales += total; }
    else                   { totalPurchase += total; if (!t.isPaid) unpaidPurchase += total; }
  });
  const profit = totalSales - totalPurchase;

  const curBizName = businesses.find(b => b.id === currentBizId)?.name || '';
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">홈 <span style="font-size:14px;font-weight:400;color:var(--gray-500);margin-left:6px">${curBizName}</span></div>
        <div class="page-subtitle">전체 누적 현황 · 월별 손익 보고서</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <button id="sheets-restore-btn" class="btn btn-ghost btn-sm" onclick="restoreFromSheets()">☁ 시트복원</button>
        <button id="sheets-backup-btn"  class="btn btn-ghost btn-sm" onclick="backupToSheets()">☁ 시트백업</button>
        <button class="btn btn-ghost btn-sm" onclick="openSheetsConfig()">⚙ 시트설정</button>
        <span style="color:var(--gray-300);padding:0 2px">|</span>
        <label class="btn btn-ghost btn-sm" style="cursor:pointer">
          📂 전체 복원
          <input type="file" accept=".json" style="display:none" onchange="restoreAll(this)">
        </label>
        <button class="btn btn-ghost btn-sm" onclick="backupAll()">💾 전체 백업</button>
        <button class="btn btn-ghost btn-sm" onclick="openCompanySettings()">⚙ 내 회사 정보</button>
      </div>
    </div>

    <div class="stats-grid" style="margin-bottom:12px">
      <div class="card">
        <div class="card-title">총 매출 (전체)</div>
        <div class="card-value positive">${fmt(totalSales)}원</div>
      </div>
      <div class="card">
        <div class="card-title">총 매입 (전체)</div>
        <div class="card-value success">${fmt(totalPurchase)}원</div>
      </div>
      <div class="card">
        <div class="card-title">순이익 (전체)</div>
        <div class="card-value ${profit >= 0 ? 'positive' : 'negative'}">${fmt(profit)}원</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px">
      <div class="card" style="border-left:4px solid var(--warning)">
        <div class="card-title" style="display:flex;align-items:center;gap:6px">
          <span style="color:var(--warning)">●</span> 미수금 (미결제 매출)
        </div>
        <div class="card-value" style="color:var(--warning)">${fmt(unpaidSales)}원</div>
        ${unpaidSales > 0 ? `<div style="font-size:12px;color:var(--gray-500);margin-top:4px">아직 받지 못한 금액</div>` : `<div style="font-size:12px;color:var(--success);margin-top:4px">✓ 미수금 없음</div>`}
      </div>
      <div class="card" style="border-left:4px solid var(--danger)">
        <div class="card-title" style="display:flex;align-items:center;gap:6px">
          <span style="color:var(--danger)">●</span> 미지급금 (미결제 매입)
        </div>
        <div class="card-value negative">${fmt(unpaidPurchase)}원</div>
        ${unpaidPurchase > 0 ? `<div style="font-size:12px;color:var(--gray-500);margin-top:4px">아직 지급하지 못한 금액</div>` : `<div style="font-size:12px;color:var(--success);margin-top:4px">✓ 미지급금 없음</div>`}
      </div>
    </div>

    ${buildMonthlyReport()}`;
}

// ── SUMMARY PAGE ──────────────────────────────────────────
function getAllBizTransactions(start, end) {
  const all = [];
  const savedBizId = currentBizId;
  businesses.forEach(b => {
    const key = 'acc_transactions__' + b.id;
    try {
      const txs = JSON.parse(localStorage.getItem(key) || '[]');
      txs.filter(t => t.date >= start && t.date <= end)
         .forEach(t => all.push({ ...t, _bizName: b.name }));
    } catch {}
  });
  return all;
}

function renderSummary(el) {
  const { start, end } = getSummaryRange();
  const srcTx = summaryAllBiz ? getAllBizTransactions(start, end) : transactions.filter(t => t.date >= start && t.date <= end);

  const periodFilterHTML = buildSummaryPeriodFilter();
  const bizName = businesses.find(b => b.id === currentBizId)?.name || '';

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">집계</div>
        <div class="page-subtitle">${summaryAllBiz ? '전체 사업체 합산' : bizName}</div>
      </div>
      ${businesses.length > 1 ? `
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-sm ${!summaryAllBiz?'btn-primary':'btn-ghost'}" onclick="summaryAllBiz=false;render('summary')">${bizName}</button>
        <button class="btn btn-sm ${summaryAllBiz?'btn-primary':'btn-ghost'}" onclick="summaryAllBiz=true;render('summary')">전체 합산</button>
      </div>` : ''}
    </div>

    ${periodFilterHTML}

    <div style="display:flex;gap:4px;margin-bottom:20px">
      <button class="period-btn ${summaryTab==='거래처별'?'active':''}" onclick="switchSummaryTab('거래처별')">🏢 거래처별 집계</button>
      <button class="period-btn ${summaryTab==='계정별'?'active':''}" onclick="switchSummaryTab('계정별')">📋 계정별 집계</button>
      <button class="period-btn ${summaryTab==='판매현황'?'active':''}" onclick="switchSummaryTab('판매현황')">📦 판매현황</button>
    </div>

    <div id="summary-content"></div>`;

  el.querySelectorAll('.sum-period-btn').forEach(btn => {
    btn.addEventListener('click', () => { summaryPeriod = btn.dataset.period; render('summary'); });
  });
  el.querySelector('#sum-apply')?.addEventListener('click', () => {
    summaryCustomFrom = el.querySelector('#sum-from').value;
    summaryCustomTo   = el.querySelector('#sum-to').value;
    if (summaryCustomFrom || summaryCustomTo) summaryPeriod = 'custom';
    render('summary');
  });

  const content = document.getElementById('summary-content');
  if (summaryTab === '거래처별')  renderVendorSummaryTab(content, srcTx);
  else if (summaryTab === '계정별') renderAccountSummaryTab(content, srcTx);
  else renderSalesStatusTab(content, srcTx);
}

function getSummaryRange() {
  const now = new Date();
  const str = d => d.toISOString().slice(0, 10);
  switch (summaryPeriod) {
    case 'today':     { const d = str(now); return { start: d, end: d }; }
    case 'yesterday': { const y = new Date(now); y.setDate(y.getDate()-1); const d = str(y); return { start: d, end: d }; }
    case 'month':     return { start: str(new Date(now.getFullYear(), now.getMonth(), 1)), end: str(new Date(now.getFullYear(), now.getMonth()+1, 0)) };
    case 'lastmonth': return { start: str(new Date(now.getFullYear(), now.getMonth()-1, 1)), end: str(new Date(now.getFullYear(), now.getMonth(), 0)) };
    case 'custom':    return { start: summaryCustomFrom || '0000-01-01', end: summaryCustomTo || '9999-12-31' };
    default:          return { start: '0000-01-01', end: '9999-12-31' };
  }
}

function buildSummaryPeriodFilter() {
  const PERIODS = [
    {key:'today',label:'오늘'},{key:'yesterday',label:'전일'},
    {key:'month',label:'이달'},{key:'lastmonth',label:'전달'},{key:'all',label:'전체'}
  ];
  return `<div class="period-filter-bar">
    ${PERIODS.map(p => `<button class="sum-period-btn period-btn ${summaryPeriod===p.key?'active':''}" data-period="${p.key}">${p.label}</button>`).join('')}
    <span class="period-divider">|</span>
    <input type="date" class="form-control" id="sum-from" value="${summaryCustomFrom}" style="width:140px">
    <span style="color:var(--gray-500)">~</span>
    <input type="date" class="form-control" id="sum-to" value="${summaryCustomTo}" style="width:140px">
    <button class="btn btn-ghost btn-sm" id="sum-apply">적용</button>
  </div>`;
}

function switchSummaryTab(tab) { summaryTab = tab; render('summary'); }

function renderVendorSummaryTab(el, filtered) {
  const src = summaryVendorFilter ? filtered.filter(t => t.type === summaryVendorFilter) : filtered;
  const byVendor = {};
  src.forEach(t => {
    const key = t.vendorId || '__etc__';
    const v   = vendors.find(v => v.id === t.vendorId);
    if (!byVendor[key]) byVendor[key] = {
      name: v ? v.companyName : '(기타)', vendorId: t.vendorId || '',
      sales: 0, salesUnpaid: 0, purchase: 0, purchasePaid: 0
    };
    const total = t.items.reduce((s, i) => s + i.amount + i.tax, 0);
    if (t.type === '매출') {
      byVendor[key].sales += total;
      if (!t.isPaid) byVendor[key].salesUnpaid += total;
    } else {
      byVendor[key].purchase += total;
      if (t.isPaid) byVendor[key].purchasePaid += total;
    }
  });

  let list = Object.values(byVendor);
  const sortFns = {
    'total_desc': (a,b) => (b.sales+b.purchase)-(a.sales+a.purchase),
    'total_asc':  (a,b) => (a.sales+a.purchase)-(b.sales+b.purchase),
    'sales_desc': (a,b) => b.sales-a.sales,
    'sales_asc':  (a,b) => a.sales-b.sales,
    'purch_desc': (a,b) => b.purchase-a.purchase,
    'purch_asc':  (a,b) => a.purchase-b.purchase,
    'name_asc':   (a,b) => a.name.localeCompare(b.name, 'ko'),
    'name_desc':  (a,b) => b.name.localeCompare(a.name, 'ko'),
  };
  list.sort(sortFns[summaryVendorSort] || sortFns['total_desc']);

  let totPurch=0, totPurchPaid=0, totSales=0, totSalesUnpaid=0;
  list.forEach(v=>{ totPurch+=v.purchase; totPurchPaid+=v.purchasePaid; totSales+=v.sales; totSalesUnpaid+=v.salesUnpaid; });

  const rows = list.map(v => {
    const nameCell = v.vendorId
      ? `<a class="vendor-link" onclick="openVendorDetail('${v.vendorId}')">${v.name}</a>`
      : v.name;
    return `<tr>
      <td style="text-align:right;color:var(--success)">${v.purchase ? fmt(v.purchase) : ''}</td>
      <td style="text-align:right;color:var(--danger)">${v.purchasePaid ? fmt(v.purchasePaid) : ''}</td>
      <td style="text-align:center">${nameCell}</td>
      <td style="text-align:right;color:var(--primary)">${v.sales ? fmt(v.sales) : ''}</td>
      <td style="text-align:right;color:var(--warning)">${v.salesUnpaid ? fmt(v.salesUnpaid) : ''}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">📭</div><p>해당 기간 거래 없음</p></div></td></tr>`;

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div class="summary-section-title" style="margin:0">
        거래처별 집계
        <span style="font-size:12px;font-weight:400;color:var(--gray-500);margin-left:8px">거래처명 클릭 → 상세보기</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select class="form-control" style="width:100px;padding:5px 8px;font-size:12.5px" onchange="summaryVendorFilter=this.value;render('summary')">
          <option value="" ${summaryVendorFilter===''?'selected':''}>전체</option>
          <option value="매출" ${summaryVendorFilter==='매출'?'selected':''}>매출만</option>
          <option value="매입" ${summaryVendorFilter==='매입'?'selected':''}>매입만</option>
        </select>
        <select class="form-control" style="width:150px;padding:5px 8px;font-size:12.5px" onchange="summaryVendorSort=this.value;render('summary')">
          <option value="total_desc" ${summaryVendorSort==='total_desc'?'selected':''}>합계 높은순</option>
          <option value="total_asc"  ${summaryVendorSort==='total_asc'?'selected':''}>합계 낮은순</option>
          <option value="sales_desc" ${summaryVendorSort==='sales_desc'?'selected':''}>매출 높은순</option>
          <option value="sales_asc"  ${summaryVendorSort==='sales_asc'?'selected':''}>매출 낮은순</option>
          <option value="purch_desc" ${summaryVendorSort==='purch_desc'?'selected':''}>매입 높은순</option>
          <option value="purch_asc"  ${summaryVendorSort==='purch_asc'?'selected':''}>매입 낮은순</option>
          <option value="name_asc"   ${summaryVendorSort==='name_asc'?'selected':''}>거래처명 가나다순</option>
          <option value="name_desc"  ${summaryVendorSort==='name_desc'?'selected':''}>거래처명 역순</option>
        </select>
        <button class="btn btn-ghost btn-sm" onclick="exportVendorSummaryXlsx()">⬇ 엑셀</button>
      </div>
    </div>
    <div class="table-wrapper">
      <table>
        <thead><tr>
          <th style="text-align:right;width:140px;color:var(--success)">매입</th>
          <th style="text-align:right;width:130px;color:var(--danger)">출돈 (결제)</th>
          <th style="text-align:center">거래처</th>
          <th style="text-align:right;width:140px;color:var(--primary)">매출</th>
          <th style="text-align:right;width:130px;color:var(--warning)">받을돈 (미수)</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="background:var(--gray-50);font-weight:700;border-top:2px solid var(--gray-200)">
          <td style="text-align:right;color:var(--success)">${fmt(totPurch)}</td>
          <td style="text-align:right;color:var(--danger)">${fmt(totPurchPaid)}</td>
          <td style="text-align:center">합 계</td>
          <td style="text-align:right;color:var(--primary)">${fmt(totSales)}</td>
          <td style="text-align:right;color:var(--warning)">${fmt(totSalesUnpaid)}</td>
        </tr></tfoot>
      </table>
    </div>`;
}

function exportVendorSummaryXlsx() {
  if (typeof XLSX === 'undefined') { alert('잠시 후 다시 시도해주세요 (라이브러리 로딩 중)'); return; }
  const { start, end } = getSummaryRange();
  const src = (summaryVendorFilter ? transactions.filter(t=>t.type===summaryVendorFilter) : transactions)
    .filter(t => t.date >= start && t.date <= end);
  const byVendor = {};
  src.forEach(t => {
    const key = t.vendorId || '__etc__';
    const v = vendors.find(v => v.id === t.vendorId);
    if (!byVendor[key]) byVendor[key] = { name: v?v.companyName:'(기타)', sales:0, salesUnpaid:0, purchase:0, purchasePaid:0 };
    const total = t.items.reduce((s,i)=>s+i.amount+i.tax,0);
    if (t.type==='매출') { byVendor[key].sales+=total; if(!t.isPaid) byVendor[key].salesUnpaid+=total; }
    else { byVendor[key].purchase+=total; if(t.isPaid) byVendor[key].purchasePaid+=total; }
  });
  const rows = [['거래처','매입','출돈(결제)','매출','받을돈(미수)']];
  Object.values(byVendor).forEach(v => rows.push([v.name, v.purchase, v.purchasePaid, v.sales, v.salesUnpaid]));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '거래처별집계');
  XLSX.writeFile(wb, `거래처별집계_${start}_${end}.xlsx`);
}

function renderSalesStatusTab(el, filtered) {
  let src = filtered;
  if (summarySalesType) src = src.filter(t => t.type === summarySalesType);
  if (summarySalesVendorId) src = src.filter(t => t.vendorId === summarySalesVendorId);

  const lineRows = [];
  src.forEach(t => {
    const v = vendors.find(v => v.id === t.vendorId);
    t.items.forEach(i => {
      lineRows.push({ date: t.date, type: t.type, vendor: v?v.companyName:'-',
        accountCategory: t.accountCategory||t.type, isPaid: t.isPaid,
        itemName: i.itemName, unit: i.unit||'', quantity: i.quantity,
        unitPrice: i.unitPrice, amount: i.amount, tax: i.tax });
    });
  });

  const sortFns = {
    'date_desc':  (a,b) => b.date.localeCompare(a.date),
    'date_asc':   (a,b) => a.date.localeCompare(b.date),
    'amt_desc':   (a,b) => (b.amount+b.tax)-(a.amount+a.tax),
    'amt_asc':    (a,b) => (a.amount+a.tax)-(b.amount+b.tax),
    'item_asc':   (a,b) => a.itemName.localeCompare(b.itemName, 'ko'),
    'item_desc':  (a,b) => b.itemName.localeCompare(a.itemName, 'ko'),
    'vendor_asc': (a,b) => a.vendor.localeCompare(b.vendor, 'ko'),
  };
  lineRows.sort(sortFns[summarySalesSort] || sortFns['date_desc']);

  let grandAmt=0, grandTax=0;
  lineRows.forEach(r=>{ grandAmt+=r.amount; grandTax+=r.tax; });

  const vendorOpts = vendors.map(v =>
    `<option value="${v.id}" ${summarySalesVendorId===v.id?'selected':''}>${v.companyName}</option>`
  ).join('');

  const rows = lineRows.map(r => {
    const typeBadge = r.type==='매출'
      ? '<span class="badge badge-sales">매출</span>'
      : '<span class="badge badge-purchase">매입</span>';
    const paidBadge = r.isPaid
      ? '<span class="badge" style="background:#f0fdf4;color:#16a34a">완료</span>'
      : (r.type==='매출'
        ? '<span class="badge" style="background:#fffbeb;color:#d97706">미수</span>'
        : '<span class="badge" style="background:#fef2f2;color:#dc2626">미지급</span>');
    return `<tr>
      <td>${r.date}</td>
      <td>${typeBadge}</td>
      <td style="font-size:11px;color:var(--gray-500)">${r.accountCategory}</td>
      <td>${r.vendor}</td>
      <td><strong>${r.itemName}</strong></td>
      <td style="text-align:center">${r.unit}</td>
      <td style="text-align:right">${fmt(r.quantity)}</td>
      <td style="text-align:right">${fmt(r.unitPrice)}원</td>
      <td style="text-align:right">${fmt(r.amount)}원</td>
      <td style="text-align:right;color:var(--gray-500)">${fmt(r.tax)}원</td>
      <td style="text-align:right"><strong>${fmt(r.amount+r.tax)}원</strong></td>
      <td>${paidBadge}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="12"><div class="empty-state"><div class="empty-icon">📦</div><p>해당 기간 거래 없음</p></div></td></tr>`;

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div class="summary-section-title" style="margin:0">판매현황 (품목별)</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select class="form-control" style="width:100px;padding:5px 8px;font-size:12.5px" onchange="summarySalesType=this.value;render('summary')">
          <option value="" ${summarySalesType===''?'selected':''}>전체</option>
          <option value="매출" ${summarySalesType==='매출'?'selected':''}>매출만</option>
          <option value="매입" ${summarySalesType==='매입'?'selected':''}>매입만</option>
        </select>
        <select class="form-control" style="width:130px;padding:5px 8px;font-size:12.5px" onchange="summarySalesVendorId=this.value;render('summary')">
          <option value="">거래처 전체</option>
          ${vendorOpts}
        </select>
        <select class="form-control" style="width:140px;padding:5px 8px;font-size:12.5px" onchange="summarySalesSort=this.value;render('summary')">
          <option value="date_desc"  ${summarySalesSort==='date_desc'?'selected':''}>날짜 최신순</option>
          <option value="date_asc"   ${summarySalesSort==='date_asc'?'selected':''}>날짜 오래된순</option>
          <option value="amt_desc"   ${summarySalesSort==='amt_desc'?'selected':''}>금액 높은순</option>
          <option value="amt_asc"    ${summarySalesSort==='amt_asc'?'selected':''}>금액 낮은순</option>
          <option value="item_asc"   ${summarySalesSort==='item_asc'?'selected':''}>품목명 가나다순</option>
          <option value="vendor_asc" ${summarySalesSort==='vendor_asc'?'selected':''}>거래처 가나다순</option>
        </select>
        <button class="btn btn-ghost btn-sm" onclick="exportSalesStatusXlsx()">⬇ 엑셀</button>
      </div>
    </div>
    <div style="font-size:12px;color:var(--gray-500);margin-bottom:10px">
      총 ${lineRows.length}건 · 공급가액 ${fmt(grandAmt)}원 · 세액 ${fmt(grandTax)}원 · 합계 <strong>${fmt(grandAmt+grandTax)}원</strong>
    </div>
    <div class="table-wrapper">
      <table>
        <thead><tr>
          <th>날짜</th><th>구분</th><th>계정과목</th><th>거래처</th>
          <th>품목명</th><th style="text-align:center">단위</th>
          <th style="text-align:right">수량</th><th style="text-align:right">단가</th>
          <th style="text-align:right">공급가액</th><th style="text-align:right">세액</th>
          <th style="text-align:right">합계</th><th>결제</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function exportSalesStatusXlsx() {
  if (typeof XLSX === 'undefined') { alert('잠시 후 다시 시도해주세요 (라이브러리 로딩 중)'); return; }
  const { start, end } = getSummaryRange();
  let src = transactions.filter(t => t.date >= start && t.date <= end);
  if (summarySalesType) src = src.filter(t => t.type === summarySalesType);
  if (summarySalesVendorId) src = src.filter(t => t.vendorId === summarySalesVendorId);
  const rows = [['날짜','구분','계정과목','거래처','품목명','단위','수량','단가','공급가액','세액','합계','결제']];
  src.forEach(t => {
    const v = vendors.find(v=>v.id===t.vendorId);
    t.items.forEach(i => rows.push([
      t.date, t.type, t.accountCategory||t.type, v?v.companyName:'-',
      i.itemName, i.unit||'', i.quantity, i.unitPrice, i.amount, i.tax, i.amount+i.tax,
      t.isPaid?'완료':(t.type==='매출'?'미수':'미지급')
    ]));
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '판매현황');
  XLSX.writeFile(wb, `판매현황_${start}_${end}.xlsx`);
}

function renderAccountSummaryTab(el, filtered) {
  const acMap = {};
  let totalSalesTax = 0, totalPurchTax = 0;
  let totalSalesAmt = 0, totalPurchAmt = 0;
  let unpaidSales = 0, unpaidPurch = 0;

  filtered.forEach(t => {
    const cat = t.accountCategory || t.type;
    if (!acMap[cat]) acMap[cat] = { type: t.type, count: 0, amt: 0, tax: 0, unpaid: 0 };
    const amt = t.items.reduce((s,i) => s+i.amount, 0);
    const tax = t.items.reduce((s,i) => s+i.tax, 0);
    acMap[cat].count++;
    acMap[cat].amt  += amt;
    acMap[cat].tax  += tax;
    if (!t.isPaid) acMap[cat].unpaid += amt + tax;

    if (t.type === '매출') { totalSalesTax += tax; totalSalesAmt += amt; if (!t.isPaid) unpaidSales += amt + tax; }
    else                   { totalPurchTax += tax; totalPurchAmt += amt; if (!t.isPaid) unpaidPurch  += amt + tax; }
  });

  const vatBalance = totalSalesTax - totalPurchTax;

  const acSortFn = {
    'amt_desc':   ([,a],[,b]) => (b.amt+b.tax)-(a.amt+a.tax),
    'amt_asc':    ([,a],[,b]) => (a.amt+a.tax)-(b.amt+b.tax),
    'count_desc': ([,a],[,b]) => b.count-a.count,
    'count_asc':  ([,a],[,b]) => a.count-b.count,
    'name_asc':   ([a],[b])   => a.localeCompare(b,'ko'),
  };
  const sfn = acSortFn[summaryAccountSort] || acSortFn['amt_desc'];

  const salesCats = Object.entries(acMap).filter(([,v]) => v.type==='매출').sort(sfn);
  const purchCats = Object.entries(acMap).filter(([,v]) => v.type==='매입').sort(sfn);

  const makeRows = (cats, colorClass) => cats.map(([cat, d]) => `<tr>
    <td><strong>${cat}</strong></td>
    <td style="text-align:center">${d.count}건</td>
    <td style="text-align:right">${fmt(d.amt)}원</td>
    <td style="text-align:right;color:var(--gray-500)">${fmt(d.tax)}원</td>
    <td style="text-align:right" class="${colorClass}">${fmt(d.amt+d.tax)}원</td>
    <td style="text-align:right;color:var(--danger)">${d.unpaid ? fmt(d.unpaid)+'원' : '-'}</td>
  </tr>`).join('');

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:flex-end;margin-bottom:12px;gap:8px">
      <select class="form-control" style="width:150px;padding:5px 8px;font-size:12.5px" onchange="summaryAccountSort=this.value;render('summary')">
        <option value="amt_desc"   ${summaryAccountSort==='amt_desc'?'selected':''}>금액 높은순</option>
        <option value="amt_asc"    ${summaryAccountSort==='amt_asc'?'selected':''}>금액 낮은순</option>
        <option value="count_desc" ${summaryAccountSort==='count_desc'?'selected':''}>건수 많은순</option>
        <option value="count_asc"  ${summaryAccountSort==='count_asc'?'selected':''}>건수 적은순</option>
        <option value="name_asc"   ${summaryAccountSort==='name_asc'?'selected':''}>계정명 가나다순</option>
      </select>
      <button class="btn btn-ghost btn-sm" onclick="exportAccountSummaryXlsx()">⬇ 엑셀</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px">
      <div class="card">
        <div class="card-title">매출 공급가액</div>
        <div class="card-value positive">${fmt(totalSalesAmt)}원</div>
      </div>
      <div class="card">
        <div class="card-title">매입 공급가액</div>
        <div class="card-value success">${fmt(totalPurchAmt)}원</div>
      </div>
      <div class="card">
        <div class="card-title">순이익</div>
        <div class="card-value ${totalSalesAmt-totalPurchAmt>=0?'positive':'negative'}">${fmt(totalSalesAmt-totalPurchAmt)}원</div>
      </div>
      <div class="card" style="border-left:3px solid var(--primary)">
        <div class="card-title">부가세 예수금 (매출세액)</div>
        <div class="card-value" style="color:var(--primary)">${fmt(totalSalesTax)}원</div>
      </div>
      <div class="card" style="border-left:3px solid var(--success)">
        <div class="card-title">부가세 대급금 (매입세액)</div>
        <div class="card-value" style="color:var(--success)">${fmt(totalPurchTax)}원</div>
      </div>
      <div class="card" style="border-left:3px solid ${vatBalance>=0?'var(--warning)':'var(--success)'}">
        <div class="card-title">납부할 부가세 (예수금 − 대급금)</div>
        <div class="card-value" style="color:${vatBalance>=0?'var(--warning)':'var(--success)'}">${vatBalance>=0?'':'환급 '}${fmt(Math.abs(vatBalance))}원</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
      <div>
        <div class="summary-section-title">매출 계정</div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>계정과목</th><th style="text-align:center">건수</th><th style="text-align:right">공급가액</th><th style="text-align:right">세액</th><th style="text-align:right">합계</th><th style="text-align:right">미수금</th></tr></thead>
            <tbody>
              ${makeRows(salesCats, 'amount-sales')}
              ${salesCats.length===0 ? `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--gray-500)">거래 없음</td></tr>` : ''}
              ${salesCats.length > 0 ? `<tr style="background:var(--gray-50);font-weight:700;border-top:2px solid var(--gray-200)">
                <td>합계</td><td></td>
                <td style="text-align:right;color:var(--primary)">${fmt(totalSalesAmt)}원</td>
                <td style="text-align:right;color:var(--gray-500)">${fmt(totalSalesTax)}원</td>
                <td style="text-align:right;color:var(--primary)">${fmt(totalSalesAmt+totalSalesTax)}원</td>
                <td style="text-align:right;color:var(--danger)">${unpaidSales?fmt(unpaidSales)+'원':'-'}</td>
              </tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <div class="summary-section-title">매입 계정</div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>계정과목</th><th style="text-align:center">건수</th><th style="text-align:right">공급가액</th><th style="text-align:right">세액</th><th style="text-align:right">합계</th><th style="text-align:right">미지급</th></tr></thead>
            <tbody>
              ${makeRows(purchCats, 'amount-purchase')}
              ${purchCats.length===0 ? `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--gray-500)">거래 없음</td></tr>` : ''}
              ${purchCats.length > 0 ? `<tr style="background:var(--gray-50);font-weight:700;border-top:2px solid var(--gray-200)">
                <td>합계</td><td></td>
                <td style="text-align:right;color:var(--success)">${fmt(totalPurchAmt)}원</td>
                <td style="text-align:right;color:var(--gray-500)">${fmt(totalPurchTax)}원</td>
                <td style="text-align:right;color:var(--success)">${fmt(totalPurchAmt+totalPurchTax)}원</td>
                <td style="text-align:right;color:var(--danger)">${unpaidPurch?fmt(unpaidPurch)+'원':'-'}</td>
              </tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function exportAccountSummaryXlsx() {
  if (typeof XLSX === 'undefined') { alert('잠시 후 다시 시도해주세요 (라이브러리 로딩 중)'); return; }
  const { start, end } = getSummaryRange();
  const filtered = transactions.filter(t => t.date >= start && t.date <= end);
  const acMap = {};
  filtered.forEach(t => {
    const cat = t.accountCategory || t.type;
    if (!acMap[cat]) acMap[cat] = { type: t.type, count: 0, amt: 0, tax: 0, unpaid: 0 };
    const amt = t.items.reduce((s,i)=>s+i.amount,0);
    const tax = t.items.reduce((s,i)=>s+i.tax,0);
    acMap[cat].count++; acMap[cat].amt+=amt; acMap[cat].tax+=tax;
    if (!t.isPaid) acMap[cat].unpaid+=amt+tax;
  });
  const rows = [['구분','계정과목','건수','공급가액','세액','합계','미수/미지급']];
  Object.entries(acMap).forEach(([cat,d]) =>
    rows.push([d.type, cat, d.count, d.amt, d.tax, d.amt+d.tax, d.unpaid||0])
  );
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '계정별집계');
  XLSX.writeFile(wb, `계정별집계_${start}_${end}.xlsx`);
}

function buildMonthlyReport() {
  const now    = new Date();
  const curM   = now.getMonth() + 1;
  const curY   = now.getFullYear();

  // 보유 연도 목록 (데이터가 있는 연도 + 현재 연도)
  const years = [...new Set([curY, ...transactions.map(t => Number(t.date.slice(0,4)))])].sort((a,b) => b-a);

  const monthlyData = Array.from({length: 12}, (_, m) => {
    const prefix   = `${currentReportYear}-${String(m+1).padStart(2,'0')}`;
    const monthTxs = transactions.filter(t => t.date.startsWith(prefix));
    const salesTxs = monthTxs.filter(t => t.type === '매출');
    const purchTxs = monthTxs.filter(t => t.type === '매입');
    const salesAmt = salesTxs.reduce((s,t) => s + t.items.reduce((a,i) => a+i.amount+i.tax, 0), 0);
    const purchAmt = purchTxs.reduce((s,t) => s + t.items.reduce((a,i) => a+i.amount+i.tax, 0), 0);
    const unpaidS  = salesTxs.filter(t => !t.isPaid).reduce((s,t) => s + t.items.reduce((a,i) => a+i.amount+i.tax, 0), 0);
    const unpaidP  = purchTxs.filter(t => !t.isPaid).reduce((s,t) => s + t.items.reduce((a,i) => a+i.amount+i.tax, 0), 0);
    return { month: m+1, salesCount: salesTxs.length, salesAmt, purchCount: purchTxs.length, purchAmt, unpaidS, unpaidP };
  });

  const grandSales  = monthlyData.reduce((s,d) => s+d.salesAmt, 0);
  const grandPurch  = monthlyData.reduce((s,d) => s+d.purchAmt, 0);
  const grandProfit = grandSales - grandPurch;
  const grandUS     = monthlyData.reduce((s,d) => s+d.unpaidS, 0);
  const grandUP     = monthlyData.reduce((s,d) => s+d.unpaidP, 0);

  const monthRows = monthlyData.map(d => {
    const profit    = d.salesAmt - d.purchAmt;
    const isCurrent = d.month === curM && currentReportYear === curY;
    const hasData   = d.salesAmt > 0 || d.purchAmt > 0;
    const dimStyle  = hasData ? '' : 'color:var(--gray-300)';
    const rowBg     = isCurrent ? 'background:var(--primary-light);' : '';
    return `<tr style="${rowBg}${dimStyle}">
      <td style="text-align:center;font-weight:${isCurrent?700:400}">${d.month}월${isCurrent ? ' <span style="color:var(--primary);font-size:10px">●</span>' : ''}</td>
      <td style="text-align:center">${d.salesCount || '-'}</td>
      <td style="text-align:right;color:${d.salesAmt?'var(--primary)':'inherit'}">${d.salesAmt ? fmt(d.salesAmt)+'원' : '-'}</td>
      <td style="text-align:center">${d.purchCount || '-'}</td>
      <td style="text-align:right;color:${d.purchAmt?'var(--success)':'inherit'}">${d.purchAmt ? fmt(d.purchAmt)+'원' : '-'}</td>
      <td style="text-align:right;font-weight:${hasData?600:400};color:${hasData?(profit>=0?'var(--primary)':'var(--danger)'):'inherit'}">${hasData ? fmt(Math.abs(profit))+(profit<0?'<span style="font-size:10px"> 적자</span>':'') + '원' : '-'}</td>
      <td style="text-align:right;color:${d.unpaidS?'var(--warning)':'inherit'}">${d.unpaidS ? fmt(d.unpaidS)+'원' : '-'}</td>
      <td style="text-align:right;color:${d.unpaidP?'var(--danger)':'inherit'}">${d.unpaidP ? fmt(d.unpaidP)+'원' : '-'}</td>
    </tr>`;
  }).join('');

  const yearBtns = years.map(y =>
    `<button class="period-btn ${currentReportYear===y?'active':''}" onclick="changeReportYear(${y})">${y}년</button>`
  ).join('');

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div class="summary-section-title" style="margin:0">월별 손익 보고서</div>
      <div style="display:flex;align-items:center;gap:6px">
        ${yearBtns}
      </div>
    </div>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th style="text-align:center;width:60px">월</th>
            <th style="text-align:center">매출건수</th>
            <th style="text-align:right">매출합계</th>
            <th style="text-align:center">매입건수</th>
            <th style="text-align:right">매입합계</th>
            <th style="text-align:right">순이익</th>
            <th style="text-align:right">미수금</th>
            <th style="text-align:right">미지급금</th>
          </tr>
        </thead>
        <tbody>
          ${monthRows}
          <tr style="background:var(--gray-50);font-weight:700;border-top:2px solid var(--gray-200)">
            <td style="text-align:center">합계</td>
            <td></td>
            <td style="text-align:right;color:var(--primary)">${fmt(grandSales)}원</td>
            <td></td>
            <td style="text-align:right;color:var(--success)">${fmt(grandPurch)}원</td>
            <td style="text-align:right;color:${grandProfit>=0?'var(--primary)':'var(--danger)'}">${fmt(Math.abs(grandProfit))}원${grandProfit<0?' <span style="font-size:10px">적자</span>':''}</td>
            <td style="text-align:right;color:var(--warning)">${grandUS ? fmt(grandUS)+'원' : '-'}</td>
            <td style="text-align:right;color:var(--danger)">${grandUP ? fmt(grandUP)+'원' : '-'}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

function changeReportYear(year) {
  currentReportYear = year;
  render('home');
}

// ── VENDOR DETAIL MODAL ───────────────────────────────────
let currentDetailVendorId = null;

function openVendorDetail(vendorId) {
  currentDetailVendorId = vendorId;
  const vendor = vendors.find(v => v.id === vendorId);
  const { start, end } = getPeriodRange(currentPeriod);

  const vendorTxs = transactions
    .filter(t => t.vendorId === vendorId && t.date >= start && t.date <= end)
    .sort((a, b) => b.date.localeCompare(a.date));

  const totalSales    = vendorTxs.filter(t => t.type === '매출').reduce((s,t) => s + t.items.reduce((a,i) => a+i.amount+i.tax, 0), 0);
  const totalPurchase = vendorTxs.filter(t => t.type === '매입').reduce((s,t) => s + t.items.reduce((a,i) => a+i.amount+i.tax, 0), 0);
  const unpaidS = vendorTxs.filter(t => t.type === '매출' && !t.isPaid).reduce((s,t) => s + t.items.reduce((a,i) => a+i.amount+i.tax,0), 0);
  const unpaidP = vendorTxs.filter(t => t.type === '매입' && !t.isPaid).reduce((s,t) => s + t.items.reduce((a,i) => a+i.amount+i.tax,0), 0);
  const diff = totalSales - totalPurchase;

  const rows = vendorTxs.map(t => {
    const amt = t.items.reduce((s,i) => s+i.amount, 0);
    const tax = t.items.reduce((s,i) => s+i.tax, 0);
    const summary = t.items.length > 1 ? `${t.items[0].itemName} 외 ${t.items.length-1}건` : (t.items[0]?.itemName || '-');
    const paidBadge = t.isPaid
      ? `<span class="badge" style="background:#f0fdf4;color:#16a34a">결제완료</span>${t.paidAt ? `<br><span style="font-size:11px;color:var(--gray-500)">${t.paidAt}</span>` : ''}`
      : (t.type === '매출'
          ? `<span class="badge" style="background:#fffbeb;color:#d97706">미수금</span>`
          : `<span class="badge" style="background:#fef2f2;color:#dc2626">미지급</span>`);
    const markBtn = !t.isPaid
      ? `<button class="btn btn-ghost btn-sm" style="margin-top:4px;padding:2px 8px" onclick="openMarkPaidModal('${t.id}')">결제처리</button>`
      : '';
    return `<tr>
      <td style="text-align:center"><input type="checkbox" class="tx-checkbox" value="${t.id}" checked></td>
      <td>${t.date}</td>
      <td>${t.type === '매출' ? '<span class="badge badge-sales">매출</span>' : '<span class="badge badge-purchase">매입</span>'}</td>
      <td>${summary}</td>
      <td style="text-align:right">${fmt(amt)}원</td>
      <td style="text-align:right">${fmt(tax)}원</td>
      <td style="text-align:right"><strong>${fmt(amt+tax)}원</strong></td>
      <td style="text-align:center">${paidBadge}${markBtn}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="8"><div class="empty-state" style="padding:24px"><div class="empty-icon">📭</div><p>해당 기간 거래 없음</p></div></td></tr>`;

  const periodStr = currentPeriod === 'custom'
    ? `${customDateFrom || '전체'} ~ ${customDateTo || '전체'}`
    : periodLabel(currentPeriod);

  const html = `
    <input type="hidden" id="detail-vendor-id" value="${vendorId}">
    <p style="font-size:12px;color:var(--gray-500);margin-bottom:14px">기간: ${periodStr}</p>

    <div class="detail-stats">
      <div class="detail-stat-card"><div class="card-title">매출합계</div><div class="card-value positive">${fmt(totalSales)}원</div></div>
      <div class="detail-stat-card"><div class="card-title">매입합계</div><div class="card-value success">${fmt(totalPurchase)}원</div></div>
      <div class="detail-stat-card"><div class="card-title">손익</div><div class="card-value ${diff>=0?'positive':'negative'}">${fmt(diff)}원</div></div>
      ${unpaidS > 0 ? `<div class="detail-stat-card" style="border-left:3px solid var(--warning)"><div class="card-title">미수금</div><div class="card-value" style="color:var(--warning)">${fmt(unpaidS)}원</div></div>` : ''}
      ${unpaidP > 0 ? `<div class="detail-stat-card" style="border-left:3px solid var(--danger)"><div class="card-title">미지급금</div><div class="card-value negative">${fmt(unpaidP)}원</div></div>` : ''}
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
        <input type="checkbox" id="select-all-tx" checked onchange="toggleAllTx(this)">
        전체 선택 (<span id="checked-count">${vendorTxs.length}</span>건 선택됨)
      </label>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" onclick="downloadStatementFromModal()">🖨 거래명세서 (PDF)</button>
        <button class="btn btn-success btn-sm" onclick="downloadExcelFromModal()">📊 엑셀 다운로드</button>
      </div>
    </div>

    <div class="items-table-wrap" style="max-height:320px;overflow-y:auto">
      <table>
        <thead>
          <tr>
            <th style="width:36px">선택</th>
            <th>날짜</th><th>구분</th><th>품목</th>
            <th style="text-align:right">공급가액</th>
            <th style="text-align:right">세액</th>
            <th style="text-align:right">합계</th>
            <th style="width:110px">결제 상태</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">닫기</button>
    </div>`;

  openModal(`${vendor ? vendor.companyName : ''} — 거래 상세`, html, true);

  setTimeout(() => {
    document.querySelectorAll('.tx-checkbox').forEach(cb => {
      cb.addEventListener('change', updateCheckedCount);
    });
  }, 0);
}

function toggleAllTx(masterCb) {
  document.querySelectorAll('.tx-checkbox').forEach(cb => cb.checked = masterCb.checked);
  updateCheckedCount();
}
function updateCheckedCount() {
  const cnt = document.querySelectorAll('.tx-checkbox:checked').length;
  const el  = document.getElementById('checked-count');
  if (el) el.textContent = cnt;
}

// ── MARK PAID ─────────────────────────────────────────────
function openMarkPaidModal(txId) {
  const tx = transactions.find(t => t.id === txId);
  if (!tx) return;
  const v = vendors.find(v => v.id === tx.vendorId);
  const amt = tx.items.reduce((s,i) => s+i.amount+i.tax, 0);

  const html = `
    <div style="background:var(--gray-50);border-radius:var(--radius);padding:12px 16px;margin-bottom:18px;font-size:13px">
      <div><strong>${tx.date}</strong> · ${tx.type} · ${v ? v.companyName : '-'}</div>
      <div style="font-size:15px;font-weight:700;margin-top:4px;color:var(--primary)">${fmt(amt)}원</div>
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label>결제일 *</label>
        <input id="paid-date" class="form-control" type="date" value="${today()}">
      </div>
      <div class="form-group">
        <label>결제방법</label>
        <select id="paid-method" class="form-control">
          <option value="현금">현금</option>
          <option value="계좌이체">계좌이체</option>
          <option value="카드">카드</option>
          <option value="어음">어음</option>
          <option value="기타">기타</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="openVendorDetail('${currentDetailVendorId}')">취소</button>
      <button class="btn btn-primary" onclick="confirmPaid('${txId}')">결제 처리 완료</button>
    </div>`;

  openModal('결제 처리', html);
}

function confirmPaid(txId) {
  const paidAt     = document.getElementById('paid-date').value;
  const paidMethod = document.getElementById('paid-method').value;
  if (!paidAt) { alert('결제일을 입력하세요.'); return; }
  const idx = transactions.findIndex(t => t.id === txId);
  if (idx !== -1) {
    transactions[idx].isPaid      = true;
    transactions[idx].paidAt      = paidAt;
    transactions[idx].paidMethod  = paidMethod;
    saveTransactions();
  }
  if (currentDetailVendorId) {
    openVendorDetail(currentDetailVendorId);
  } else {
    closeModal();
    render(currentPage);
  }
}

// 한 번에 결제완료 (오늘 날짜, 기존 결제방법)
function quickPaid(txId) {
  const idx = transactions.findIndex(t => t.id === txId);
  if (idx === -1) return;
  const t = transactions[idx];
  if (!confirm(`${t.date} · ${t.type} 거래를 오늘(${today()}) 결제완료 처리하시겠습니까?`)) return;
  transactions[idx].isPaid     = true;
  transactions[idx].paidAt     = today();
  transactions[idx].paidMethod = t.paymentMethod || '현금';
  saveTransactions();
  render(currentPage);
}

// 단일 거래 명세서 PDF
function printTxStatement(txId) {
  const t = transactions.find(t => t.id === txId);
  if (!t) return;
  const vendor = vendors.find(v => v.id === t.vendorId);
  const win = window.open('', '_blank', 'width=900,height=750');
  win.document.write(generateStatementHTML([t], vendor));
  win.document.close();
}

// 거래 내역 페이지에서 직접 결제처리
function markPaidFromList(txId) {
  currentDetailVendorId = null;
  const tx = transactions.find(t => t.id === txId);
  if (!tx) return;
  const v   = vendors.find(v => v.id === tx.vendorId);
  const amt = tx.items.reduce((s,i) => s+i.amount+i.tax, 0);

  const html = `
    <div style="background:var(--gray-50);border-radius:var(--radius);padding:12px 16px;margin-bottom:18px;font-size:13px">
      <div><strong>${tx.date}</strong> · ${tx.type} · ${v ? v.companyName : '-'}</div>
      <div style="font-size:15px;font-weight:700;margin-top:4px;color:var(--primary)">${fmt(amt)}원</div>
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label>결제일 *</label>
        <input id="paid-date" class="form-control" type="date" value="${today()}">
      </div>
      <div class="form-group">
        <label>결제방법</label>
        <select id="paid-method" class="form-control">
          <option value="현금">현금</option>
          <option value="계좌이체">계좌이체</option>
          <option value="카드">카드</option>
          <option value="어음">어음</option>
          <option value="기타">기타</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">취소</button>
      <button class="btn btn-primary" onclick="confirmPaid('${txId}')">결제 처리 완료</button>
    </div>`;

  openModal('결제 처리', html);
}

// ── STATEMENT / EXCEL ─────────────────────────────────────
function downloadStatementFromModal() {
  const vendorId = document.getElementById('detail-vendor-id').value;
  const checked  = [...document.querySelectorAll('.tx-checkbox:checked')].map(cb => cb.value);
  if (!checked.length) { alert('거래를 선택하세요.'); return; }
  downloadStatement(checked, vendorId);
}

function downloadExcelFromModal() {
  const vendorId = document.getElementById('detail-vendor-id').value;
  const checked  = [...document.querySelectorAll('.tx-checkbox:checked')].map(cb => cb.value);
  if (!checked.length) { alert('거래를 선택하세요.'); return; }
  downloadExcel(checked, vendorId);
}

function downloadStatement(txIds, vendorId) {
  const vendor      = vendors.find(v => v.id === vendorId);
  const selectedTxs = txIds.map(id => transactions.find(t => t.id === id)).filter(Boolean).sort((a,b) => a.date.localeCompare(b.date));
  const win = window.open('', '_blank', 'width=900,height=750');
  win.document.write(generateStatementHTML(selectedTxs, vendor));
  win.document.close();
}

function generateStatementHTML(txs, vendor) {
  let rows = '', grandAmt = 0, grandTax = 0;
  txs.forEach(t => {
    t.items.forEach(i => {
      grandAmt += i.amount; grandTax += i.tax;
      rows += `<tr>
        <td>${t.date}</td>
        <td style="text-align:left;padding-left:8px">${i.itemName}</td>
        <td>${i.unit||''}</td>
        <td style="text-align:right">${fmt(i.quantity)}</td>
        <td style="text-align:right">${fmt(i.unitPrice)}</td>
        <td style="text-align:right">${fmt(i.amount)}</td>
        <td style="text-align:right">${fmt(i.tax)}</td>
        <td style="text-align:right">${fmt(i.amount+i.tax)}</td>
        <td>${i.notes||''}</td>
      </tr>`;
    });
  });
  const ci = companyInfo;
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>거래명세서</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'맑은 고딕','맑은고딕',sans-serif;font-size:12px;padding:20px;color:#111}
@media print{@page{size:A4;margin:12mm}.no-print{display:none!important}body{padding:0}}
.no-print{text-align:center;margin-bottom:16px}
.print-btn{padding:8px 28px;background:#2563eb;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer}
.doc-title{text-align:center;font-size:22px;font-weight:700;letter-spacing:10px;margin-bottom:16px;padding-bottom:10px;border-bottom:3px double #333}
.meta{display:flex;justify-content:flex-end;gap:20px;font-size:11px;margin-bottom:12px;color:#555}
.header-wrap{display:flex;gap:8px;margin-bottom:14px}
.header-box{flex:1;border:1px solid #555;padding:10px 12px}
.hbox-title{font-weight:700;border-bottom:1px solid #888;padding-bottom:5px;margin-bottom:7px}
.hrow{display:flex;margin-bottom:3px;font-size:11px}
.hlabel{font-weight:600;width:76px;flex-shrink:0;color:#444}
table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:11px}
th{background:#f0f0f0;border:1px solid #666;padding:5px 4px;text-align:center;font-weight:600}
td{border:1px solid #aaa;padding:4px;text-align:center}
.total-row td{background:#f5f5f5;font-weight:700;border-color:#666}
.summary{border:1px solid #555;padding:10px 16px;margin-top:10px}
.srow{display:flex;justify-content:space-between;margin-bottom:3px;font-size:12px}
.srow.grand{font-size:14px;font-weight:700;border-top:1px solid #555;padding-top:6px;margin-top:6px}
.stamp{text-align:right;margin-top:18px}
.stamp-box{display:inline-block;border:1px solid #888;padding:8px 24px;text-align:center;line-height:1.6;font-size:11px}
</style></head><body>
<div class="no-print"><button class="print-btn" onclick="window.print()">🖨️ 인쇄 / PDF 저장</button></div>
<div class="doc-title">거 래 명 세 서</div>
<div class="meta"><span>발행일: ${today()}</span></div>
<div class="header-wrap">
  <div class="header-box">
    <div class="hbox-title">◼ 공급받는 자 (거래처)</div>
    <div class="hrow"><span class="hlabel">상호</span><span>${vendor?vendor.companyName:''}</span></div>
    <div class="hrow"><span class="hlabel">대표자</span><span>${vendor?(vendor.representative||''):''}</span></div>
    <div class="hrow"><span class="hlabel">사업자번호</span><span>${vendor?(vendor.businessNumber||''):''}</span></div>
    <div class="hrow"><span class="hlabel">주소</span><span>${vendor?(vendor.address||''):''}</span></div>
  </div>
  <div class="header-box">
    <div class="hbox-title">◼ 공급자 (발행)</div>
    <div class="hrow"><span class="hlabel">상호</span><span>${ci.name||''}</span></div>
    <div class="hrow"><span class="hlabel">대표자</span><span>${ci.representative||''}</span></div>
    <div class="hrow"><span class="hlabel">사업자번호</span><span>${ci.businessNumber||''}</span></div>
    <div class="hrow"><span class="hlabel">주소</span><span>${ci.address||''}</span></div>
    <div class="hrow"><span class="hlabel">연락처</span><span>${ci.tel||''}</span></div>
  </div>
</div>
<table>
  <thead><tr><th style="width:72px">날짜</th><th>품목명</th><th style="width:44px">단위</th><th style="width:44px">수량</th><th style="width:70px">단가</th><th style="width:80px">공급가액</th><th style="width:70px">세액</th><th style="width:84px">합계금액</th><th style="width:70px">비고</th></tr></thead>
  <tbody>${rows}
  <tr class="total-row"><td colspan="5" style="text-align:right">합 계</td><td style="text-align:right">${fmt(grandAmt)}</td><td style="text-align:right">${fmt(grandTax)}</td><td style="text-align:right">${fmt(grandAmt+grandTax)}</td><td></td></tr>
  </tbody>
</table>
<div class="summary">
  <div class="srow"><span>공급가액 합계</span><span>${fmt(grandAmt)}원</span></div>
  <div class="srow"><span>세액 합계 (VAT 10%)</span><span>${fmt(grandTax)}원</span></div>
  <div class="srow grand"><span>합 계 금 액</span><span>${fmt(grandAmt+grandTax)}원</span></div>
</div>
<div class="stamp"><div class="stamp-box"><div>${ci.name||'(공급자)'}</div><div>대표자: ${ci.representative||''} (인)</div></div></div>
</body></html>`;
}

function downloadExcel(txIds, vendorId) {
  if (typeof XLSX === 'undefined') { alert('엑셀 라이브러리 로딩 중입니다. 잠시 후 다시 시도해주세요.'); return; }
  const vendor      = vendors.find(v => v.id === vendorId);
  const vendorName  = vendor ? vendor.companyName : '거래처';
  const selectedTxs = txIds.map(id => transactions.find(t => t.id === id)).filter(Boolean).sort((a,b) => a.date.localeCompare(b.date));

  const wb   = XLSX.utils.book_new();
  const rows = [['거래명세서'], [`거래처: ${vendorName}`, '', '', '', '', `발행일: ${today()}`], [],
    ['날짜','구분','품목명','단위','수량','단가','공급가액','세액(10%)','합계금액','결제방법','결제상태','결제일','비고']];
  let gAmt = 0, gTax = 0;
  selectedTxs.forEach(t => {
    t.items.forEach(i => {
      rows.push([t.date, t.type, i.itemName, i.unit||'', i.quantity, i.unitPrice, i.amount, i.tax, i.amount+i.tax,
        t.paymentMethod||'', t.isPaid ? '결제완료' : (t.type==='매출'?'미수금':'미지급'), t.paidAt||'', i.notes||'']);
      gAmt += i.amount; gTax += i.tax;
    });
  });
  rows.push([], ['','','','','','합 계', gAmt, gTax, gAmt+gTax, '', '', '', '']);

  const ws1 = XLSX.utils.aoa_to_sheet(rows);
  ws1['!cols'] = [{wch:12},{wch:6},{wch:20},{wch:6},{wch:6},{wch:10},{wch:12},{wch:12},{wch:12},{wch:10},{wch:10},{wch:12},{wch:16}];
  XLSX.utils.book_append_sheet(wb, ws1, '거래명세서');

  XLSX.writeFile(wb, `거래명세서_${vendorName}_${today().replace(/-/g,'')}.xlsx`);
}

// ── COMPANY SETTINGS ──────────────────────────────────────
function openCompanySettings() {
  const ci = companyInfo;
  const html = `
    <div class="form-grid">
      <div class="form-group"><label>회사명 (상호)</label><input id="cs-name" class="form-control" value="${ci.name||''}" placeholder="(주)나의회사"></div>
      <div class="form-group"><label>대표자</label><input id="cs-rep" class="form-control" value="${ci.representative||''}"></div>
      <div class="form-group"><label>사업자번호</label><input id="cs-biz" class="form-control" value="${ci.businessNumber||''}" placeholder="000-00-00000"></div>
      <div class="form-group"><label>연락처</label><input id="cs-tel" class="form-control" value="${ci.tel||''}" placeholder="02-0000-0000"></div>
      <div class="form-group full"><label>주소</label><input id="cs-addr" class="form-control" value="${ci.address||''}"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">취소</button>
      <button class="btn btn-primary" onclick="saveCompanyInfoFromModal()">저장</button>
    </div>`;
  openModal('내 회사 정보 설정', html);
}
function saveCompanyInfoFromModal() {
  companyInfo = {
    name:           document.getElementById('cs-name').value.trim(),
    representative: document.getElementById('cs-rep').value.trim(),
    businessNumber: document.getElementById('cs-biz').value.trim(),
    tel:            document.getElementById('cs-tel').value.trim(),
    address:        document.getElementById('cs-addr').value.trim()
  };
  saveCompanyInfo();
  closeModal();
}

// ── VENDORS PAGE ──────────────────────────────────────────
let vendorSearch = '';

function renderVendors(el) {
  const filtered = vendors.filter(v =>
    v.companyName.includes(vendorSearch) || (v.businessNumber||'').includes(vendorSearch) || (v.representative||'').includes(vendorSearch)
  );
  const rows = filtered.map(v => `<tr>
    <td style="text-align:center;width:36px"><input type="checkbox" class="sel-cb tx-checkbox" data-page="vendors" value="${v.id}" ${_sel.vendors.has(v.id)?'checked':''} onchange="toggleSel('vendors','${v.id}')"></td>
    <td>${v.companyName}</td><td>${v.representative||'-'}</td><td>${v.businessNumber||'-'}</td>
    <td>${v.address||'-'}</td><td>${v.email||'-'}</td>
    <td>${v.accountType==='매출'?'<span class="badge badge-sales">매출</span>':v.accountType==='매입'?'<span class="badge badge-purchase">매입</span>':'<span class="badge badge-both">매출+매입</span>'}</td>
    <td><div class="td-actions">
      <button class="btn btn-ghost btn-sm" onclick="editVendor('${v.id}')">수정</button>
      <button class="btn btn-danger btn-sm" onclick="deleteVendor('${v.id}')">삭제</button>
    </div></td>
  </tr>`).join('') || `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">🏢</div><p>등록된 거래처가 없습니다</p></div></td></tr>`;

  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">거래처 관리</div><div class="page-subtitle">거래처 목록 (${vendors.length}개)</div></div>
      <div style="display:flex;gap:8px">
        <button id="sel-del-vendors" class="btn btn-danger btn-sm" style="display:none" onclick="deleteSelected('vendors')">선택 삭제</button>
        <label class="btn btn-ghost" style="cursor:pointer">
          📂 엑셀 업로드
          <input type="file" accept=".xlsx,.xls" style="display:none" onchange="uploadVendorsExcel(this)">
        </label>
        <button class="btn btn-ghost" onclick="downloadVendorListExcel()">📊 엑셀 다운로드</button>
        <button class="btn btn-primary" onclick="openVendorModal()">+ 거래처 등록</button>
      </div>
    </div>
    <div class="filter-bar"><input class="search-input form-control" id="vendor-search" placeholder="상호명 / 사업자번호 검색" value="${vendorSearch}"></div>
    <div class="table-wrapper"><table>
      <thead><tr>
        <th style="width:36px;text-align:center"><input type="checkbox" id="sel-all-vendors" class="tx-checkbox" onchange="selAll('vendors',this)"></th>
        <th>상호명</th><th>대표자</th><th>사업자번호</th><th>주소</th><th>이메일</th><th>구분</th><th>관리</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;

  el.querySelector('#vendor-search').addEventListener('input', debounce(e => { vendorSearch = e.target.value; renderVendors(el); }, 300));
  _updateSelUI('vendors');
}

function openVendorModal(id = null) {
  const v = id ? vendors.find(v => v.id === id) : null;
  const html = `
    <div class="form-grid">
      <div class="form-group"><label>상호명 *</label><input id="v-company" class="form-control" value="${v?v.companyName:''}"></div>
      <div class="form-group"><label>대표자</label><input id="v-rep" class="form-control" value="${v?v.representative||'':''}"></div>
      <div class="form-group"><label>사업자번호</label><input id="v-biz" class="form-control" placeholder="000-00-00000" value="${v?v.businessNumber||'':''}"></div>
      <div class="form-group"><label>이메일</label><input id="v-email" class="form-control" value="${v?v.email||'':''}"></div>
      <div class="form-group full"><label>주소</label><input id="v-addr" class="form-control" value="${v?v.address||'':''}"></div>
      <div class="form-group full"><label>거래 구분 *</label>
        <div class="radio-group">
          <label class="radio-label"><input type="radio" name="v-type" value="매출" ${!v||v.accountType==='매출'?'checked':''}> 매출거래처</label>
          <label class="radio-label"><input type="radio" name="v-type" value="매입" ${v&&v.accountType==='매입'?'checked':''}> 매입거래처</label>
          <label class="radio-label"><input type="radio" name="v-type" value="매출+매입" ${v&&v.accountType==='매출+매입'?'checked':''}> 매출+매입</label>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">취소</button>
      <button class="btn btn-primary" onclick="saveVendor('${id||''}')">저장</button>
    </div>`;
  openModal(id ? '거래처 수정' : '거래처 등록', html);
}

function saveVendor(id) {
  const companyName = document.getElementById('v-company').value.trim();
  if (!companyName) { alert('상호명을 입력하세요.'); return; }
  const data = {
    companyName, representative: document.getElementById('v-rep').value.trim(),
    businessNumber: document.getElementById('v-biz').value.trim(),
    email: document.getElementById('v-email').value.trim(),
    address: document.getElementById('v-addr').value.trim(),
    accountType: document.querySelector('input[name="v-type"]:checked')?.value || '매출'
  };
  if (id) { const idx = vendors.findIndex(v => v.id === id); vendors[idx] = {...vendors[idx], ...data}; }
  else vendors.push({ id: uid(), ...data });
  saveVendors(); closeModal(); render(currentPage);
}
function editVendor(id)   { openVendorModal(id); }
function deleteVendor(id) {
  if (!confirm(`"${vendors.find(v=>v.id===id)?.companyName}" 거래처를 삭제하시겠습니까?`)) return;
  vendors = vendors.filter(v => v.id !== id); saveVendors(); render(currentPage);
}

// ── ITEMS PAGE ────────────────────────────────────────────
let itemSearch = '';

function renderItems(el) {
  const filtered = items.filter(i => i.name.includes(itemSearch) || (i.code||'').includes(itemSearch) || (i.spec||'').includes(itemSearch));
  const rows = filtered.map(i => {
    const pv = vendors.find(v => v.id === i.purchaseVendorId);
    const sv = vendors.find(v => v.id === i.salesVendorId);
    return `<tr>
      <td style="text-align:center;width:36px"><input type="checkbox" class="sel-cb tx-checkbox" data-page="items" value="${i.id}" ${_sel.items.has(i.id)?'checked':''} onchange="toggleSel('items','${i.id}')"></td>
      <td>${i.code||'-'}</td>
      <td><strong>${i.name}</strong>${i.spec?`<br><span style="color:var(--gray-500);font-size:12px">${i.spec}</span>`:''}</td>
      <td>${i.unit||'-'}</td>
      <td style="text-align:right">${fmt(i.purchasePrice)}원</td>
      <td style="color:var(--gray-500);font-size:12px">${pv?pv.companyName:'-'}</td>
      <td style="text-align:right">${fmt(i.salesPrice)}원</td>
      <td style="color:var(--gray-500);font-size:12px">${sv?sv.companyName:'-'}</td>
      <td>${i.taxExempt?'<span class="badge" style="background:#f3f4f6;color:#6b7280">비과세</span>':'<span class="badge" style="background:#eff6ff;color:#2563eb">과세</span>'}</td>
      <td><div class="td-actions">
        <button class="btn btn-ghost btn-sm" onclick="editItem('${i.id}')">수정</button>
        <button class="btn btn-danger btn-sm" onclick="deleteItem('${i.id}')">삭제</button>
      </div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="10"><div class="empty-state"><div class="empty-icon">📦</div><p>등록된 품목이 없습니다</p></div></td></tr>`;

  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">품목 관리</div><div class="page-subtitle">품목 목록 (${items.length}개)</div></div>
      <div style="display:flex;gap:8px">
        <button id="sel-del-items" class="btn btn-danger btn-sm" style="display:none" onclick="deleteSelected('items')">선택 삭제</button>
        <label class="btn btn-ghost" style="cursor:pointer">
          📂 엑셀 업로드
          <input type="file" accept=".xlsx,.xls" style="display:none" onchange="uploadItemsExcel(this)">
        </label>
        <button class="btn btn-ghost" onclick="downloadItemListExcel()">📊 엑셀 다운로드</button>
        <button class="btn btn-primary" onclick="openItemModal()">+ 품목 등록</button>
      </div>
    </div>
    <div class="filter-bar"><input class="search-input form-control" id="item-search" placeholder="품목명 / 코드 검색" value="${itemSearch}"></div>
    <div class="table-wrapper"><table>
      <thead><tr>
        <th style="width:36px;text-align:center"><input type="checkbox" id="sel-all-items" class="tx-checkbox" onchange="selAll('items',this)"></th>
        <th>코드</th><th>품목명/규격</th><th>단위</th><th style="text-align:right">매입단가</th><th>매입거래처</th><th style="text-align:right">매출단가</th><th>매출거래처</th><th>세금</th><th>관리</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;

  el.querySelector('#item-search').addEventListener('input', debounce(e => { itemSearch = e.target.value; renderItems(el); }, 300));
  _updateSelUI('items');
}

function openItemModal(id = null) {
  const it = id ? items.find(i => i.id === id) : null;
  const vOpts = sel => vendors.map(v => `<option value="${v.id}" ${it&&it[sel]===v.id?'selected':''}>${v.companyName}</option>`).join('');
  const html = `
    <div class="form-grid">
      <div class="form-group"><label>품목명 *</label><input id="i-name" class="form-control" value="${it?it.name:''}"></div>
      <div class="form-group"><label>규격 / 별칭</label><input id="i-spec" class="form-control" value="${it?it.spec||'':''}"></div>
      <div class="form-group"><label>품목코드</label><input id="i-code" class="form-control" placeholder="A001" value="${it?it.code||'':''}"></div>
      <div class="form-group"><label>단위</label><input id="i-unit" class="form-control" placeholder="EA, BOX, KG..." value="${it?it.unit||'':''}"></div>
      <div class="form-section-title full" style="margin-top:4px">매입 정보</div>
      <div class="form-group"><label>매입단가</label><input id="i-purchase-price" class="form-control" type="number" value="${it?it.purchasePrice||'':''}"></div>
      <div class="form-group"><label>매입거래처</label><select id="i-purchase-vendor" class="form-control"><option value="">선택 안 함</option>${vOpts('purchaseVendorId')}</select></div>
      <div class="form-section-title full" style="margin-top:4px">매출 정보</div>
      <div class="form-group"><label>매출단가</label><input id="i-sales-price" class="form-control" type="number" value="${it?it.salesPrice||'':''}"></div>
      <div class="form-group"><label>매출거래처</label><select id="i-sales-vendor" class="form-control"><option value="">선택 안 함</option>${vOpts('salesVendorId')}</select></div>
      <div class="form-group full"><label class="checkbox-label"><input type="checkbox" id="i-tax-exempt" ${it&&it.taxExempt?'checked':''}> 비과세 품목 (부가세 미적용)</label></div>
      <div class="form-group full"><label>비고</label><input id="i-notes" class="form-control" value="${it?it.notes||'':''}"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">취소</button>
      <button class="btn btn-primary" onclick="saveItem('${id||''}')">저장</button>
    </div>`;
  openModal(id ? '품목 수정' : '품목 등록', html);
}

function saveItem(id) {
  const name = document.getElementById('i-name').value.trim();
  if (!name) { alert('품목명을 입력하세요.'); return; }
  const data = {
    name, spec: document.getElementById('i-spec').value.trim(), code: document.getElementById('i-code').value.trim(),
    unit: document.getElementById('i-unit').value.trim(),
    purchasePrice: Number(document.getElementById('i-purchase-price').value)||0,
    purchaseVendorId: document.getElementById('i-purchase-vendor').value,
    salesPrice: Number(document.getElementById('i-sales-price').value)||0,
    salesVendorId: document.getElementById('i-sales-vendor').value,
    taxExempt: document.getElementById('i-tax-exempt').checked,
    notes: document.getElementById('i-notes').value.trim()
  };
  if (id) { const idx = items.findIndex(i => i.id === id); items[idx] = {...items[idx], ...data}; }
  else items.push({ id: uid(), ...data });
  saveItems(); closeModal(); render(currentPage);
}
function editItem(id)   { openItemModal(id); }
function deleteItem(id) {
  if (!confirm(`"${items.find(i=>i.id===id)?.name}" 품목을 삭제하시겠습니까?`)) return;
  items = items.filter(i => i.id !== id); saveItems(); render(currentPage);
}

// ── TRANSACTIONS PAGE ─────────────────────────────────────
let txFilter = { type: '', vendorId: '', dateFrom: '', dateTo: '', paid: '' };
let txSearch  = '';

function renderTransactions(el) {
  let filtered = [...transactions].sort((a,b) => b.date.localeCompare(a.date));
  if (txFilter.type)     filtered = filtered.filter(t => t.type === txFilter.type);
  if (txFilter.vendorId) filtered = filtered.filter(t => t.vendorId === txFilter.vendorId);
  if (txFilter.dateFrom) filtered = filtered.filter(t => t.date >= txFilter.dateFrom);
  if (txFilter.dateTo)   filtered = filtered.filter(t => t.date <= txFilter.dateTo);
  if (txFilter.paid === 'unpaid') filtered = filtered.filter(t => !t.isPaid);
  if (txFilter.paid === 'paid')   filtered = filtered.filter(t =>  t.isPaid);
  if (txSearch) filtered = filtered.filter(t => {
    const v = vendors.find(v => v.id === t.vendorId);
    return (v?v.companyName:'').includes(txSearch) || t.items.some(i => i.itemName.includes(txSearch));
  });

  const todayMs = new Date().setHours(0,0,0,0);
  const rows = filtered.map(t => {
    const v   = vendors.find(v => v.id === t.vendorId);
    const amt = t.items.reduce((s,i) => s+i.amount, 0);
    const tax = t.items.reduce((s,i) => s+i.tax, 0);

    let paidBadge;
    if (t.isPaid) {
      paidBadge = `<span class="badge" style="background:#f0fdf4;color:#16a34a">완료</span>`;
    } else {
      const daysDiff = Math.floor((todayMs - new Date(t.date).setHours(0,0,0,0)) / 86400000);
      const daysBadge = daysDiff > 0 ? `<span style="font-size:10px;color:var(--gray-500);margin-left:4px">${daysDiff}일 경과</span>` : '';
      if (t.type==='매출') {
        paidBadge = `<span class="badge" style="background:#fffbeb;color:#d97706">미수금</span>${daysBadge}`;
      } else {
        paidBadge = `<span class="badge" style="background:#fef2f2;color:#dc2626">미지급</span>${daysBadge}`;
      }
    }

    const bizCatColor = t.bizCategory === '유통업' ? '#7c3aed' : t.bizCategory === '기타' ? '#6b7280' : '#0369a1';
    const bizCatBadge = t.bizCategory
      ? `<span style="font-size:10px;background:${bizCatColor}20;color:${bizCatColor};border:1px solid ${bizCatColor}40;border-radius:4px;padding:1px 5px;margin-left:4px">${t.bizCategory}</span>` : '';
    const acCatBadge = t.accountCategory
      ? `<br><span style="font-size:11px;color:var(--gray-500)">${t.accountCategory}</span>` : '';
    const validItems = t.items.filter(i => i.itemName);
    const jeokyo = validItems.length === 0 ? '-'
      : validItems.length === 1 ? validItems[0].itemName
      : `${validItems[0].itemName} 외 ${validItems.length-1}건`;
    return `<tr>
      <td style="text-align:center;width:36px"><input type="checkbox" class="sel-cb tx-checkbox" data-page="txRows" value="${t.id}" ${_sel.txRows.has(t.id)?'checked':''} onchange="toggleSel('txRows','${t.id}')"></td>
      <td>${t.date}</td>
      <td>${t.type==='매출'?'<span class="badge badge-sales">매출</span>':'<span class="badge badge-purchase">매입</span>'}${bizCatBadge}${acCatBadge}</td>
      <td>${v?v.companyName:'-'}</td>
      <td style="color:var(--gray-700);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${jeokyo}</td>
      <td>${t.paymentMethod||'-'}</td>
      <td style="text-align:right">${fmt(amt)}원</td>
      <td style="text-align:right">${fmt(tax)}원</td>
      <td style="text-align:right"><strong>${fmt(amt+tax)}원</strong></td>
      <td>${paidBadge}</td>
      <td><div class="td-actions">
        ${!t.isPaid ? `<button class="btn btn-ghost btn-sm" onclick="quickPaid('${t.id}')">✓ 완료</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="printTxStatement('${t.id}')">🖨</button>
        <button class="btn btn-ghost btn-sm" onclick="viewTransaction('${t.id}')">상세</button>
        <button class="btn btn-ghost btn-sm" onclick="editTransaction('${t.id}')">수정</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTransaction('${t.id}')">삭제</button>
      </div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="11"><div class="empty-state"><div class="empty-icon">📝</div><p>거래 내역이 없습니다</p></div></td></tr>`;

  const vOpts = vendors.map(v => `<option value="${v.id}" ${txFilter.vendorId===v.id?'selected':''}>${v.companyName}</option>`).join('');

  el.innerHTML = `
    <div class="page-header">
      <div><div class="page-title">거래 내역</div><div class="page-subtitle">전체 ${transactions.length}건 (표시 ${filtered.length}건)</div></div>
      <div style="display:flex;gap:8px">
        <label class="btn btn-ghost" style="cursor:pointer">
          📂 엑셀 업로드
          <input type="file" accept=".xlsx,.xls" style="display:none" onchange="uploadTransactionsExcel(this)">
        </label>
        <button class="btn btn-ghost" onclick="downloadTransactionsExcel()">📊 엑셀 다운로드</button>
        <button class="btn btn-primary" onclick="openTransactionModal()">+ 거래 입력</button>
      </div>
    </div>
    <div class="filter-bar">
      <button id="sel-del-txRows" class="btn btn-danger btn-sm" style="display:none" onclick="deleteSelected('txRows')">선택 삭제</button>
      <button id="sel-bulk-txRows" class="btn btn-primary btn-sm" style="display:none" onclick="bulkEditTxModal()">✏ 일괄 변경</button>
      <input class="form-control search-input" id="tx-search" placeholder="거래처명 / 품목명 검색" value="${txSearch}">
      <select class="form-control" id="tx-type"><option value="">전체 구분</option><option value="매출" ${txFilter.type==='매출'?'selected':''}>매출</option><option value="매입" ${txFilter.type==='매입'?'selected':''}>매입</option></select>
      <select class="form-control" id="tx-vendor"><option value="">전체 거래처</option>${vOpts}</select>
      <select class="form-control" id="tx-paid">
        <option value="">전체 결제상태</option>
        <option value="unpaid" ${txFilter.paid==='unpaid'?'selected':''}>미결제만</option>
        <option value="paid"   ${txFilter.paid==='paid'  ?'selected':''}>결제완료만</option>
      </select>
      <input class="form-control" id="tx-from" type="date" value="${txFilter.dateFrom}">
      <input class="form-control" id="tx-to"   type="date" value="${txFilter.dateTo}">
    </div>
    <div class="table-wrapper"><table>
      <thead><tr>
        <th style="width:36px;text-align:center"><input type="checkbox" id="sel-all-txRows" class="tx-checkbox" onchange="selAll('txRows',this)"></th>
        <th>날짜</th><th>구분</th><th>거래처</th><th>적요</th><th>결제방법</th><th style="text-align:right">공급가액</th><th style="text-align:right">세액</th><th style="text-align:right">합계</th><th>결제상태</th><th>관리</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;

  el.querySelector('#tx-search').addEventListener('input', debounce(e => { txSearch = e.target.value; renderTransactions(el); }, 300));
  el.querySelector('#tx-type').addEventListener('change',   e => { txFilter.type = e.target.value;        renderTransactions(el); });
  el.querySelector('#tx-vendor').addEventListener('change', e => { txFilter.vendorId = e.target.value;    renderTransactions(el); });
  el.querySelector('#tx-paid').addEventListener('change',   e => { txFilter.paid = e.target.value;        renderTransactions(el); });
  el.querySelector('#tx-from').addEventListener('change',   e => { txFilter.dateFrom = e.target.value;    renderTransactions(el); });
  el.querySelector('#tx-to').addEventListener('change',     e => { txFilter.dateTo = e.target.value;      renderTransactions(el); });
  _updateSelUI('txRows');
}

function viewTransaction(id) {
  const t = transactions.find(t => t.id === id);
  const v = vendors.find(v => v.id === t.vendorId);
  const amt = t.items.reduce((s,i) => s+i.amount, 0);
  const tax = t.items.reduce((s,i) => s+i.tax, 0);
  const tRows = t.items.map(i => `<tr>
    <td>${i.itemName}</td><td>${i.unit||'-'}</td>
    <td style="text-align:right">${fmt(i.quantity)}</td>
    <td style="text-align:right">${fmt(i.unitPrice)}원</td>
    <td style="text-align:right">${fmt(i.amount)}원</td>
    <td style="text-align:right">${fmt(i.tax)}원</td>
    <td style="text-align:right"><strong>${fmt(i.amount+i.tax)}원</strong></td>
    <td>${i.notes||'-'}</td>
  </tr>`).join('');

  const paidStatus = t.isPaid
    ? `<span class="badge" style="background:#f0fdf4;color:#16a34a;font-size:13px;padding:4px 12px">결제완료 ${t.paidAt ? '('+t.paidAt+')' : ''} ${t.paidMethod ? '· '+t.paidMethod : ''}</span>`
    : `<span class="badge" style="${t.type==='매출'?'background:#fffbeb;color:#d97706':'background:#fef2f2;color:#dc2626'};font-size:13px;padding:4px 12px">${t.type==='매출'?'미수금 (미결제)':'미지급금 (미결제)'}</span>`;

  const html = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
      <div class="card" style="padding:14px"><div class="card-title">날짜</div><div style="font-weight:600">${t.date}</div></div>
      <div class="card" style="padding:14px"><div class="card-title">구분 / 거래처</div><div style="font-weight:600">${t.type} · ${v?v.companyName:'-'}</div></div>
      <div class="card" style="padding:14px"><div class="card-title">결제방법</div><div style="font-weight:600">${t.paymentMethod||'-'}</div></div>
    </div>
    <div style="margin-bottom:16px;display:flex;align-items:center;gap:10px">
      ${paidStatus}
      ${!t.isPaid ? `<button class="btn btn-primary btn-sm" onclick="closeModal();markPaidFromList('${t.id}')">결제 처리</button>` : ''}
    </div>
    <div class="items-table-wrap">
      <table>
        <thead><tr><th>품목명</th><th>단위</th><th>수량</th><th>단가</th><th>공급가액</th><th>세액</th><th>합계</th><th>비고</th></tr></thead>
        <tbody>${tRows}</tbody>
        <tfoot><tr style="background:var(--gray-50);font-weight:700">
          <td colspan="4" style="text-align:right">합계</td>
          <td style="text-align:right">${fmt(amt)}원</td>
          <td style="text-align:right">${fmt(tax)}원</td>
          <td style="text-align:right">${fmt(amt+tax)}원</td>
          <td></td>
        </tr></tfoot>
      </table>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost" onclick="closeModal()">닫기</button></div>`;
  openModal(`거래 상세 — ${t.type} (${t.date})`, html, true);
}

function deleteTransaction(id) {
  const t = transactions.find(t => t.id === id);
  const v = vendors.find(v => v.id === t.vendorId);
  if (!confirm(`${t.date} ${t.type} (${v?v.companyName:''}) 거래를 삭제하시겠습니까?`)) return;
  transactions = transactions.filter(t => t.id !== id);
  saveTransactions(); render(currentPage);
}

// ── TRANSACTION INPUT MODAL ───────────────────────────────
let txLineItems = [];

function editTransaction(id) {
  const t = transactions.find(t => t.id === id);
  if (!t) return;
  openTransactionModal(t, id);
}

function openTransactionModal(prefill = null, editId = null) {
  txLineItems = prefill ? prefill.items.map(i => ({...i})) : [newLineItem()];
  const vOpts = vendors.map(v => `<option value="${v.id}">${v.companyName} (${v.accountType})</option>`).join('');

  const initType   = prefill?.type || '매출';
  const initAcCat  = prefill?.accountCategory || (initType==='매입' ? '매입(상품)' : '매출');
  const salesOpts  = `<option value="매출" ${initAcCat==='매출'?'selected':''}>매출</option>`;
  const purchOpts  = ['매입(상품)','매입(경비)','매입(원재료)','매입(기타)']
    .map(o=>`<option value="${o}" ${initAcCat===o?'selected':''}>${o}</option>`).join('');
  const acOpts     = initType==='매출' ? salesOpts : purchOpts;

  const html = `
    <div class="form-grid">
      <div class="form-group"><label>날짜 *</label><input id="tx-date" class="form-control" type="date" value="${prefill?prefill.date:today()}"></div>
      <div class="form-group"><label>구분 *</label>
        <div class="radio-group" id="tx-type-group">
          <label class="radio-label"><input type="radio" name="tx-type" value="매출" ${initType==='매출'?'checked':''} onchange="onTxTypeChange('매출')"> 매출</label>
          <label class="radio-label"><input type="radio" name="tx-type" value="매입" ${initType==='매입'?'checked':''} onchange="onTxTypeChange('매입')"> 매입</label>
        </div>
      </div>
      <div class="form-group"><label>계정과목</label>
        <select id="tx-account-cat" class="form-control">${acOpts}</select>
      </div>
      <div class="form-group"><label>거래처</label>
        <select id="tx-vendor-sel" class="form-control" onchange="onTxVendorChange(this)">
          <option value="">거래처 선택</option>${vOpts}
        </select>
      </div>
      <div class="form-group"><label>결제방법</label>
        <select id="tx-payment" class="form-control">
          ${['현금','계좌이체','카드','어음','기타'].map(m=>`<option value="${m}" ${prefill?.paymentMethod===m?'selected':''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>사업 구분 <span style="font-size:11px;color:var(--gray-400)">(기장용)</span></label>
        <select id="tx-biz-category" class="form-control">
          ${['제조업','유통업','기타'].map(o=>`<option value="${o}" ${(prefill?.bizCategory||'제조업')===o?'selected':''}>${o}</option>`).join('')}
        </select>
      </div>
      <div class="form-group full">
        <label class="checkbox-label">
          <input type="checkbox" id="tx-is-paid" ${prefill ? (prefill.isPaid?'checked':'') : ''} onchange="togglePaidSection(this)">
          결제 완료 (체크 해제 시 미수금 / 미지급금으로 등록)
        </label>
      </div>
    </div>
    <input type="hidden" id="tx-edit-id" value="${editId||''}">

    <div class="form-section-title">품목 내역</div>
    <div class="items-table-wrap" id="tx-items-table">
      <table>
        <thead><tr>
          <th style="width:210px">품목명</th><th style="width:55px">단위</th>
          <th style="width:90px">수량</th><th style="width:110px">단가</th>
          <th style="width:110px">공급가액</th><th style="width:90px">세액(10%)</th>
          <th style="width:100px">비고</th><th style="width:36px"></th>
        </tr></thead>
        <tbody id="tx-items-body"></tbody>
        <tfoot id="tx-items-foot"></tfoot>
      </table>
    </div>
    <button class="btn btn-ghost btn-sm" style="margin-bottom:16px" onclick="addLineItem()">+ 품목 추가</button>

    ${!editId ? `<label class="checkbox-label" style="margin-bottom:8px">
      <input type="checkbox" id="tx-auto-purchase">
      자동 매입 등록 (매출 저장 시 해당 품목 매입거래 자동 생성)
    </label>` : ''}

    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">닫기</button>
      ${!editId ? `<button class="btn btn-ghost" onclick="saveTx(true)">계속 입력</button>` : ''}
      <button class="btn btn-primary" onclick="saveTx(false)">저장</button>
    </div>`;

  openModal(editId ? '거래 수정' : '거래 입력', html, true);
  renderLineItems();
  if (prefill) { document.getElementById('tx-vendor-sel').value = prefill.vendorId || ''; }
}

function togglePaidSection(cb) {
  // 현재는 체크박스만으로 충분 (isPaid 저장에 반영됨)
}

function newLineItem() {
  return { _id: uid(), itemId: '', itemName: '', unit: '', quantity: 1, unitPrice: 0, amount: 0, tax: 0, taxExempt: false, notes: '' };
}
function addLineItem()     { txLineItems.push(newLineItem()); renderLineItems(); }
function removeLineItem(i) { txLineItems.splice(i,1); if(!txLineItems.length) txLineItems.push(newLineItem()); renderLineItems(); }

function renderLineItems() {
  const tbody = document.getElementById('tx-items-body');
  if (!tbody) return;
  tbody.innerHTML = txLineItems.map((line, idx) => `
    <tr data-idx="${idx}">
      <td><div class="search-dropdown-wrap">
        <input class="item-name-input" data-idx="${idx}" placeholder="품목 검색..." value="${line.itemName}"
          oninput="onItemSearch(this,${idx})" autocomplete="off">
        <div class="search-dropdown hidden" id="item-dd-${idx}"></div>
      </div></td>
      <td><input data-idx="${idx}" data-field="unit"      class="line-field" value="${line.unit}"      oninput="onLineChange(this)"></td>
      <td><input data-idx="${idx}" data-field="quantity"  class="line-field" type="number" value="${line.quantity}"  style="min-width:80px" oninput="onLineChange(this)"></td>
      <td><input data-idx="${idx}" data-field="unitPrice" class="line-field" type="number" value="${line.unitPrice}" style="min-width:100px" oninput="onLineChange(this)"></td>
      <td class="readonly-cell">${fmt(line.amount)}</td>
      <td class="readonly-cell">${fmt(line.tax)}</td>
      <td><input data-idx="${idx}" data-field="notes" class="line-field" value="${line.notes}" oninput="onLineChange(this)"></td>
      <td style="text-align:center"><button onclick="removeLineItem(${idx})" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--danger)">✕</button></td>
    </tr>`).join('');
  updateLineItemTotals();
}

function updateLineItemTotals() {
  const tfoot = document.getElementById('tx-items-foot');
  if (!tfoot) return;
  const totalAmt = txLineItems.reduce((s, l) => s + (l.amount||0), 0);
  const totalTax = txLineItems.reduce((s, l) => s + (l.tax||0), 0);
  tfoot.innerHTML = `<tr style="background:var(--gray-50);font-weight:700;border-top:2px solid var(--gray-200)">
    <td colspan="4" style="text-align:right;padding:8px 12px;font-size:13px;color:var(--gray-500)">합 계</td>
    <td class="readonly-cell" id="total-amt-cell">${fmt(totalAmt)}</td>
    <td class="readonly-cell" id="total-tax-cell">${fmt(totalTax)}</td>
    <td class="readonly-cell" colspan="2" style="color:var(--primary)">${fmt(totalAmt + totalTax)}원</td>
  </tr>`;
}

function onItemSearch(input, idx) {
  const q  = input.value.toLowerCase();
  txLineItems[idx].itemName = input.value;
  const dd = document.getElementById(`item-dd-${idx}`);
  if (!q) { dd.classList.add('hidden'); return; }
  const matched = items.filter(i =>
    i.name.toLowerCase().includes(q) || (i.code||'').toLowerCase().includes(q) || (i.spec||'').toLowerCase().includes(q)
  ).slice(0, 10);
  if (!matched.length) { dd.classList.add('hidden'); return; }
  dd.innerHTML = matched.map(i => `<div class="dropdown-item" onmousedown="selectItem(${idx},'${i.id}')">
    <span>${i.name}${i.spec?` <small style="color:var(--gray-500)">(${i.spec})</small>`:''}</span>
    <span class="item-code">${i.code||''} · ${i.unit||''}</span>
  </div>`).join('');
  // modal-body 의 overflow:auto 를 피하기 위해 fixed 좌표로 배치
  const rect = input.getBoundingClientRect();
  dd.style.position  = 'fixed';
  dd.style.top       = (rect.bottom + 2) + 'px';
  dd.style.left      = rect.left + 'px';
  dd.style.width     = Math.max(rect.width, 280) + 'px';
  dd.style.zIndex    = '9999';
  dd.classList.remove('hidden');
}

function selectItem(idx, itemId) {
  const item = items.find(i => i.id === itemId);
  if (!item) return;
  const txType    = document.querySelector('input[name="tx-type"]:checked')?.value || '매출';
  const unitPrice = txType === '매출' ? item.salesPrice : item.purchasePrice;
  const qty       = txLineItems[idx].quantity || 1;
  txLineItems[idx] = { ...txLineItems[idx], itemId: item.id, itemName: item.name, unit: item.unit||'',
    unitPrice: unitPrice||0, taxExempt: item.taxExempt,
    amount: qty*(unitPrice||0), tax: item.taxExempt ? 0 : Math.round(qty*(unitPrice||0)*0.1) };
  renderLineItems();
  document.getElementById(`item-dd-${idx}`)?.classList.add('hidden');
}

function onLineChange(input) {
  const idx   = Number(input.dataset.idx);
  const field = input.dataset.field;
  txLineItems[idx][field] = (field==='unit'||field==='notes') ? input.value : (Number(input.value)||0);
  const line  = txLineItems[idx];
  line.amount = line.quantity * line.unitPrice;
  line.tax    = line.taxExempt ? 0 : Math.round(line.amount * 0.1);
  const cells = input.closest('tr').querySelectorAll('.readonly-cell');
  cells[0].textContent = fmt(line.amount);
  cells[1].textContent = fmt(line.tax);
  updateLineItemTotals();
}

function onTxVendorChange(sel) {
  const v  = vendors.find(v => v.id === sel.value);
  const tg = document.getElementById('tx-type-group');
  if (!v || !tg) return;
  if (v.accountType==='매출') { tg.querySelector('input[value="매출"]').checked = true; onTxTypeChange('매출'); }
  else if (v.accountType==='매입') { tg.querySelector('input[value="매입"]').checked = true; onTxTypeChange('매입'); }
}

function onTxTypeChange(type) {
  const sel = document.getElementById('tx-account-cat');
  if (!sel) return;
  const cur = sel.value;
  if (type === '매출') {
    sel.innerHTML = `<option value="매출">매출</option>`;
  } else {
    const opts = ['매입(상품)','매입(경비)','매입(원재료)','매입(기타)'];
    sel.innerHTML = opts.map(o => `<option value="${o}" ${cur===o?'selected':''}>${o}</option>`).join('');
  }
  // 이미 선택된 품목들의 단가를 구분에 맞게 갱신
  let changed = false;
  txLineItems.forEach(line => {
    if (!line.itemId) return;
    const item = items.find(i => i.id === line.itemId);
    if (!item) return;
    const newPrice = type === '매출' ? (item.salesPrice||0) : (item.purchasePrice||0);
    if (line.unitPrice !== newPrice) {
      line.unitPrice = newPrice;
      line.amount    = line.quantity * newPrice;
      line.tax       = line.taxExempt ? 0 : Math.round(line.amount * 0.1);
      changed = true;
    }
  });
  if (changed) renderLineItems();
}

function saveTx(cont) {
  const date    = document.getElementById('tx-date').value;
  if (!date) { alert('날짜를 입력하세요.'); return; }
  const type    = document.querySelector('input[name="tx-type"]:checked')?.value;
  if (!type) { alert('구분을 선택하세요.'); return; }
  const vendorId       = document.getElementById('tx-vendor-sel').value;
  const paymentMethod  = document.getElementById('tx-payment').value;
  const isPaid         = document.getElementById('tx-is-paid').checked;
  const autoPurchase   = document.getElementById('tx-auto-purchase')?.checked;
  const accountCategory = document.getElementById('tx-account-cat')?.value || type;
  const bizCategory     = document.getElementById('tx-biz-category')?.value || '제조업';
  const editId          = document.getElementById('tx-edit-id')?.value || '';

  txLineItems.forEach(line => {
    line.amount = line.quantity * line.unitPrice;
    line.tax    = line.taxExempt ? 0 : Math.round(line.amount * 0.1);
  });
  const validItems = txLineItems.filter(l => l.itemName || l.amount > 0);
  if (!validItems.length) { alert('품목을 하나 이상 입력하세요.'); return; }

  if (editId) {
    const idx = transactions.findIndex(t => t.id === editId);
    if (idx > -1) {
      const orig = transactions[idx];
      transactions[idx] = { ...orig, date, type, accountCategory, bizCategory, vendorId, paymentMethod,
        isPaid, paidAt: isPaid ? (orig.paidAt || date) : '', paidMethod: isPaid ? (orig.paidMethod || paymentMethod) : '',
        items: validItems };
    }
    saveTransactions(); closeModal(); render(currentPage); return;
  }

  transactions.push({ id: uid(), date, type, accountCategory, bizCategory, vendorId, paymentMethod, isPaid, paidAt: isPaid ? date : '', paidMethod: isPaid ? paymentMethod : '', items: validItems });

  if (autoPurchase && type === '매출') {
    const pItems = validItems.map(line => {
      const item          = items.find(i => i.id === line.itemId);
      const purchasePrice = item ? item.purchasePrice : line.unitPrice;
      const amount        = line.quantity * purchasePrice;
      return { ...line, unitPrice: purchasePrice, amount, tax: line.taxExempt ? 0 : Math.round(amount * 0.1) };
    });
    const firstItem        = items.find(i => i.id === validItems[0]?.itemId);
    const purchaseVendorId = firstItem ? firstItem.purchaseVendorId : '';
    transactions.push({ id: uid(), date, type: '매입', accountCategory: '매입(상품)', vendorId: purchaseVendorId, paymentMethod, isPaid, paidAt: isPaid ? date : '', paidMethod: isPaid ? paymentMethod : '', items: pItems });
  }

  saveTransactions();
  closeModal();
  if (cont) openTransactionModal();
  else render(currentPage);
}

// ── EXCEL DOWNLOAD / UPLOAD ──────────────────────────────
function xlsxCheck() {
  if (typeof XLSX === 'undefined') { alert('엑셀 라이브러리 로딩 중입니다. 잠시 후 다시 시도해주세요.'); return false; }
  return true;
}

function xlsxSave(wb, name) {
  XLSX.writeFile(wb, name + '_' + today().replace(/-/g,'') + '.xlsx');
}

// ── 거래내역 다운로드 ─────────────────────────────────────
function getFilteredTransactions() {
  let list = [...transactions].sort((a,b) => b.date.localeCompare(a.date));
  if (txFilter.type)     list = list.filter(t => t.type === txFilter.type);
  if (txFilter.vendorId) list = list.filter(t => t.vendorId === txFilter.vendorId);
  if (txFilter.dateFrom) list = list.filter(t => t.date >= txFilter.dateFrom);
  if (txFilter.dateTo)   list = list.filter(t => t.date <= txFilter.dateTo);
  if (txFilter.paid === 'unpaid') list = list.filter(t => !t.isPaid);
  if (txFilter.paid === 'paid')   list = list.filter(t =>  t.isPaid);
  if (txSearch) list = list.filter(t => {
    const v = vendors.find(v => v.id === t.vendorId);
    return (v?v.companyName:'').includes(txSearch) || t.items.some(i => i.itemName.includes(txSearch));
  });
  return list;
}

function downloadTransactionsExcel() {
  if (!xlsxCheck()) return;
  const list = getFilteredTransactions();
  if (!list.length) { alert('다운로드할 거래가 없습니다.'); return; }

  const header = ['날짜','구분','사업구분','계정과목','거래처','결제방법','공급가액','세액','합계금액','결제상태','결제일','결제방법(결제)','품목내역'];
  const rows = list.map(t => {
    const v   = vendors.find(v => v.id === t.vendorId);
    const amt = t.items.reduce((s,i) => s+i.amount, 0);
    const tax = t.items.reduce((s,i) => s+i.tax, 0);
    const memo = t.items.length > 1
      ? t.items[0].itemName + ' 외 ' + (t.items.length-1) + '건'
      : (t.items[0]?.itemName || '');
    return [
      t.date, t.type, t.bizCategory||'제조업', t.accountCategory||t.type, v?v.companyName:'',
      t.paymentMethod||'', amt, tax, amt+tax,
      t.isPaid?'결제완료':'미결제', t.paidAt||'', t.paidMethod||'', memo
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([
    [`■ 기간별 거래내역 (${today()} 다운로드)`],
    [],
    header,
    ...rows
  ]);
  ws['!cols'] = [10,8,12,20,8,12,10,12,8,10,10,30].map(w=>({wch:w}));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '거래내역');
  xlsxSave(wb, '거래내역');
}

// ── 거래내역 업로드 ───────────────────────────────────────
function uploadTransactionsExcel(input) {
  const file = input.files[0];
  if (!file) return;
  if (!xlsxCheck()) return;
  const reader = new FileReader();
  reader.onload = e => {
    const wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // 헤더 행 찾기: '날짜' 또는 '일자' 셀이 있는 행
    let headerRowIdx = -1;
    let col = { date:0, type:1, cat:2, vendor:3, payment:4, amt:5, tax:6, total:7, paid:8, paidAt:9, paidMethod:10, memo:11 };

    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const dateIdx = rows[i].findIndex(c => ['날짜','일자','Date'].includes(String(c||'').trim()));
      if (dateIdx > -1) {
        headerRowIdx = i;
        rows[i].forEach((c, idx) => {
          const h = String(c||'').trim();
          if (['날짜','일자'].includes(h))               col.date      = idx;
          if (h === '구분')                               col.type      = idx;
          if (['계정과목','계정'].includes(h))            col.cat       = idx;
          if (['거래처','거래처명'].includes(h))          col.vendor    = idx;
          if (['결제방법'].includes(h) && idx < 6)       col.payment   = idx;
          if (['공급가액','공급금액'].includes(h))        col.amt       = idx;
          if (['세액','부가세'].includes(h))              col.tax       = idx;
          if (['합계금액','합계','금액'].includes(h))     col.total     = idx;
          if (['결제상태','결제여부'].includes(h))        col.paid      = idx;
          if (['결제일'].includes(h))                     col.paidAt    = idx;
          if (['결제방법(결제)'].includes(h))             col.paidMethod= idx;
          if (['품목내역','적요','메모'].includes(h))     col.memo      = idx;
        });
        break;
      }
    }

    const dataStart = headerRowIdx > -1 ? headerRowIdx + 1 : 3;
    const newTxs = [];

    for (let i = dataStart; i < rows.length; i++) {
      const row  = rows[i];
      const date = String(row[col.date]||'').trim().replace(/\./g,'-');
      if (!date || !/\d{4}-\d{2}-\d{2}/.test(date)) continue;
      const type = String(row[col.type]||'').trim();
      if (!['매출','매입'].includes(type)) continue;

      const vendorName = String(row[col.vendor]||'').trim();
      const vendor = vendors.find(v => v.companyName === vendorName);

      // 금액 파싱 (숫자로 변환, 쉼표 제거)
      const parseNum = v => Number(String(v||'0').replace(/[^0-9.-]/g,'')) || 0;
      let amt = parseNum(row[col.amt]);
      let tax = parseNum(row[col.tax]);
      const total = parseNum(row[col.total]);

      // 합계만 있고 공급가액/세액이 없는 경우 (알찬웹장부 형식)
      if (!amt && total) {
        amt = Math.round(total / 1.1);
        tax = total - amt;
      }

      const memo    = String(row[col.memo]||'').trim() || vendorName || type;
      const isPaid  = String(row[col.paid]||'').includes('완료');
      const paidAt  = String(row[col.paidAt]||'').trim().replace(/\./g,'-');
      const paidMethod = String(row[col.paidMethod]||'').trim();
      const accountCategory = String(row[col.cat]||'').trim() || type;
      const paymentMethod   = String(row[col.payment]||'').trim() || '현금';

      newTxs.push({
        id: uid(), date, type, accountCategory,
        vendorId: vendor ? vendor.id : '',
        paymentMethod, isPaid, paidAt: isPaid ? (paidAt||date) : '', paidMethod,
        items: [{ _id: uid(), itemId:'', itemName: memo, unit:'', quantity:1,
          unitPrice: amt, amount: amt, tax, taxExempt: tax===0, notes:'' }]
      });
    }

    if (!newTxs.length) {
      alert(`가져올 거래 데이터가 없습니다.\n(헤더 행: ${headerRowIdx+1}행, 데이터 시작: ${dataStart+1}행)`);
      input.value = ''; return;
    }

    if (!confirm(`총 ${newTxs.length}건 거래를 가져옵니다.\n기존 거래는 유지되고 새로 추가됩니다.\n\n※ 거래처명이 등록된 거래처와 일치해야 연결됩니다.\n\n계속하시겠습니까?`)) { input.value=''; return; }

    transactions.push(...newTxs);
    saveTransactions();
    input.value = '';
    render(currentPage);
    alert(`${newTxs.length}건 거래를 추가했습니다.`);
  };
  reader.readAsArrayBuffer(file);
}

// ── 거래처 목록 다운로드 ──────────────────────────────────
function downloadVendorListExcel() {
  if (!xlsxCheck()) return;
  if (!vendors.length) { alert('다운로드할 거래처가 없습니다.'); return; }
  const header = ['번호','구분','거래처','거래계정','사업자번호','대표자','연락처','이메일','주소'];
  const rows = vendors.map((v, i) => [
    i+1, v.accountType, v.companyName, v.accountType,
    v.businessNumber||'', v.representative||'', v.tel||'', v.email||'', v.address||''
  ]);
  const ws = XLSX.utils.aoa_to_sheet([['■ 거래처 관리'],[],header,...rows]);
  ws['!cols'] = [5,6,22,10,14,8,14,24,20].map(w=>({wch:w}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '거래처');
  xlsxSave(wb, '거래처');
}

// ── 품목 목록 다운로드 ────────────────────────────────────
function downloadItemListExcel() {
  if (!xlsxCheck()) return;
  if (!items.length) { alert('다운로드할 품목이 없습니다.'); return; }
  const header = ['번호','코드','품목명/규격','단위','매입단가','매출단가','비과세','비고'];
  const rows = items.map((it, i) => {
    const fullName = it.spec ? it.name + ' / ' + it.spec : it.name;
    return [i+1, it.code||'', fullName, it.unit||'', it.purchasePrice||0, it.salesPrice||0, it.taxExempt?1:0, it.notes||''];
  });
  const ws = XLSX.utils.aoa_to_sheet([['■ 품목 관리'],[],header,...rows]);
  ws['!cols'] = [5,8,36,6,10,10,6,16].map(w=>({wch:w}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '품목');
  xlsxSave(wb, '품목');
}

// ── 견적/발주 목록 다운로드 ───────────────────────────────
function downloadQuoteListExcel() {
  if (!xlsxCheck()) return;
  if (!quotes.length) { alert('다운로드할 견적/발주가 없습니다.'); return; }
  const header = ['번호','종류','작성일','유효기간','거래처','상태','공급가액','세액','합계금액','메모'];
  const rows = quotes.map(q => {
    const v   = vendors.find(v => v.id === q.vendorId);
    const amt = q.items.reduce((s,i) => s+i.amount, 0);
    const tax = q.items.reduce((s,i) => s+i.tax, 0);
    return [q.quoteNo, q.type, q.date, q.validUntil||'', v?v.companyName:'', q.status, amt, tax, amt+tax, q.memo||''];
  });
  const ws = XLSX.utils.aoa_to_sheet([['■ 견적/발주 목록'],[],header,...rows]);
  ws['!cols'] = [14,6,10,10,20,6,12,10,12,20].map(w=>({wch:w}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '견적발주');
  xlsxSave(wb, '견적발주');
}

// ── EXCEL UPLOAD ─────────────────────────────────────────
function uploadVendorsExcel(input) {
  const file = input.files[0];
  if (!file) return;
  if (typeof XLSX === 'undefined') { alert('엑셀 라이브러리 로딩 중입니다. 잠시 후 다시 시도해주세요.'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // 헤더 행 찾기: 행에서 '거래처' 셀 위치를 직접 탐색
    let headerRowIdx = -1;
    let colName = 2, colType = 1, colBiz = 4, colRep = 5, colTel = 6, colEmail = 7;

    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const row = rows[i];
      const nameIdx = row.findIndex(c => ['거래처','거래처명','상호','상호명'].includes(String(c||'').trim()));
      if (nameIdx > -1) {
        headerRowIdx = i;
        colName = nameIdx;
        row.forEach((c, idx) => {
          const h = String(c||'').trim();
          if (['구분','유형'].includes(h))              colType  = idx;
          if (['사업자번호','사업자등록번호'].includes(h))  colBiz   = idx;
          if (['대표자','대표','담당자'].includes(h))       colRep   = idx;
          if (['연락처','전화','전화번호','Tel'].includes(h)) colTel   = idx;
          if (['이메일','Email','e-mail'].includes(h))    colEmail = idx;
        });
        break;
      }
    }

    const dataStart = headerRowIdx > -1 ? headerRowIdx + 1 : 3;
    const newVendors = [];

    for (let i = dataStart; i < rows.length; i++) {
      const row  = rows[i];
      const name = String(row[colName]||'').trim();
      if (!name || name === '거래처') continue;
      const 구분val   = String(row[colType]||'').trim();
      const accountType = 구분val === '매출' ? '매출' : 구분val === '매입' ? '매입' : '매출';
      newVendors.push({
        id:             uid(),
        companyName:    name,
        accountType,
        businessNumber: String(row[colBiz]  || '').trim(),
        representative: String(row[colRep]  || '').trim(),
        tel:            String(row[colTel]  || '').trim(),
        email:          String(row[colEmail]|| '').trim(),
        address:        ''
      });
    }

    if (!newVendors.length) {
      alert(`가져올 거래처 데이터가 없습니다.\n(감지된 헤더: ${headerRowIdx+1}행, 데이터 시작: ${dataStart+1}행, 전체 행 수: ${rows.length}행)`);
      input.value = ''; return;
    }

    const dupCount = newVendors.filter(n => vendors.some(v => v.companyName === n.companyName)).length;
    const msg = `총 ${newVendors.length}개 거래처를 가져옵니다.\n` +
      (dupCount ? `※ 이름이 같은 거래처 ${dupCount}개는 중복 추가됩니다.\n` : '') +
      `\n기존 거래처는 유지되고 새로 추가됩니다. 계속하시겠습니까?`;
    if (!confirm(msg)) { input.value = ''; return; }

    vendors.push(...newVendors);
    saveVendors();
    input.value = '';
    render(currentPage);
    alert(`${newVendors.length}개 거래처를 추가했습니다.`);
  };
  reader.readAsArrayBuffer(file);
}

function uploadItemsExcel(input) {
  const file = input.files[0];
  if (!file) return;
  if (typeof XLSX === 'undefined') { alert('엑셀 라이브러리 로딩 중입니다. 잠시 후 다시 시도해주세요.'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // 헤더 행 찾기: "품목명" 텍스트가 있는 행
    let dataStart = 3;
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
      if (String(rows[i][2]||'').includes('품목명')) { dataStart = i + 1; break; }
    }

    const newItems = [];
    for (let i = dataStart; i < rows.length; i++) {
      const row      = rows[i];
      const fullName = String(row[2]||'').trim();
      if (!fullName) continue;

      // "품목명 / 규격" 형식으로 분리
      const slashIdx = fullName.indexOf(' / ');
      const itemName = slashIdx > -1 ? fullName.slice(0, slashIdx).trim() : fullName;
      const spec     = slashIdx > -1 ? fullName.slice(slashIdx + 3).trim() : '';

      const taxExemptVal = row[5];
      const taxExempt    = taxExemptVal !== '' && taxExemptVal !== 0 && taxExemptVal !== '0';

      newItems.push({
        id:            uid(),
        code:          String(row[1]||'').trim(),
        name:          itemName,
        spec,
        unit:          '',
        purchasePrice: Number(row[3]) || 0,
        salesPrice:    Number(row[4]) || 0,
        taxExempt,
        purchaseVendorId: '',
        salesVendorId:    '',
        notes:         String(row[6]||'').trim()
      });
    }

    if (!newItems.length) { alert('가져올 품목 데이터가 없습니다.'); input.value=''; return; }

    const msg = `총 ${newItems.length}개 품목을 가져옵니다.\n` +
      `매입처/매출처는 비어 있으며, 수정 버튼으로 직접 지정해주세요.\n\n계속하시겠습니까?`;
    if (!confirm(msg)) { input.value=''; return; }

    items.push(...newItems);
    saveItems();
    input.value = '';
    render(currentPage);
    alert(`${newItems.length}개 품목을 추가했습니다.`);
  };
  reader.readAsArrayBuffer(file);
}

// ── QUOTES & PURCHASE ORDERS ─────────────────────────────
let quotes    = DB.load('acc_quotes');
let quotesTab = '견적서';
let lastSavedQuoteId = null;

function genQuoteNo(type) {
  const d   = new Date();
  const pfx = type === '견적서' ? 'Q' : 'PO';
  const ym  = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
  const cnt = quotes.filter(q => q.type === type && (q.quoteNo||'').includes(ym)).length;
  return `${pfx}-${ym}-${String(cnt+1).padStart(3,'0')}`;
}

function renderQuotes(el) {
  const list = quotes.filter(q => q.type === quotesTab).sort((a,b) => b.date.localeCompare(a.date));

  const rows = list.map(q => {
    const v     = vendors.find(v => v.id === q.vendorId);
    const total = q.items.reduce((s,i) => s + i.amount + i.tax, 0);
    const statusBadge = q.status === '확정'
      ? `<span class="badge" style="background:#f0fdf4;color:#16a34a">확정</span>`
      : q.status === '취소'
      ? `<span class="badge" style="background:#fef2f2;color:#dc2626">취소</span>`
      : `<span class="badge" style="background:#eff6ff;color:#2563eb">대기</span>`;
    const txBadge = q.convertedTxId
      ? `<span class="badge" style="background:#f0fdf4;color:#16a34a;margin-left:4px">거래전환됨</span>` : '';
    const convertBtn = !q.convertedTxId && q.status !== '취소'
      ? `<button class="btn btn-primary btn-sm" onclick="convertQuoteToTx('${q.id}')">→ 거래 전환</button>` : '';
    return `<tr>
      <td style="text-align:center;width:36px"><input type="checkbox" class="sel-cb tx-checkbox" data-page="quotes" value="${q.id}" ${_sel.quotes.has(q.id)?'checked':''} onchange="toggleSel('quotes','${q.id}')"></td>
      <td><strong>${q.quoteNo}</strong></td>
      <td>${q.date}</td>
      <td>${q.validUntil || '-'}</td>
      <td>${v ? v.companyName : '-'}</td>
      <td style="text-align:right"><strong>${fmt(total)}원</strong></td>
      <td>${statusBadge}${txBadge}</td>
      <td><div class="td-actions">
        <button class="btn btn-ghost btn-sm" onclick="downloadQuotePDF('${q.id}')">🖨 PDF</button>
        ${convertBtn}
        <button class="btn btn-ghost btn-sm" onclick="editQuote('${q.id}')">수정</button>
        <button class="btn btn-danger btn-sm" onclick="deleteQuote('${q.id}')">삭제</button>
      </div></td>
    </tr>`;
  }).join('') || `<tr><td colspan="8"><div class="empty-state">
    <div class="empty-icon">${quotesTab === '견적서' ? '📋' : '📦'}</div>
    <p>작성된 ${quotesTab}이 없습니다</p>
  </div></td></tr>`;

  const qCnt  = quotes.filter(q => q.type==='견적서').length;
  const poCnt = quotes.filter(q => q.type==='발주서').length;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">견적 / 발주</div>
        <div class="page-subtitle">견적서 · 발주서 작성 및 거래 전환</div>
      </div>
      <div style="display:flex;gap:8px">
        <button id="sel-del-quotes" class="btn btn-danger btn-sm" style="display:none" onclick="deleteSelected('quotes')">선택 삭제</button>
        <button class="btn btn-ghost" onclick="downloadQuoteListExcel()">📊 엑셀 다운로드</button>
        <button class="btn btn-primary" onclick="openQuoteModal(null, quotesTab)">+ ${quotesTab} 작성</button>
      </div>
    </div>

    <div style="display:flex;gap:4px;margin-bottom:18px">
      <button class="period-btn ${quotesTab==='견적서'?'active':''}" onclick="switchQuotesTab('견적서')">📋 견적서 (${qCnt})</button>
      <button class="period-btn ${quotesTab==='발주서'?'active':''}" onclick="switchQuotesTab('발주서')">📦 발주서 (${poCnt})</button>
    </div>

    <div class="table-wrapper">
      <table>
        <thead><tr>
          <th style="width:36px;text-align:center"><input type="checkbox" id="sel-all-quotes" class="tx-checkbox" onchange="selAll('quotes',this)"></th>
          <th>번호</th><th>작성일</th><th>유효기간</th><th>거래처</th>
          <th style="text-align:right">금액(세포함)</th><th>상태</th><th>관리</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  _updateSelUI('quotes');
}

function switchQuotesTab(tab) {
  quotesTab = tab;
  render('quotes');
}

function openQuoteModal(id = null, type = '견적서') {
  const q = id ? quotes.find(q => q.id === id) : null;
  txLineItems = q ? q.items.map(i => ({...i})) : [newLineItem()];

  const vOpts = vendors.map(v =>
    `<option value="${v.id}" ${q && q.vendorId===v.id ? 'selected' : ''}>${v.companyName}</option>`
  ).join('');

  const d30 = new Date(); d30.setDate(d30.getDate()+30);
  const defaultValid = d30.toISOString().slice(0,10);

  const html = `
    <div class="form-grid">
      <div class="form-group">
        <label>${type} 번호</label>
        <input id="q-no" class="form-control readonly" value="${q ? q.quoteNo : genQuoteNo(type)}" readonly>
      </div>
      <div class="form-group">
        <label>작성일 *</label>
        <input id="q-date" class="form-control" type="date" value="${q ? q.date : today()}">
      </div>
      <div class="form-group">
        <label>유효기간</label>
        <input id="q-valid" class="form-control" type="date" value="${q ? q.validUntil||'' : defaultValid}">
      </div>
      <div class="form-group">
        <label>거래처</label>
        <select id="q-vendor" class="form-control">
          <option value="">거래처 선택</option>${vOpts}
        </select>
      </div>
      <div class="form-group full">
        <label>메모 (특기사항, 납기일 등)</label>
        <input id="q-memo" class="form-control" placeholder="예: 납기 2주, 운임 별도 등" value="${q ? q.memo||'' : ''}">
      </div>
    </div>

    <div class="form-section-title">품목 내역</div>
    <div class="items-table-wrap">
      <table>
        <thead><tr>
          <th style="width:210px">품목명</th><th style="width:55px">단위</th>
          <th style="width:90px">수량</th><th style="width:110px">단가</th>
          <th style="width:110px">공급가액</th><th style="width:90px">세액(10%)</th>
          <th style="width:100px">비고</th><th style="width:36px"></th>
        </tr></thead>
        <tbody id="tx-items-body"></tbody>
        <tfoot id="tx-items-foot"></tfoot>
      </table>
    </div>
    <button class="btn btn-ghost btn-sm" style="margin-bottom:16px" onclick="addLineItem()">+ 품목 추가</button>

    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">취소</button>
      <button class="btn btn-ghost" onclick="saveQuoteThen('${id||''}','${type}',true)">저장 후 PDF</button>
      <button class="btn btn-primary" onclick="saveQuoteThen('${id||''}','${type}',false)">저장</button>
    </div>`;

  openModal((id ? type+' 수정' : type+' 작성'), html, true);
  renderLineItems();
}

function saveQuoteThen(id, type, openPDF) {
  const date       = document.getElementById('q-date').value;
  const quoteNo    = document.getElementById('q-no').value;
  const validUntil = document.getElementById('q-valid').value;
  const vendorId   = document.getElementById('q-vendor').value;
  const memo       = document.getElementById('q-memo').value.trim();
  if (!date) { alert('작성일을 입력하세요.'); return; }

  txLineItems.forEach(line => {
    line.amount = line.quantity * line.unitPrice;
    line.tax    = line.taxExempt ? 0 : Math.round(line.amount * 0.1);
  });
  const validItems = txLineItems.filter(l => l.itemName || l.amount > 0);
  if (!validItems.length) { alert('품목을 하나 이상 입력하세요.'); return; }

  const data = { quoteNo, date, validUntil, vendorId, memo, type, items: validItems };

  if (id) {
    const idx = quotes.findIndex(q => q.id === id);
    quotes[idx] = { ...quotes[idx], ...data };
    lastSavedQuoteId = id;
  } else {
    lastSavedQuoteId = uid();
    quotes.push({ id: lastSavedQuoteId, status: '대기', convertedTxId: null, ...data });
  }
  saveQuotes();
  closeModal();
  if (openPDF) downloadQuotePDF(lastSavedQuoteId);
  render(currentPage);
}

function editQuote(id) {
  const q = quotes.find(q => q.id === id);
  if (q) openQuoteModal(id, q.type);
}

function deleteQuote(id) {
  const q = quotes.find(q => q.id === id);
  if (!confirm(`"${q.quoteNo}" ${q.type}를 삭제하시겠습니까?`)) return;
  quotes = quotes.filter(q => q.id !== id);
  saveQuotes();
  render(currentPage);
}

function convertQuoteToTx(id) {
  const q      = quotes.find(q => q.id === id);
  const txType = q.type === '견적서' ? '매출' : '매입';
  const v      = vendors.find(v => v.id === q.vendorId);
  if (!confirm(`"${q.quoteNo}"을 ${txType} 거래로 전환하시겠습니까?\n거래처: ${v ? v.companyName : '없음'}`)) return;

  const txId = uid();
  transactions.push({
    id: txId, date: today(), type: txType,
    vendorId: q.vendorId, paymentMethod: '현금',
    isPaid: false, paidAt: '', paidMethod: '',
    items: q.items.map(i => ({...i}))
  });
  const idx = quotes.findIndex(q => q.id === id);
  quotes[idx].status        = '확정';
  quotes[idx].convertedTxId = txId;

  saveQuotes(); saveTransactions();
  alert(`${txType} 거래로 전환됐습니다. 거래 내역에서 결제 처리해주세요.`);
  render(currentPage);
}

function downloadQuotePDF(id) {
  const q      = quotes.find(q => q.id === id);
  if (!q) return;
  const vendor = vendors.find(v => v.id === q.vendorId);
  const win    = window.open('', '_blank', 'width=900,height=750');
  win.document.write(generateQuoteHTML(q, vendor));
  win.document.close();
}

function generateQuoteHTML(q, vendor) {
  let rows = '', grandAmt = 0, grandTax = 0;
  q.items.forEach((i, n) => {
    grandAmt += i.amount; grandTax += i.tax;
    rows += `<tr>
      <td style="text-align:center">${n+1}</td>
      <td style="text-align:left;padding-left:8px">${i.itemName}</td>
      <td>${i.unit||''}</td>
      <td style="text-align:right">${fmt(i.quantity)}</td>
      <td style="text-align:right">${fmt(i.unitPrice)}</td>
      <td style="text-align:right">${fmt(i.amount)}</td>
      <td style="text-align:right">${fmt(i.tax)}</td>
      <td style="text-align:right">${fmt(i.amount+i.tax)}</td>
      <td>${i.notes||''}</td>
    </tr>`;
  });

  const isQuote  = q.type === '견적서';
  const accent   = isQuote ? '#2563eb' : '#16a34a';
  const ci       = companyInfo;
  const docTitle = isQuote ? '견 적 서' : '발 주 서';

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${q.quoteNo}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'맑은 고딕','맑은고딕',sans-serif;font-size:12px;padding:20px;color:#111}
@media print{@page{size:A4;margin:12mm}.no-print{display:none!important}body{padding:0}}
.no-print{text-align:center;margin-bottom:16px}
.print-btn{padding:8px 28px;background:${accent};color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-family:inherit}
.doc-title{text-align:center;font-size:24px;font-weight:700;letter-spacing:10px;padding-bottom:10px;border-bottom:3px double ${accent};color:${accent};margin-bottom:6px}
.doc-no{text-align:center;font-size:11px;color:#666;margin-bottom:12px}
.meta{display:flex;justify-content:space-between;font-size:11px;color:#555;margin-bottom:12px}
.header-wrap{display:flex;gap:8px;margin-bottom:14px}
.header-box{flex:1;border:1px solid #555;padding:10px 12px}
.hbox-title{font-weight:700;border-bottom:1px solid #888;padding-bottom:5px;margin-bottom:7px}
.hrow{display:flex;margin-bottom:3px;font-size:11px}
.hlabel{font-weight:600;width:76px;flex-shrink:0;color:#444}
table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:11px}
th{background:#f0f0f0;border:1px solid #666;padding:5px 4px;text-align:center;font-weight:600}
td{border:1px solid #aaa;padding:4px;text-align:center}
.total-row td{background:#f5f5f5;font-weight:700;border-color:#666}
.summary{border:1px solid #555;padding:10px 16px;margin-top:10px}
.srow{display:flex;justify-content:space-between;margin-bottom:3px;font-size:12px}
.srow.grand{font-size:15px;font-weight:700;border-top:2px solid ${accent};padding-top:7px;margin-top:7px;color:${accent}}
.memo-box{margin-top:10px;border:1px dashed #aaa;padding:8px 12px;font-size:11px;color:#555;border-radius:4px}
.stamp{text-align:right;margin-top:18px}
.stamp-box{display:inline-block;border:1px solid #888;padding:8px 24px;text-align:center;line-height:1.6;font-size:11px}
</style></head><body>
<div class="no-print"><button class="print-btn" onclick="window.print()">🖨️ 인쇄 / PDF 저장</button></div>
<div class="doc-title">${docTitle}</div>
<div class="doc-no">${q.quoteNo}</div>
<div class="meta">
  <span>작성일: ${q.date}</span>
  ${q.validUntil ? `<span>유효기간: ~${q.validUntil}</span>` : ''}
</div>
<div class="header-wrap">
  <div class="header-box">
    <div class="hbox-title">◼ ${isQuote ? '수신 (공급받는 자)' : '공급사 (매입처)'}</div>
    <div class="hrow"><span class="hlabel">상호</span><span>${vendor ? vendor.companyName : ''}</span></div>
    <div class="hrow"><span class="hlabel">대표자</span><span>${vendor ? vendor.representative||'' : ''}</span></div>
    <div class="hrow"><span class="hlabel">사업자번호</span><span>${vendor ? vendor.businessNumber||'' : ''}</span></div>
    <div class="hrow"><span class="hlabel">주소</span><span>${vendor ? vendor.address||'' : ''}</span></div>
  </div>
  <div class="header-box">
    <div class="hbox-title">◼ ${isQuote ? '공급자 (발행)' : '발주자'}</div>
    <div class="hrow"><span class="hlabel">상호</span><span>${ci.name||''}</span></div>
    <div class="hrow"><span class="hlabel">대표자</span><span>${ci.representative||''}</span></div>
    <div class="hrow"><span class="hlabel">사업자번호</span><span>${ci.businessNumber||''}</span></div>
    <div class="hrow"><span class="hlabel">주소</span><span>${ci.address||''}</span></div>
    <div class="hrow"><span class="hlabel">연락처</span><span>${ci.tel||''}</span></div>
  </div>
</div>
<table>
  <thead><tr>
    <th style="width:28px">No</th><th>품목명</th><th style="width:44px">단위</th>
    <th style="width:44px">수량</th><th style="width:70px">단가</th>
    <th style="width:80px">공급가액</th><th style="width:70px">세액</th>
    <th style="width:84px">합계금액</th><th style="width:70px">비고</th>
  </tr></thead>
  <tbody>
    ${rows}
    <tr class="total-row">
      <td colspan="5" style="text-align:right">합 계</td>
      <td style="text-align:right">${fmt(grandAmt)}</td>
      <td style="text-align:right">${fmt(grandTax)}</td>
      <td style="text-align:right">${fmt(grandAmt+grandTax)}</td>
      <td></td>
    </tr>
  </tbody>
</table>
<div class="summary">
  <div class="srow"><span>공급가액 합계</span><span>${fmt(grandAmt)}원</span></div>
  <div class="srow"><span>세액 합계 (VAT 10%)</span><span>${fmt(grandTax)}원</span></div>
  <div class="srow grand"><span>${isQuote ? '견 적 금 액' : '발 주 금 액'}</span><span>${fmt(grandAmt+grandTax)}원</span></div>
</div>
${q.memo ? `<div class="memo-box">📝 메모: ${q.memo}</div>` : ''}
<div class="stamp">
  <div class="stamp-box">
    <div>${ci.name||'(발행자)'}</div>
    <div>대표자: ${ci.representative||''} (인)</div>
  </div>
</div>
</body></html>`;
}

// ── 세금 분석 페이지 ──────────────────────────────────────

function calcIncomeTax(income) {
  if (income <= 0) return 0;
  const brackets = [
    [14000000,   0.06,        0],
    [50000000,   0.15,  1260000],
    [88000000,   0.24,  5760000],
    [150000000,  0.35, 15440000],
    [300000000,  0.38, 19940000],
    [500000000,  0.40, 25940000],
    [1000000000, 0.42, 35940000],
    [Infinity,   0.45, 65940000],
  ];
  for (const [limit, rate, deduction] of brackets) {
    if (income <= limit) return Math.round(income * rate - deduction);
  }
}

function calcEarnedIncomeDeduction(salary) {
  let d = 0;
  if (salary <= 5000000)        d = salary * 0.7;
  else if (salary <= 15000000)  d = 3500000  + (salary - 5000000)  * 0.4;
  else if (salary <= 45000000)  d = 7500000  + (salary - 15000000) * 0.15;
  else if (salary <= 100000000) d = 12000000 + (salary - 45000000) * 0.05;
  else                          d = 14750000 + (salary - 100000000)* 0.02;
  return Math.min(Math.round(d), 20000000);
}

function calcInsuranceEstimate(salary) {
  const m = salary / 12;
  return {
    pension:    Math.round(Math.min(m, 6170000) * 0.045 * 12),
    health:     Math.round(m * 0.03545 * 12),
    ltc:        Math.round(m * 0.03545 * 12 * 0.1295),
    employment: Math.round(m * 0.009 * 12),
  };
}
function calcInsurance(salary) {
  const e = calcInsuranceEstimate(salary);
  return e.pension + e.health + e.ltc + e.employment;
}

// 월급 명세 추산 (지급/공제/실수령). 4대보험·소득세는 연간 override 있으면 우선 적용.
function calcMonthlyPayslip(annualSalary, ov) {
  ov = ov || {};
  const gross = Math.round(annualSalary / 12);
  const est   = calcInsuranceEstimate(annualSalary);
  const pension    = ov.pension    ?? est.pension;
  const health     = ov.health     ?? est.health;
  const ltc        = ov.ltc        ?? est.ltc;
  const employment = ov.employment ?? est.employment;

  let incomeTaxAnnual;
  if (ov.withheld) {
    incomeTaxAnnual = ov.withheld;
  } else {
    const earnedDed    = calcEarnedIncomeDeduction(annualSalary);
    const earnedIncome = annualSalary - earnedDed;
    const personalDed  = (1 + (ov.dependents || 0)) * 1500000;
    const taxable      = Math.max(0, earnedIncome - personalDed - pension);
    const gross2       = calcIncomeTax(taxable);
    const credit       = calcEarnedIncomeCredit(annualSalary, gross2);
    incomeTaxAnnual    = Math.max(0, gross2 - credit);
  }

  const incomeTaxM  = Math.round(incomeTaxAnnual / 12);
  const localTaxM   = Math.round(incomeTaxM * 0.1);
  const pensionM    = Math.round(pension / 12);
  const healthM     = Math.round(health / 12);
  const ltcM        = Math.round(ltc / 12);
  const employmentM = Math.round(employment / 12);
  const deductM     = incomeTaxM + localTaxM + pensionM + healthM + ltcM + employmentM;
  return { gross, incomeTaxM, localTaxM, pensionM, healthM, ltcM, employmentM, deductM, net: gross - deductM };
}

function calcCardDeduction(salary, creditCard, debitCash) {
  const threshold = Math.round(salary * 0.25);
  if (creditCard + debitCash <= threshold) return 0;
  let deduction = 0;
  if (creditCard >= threshold) {
    deduction = (creditCard - threshold) * 0.15 + debitCash * 0.30;
  } else {
    deduction = Math.max(0, debitCash - (threshold - creditCard)) * 0.30;
  }
  const limit = salary <= 70000000 ? 3000000 : salary <= 120000000 ? 2500000 : 2000000;
  return Math.min(Math.round(deduction), limit);
}

function calcPensionSavingsCredit(salary, pensionSavings, irp) {
  if (!pensionSavings && !irp) return 0;
  const ps    = Math.min(pensionSavings || 0, 4000000);
  const total = Math.min(ps + (irp || 0), 7000000);
  const rate  = salary <= 55000000 ? 0.165 : 0.132;
  return Math.round(total * rate);
}

function calcEarnedIncomeCredit(salary, taxAmount) {
  let limit;
  if (salary <= 33000000)      limit = 740000;
  else if (salary <= 70000000) limit = Math.max(740000 - (salary - 33000000) * 8 / 1000, 660000);
  else                         limit = Math.max(660000 - (salary - 70000000) * 0.5, 500000);
  const credit = taxAmount <= 1300000 ? taxAmount * 0.55 : 715000 + (taxAmount - 1300000) * 0.3;
  return Math.min(Math.round(credit), Math.round(limit));
}

function loadTaxSettings() {
  return DBshared.load('acc_tax_settings', JSON.stringify({
    salary: 52000000, startupReduction: true, dependents: 0,
    pension: null, health: null, ltc: null, employment: null,
    withheld: 0, creditCard: 0, debitCash: 0, pensionSavings: 0, irp: 0,
    misc: {}
  }));
}
function saveTaxSettings(s) { DBshared.save('acc_tax_settings', s); }

function getAllBizVat() {
  const year = new Date().getFullYear();
  return businesses.map(b => {
    let h1s = 0, h1p = 0, h2s = 0, h2p = 0;
    try {
      const txs = JSON.parse(localStorage.getItem('acc_transactions__' + b.id) || '[]');
      txs.forEach(t => {
        if (!t.date) return;
        const tax = t.items.reduce((s, i) => s + (i.tax || 0), 0);
        const half = t.date >= `${year}-07-01` ? 'h2' : (t.date >= `${year}-01-01` ? 'h1' : null);
        if (!half) return;
        if (t.type === '매출') { if (half==='h1') h1s+=tax; else h2s+=tax; }
        else                   { if (half==='h1') h1p+=tax; else h2p+=tax; }
      });
    } catch {}
    return { name: b.name, h1: { sales: h1s, purchase: h1p, due: h1s-h1p }, h2: { sales: h2s, purchase: h2p, due: h2s-h2p } };
  });
}

function getAllBizIncome() {
  const year = new Date().getFullYear();
  const start = `${year}-01-01`, end = `${year}-12-31`;
  const bizSummary = businesses.map(b => {
    let sales = 0, purchase = 0;
    try {
      const txs = JSON.parse(localStorage.getItem('acc_transactions__' + b.id) || '[]');
      txs.filter(t => t.date >= start && t.date <= end).forEach(t => {
        const amt = t.items.reduce((s, i) => s + (i.amount||0) + (i.tax||0), 0);
        if (t.type === '매출') sales += amt; else purchase += amt;
      });
    } catch {}
    return { name: b.name, sales, purchase };
  });
  const totalSales    = bizSummary.reduce((s, b) => s + b.sales, 0);
  const totalPurchase = bizSummary.reduce((s, b) => s + b.purchase, 0);
  return { bizSummary, totalSales, totalPurchase };
}

// 숫자 입력 쉼표 포맷
function fmtField(el) {
  const pos    = el.selectionStart;
  const oldLen = el.value.length;
  const digits  = el.value.replace(/[^0-9]/g, '');
  const formatted = digits ? Number(digits).toLocaleString('ko-KR') : '';
  el.value = formatted;
  el.selectionStart = el.selectionEnd = Math.max(0, pos + (formatted.length - oldLen));
}
function onNumInput(el) {
  fmtField(el);
  recalcTax();
}
// 세전 연봉 입력 → 세전 월급 동기화
function onSalaryInput(el) {
  fmtField(el);
  const annual = parseNum('ti-salary');
  const m = document.getElementById('ti-msalary');
  if (m) m.value = annual ? Math.round(annual / 12).toLocaleString('ko-KR') : '';
  recalcTax();
}
// 세전 월급 입력 → 세전 연봉 동기화
function onMonthlyInput(el) {
  fmtField(el);
  const monthly = parseNum('ti-msalary');
  const s = document.getElementById('ti-salary');
  if (s) s.value = monthly ? Math.round(monthly * 12).toLocaleString('ko-KR') : '';
  recalcTax();
}
function parseNum(id) {
  const v = document.getElementById(id)?.value || '';
  return parseInt(v.replace(/[^0-9]/g, '')) || 0;
}
function parseNumNull(id) {
  const v = (document.getElementById(id)?.value || '').replace(/[^0-9]/g, '');
  return v ? parseInt(v) : null;
}
function numFmt(n) { return n ? Math.round(n).toLocaleString('ko-KR') : ''; }

function renderTaxPage(el) {
  const settings = loadTaxSettings();
  const salary0 = settings.salary || 52000000;
  const est0 = calcInsuranceEstimate(salary0);
  const fmtN = n => Math.abs(Math.round(n)).toLocaleString('ko-KR');

  const misc = settings.misc || {};
  const autoExp = getConfirmedExpenseByCategory();   // 사업비 후보에서 반영된 카드경비 (계정별 합계)
  const ni = (id, val, ph) => `<input type="text" inputmode="numeric" id="${id}" class="form-control" value="${numFmt(val)}" placeholder="${ph||'0'}" oninput="onNumInput(this)" style="text-align:right">`;
  const autoHint = k => autoExp[k] > 0 ? `<span style="font-size:11px;font-weight:600;color:var(--primary)"> · 카드 ${autoExp[k].toLocaleString('ko-KR')}원 자동</span>` : '';

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">💰 세금 분석</div>
        <div class="page-subtitle">${new Date().getFullYear()}년 예상 세금 · 입력값 기준 실시간 추산</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="saveTaxInputs()">💾 설정 저장</button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <!-- 근로소득 -->
      <div class="card">
        <div style="font-size:13px;font-weight:700;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--gray-200)">👔 근로소득</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="form-group">
              <label>세전 연봉</label>
              <input type="text" inputmode="numeric" id="ti-salary" class="form-control" value="${numFmt(salary0)}" placeholder="0" oninput="onSalaryInput(this)" style="text-align:right">
            </div>
            <div class="form-group">
              <label>세전 월급 <span style="font-size:11px;font-weight:400;color:var(--gray-500)">(연봉÷12)</span></label>
              <input type="text" inputmode="numeric" id="ti-msalary" class="form-control" value="${numFmt(Math.round(salary0/12))}" placeholder="0" oninput="onMonthlyInput(this)" style="text-align:right">
            </div>
          </div>
          <div class="form-group">
            <label>원천징수 소득세 (연간) <span style="font-size:11px;font-weight:400;color:var(--gray-500)">급여명세서 소득세 합산</span></label>
            ${ni('ti-withheld', settings.withheld, '0 (모르면 자동추산)')}
          </div>
          <div style="font-size:12px;font-weight:600;color:var(--gray-500)">4대보험 연간 납부액 (빈칸 = 자동추산)</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="form-group"><label>국민연금</label>${ni('ti-pension', settings.pension, fmtN(est0.pension)+' 추산')}</div>
            <div class="form-group"><label>건강보험</label>${ni('ti-health', settings.health, fmtN(est0.health)+' 추산')}</div>
            <div class="form-group"><label>장기요양</label>${ni('ti-ltc', settings.ltc, fmtN(est0.ltc)+' 추산')}</div>
            <div class="form-group"><label>고용보험</label>${ni('ti-employment', settings.employment, fmtN(est0.employment)+' 추산')}</div>
          </div>
        </div>
      </div>

      <!-- 소득공제 -->
      <div class="card">
        <div style="font-size:13px;font-weight:700;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--gray-200)">🧾 공제 항목</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div class="form-group">
            <label>부양가족 수 (본인 제외)</label>
            <input type="number" id="ti-dependents" class="form-control" value="${settings.dependents||0}" min="0" oninput="recalcTax()">
          </div>
          <div style="font-size:12px;font-weight:600;color:var(--gray-500)">신용카드 소득공제 — 순수 개인소비만 (사업 매입 제외)</div>
          <div class="form-group">
            <label>신용카드 <span style="font-size:11px;font-weight:400;color:var(--gray-500)">(15%)</span></label>
            ${ni('ti-creditcard', settings.creditCard)}
          </div>
          <div class="form-group">
            <label>체크카드 + 현금영수증 <span style="font-size:11px;font-weight:400;color:var(--gray-500)">(30%)</span></label>
            ${ni('ti-debitcash', settings.debitCash)}
          </div>
          <div style="font-size:12px;font-weight:600;color:var(--gray-500)">연금 세액공제</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="form-group"><label>연금저축 <span style="font-size:11px;font-weight:400;color:var(--gray-500)">(한도 400만)</span></label>${ni('ti-pensionsavings', settings.pensionSavings)}</div>
            <div class="form-group"><label>IRP <span style="font-size:11px;font-weight:400;color:var(--gray-500)">(합산 700만)</span></label>${ni('ti-irp', settings.irp)}</div>
          </div>
          <div class="form-group">
            <label>창업중소기업 세액감면</label>
            <select id="ti-startup" class="form-control" onchange="recalcTax()">
              <option value="true"  ${settings.startupReduction !== false ? 'selected':''}>적용 (50% 감면)</option>
              <option value="false" ${settings.startupReduction === false  ? 'selected':''}>미적용</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <!-- 월급 명세 (추산) -->
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;padding-bottom:8px;border-bottom:1px solid var(--gray-200)">
        <div style="font-size:13px;font-weight:700">📄 월급 명세 (추산) <span style="font-size:11px;font-weight:400;color:var(--gray-500)">— 세전 연봉·월급 입력 시 4대보험·세후 월급 자동 계산</span></div>
        <button class="btn btn-ghost btn-sm" onclick="showPayslipMethod()">계산방법보기</button>
      </div>
      <div id="payslip-box"></div>
    </div>

    <!-- 기타 사업경비 -->
    <div class="card" style="margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;margin-bottom:4px;padding-bottom:8px;border-bottom:1px solid var(--gray-200)">
        🧾 기타 사업경비 <span style="font-size:11px;font-weight:400;color:var(--gray-500)">— 카드 자동합계(파란색) + 수동 추가입력. 둘을 합쳐 사업소득에서 차감</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px">
        <div class="form-group">
          <label>접대비 <span style="font-size:11px;font-weight:400;color:var(--gray-500)">거래처 식대·선물</span>${autoHint('접대비')}</label>
          ${ni('ti-misc-접대비', misc['접대비'])}
        </div>
        <div class="form-group">
          <label>차량유지비 <span style="font-size:11px;font-weight:400;color:var(--gray-500)">유류·수리·보험</span>${autoHint('차량유지비')}</label>
          ${ni('ti-misc-차량유지비', misc['차량유지비'])}
        </div>
        <div class="form-group">
          <label>통신비 <span style="font-size:11px;font-weight:400;color:var(--gray-500)">GPT·인터넷·통신</span>${autoHint('통신비')}</label>
          ${ni('ti-misc-통신비', misc['통신비'])}
        </div>
        <div class="form-group">
          <label>비품구입 <span style="font-size:11px;font-weight:400;color:var(--gray-500)">컴퓨터·사무용품</span>${autoHint('비품구입')}</label>
          ${ni('ti-misc-비품구입', misc['비품구입'])}
        </div>
        <div class="form-group">
          <label>복리후생비 <span style="font-size:11px;font-weight:400;color:var(--gray-500)">축의금·경조사</span>${autoHint('복리후생비')}</label>
          ${ni('ti-misc-복리후생비', misc['복리후생비'])}
        </div>
        <div class="form-group">
          <label>기타경비 <span style="font-size:11px;font-weight:400;color:var(--gray-500)">그 외 잡비</span>${autoHint('기타경비')}</label>
          ${ni('ti-misc-기타경비', misc['기타경비'])}
        </div>
      </div>
      <div id="misc-total" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--gray-200);font-size:13px;text-align:right;color:var(--gray-500)">소계: <strong style="color:var(--gray-900)">₩0</strong></div>
    </div>

    <div id="tax-results"></div>`;

  recalcTax();
}

function recalcTax() {
  const el = document.getElementById('tax-results');
  if (!el) return;

  const salary     = parseNum('ti-salary') || 52000000;
  const withheld   = parseNum('ti-withheld');
  const dependents = parseInt(document.getElementById('ti-dependents')?.value) || 0;
  const creditCard = parseNum('ti-creditcard');
  const debitCash  = parseNum('ti-debitcash');
  const pensionSavings = parseNum('ti-pensionsavings');
  const irp        = parseNum('ti-irp');
  const startupReduction = document.getElementById('ti-startup')?.value !== 'false';

  const MISC_KEYS = ['접대비','차량유지비','통신비','비품구입','복리후생비','기타경비'];
  const autoExpense = getConfirmedExpenseByCategory();          // 사업비 후보 반영분
  const autoTotal   = MISC_KEYS.reduce((s, k) => s + (autoExpense[k] || 0), 0);
  const manualTotal = MISC_KEYS.reduce((s, k) => s + parseNum('ti-misc-' + k), 0);
  const miscTotal   = autoTotal + manualTotal;                  // 자동 + 수동
  const miscEl = document.getElementById('misc-total');
  if (miscEl) {
    const autoLine = autoTotal > 0 ? `<span style="color:var(--gray-500)">카드자동 ₩${autoTotal.toLocaleString('ko-KR')} + 수동 ₩${manualTotal.toLocaleString('ko-KR')} = </span>` : '';
    miscEl.innerHTML = `소계: ${autoLine}<strong style="color:${miscTotal>0?'var(--danger)':'var(--gray-900)'}">${miscTotal>0?'-':''} ₩${miscTotal.toLocaleString('ko-KR')}</strong>`;
  }

  const est  = calcInsuranceEstimate(salary);
  const pension    = parseNumNull('ti-pension')    ?? est.pension;
  const health     = parseNumNull('ti-health')     ?? est.health;
  const ltc        = parseNumNull('ti-ltc')        ?? est.ltc;
  const employment = parseNumNull('ti-employment') ?? est.employment;
  const totalIns   = pension + health + ltc + employment;

  const year = new Date().getFullYear();
  const fmtW = n => (n < 0 ? '-' : '') + '₩' + Math.abs(Math.round(n)).toLocaleString('ko-KR');
  const dueBg  = n => n >= 0 ? 'color:var(--danger)' : 'color:var(--success)';
  const dueStr = n => n >= 0 ? fmtW(n) : '환급 ' + fmtW(Math.abs(n));

  // 4대보험 자동추산 placeholder 실시간 갱신
  const phN = n => Math.round(n).toLocaleString('ko-KR') + ' 추산';
  const setPh = (id, v) => { const e = document.getElementById(id); if (e) e.placeholder = phN(v); };
  setPh('ti-pension', est.pension); setPh('ti-health', est.health);
  setPh('ti-ltc', est.ltc);         setPh('ti-employment', est.employment);

  // 월급 명세 (지급/공제/실수령) 추산
  const pbox = document.getElementById('payslip-box');
  if (pbox) {
    const ps = calcMonthlyPayslip(salary, {
      pension: parseNumNull('ti-pension'), health: parseNumNull('ti-health'),
      ltc: parseNumNull('ti-ltc'), employment: parseNumNull('ti-employment'),
      withheld, dependents,
    });
    const row = (label, val, color) => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--gray-100)"><span style="color:var(--gray-500)">${label}</span><span style="${color||''}">${fmtW(val)}</span></div>`;
    const deductRate = ps.gross > 0 ? (ps.deductM / ps.gross * 100).toFixed(1) : '0.0';
    const taxHint = withheld > 0 ? '직접입력' : '자동추산 · 누진세율';
    pbox.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px">
        <div>
          <div style="font-size:12px;font-weight:700;color:var(--gray-500);margin-bottom:4px">지급</div>
          ${row('세전 월급 (지급총액)', ps.gross)}
          <div style="display:flex;justify-content:space-between;padding:8px 0;font-weight:700"><span>지급총액</span><span>${fmtW(ps.gross)}</span></div>
        </div>
        <div>
          <div style="font-size:12px;font-weight:700;color:var(--gray-500);margin-bottom:4px">공제</div>
          <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--gray-100)"><span style="color:var(--gray-500)">소득세 <span style="font-size:10px;color:var(--gray-400)">(${taxHint})</span></span><span style="color:var(--danger)">${fmtW(ps.incomeTaxM)}</span></div>
          ${row('주민세 (지방소득세)', ps.localTaxM, 'color:var(--danger)')}
          ${row('국민연금', ps.pensionM, 'color:var(--danger)')}
          ${row('건강보험', ps.healthM, 'color:var(--danger)')}
          ${row('장기요양보험', ps.ltcM, 'color:var(--danger)')}
          ${row('고용보험', ps.employmentM, 'color:var(--danger)')}
          <div style="display:flex;justify-content:space-between;padding:8px 0;font-weight:700"><span>공제총액 <span style="font-size:11px;font-weight:400;color:var(--gray-500)">(공제율 ${deductRate}%)</span></span><span style="color:var(--danger)">${fmtW(ps.deductM)}</span></div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;background:var(--primary-light);border-radius:var(--radius);padding:12px 16px;margin-top:12px">
        <span style="font-weight:700;color:var(--primary)">세후 월급 (실수령액)</span>
        <span style="font-weight:700;font-size:18px;color:var(--primary)">${fmtW(ps.net)}</span>
      </div>
      <div style="font-size:11px;color:var(--gray-500);margin-top:8px">소득세는 연봉 환산 후 근로소득공제·인적공제·국민연금공제를 반영한 누진세율(6~45%)로 추산합니다. 명세서 실제 소득세는 위 '원천징수 소득세(연간)' 칸에 입력하면 그대로 반영됩니다.</div>`;
  }

  const earnedDed    = calcEarnedIncomeDeduction(salary);
  const earnedIncome = salary - earnedDed;
  const dependentsDed = (1 + dependents) * 1500000;
  const cardDed = calcCardDeduction(salary, creditCard, debitCash);
  const totalDed = dependentsDed + totalIns + cardDed;

  const { bizSummary, totalSales, totalPurchase } = getAllBizIncome();
  const bizIncome = Math.max(0, totalSales - totalPurchase - miscTotal);

  const totalIncome   = earnedIncome + bizIncome;
  const taxableIncome = Math.max(0, totalIncome - totalDed);
  const grossTax      = calcIncomeTax(taxableIncome);

  const pensionCredit = calcPensionSavingsCredit(salary, pensionSavings, irp);
  const earnedRatio   = totalIncome > 0 ? earnedIncome / totalIncome : 1;
  const earnedTaxPart = Math.round(grossTax * earnedRatio);
  const bizTaxPart    = grossTax - earnedTaxPart;
  const earnedCredit  = calcEarnedIncomeCredit(salary, earnedTaxPart);
  const startupCredit = startupReduction ? Math.round(bizTaxPart * 0.5) : 0;
  const finalTax      = Math.max(0, grossTax - earnedCredit - startupCredit - pensionCredit);
  const localTax      = Math.round(finalTax * 0.1);
  const totalTaxDue   = finalTax + localTax;
  const netDue        = totalTaxDue - withheld;

  // (3) 예상 절세액: 기타 사업경비가 없을 때 대비 줄어든 세금
  const bizIncomeNoMisc   = Math.max(0, totalSales - totalPurchase);
  const totalIncomeNoMisc = earnedIncome + bizIncomeNoMisc;
  const taxableNoMisc     = Math.max(0, totalIncomeNoMisc - totalDed);
  const grossTaxNoMisc    = calcIncomeTax(taxableNoMisc);
  const earnedRatioNo     = totalIncomeNoMisc > 0 ? earnedIncome / totalIncomeNoMisc : 1;
  const earnedTaxPartNo   = Math.round(grossTaxNoMisc * earnedRatioNo);
  const bizTaxPartNo      = grossTaxNoMisc - earnedTaxPartNo;
  const earnedCreditNo    = calcEarnedIncomeCredit(salary, earnedTaxPartNo);
  const startupCreditNo   = startupReduction ? Math.round(bizTaxPartNo * 0.5) : 0;
  const finalTaxNo        = Math.max(0, grossTaxNoMisc - earnedCreditNo - startupCreditNo - pensionCredit);
  const totalTaxDueNo     = finalTaxNo + Math.round(finalTaxNo * 0.1);
  const taxSaving         = Math.max(0, totalTaxDueNo - totalTaxDue);

  const vatData = getAllBizVat();
  const h1Total = vatData.reduce((s, b) => s + b.h1.due, 0);
  const h2Total = vatData.reduce((s, b) => s + b.h2.due, 0);

  const TAX_BRACKETS = [
    { range: '1,400만원 이하',    rate: '6%',  ded: '-',        limit: 14000000   },
    { range: '1,400~5,000만원',   rate: '15%', ded: '126만원',  limit: 50000000   },
    { range: '5,000~8,800만원',   rate: '24%', ded: '576만원',  limit: 88000000   },
    { range: '8,800만~1.5억원',   rate: '35%', ded: '1,544만원',limit: 150000000  },
    { range: '1.5억~3억원',       rate: '38%', ded: '1,994만원',limit: 300000000  },
    { range: '3억~5억원',         rate: '40%', ded: '2,594만원',limit: 500000000  },
    { range: '5억~10억원',        rate: '42%', ded: '3,594만원',limit: 1000000000 },
    { range: '10억원 초과',       rate: '45%', ded: '6,594만원',limit: Infinity   },
  ];
  const curIdx = TAX_BRACKETS.findIndex(b => taxableIncome <= b.limit);

  el.innerHTML = `
    <div style="font-size:15px;font-weight:700;margin-bottom:12px">📋 부가세 (VAT)</div>
    <div class="table-wrapper" style="margin-bottom:24px">
      <table>
        <thead><tr>
          <th>사업체</th>
          <th style="text-align:right">상반기 (1~6월)</th>
          <th style="text-align:right">하반기 (7~12월)</th>
          <th style="text-align:right">연간 합계</th>
        </tr></thead>
        <tbody>
          ${vatData.map(b => `<tr>
            <td style="font-weight:600">${b.name}</td>
            <td style="text-align:right">
              <div style="font-weight:600;${dueBg(b.h1.due)}">${dueStr(b.h1.due)}</div>
              <div style="font-size:11px;color:var(--gray-500)">매출세 ${b.h1.sales.toLocaleString()} / 매입세 ${b.h1.purchase.toLocaleString()}</div>
            </td>
            <td style="text-align:right">
              <div style="font-weight:600;${dueBg(b.h2.due)}">${dueStr(b.h2.due)}</div>
              <div style="font-size:11px;color:var(--gray-500)">매출세 ${b.h2.sales.toLocaleString()} / 매입세 ${b.h2.purchase.toLocaleString()}</div>
            </td>
            <td style="text-align:right;font-weight:700;font-size:15px;${dueBg(b.h1.due+b.h2.due)}">${dueStr(b.h1.due+b.h2.due)}</td>
          </tr>`).join('')}
          ${vatData.length > 1 ? `<tr style="background:var(--gray-50);border-top:2px solid var(--gray-200)">
            <td style="font-weight:700">합계</td>
            <td style="text-align:right;font-weight:700;${dueBg(h1Total)}">${dueStr(h1Total)}</td>
            <td style="text-align:right;font-weight:700;${dueBg(h2Total)}">${dueStr(h2Total)}</td>
            <td style="text-align:right;font-weight:700;font-size:15px;${dueBg(h1Total+h2Total)}">${dueStr(h1Total+h2Total)}</td>
          </tr>` : ''}
        </tbody>
      </table>
    </div>

    <div style="font-size:15px;font-weight:700;margin-bottom:12px">📊 종합소득세</div>
    ${miscTotal > 0 ? (taxSaving > 0 ? `<div style="display:flex;align-items:center;justify-content:space-between;background:var(--success-light);border:1px solid #bbf7d0;border-radius:var(--radius);padding:12px 16px;margin-bottom:16px">
      <div>
        <div style="font-weight:700;color:var(--success)">💰 기타 사업경비로 줄어든 세금 (추정)</div>
        <div style="font-size:11.5px;color:var(--gray-500);margin-top:2px">경비 ${fmtW(miscTotal)} 반영 시 · 소득세+지방세 기준${startupReduction?' · 창업감면 반영':''}</div>
      </div>
      <div style="font-size:20px;font-weight:700;color:var(--success)">-${fmtW(taxSaving)}</div>
    </div>` : `<div style="background:var(--gray-50);border-radius:var(--radius);padding:12px 16px;margin-bottom:16px;font-size:12px;color:var(--gray-500)">
      💡 경비 ${fmtW(miscTotal)}를 반영했지만 <b>사업소득금액이 이미 0원</b>이라 추가 절세 효과가 없습니다. (사업 매출이 경비보다 커야 절세로 이어집니다)
    </div>`) : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div class="card">
        <div style="font-size:13px;font-weight:700;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--gray-200)">👔 근로소득</div>
        <div style="font-size:13px;display:flex;flex-direction:column;gap:6px">
          <div style="display:flex;justify-content:space-between"><span style="color:var(--gray-500)">세전 연봉</span><span>${fmtW(salary)}</span></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--gray-500)">근로소득공제</span><span style="color:var(--success)">-${fmtW(earnedDed)}</span></div>
          <div style="display:flex;justify-content:space-between;border-top:1px solid var(--gray-200);padding-top:6px;font-weight:600"><span>근로소득금액</span><span>${fmtW(earnedIncome)}</span></div>
        </div>
      </div>
      <div class="card">
        <div style="font-size:13px;font-weight:700;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--gray-200)">🏢 사업소득 (${year}년 누계)</div>
        <div style="font-size:13px;display:flex;flex-direction:column;gap:6px">
          ${bizSummary.map(b => `<div style="font-size:11.5px;color:var(--gray-500)">${b.name}: 매출 ${fmtW(b.sales)} / 매입 ${fmtW(b.purchase)}</div>`).join('')}
          ${miscTotal > 0 ? `<div style="font-size:11.5px;color:var(--gray-500)">기타 사업경비: -${fmtW(miscTotal)}</div>` : ''}
          <div style="display:flex;justify-content:space-between;border-top:1px solid var(--gray-200);padding-top:6px;font-weight:600"><span>사업소득금액</span><span>${fmtW(bizIncome)}</span></div>
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:3fr 2fr;gap:16px;margin-bottom:20px">
      <div class="card">
        <div style="font-size:13px;font-weight:700;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--gray-200)">세액 계산 상세</div>
        <div style="font-size:13px;display:flex;flex-direction:column;gap:7px">
          <div style="display:flex;justify-content:space-between"><span style="color:var(--gray-500)">종합소득금액 (근로+사업)</span><span style="font-weight:600">${fmtW(totalIncome)}</span></div>
          <div style="font-size:12px;font-weight:600;color:var(--gray-500);margin-top:2px">소득공제</div>
          <div style="display:flex;justify-content:space-between;padding-left:10px"><span style="color:var(--gray-500)">인적공제 (본인${dependents?'+부양가족'+dependents+'명':''})</span><span style="color:var(--success)">-${fmtW(dependentsDed)}</span></div>
          <div style="display:flex;justify-content:space-between;padding-left:10px">
            <span style="color:var(--gray-500)">4대보험 <span style="font-size:11px">(국민연금 ${fmtW(pension)} + 건강 ${fmtW(health)} + 장기 ${fmtW(ltc)} + 고용 ${fmtW(employment)})</span></span>
            <span style="color:var(--success)">-${fmtW(totalIns)}</span>
          </div>
          ${cardDed > 0 ? `<div style="display:flex;justify-content:space-between;padding-left:10px"><span style="color:var(--gray-500)">신용카드 소득공제</span><span style="color:var(--success)">-${fmtW(cardDed)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;border-top:1px solid var(--gray-200);padding-top:7px;font-weight:700"><span>과세표준</span><span style="font-size:14px">${fmtW(taxableIncome)}</span></div>
          <div style="display:flex;justify-content:space-between;background:var(--primary-light);padding:6px 10px;border-radius:4px">
            <span style="color:var(--primary);font-size:12px">적용 세율 구간</span>
            <span style="color:var(--primary);font-weight:700">${TAX_BRACKETS[curIdx]?.range} · ${TAX_BRACKETS[curIdx]?.rate}</span>
          </div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--gray-500)">산출세액</span><span style="font-weight:600">${fmtW(grossTax)}</span></div>
          <div style="font-size:12px;font-weight:600;color:var(--gray-500);margin-top:2px">세액공제</div>
          <div style="display:flex;justify-content:space-between;padding-left:10px"><span style="color:var(--gray-500)">근로소득세액공제</span><span style="color:var(--success)">-${fmtW(earnedCredit)}</span></div>
          ${startupReduction ? `<div style="display:flex;justify-content:space-between;padding-left:10px"><span style="color:var(--gray-500)">창업중소기업 감면 (50%)</span><span style="color:var(--success)">-${fmtW(startupCredit)}</span></div>` : ''}
          ${pensionCredit > 0 ? `<div style="display:flex;justify-content:space-between;padding-left:10px"><span style="color:var(--gray-500)">연금 세액공제</span><span style="color:var(--success)">-${fmtW(pensionCredit)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;border-top:2px solid var(--gray-300);padding-top:7px;font-weight:700"><span>결정세액 (소득세)</span><span style="color:var(--danger)">${fmtW(finalTax)}</span></div>
          <div style="display:flex;justify-content:space-between"><span style="color:var(--gray-500)">지방소득세 (10%)</span><span style="color:var(--danger)">${fmtW(localTax)}</span></div>
          <div style="display:flex;justify-content:space-between;border-top:1px solid var(--gray-200);padding-top:7px;font-weight:700"><span>소득세 + 지방세 합계</span><span style="font-size:15px;color:var(--danger)">${fmtW(totalTaxDue)}</span></div>
          ${withheld > 0 ? `
          <div style="display:flex;justify-content:space-between"><span style="color:var(--gray-500)">기납부세액 (원천징수)</span><span style="color:var(--success)">-${fmtW(withheld)}</span></div>
          <div style="display:flex;justify-content:space-between;background:${netDue>=0?'var(--danger-light)':'var(--success-light)'};padding:10px 12px;border-radius:var(--radius);margin-top:4px">
            <span style="font-weight:700;color:${netDue>=0?'var(--danger)':'var(--success)'}">${netDue>=0?'추가 납부 예상':'환급 예상'}</span>
            <span style="font-weight:700;font-size:16px;color:${netDue>=0?'var(--danger)':'var(--success)'}">${fmtW(Math.abs(netDue))}</span>
          </div>` : `
          <div style="display:flex;justify-content:space-between;background:var(--danger-light);padding:10px 12px;border-radius:var(--radius);margin-top:4px">
            <span style="font-weight:700;color:var(--danger)">최종 납부 예상</span>
            <span style="font-weight:700;font-size:16px;color:var(--danger)">${fmtW(totalTaxDue)}</span>
          </div>`}
        </div>
      </div>

      <div class="card" style="padding:0;overflow:hidden">
        <div style="font-size:13px;font-weight:700;padding:14px 16px 10px;border-bottom:1px solid var(--gray-200)">종합소득세 세율 구간</div>
        <table style="width:100%;font-size:12px;border-collapse:collapse">
          <thead><tr style="background:var(--gray-50)">
            <th style="padding:7px 10px;text-align:left;color:var(--gray-500);font-size:11px">과세표준</th>
            <th style="padding:7px 8px;text-align:center;color:var(--gray-500);font-size:11px">세율</th>
            <th style="padding:7px 10px;text-align:right;color:var(--gray-500);font-size:11px">누진공제</th>
          </tr></thead>
          <tbody>
            ${TAX_BRACKETS.map((b, i) => `
            <tr style="border-bottom:1px solid var(--gray-100);${i===curIdx?'background:#eff6ff;':''}">
              <td style="padding:7px 10px;${i===curIdx?'font-weight:700;color:var(--primary)':''}">${b.range}${i===curIdx?' ◀':''}</td>
              <td style="padding:7px 8px;text-align:center;font-weight:600;${i===curIdx?'color:var(--primary)':''}">${b.rate}</td>
              <td style="padding:7px 10px;text-align:right;color:var(--gray-500)">${b.ded}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div style="font-size:12px;color:var(--gray-500);background:var(--gray-50);border-radius:var(--radius);padding:12px 16px;line-height:1.7">
      ⚠ 추산값이며 실제 납부액은 세무사 신고 결과와 다를 수 있습니다. 중간예납, 성실신고 등 별도 사항은 반영되지 않습니다.
    </div>`;
}

function saveTaxInputs() {
  const MISC_KEYS = ['접대비','차량유지비','통신비','비품구입','복리후생비','기타경비'];
  const misc = {};
  MISC_KEYS.forEach(k => { const v = parseNum('ti-misc-' + k); if (v) misc[k] = v; });
  saveTaxSettings({
    salary:          parseNum('ti-salary') || 52000000,
    withheld:        parseNum('ti-withheld'),
    dependents:      parseInt(document.getElementById('ti-dependents')?.value) || 0,
    creditCard:      parseNum('ti-creditcard'),
    debitCash:       parseNum('ti-debitcash'),
    pensionSavings:  parseNum('ti-pensionsavings'),
    irp:             parseNum('ti-irp'),
    startupReduction: document.getElementById('ti-startup')?.value !== 'false',
    pension:         parseNumNull('ti-pension'),
    health:          parseNumNull('ti-health'),
    ltc:             parseNumNull('ti-ltc'),
    employment:      parseNumNull('ti-employment'),
    misc,
  });
  const btn = document.querySelector('[onclick="saveTaxInputs()"]');
  if (btn) { const orig = btn.textContent; btn.textContent = '✓ 저장됨'; setTimeout(() => { btn.textContent = orig; }, 1500); }
}

function showPayslipMethod() {
  openModal('월급 명세 계산 방법', `
    <div style="font-size:13px;line-height:1.8;color:var(--gray-700)">
      <p style="margin:0 0 12px"><b>세전 월급 = 세전 연봉 ÷ 12</b> (두 칸은 자동 연동되며, 어느 쪽이든 직접 입력할 수 있습니다.)</p>
      <p style="margin:0 0 6px;font-weight:700">공제 항목 (2025년 기준 요율)</p>
      <ul style="margin:0 0 12px;padding-left:18px">
        <li>국민연금 — 기준소득월액 × 4.5% (상한 6,170,000원)</li>
        <li>건강보험 — 보수월액 × 3.545%</li>
        <li>장기요양보험 — 건강보험료 × 12.95%</li>
        <li>고용보험 — 보수월액 × 0.9%</li>
        <li>소득세 — 연봉 기준 근로소득공제·인적공제·국민연금 공제 후 산출세액에서 근로소득세액공제를 차감해 연환산, ÷12</li>
        <li>주민세 (지방소득세) — 소득세 × 10%</li>
      </ul>
      <p style="margin:0 0 12px"><b>세후 월급 (실수령액) = 지급총액 − 공제총액</b></p>
      <p style="margin:0;font-size:12px;color:var(--gray-500)">※ 4대보험 실제 부과 기준(기준소득월액·보수월액)은 전년도 신고소득을 따르므로 추산값과 차이가 날 수 있습니다. 정확한 값은 4대보험/소득세 칸에 급여명세서 금액을 <b>직접 입력</b>하면 그 값이 우선 적용됩니다.</p>
    </div>`);
}


// ── 사업비 후보 ────────────────────────────────────────────
function loadCandidates()          { return DBshared.load('acc_expense_candidates', '[]'); }
function saveCandidates(list)      { DBshared.save('acc_expense_candidates', list); }

function suggestCategory(merchant) {
  const m = merchant || '';
  if (/주유|GS칼텍스|SK에너지|현대오일|오일뱅크|S-OIL|세차/i.test(m))   return '차량유지비';
  if (/KT|SKT|LGU|통신|휴대폰|알뜰폰|인터넷/i.test(m))                   return '통신비';
  if (/마트|이마트|홈플러스|코스트코|다이소|오피스|문구/i.test(m))         return '비품구입';
  if (/식당|고기|해장|치킨|피자|카페|커피|베이커리|파리바게|스타벅/i.test(m)) return '접대비';
  if (/AWS|Google|클라우드|호스팅|도메인|GPT|구독|소프트웨어/i.test(m))    return '통신비';
  if (/병원|약국|건강/i.test(m))                                           return '복리후생비';
  return '기타경비';
}

function parseSmsBody(body) {
  // 날짜: MM/DD 또는 YYYY-MM-DD 또는 MM-DD
  const dateMatch = body.match(/(\d{4})-(\d{2})-(\d{2})/) ||
                    body.match(/(\d{1,2})[\/.월](\d{1,2})/);
  let date = '';
  if (dateMatch) {
    if (dateMatch[0].includes('-') && dateMatch[1].length === 4) {
      date = dateMatch[0];
    } else {
      const y = new Date().getFullYear();
      const mm = String(dateMatch[1]).padStart(2, '0');
      const dd = String(dateMatch[2]).padStart(2, '0');
      date = `${y}-${mm}-${dd}`;
    }
  }
  // 시각(HH:MM)이 있으면 날짜에 붙임
  const tMatch = body.match(/(\d{1,2}):(\d{2})/);
  if (date && tMatch) date = `${date} ${String(tMatch[1]).padStart(2,'0')}:${tMatch[2]}`;
  // 금액: 숫자+쉼표+"원" (누적 제외)
  const amtMatch = body.replace(/누적\s*[\d,]+원/g, '').match(/([\d,]+)원/);
  const amount = amtMatch ? parseInt(amtMatch[1].replace(/,/g, '')) : 0;
  // 카드사 (라스베가스=롯데카드 별칭 → 롯데카드로 정규화)
  const cardMatch = body.match(/라스베가스|롯데카드|현대카드/);
  let cardType = cardMatch ? cardMatch[0] : '';
  if (cardType === '라스베가스') cardType = '롯데카드';
  // 가맹점: 첫 줄이 가맹점명 (예: 네이버파이낸셜), 아니면 키워드 제거 후 첫 단어
  const lines = body.split(/\n/).map(s => s.trim()).filter(Boolean);
  const NOISE = /[\d,]+원|라스베가스|롯데카드|현대카드|승인|취소/;
  let merchant;
  if (lines.length > 1 && lines[0] && !lines[0].includes('[') && !NOISE.test(lines[0])) {
    merchant = lines[0];
  } else {
    merchant = body
      .replace(/\[.*?\]/g, '')
      .replace(/라스베가스|롯데카드|현대카드/g, '')
      .replace(/\d{1,4}[\/\-\.월]\d{1,2}[일]?(\s*\d{1,2}:\d{2})?/g, '')
      .replace(/[\d,]+원/g, '')
      .replace(/승인|취소|일시불|할부|포인트|캐시백/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .split(/\s/)[0] || '(가맹점 미확인)';
  }
  return { date, amount, cardType, merchant };
}

function candidateId(date, merchant, amount) {
  return [date, merchant, amount].join('|');
}

let _candidatesCache = null;

async function fetchCandidatesFromGas() {
  if (!APPS_SCRIPT_URL) { alert('⚙ 시트 URL이 설정되지 않았습니다.'); return; }
  try {
    const res  = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ secretKey: SHEETS_SECRET, action: 'getExpenseCandidates' })
    });
    const json = await res.json();
    if (json.candidates) {
      const existing = loadCandidates();
      const existingIds = new Set(existing.map(c => c.id));
      const merged = [...existing];
      json.candidates.forEach(c => { if (!existingIds.has(c.id)) merged.push(c); });
      saveCandidates(merged);
      _candidatesCache = merged;
      return merged;
    }
  } catch (err) {
    alert('GAS 연결 오류: ' + err.message);
  }
  return null;
}

const EXPENSE_CATS = ['접대비','차량유지비','통신비','비품구입','복리후생비','기타경비'];

// 후보 날짜 표시 → "2026년 06월 28일 20시 30분" (시각 없으면 날짜만)
function candDateText(d) {
  if (!d) return '<span style="color:var(--gray-500)">날짜미상</span>';
  const s = String(d);
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (m) {
    let [, y, mo, da, hh, mi] = m;
    if (/Z$/.test(s)) {                       // UTC 표기면 KST(+9)로 변환
      const dt = new Date(s);
      if (!isNaN(dt.getTime())) {
        const k = new Date(dt.getTime() + 9 * 3600 * 1000);
        y  = k.getUTCFullYear();
        mo = String(k.getUTCMonth() + 1).padStart(2, '0');
        da = String(k.getUTCDate()).padStart(2, '0');
        hh = String(k.getUTCHours()).padStart(2, '0');
        mi = String(k.getUTCMinutes()).padStart(2, '0');
      }
    }
    return `${y}년 ${mo}월 ${da}일 ${hh}시 ${mi}분`;
  }
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);      // 날짜만
  if (m) return `${m[1]}년 ${m[2]}월 ${m[3]}일`;
  return '<span style="color:var(--gray-500)">날짜미상</span>';
}

// ── 가맹점별 계정 학습 (3) ─────────────────────────────────
function loadMerchantCats()        { return DBshared.load('acc_merchant_cats', '{}'); }
function saveMerchantCats(map)     { DBshared.save('acc_merchant_cats', map); }
function learnMerchantCat(merchant, cat) {
  if (!merchant || !cat) return;
  const map = loadMerchantCats();
  map[merchant] = cat;
  saveMerchantCats(map);
}

// 후보의 계정: 직접 수정값 > 학습된 가맹점 계정 > 키워드 추천
function candCategory(c) {
  if (c.category) return c.category;
  const learned = loadMerchantCats()[c.merchant];
  if (learned) return learned;
  return c.suggestedCategory || '기타경비';
}

// 반영(confirmed)된 후보를 계정별로 합산 → 세금분석 연동용
function getConfirmedExpenseByCategory() {
  const sums = {};
  EXPENSE_CATS.forEach(k => sums[k] = 0);
  loadCandidates().forEach(c => {
    if (c.status === 'confirmed') {
      const k = candCategory(c);
      sums[k] = (sums[k] || 0) + (Number(c.amount) || 0);
    }
  });
  return sums;
}

function candMonth(c) {
  const d = c.date || '';
  return (/^\d{4}-\d{2}/.test(d)) ? d.slice(0, 7) : '';   // YYYY-MM (잘못된 날짜는 '')
}

const CAT_COLORS = { 접대비:'#ef4444', 차량유지비:'#f59e0b', 통신비:'#3b82f6', 비품구입:'#8b5cf6', 복리후생비:'#10b981', 기타경비:'#9ca3af' };

// ── (1) 월별 경비 추이 막대그래프 ─────────────────────────
function monthlyExpenseBarsHtml() {
  const byMonth = {};
  loadCandidates().forEach(c => {
    if (c.status === 'confirmed') {
      const m = candMonth(c) || '미상';
      byMonth[m] = (byMonth[m] || 0) + (Number(c.amount) || 0);
    }
  });
  const months = Object.keys(byMonth).sort().slice(-6);
  if (!months.length) return `<div style="color:var(--gray-500);font-size:12px;padding:20px 0;text-align:center">반영된 경비가 없습니다</div>`;
  const max = Math.max(...months.map(m => byMonth[m]), 1);
  const bars = months.map(m => {
    const pct = Math.round(byMonth[m] / max * 100);
    const label = m === '미상' ? '미상' : m.slice(2).replace('-', '.');
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px;min-width:0">
      <div style="font-size:10px;color:var(--gray-500);white-space:nowrap">${(byMonth[m]/10000).toFixed(byMonth[m]>=100000?0:1)}만</div>
      <div style="width:70%;max-width:34px;height:${Math.max(pct,2)}%;background:var(--primary);border-radius:4px 4px 0 0;transition:height .3s"></div>
      <div style="font-size:10px;color:var(--gray-700)">${label}</div>
    </div>`;
  }).join('');
  return `<div style="display:flex;align-items:flex-end;gap:6px;height:120px;padding-top:6px">${bars}</div>`;
}

// ── (2) 계정별 비중 도넛차트 ──────────────────────────────
function categoryDonutHtml() {
  const sums = getConfirmedExpenseByCategory();
  const entries = EXPENSE_CATS.map(k => [k, sums[k] || 0]).filter(e => e[1] > 0);
  const total = entries.reduce((s, e) => s + e[1], 0);
  if (!total) return `<div style="color:var(--gray-500);font-size:12px;padding:20px 0;text-align:center">반영된 경비가 없습니다</div>`;
  let acc = 0;
  const seg = entries.map(([k, v]) => {
    const from = acc / total * 100; acc += v;
    const to = acc / total * 100;
    return `${CAT_COLORS[k]} ${from}% ${to}%`;
  }).join(',');
  const legend = entries.map(([k, v]) => `<div style="display:flex;align-items:center;gap:6px;font-size:12px">
      <span style="width:10px;height:10px;border-radius:2px;background:${CAT_COLORS[k]};flex-shrink:0"></span>
      <span style="color:var(--gray-700)">${k}</span>
      <span style="color:var(--gray-500);margin-left:auto">${Math.round(v/total*100)}%</span>
    </div>`).join('');
  return `<div style="display:flex;align-items:center;gap:18px">
    <div style="width:110px;height:110px;border-radius:50%;background:conic-gradient(${seg});flex-shrink:0;position:relative">
      <div style="position:absolute;inset:26px;background:var(--white,#fff);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--gray-500);text-align:center;line-height:1.3">계정별<br>비중</div>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;gap:6px;min-width:0">${legend}</div>
  </div>`;
}

// ── (8) 경비 인정 위험(소명) 알림 ─────────────────────────
function expenseWarningsHtml() {
  const confirmed = loadCandidates().filter(c => c.status === 'confirmed');
  if (!confirmed.length) return '';
  const warns = [];

  // 주말 결제
  const weekendCnt = confirmed.filter(c => {
    const d = new Date(c.date);
    return !isNaN(d.getTime()) && (d.getDay() === 0 || d.getDay() === 6);
  }).length;
  if (weekendCnt) warns.push(`주말 결제 <b>${weekendCnt}건</b> — 업무 관련 여부 소명 대비`);

  // 단건 고액(50만원↑)
  const bigCnt = confirmed.filter(c => (Number(c.amount) || 0) >= 500000).length;
  if (bigCnt) warns.push(`50만원 이상 고액 <b>${bigCnt}건</b> — 증빙·업무관련성 확인`);

  // 접대비 한도(중소기업 기본 3,600만/년)
  const ent = getConfirmedExpenseByCategory()['접대비'] || 0;
  if (ent > 36000000) warns.push(`접대비 합계 <b>${ent.toLocaleString('ko-KR')}원</b> — 기본 한도(3,600만) 초과분은 손금 불산입`);
  else if (ent > 27000000) warns.push(`접대비 합계 <b>${ent.toLocaleString('ko-KR')}원</b> — 기본 한도(3,600만) 근접`);

  if (!warns.length) {
    return `<div style="font-size:12px;color:var(--success);background:var(--success-light);border-radius:6px;padding:10px 12px">✅ 소명 주의 항목 없음</div>`;
  }
  return `<div style="font-size:12px;color:var(--gray-700);background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px 12px;line-height:1.8">
    <div style="font-weight:700;color:#d97706;margin-bottom:4px">⚠ 소명 주의 항목</div>
    ${warns.map(w => `<div>· ${w}</div>`).join('')}
  </div>`;
}

// ── (7) 세무사용 경비 엑셀 내보내기 ───────────────────────
function exportExpensesExcel() {
  if (typeof XLSX === 'undefined') { alert('엑셀 모듈 로딩 중입니다. 잠시 후 다시 시도하세요.'); return; }
  const confirmed = loadCandidates().filter(c => c.status === 'confirmed');
  if (!confirmed.length) { alert('반영된 경비가 없습니다.'); return; }

  // 시트1: 상세 내역
  const detail = confirmed
    .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(c => ({
      '날짜': (/^\d{4}-\d{2}-\d{2}/.test(c.date)) ? c.date : '날짜미상',
      '가맹점': c.merchant || '',
      '금액': Number(c.amount) || 0,
      '계정과목': candCategory(c),
      '카드': c.cardType || '',
      '메모(소명)': c.memo || '',
    }));
  // 시트2: 계정별 합계
  const sums = getConfirmedExpenseByCategory();
  const summary = EXPENSE_CATS.filter(k => sums[k] > 0).map(k => ({ '계정과목': k, '합계': sums[k] }));
  summary.push({ '계정과목': '총계', '합계': summary.reduce((s, r) => s + r['합계'], 0) });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), '경비상세');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), '계정별합계');
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `사업경비_${today}.xlsx`);
}

function renderCandidatesPage(el) {
  _candidatesCache = loadCandidates();
  const filter = el._filter || 'pending';
  const month  = el._month  || 'all';   // 'all' | 'YYYY-MM'

  const counts = { all: 0, pending: 0, confirmed: 0, excluded: 0 };
  _candidatesCache.forEach(c => { counts.all++; if (counts[c.status] != null) counts[c.status]++; });

  // 중복(할부/취소 의심) 감지: 같은 가맹점+금액이 2건 이상 (4)
  const dupKey = c => (c.merchant || '') + '|' + (Number(c.amount) || 0);
  const dupCount = {};
  _candidatesCache.forEach(c => { const k = dupKey(c); dupCount[k] = (dupCount[k] || 0) + 1; });

  // 월 목록 (2)
  const months = [...new Set(_candidatesCache.map(candMonth).filter(Boolean))].sort().reverse();
  const monthOpts = `<option value="all" ${month==='all'?'selected':''}>전체 월</option>` +
    months.map(m => `<option value="${m}" ${month===m?'selected':''}>${m.replace('-','년 ')}월</option>`).join('');

  let list = filter === 'all' ? _candidatesCache
           : _candidatesCache.filter(c => c.status === filter);
  // 월 필터 (날짜미상 항목은 항상 표시해 놓치지 않게)
  if (month !== 'all') list = list.filter(c => candMonth(c) === month || candMonth(c) === '');

  // 반영된 금액 합계 (월 필터 반영)
  const confirmedTotal = _candidatesCache
    .filter(c => c.status === 'confirmed' && (month === 'all' || candMonth(c) === month || candMonth(c) === ''))
    .reduce((s, c) => s + (Number(c.amount) || 0), 0);

  const tabs = [
    { k: 'pending',   label: `대기 ${counts.pending}` },
    { k: 'confirmed', label: `반영됨 ${counts.confirmed}` },
    { k: 'excluded',  label: `제외됨 ${counts.excluded}` },
    { k: 'all',       label: `전체 ${counts.all}` },
  ].map(t => `<button class="btn btn-sm ${filter === t.k ? 'btn-primary' : 'btn-ghost'}" onclick="this.closest('.page')._filter='${t.k}';renderCandidatesPage(this.closest('.page'))">${t.label}</button>`).join('');

  const rows = list.length === 0
    ? `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📱</div><p>항목이 없습니다</p></div></td></tr>`
    : list.map(c => {
        const realIdx = _candidatesCache.indexOf(c);
        const statusBadge = c.status === 'pending'   ? `<span class="badge" style="background:#fffbeb;color:#d97706">대기</span>`
                          : c.status === 'confirmed' ? `<span class="badge" style="background:#f0fdf4;color:#16a34a">반영됨</span>`
                          :                            `<span class="badge" style="background:#fef2f2;color:#dc2626">제외됨</span>`;
        const dupBadge = dupCount[dupKey(c)] > 1
          ? ` <span class="badge" style="background:#fef2f2;color:#dc2626" title="같은 가맹점·금액이 여러 건입니다. 할부/취소/중복 여부를 확인하세요">⚠ 중복?</span>` : '';
        const catSel = `<select class="form-control" style="padding:4px 6px;font-size:12px;min-width:96px" onchange="setCandidateCategory(${realIdx}, this.value)">
            ${EXPENSE_CATS.map(k => `<option value="${k}" ${candCategory(c)===k?'selected':''}>${k}</option>`).join('')}
          </select>`;
        let actions = '';
        if (c.status === 'pending') {
          actions = `<button class="btn btn-success btn-sm" onclick="setCandidateStatus(${realIdx},'confirmed')">반영</button>
                     <button class="btn btn-ghost btn-sm" onclick="setCandidateStatus(${realIdx},'excluded')">제외</button>`;
        } else if (c.status === 'confirmed') {
          actions = `<button class="btn btn-ghost btn-sm" onclick="setCandidateStatus(${realIdx},'pending')">대기로</button>
                     <button class="btn btn-ghost btn-sm" onclick="setCandidateStatus(${realIdx},'excluded')">제외</button>`;
        } else {
          actions = `<button class="btn btn-success btn-sm" onclick="setCandidateStatus(${realIdx},'confirmed')">반영</button>
                     <button class="btn btn-ghost btn-sm" onclick="setCandidateStatus(${realIdx},'pending')">대기로</button>`;
        }
        actions += `<button class="btn btn-danger btn-sm" onclick="deleteCandidate(${realIdx})">🗑</button>`;
        const memoLine = c.memo
          ? `<div style="font-size:11px;color:var(--gray-500);margin-top:2px">📝 ${c.memo}</div>`
          : '';
        return `<tr>
          <td style="text-align:center">${candDateText(c.date)}</td>
          <td>${c.merchant || '-'}${dupBadge}${memoLine}</td>
          <td style="text-align:right">${(Number(c.amount)||0).toLocaleString('ko-KR')}원</td>
          <td style="text-align:center">${c.cardType || '-'}</td>
          <td style="text-align:center">${catSel}</td>
          <td style="text-align:center">${statusBadge}</td>
          <td><div class="td-actions">
            <button class="btn btn-ghost btn-sm" title="소명 메모" onclick="openCandidateMemoModal(${realIdx})">${c.memo ? '📝' : '✏️'}</button>
            ${actions}
          </div></td>
        </tr>`;
      }).join('');

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">📱 사업비 후보</div>
        <div class="page-subtitle">카드 승인 문자 → 확인 후 반영 · 반영액은 세금분석 경비로 합산됩니다</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-ghost" onclick="exportExpensesExcel()">📊 경비 엑셀</button>
        <button class="btn btn-ghost" onclick="openAddCandidateModal()">+ 직접 추가</button>
        <button class="btn btn-primary" id="cand-sync-btn" onclick="syncCandidatesUI()">↻ GAS 동기화</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:14px;display:flex;align-items:center;justify-content:space-between">
      <div class="card-title" style="margin:0">반영된 사업비 합계 ${month==='all'?'(전체)':'('+month+')'}</div>
      <div style="font-size:18px;font-weight:700;color:var(--primary)">${confirmedTotal.toLocaleString('ko-KR')}원</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
      <div class="card">
        <div class="card-title" style="margin:0 0 6px">📈 월별 경비 추이 <span style="font-size:11px;color:var(--gray-500)">(반영 기준)</span></div>
        ${monthlyExpenseBarsHtml()}
      </div>
      <div class="card">
        <div class="card-title" style="margin:0 0 10px">🍩 계정별 비중</div>
        ${categoryDonutHtml()}
      </div>
    </div>
    <div style="margin-bottom:14px">${expenseWarningsHtml()}</div>
    <div class="filter-bar" style="margin-bottom:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      ${tabs}
      <span style="width:1px;height:20px;background:var(--gray-200);margin:0 2px"></span>
      <select class="form-control" style="width:auto;min-width:120px" onchange="this.closest('.page')._month=this.value;renderCandidatesPage(this.closest('.page'))">${monthOpts}</select>
    </div>
    <div class="table-wrapper"><table>
      <thead><tr>
        <th style="text-align:center">날짜</th><th>가맹점</th><th style="text-align:right">금액</th>
        <th style="text-align:center">카드</th><th style="text-align:center">계정</th>
        <th style="text-align:center">상태</th><th>관리</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

async function syncCandidatesUI() {
  const btn = document.getElementById('cand-sync-btn');
  if (btn) { btn.disabled = true; btn.textContent = '동기화 중...'; }
  const r = await fetchCandidatesFromGas();
  if (btn) { btn.disabled = false; btn.textContent = '↻ GAS 동기화'; }
  renderCandidatesPage(document.getElementById('page-candidates'));
}

function setCandidateStatus(idx, status) {
  const c = _candidatesCache[idx];
  if (!c) return;
  _candidatesCache[idx] = { ...c, status };
  saveCandidates(_candidatesCache);
  renderCandidatesPage(document.getElementById('page-candidates'));
}

function setCandidateCategory(idx, category) {
  const c = _candidatesCache[idx];
  if (!c) return;
  _candidatesCache[idx] = { ...c, category };
  saveCandidates(_candidatesCache);
  // 학습: 이 가맹점은 앞으로 이 계정으로 추천 (3)
  learnMerchantCat(c.merchant, category);
  // 반영됨 항목이면 세금분석 합계가 바뀌므로 화면 갱신
  if (c.status === 'confirmed') renderCandidatesPage(document.getElementById('page-candidates'));
}

function openCandidateMemoModal(idx) {
  const c = _candidatesCache[idx];
  if (!c) return;
  openModal('소명 메모', `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="font-size:12px;color:var(--gray-500)">
        ${c.date || ''} · ${c.merchant || ''} · ${(Number(c.amount)||0).toLocaleString('ko-KR')}원
      </div>
      <div class="form-group">
        <label>메모 <span style="font-size:11px;font-weight:400;color:var(--gray-500)">업무 관련성·동석자 등 (세무조사 소명 대비)</span></label>
        <textarea id="cm-memo" class="form-control" rows="3" placeholder="예: 거래처 김대표와 점심 / 사무실 프린터 토너 구입">${c.memo || ''}</textarea>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="saveCandidateMemo(${idx})">저장</button>
      </div>
    </div>`, false);
  setTimeout(() => document.getElementById('cm-memo')?.focus(), 50);
}

function saveCandidateMemo(idx) {
  const c = _candidatesCache[idx];
  if (!c) return;
  const memo = (document.getElementById('cm-memo')?.value || '').trim();
  _candidatesCache[idx] = { ...c, memo };
  saveCandidates(_candidatesCache);
  closeModal();
  renderCandidatesPage(document.getElementById('page-candidates'));
}

function deleteCandidate(idx) {
  const c = _candidatesCache[idx];
  if (!c || !confirm(`"${c.merchant}" 항목을 삭제할까요?`)) return;
  _candidatesCache.splice(idx, 1);
  saveCandidates(_candidatesCache);
  renderCandidatesPage(document.getElementById('page-candidates'));
}

function openAddCandidateModal() {
  openModal('사업비 직접 추가', `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="form-group">
        <label>SMS 내용 붙여넣기 (또는 직접 입력)</label>
        <textarea id="ac-sms" class="form-control" rows="3" placeholder="[롯데카드] 06/28 14:23 파리바게뜨 15,000원 승인" oninput="autoFillFromSms()"></textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group">
          <label>날짜</label>
          <input id="ac-date" type="date" class="form-control" value="${new Date().toISOString().slice(0,10)}">
        </div>
        <div class="form-group">
          <label>카드</label>
          <input id="ac-card" type="text" class="form-control" placeholder="롯데카드">
        </div>
      </div>
      <div class="form-group">
        <label>가맹점명</label>
        <input id="ac-merchant" type="text" class="form-control" placeholder="파리바게뜨">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group">
          <label>금액 (원)</label>
          <input id="ac-amount" type="number" class="form-control" placeholder="15000">
        </div>
        <div class="form-group">
          <label>계정 분류</label>
          <select id="ac-cat" class="form-control">${EXPENSE_CATS.map(k=>`<option value="${k}">${k}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-group">
        <label>메모 <span style="font-size:11px;font-weight:400;color:var(--gray-500)">소명용 (선택)</span></label>
        <input id="ac-memo" type="text" class="form-control" placeholder="예: 거래처 김대표와 점심">
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button class="btn btn-ghost" onclick="closeModal()">취소</button>
        <button class="btn btn-primary" onclick="doAddManualCandidate()">후보 등록</button>
      </div>
    </div>`, false);
}

function autoFillFromSms() {
  const body = document.getElementById('ac-sms')?.value || '';
  if (!body) return;
  const parsed = parseSmsBody(body);
  if (parsed.date)     document.getElementById('ac-date').value     = parsed.date;
  if (parsed.merchant) document.getElementById('ac-merchant').value = parsed.merchant;
  if (parsed.amount)   document.getElementById('ac-amount').value   = parsed.amount;
  if (parsed.cardType) document.getElementById('ac-card').value     = parsed.cardType;
  if (parsed.merchant) document.getElementById('ac-cat').value      = suggestCategory(parsed.merchant);
}

function doAddManualCandidate() {
  const date     = document.getElementById('ac-date')?.value || new Date().toISOString().slice(0,10);
  const merchant = (document.getElementById('ac-merchant')?.value || '').trim();
  const amount   = parseInt(document.getElementById('ac-amount')?.value) || 0;
  const cardType = (document.getElementById('ac-card')?.value || '').trim();
  const category = document.getElementById('ac-cat')?.value || suggestCategory(merchant);
  const memo     = (document.getElementById('ac-memo')?.value || '').trim();
  if (!merchant) { alert('가맹점명을 입력하세요.'); return; }
  const id = candidateId(date, merchant, amount);
  const list = loadCandidates();
  if (list.find(c => c.id === id)) { alert('이미 동일한 항목이 있습니다.'); return; }
  list.unshift({ id, date, merchant, amount, cardType, status: 'pending',
                 suggestedCategory: suggestCategory(merchant), category, memo, body: '', receivedAt: new Date().toISOString() });
  saveCandidates(list);
  _candidatesCache = list;
  closeModal();
  renderCandidatesPage(document.getElementById('page-candidates'));
}


// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-item').forEach(el => el.addEventListener('click', () => navigate(el.dataset.page)));
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
  renderSidebarBiz();
  render('home');
});
