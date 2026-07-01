// ── 클로드 사무실 (멀티 AI 직원 대시보드) ────────────────
// 장부앱과 독립. GAS(askClaude)를 통해 Claude 호출, 로그는 localStorage + 시트.

let GAS_URL = localStorage.getItem('office_gas_url') || localStorage.getItem('acc_sheets_url') || '';
let SECRET  = localStorage.getItem('office_gas_key') || localStorage.getItem('acc_sheets_key') || '';
let MODEL   = localStorage.getItem('office_model')   || 'claude-sonnet-4-6';

const DEFAULT_EMPLOYEES = [
  { id: 'e_lead',  emoji: '🧑‍💼', name: '비서실장',   role: '당신은 비서실장입니다. 사용자의 요청을 정리하고, 어떤 직원에게 맡기면 좋을지 제안하며, 전체 업무를 조율합니다. 항상 간결하고 실무적으로 한국어로 답하세요.' },
  { id: 'e_tax',   emoji: '🧾', name: '세무 담당',   role: '당신은 대한민국 세무·회계 전문가입니다. 부가세, 종합소득세, 경비처리, 절세를 실무 관점에서 정확하고 쉽게 설명합니다. 불확실하면 세무사 확인이 필요하다고 알립니다. 한국어로 답하세요.' },
  { id: 'e_sales', emoji: '📞', name: '영업 담당',   role: '당신은 B2B 영업 담당자입니다. 고객 메일·제안·후속 연락 문구를 설득력 있고 예의 바르게 작성합니다. 광고성 메일에는 (광고) 표기와 수신거부 안내가 필요함을 압니다. 한국어로 답하세요.' },
  { id: 'e_plan',  emoji: '🧠', name: '기획 담당',   role: '당신은 사업 기획·전략 담당자입니다. 아이디어를 구조화하고, 우선순위와 실행 단계를 제시합니다. 한국어로 답하세요.' },
  { id: 'e_copy',  emoji: '✍️', name: '카피라이터', role: '당신은 마케팅 카피라이터입니다. 짧고 임팩트 있는 문구, 제목, 홍보문을 여러 버전으로 제안합니다. 한국어로 답하세요.' },
];

function loadEmployees() {
  try { const v = JSON.parse(localStorage.getItem('office_employees')); if (Array.isArray(v) && v.length) return v; } catch {}
  return DEFAULT_EMPLOYEES.slice();
}
function saveEmployees() { localStorage.setItem('office_employees', JSON.stringify(employees)); }

let employees = loadEmployees();
let currentEmpId = employees[0] ? employees[0].id : null;

function chatKey(id) { return 'office_chat_' + id; }
function loadChat(id) { try { return JSON.parse(localStorage.getItem(chatKey(id))) || []; } catch { return []; } }
function saveChat(id, msgs) { localStorage.setItem(chatKey(id), JSON.stringify(msgs)); scheduleSyncToGas(); }

// ── GAS 클라우드 동기화 ────────────────────────────────────
let _syncTimer = null;
function scheduleSyncToGas() {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(syncToGas, 2000);
}

function buildSyncData() {
  const data = { office_employees: JSON.stringify(employees) };
  employees.forEach(e => {
    const msgs = loadChat(e.id);
    if (msgs.length) data[chatKey(e.id)] = JSON.stringify(msgs);
  });
  return data;
}

async function syncToGas() {
  if (!GAS_URL || !SECRET) return;
  try {
    await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ secretKey: SECRET, action: 'saveOfficeChatHistory', data: buildSyncData() })
    });
  } catch {}
}

async function syncFromGas() {
  if (!GAS_URL || !SECRET) { alert('⚙ 설정에서 GAS 주소와 키를 입력하세요.'); return; }
  const indicator = $('sync-indicator');
  if (indicator) indicator.textContent = '☁ 동기화 중…';
  try {
    // 1. 클라우드에서 내려받기
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ secretKey: SECRET, action: 'loadOfficeChatHistory' })
    });
    const json = await res.json();
    const data = (json.success && json.data) ? json.data : {};

    // 2. 직원 목록 병합 (클라우드에 있는데 로컬에 없는 직원 추가)
    if (data.office_employees) {
      try {
        const remoteEmps = JSON.parse(data.office_employees);
        if (Array.isArray(remoteEmps) && remoteEmps.length) {
          remoteEmps.forEach(re => { if (!employees.find(e => e.id === re.id)) employees.push(re); });
          saveEmployees();
        }
      } catch {}
    }

    // 3. 대화내역 병합 (로컬 + 클라우드 합집합, role+ts+앞50자로 중복제거)
    const allChatKeys = new Set([
      ...employees.map(e => chatKey(e.id)),
      ...Object.keys(data).filter(k => k.startsWith('office_chat_'))
    ]);
    allChatKeys.forEach(k => {
      try {
        const empId = k.replace('office_chat_', '');
        const localMsgs  = loadChat(empId);
        const remoteMsgs = data[k] ? JSON.parse(data[k]) : [];
        const seen   = new Set(localMsgs.map(m => m.role + '|' + m.ts + '|' + String(m.content).slice(0, 50)));
        const merged = [...localMsgs];
        remoteMsgs.forEach(m => {
          const key = m.role + '|' + m.ts + '|' + String(m.content).slice(0, 50);
          if (!seen.has(key)) { seen.add(key); merged.push(m); }
        });
        if (merged.length) localStorage.setItem(k, JSON.stringify(merged));
      } catch {}
    });

    // 4. 병합 결과를 클라우드에 다시 올리기
    await syncToGas();

    if (indicator) indicator.textContent = '☁ 동기화됨';
    setTimeout(() => { if (indicator) indicator.textContent = ''; }, 2500);
    renderAll();
  } catch (err) {
    if (indicator) indicator.textContent = '⚠ 실패';
    setTimeout(() => { if (indicator) indicator.textContent = ''; }, 3000);
  }
}

function loadLogs() { try { return JSON.parse(localStorage.getItem('office_logs')) || []; } catch { return []; } }
function pushLog(entry) {
  const logs = loadLogs(); logs.push(entry);
  if (logs.length > 500) logs.splice(0, logs.length - 500);
  localStorage.setItem('office_logs', JSON.stringify(logs));
}

const $ = id => document.getElementById(id);
function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function nowHM() { const d = new Date(); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
function curEmp() { return employees.find(e => e.id === currentEmpId) || null; }

// ── 렌더 ──────────────────────────────────────────────────
function renderEmpList() {
  $('emp-list').innerHTML = employees.map(e => `
    <div class="emp-card ${e.id === currentEmpId ? 'active' : ''}" onclick="selectEmp('${e.id}')">
      <span class="emp-emoji">${e.emoji || '🤖'}</span>
      <div style="min-width:0">
        <div class="emp-name">${esc(e.name)}</div>
        <div class="emp-role">${esc((e.role || '').slice(0, 30))}</div>
      </div>
    </div>`).join('');
}

function renderTop() {
  const e = curEmp();
  if (!e) { $('office-top').innerHTML = ''; return; }
  $('office-top').innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;min-width:0">
      <span style="font-size:24px">${e.emoji || '🤖'}</span>
      <div style="min-width:0">
        <div style="font-weight:700">${esc(e.name)}</div>
        <div style="font-size:12px;color:var(--gray-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:520px">${esc(e.role)}</div>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0">
      <button class="btn btn-ghost btn-sm" onclick="editEmployee('${e.id}')">✏ 임무 수정</button>
      <button class="btn btn-ghost btn-sm" onclick="clearChat('${e.id}')">🗑 대화비우기</button>
    </div>`;
}

function renderChat() {
  const e = curEmp();
  const area = $('chat-area');
  if (!e) {
    $('chat-input-wrap').style.display = 'none';
    area.innerHTML = `<div class="empty-office"><div style="font-size:40px">🏢</div><div style="margin-top:8px">왼쪽에서 직원을 선택하거나 추가하세요.</div></div>`;
    return;
  }
  $('chat-input-wrap').style.display = 'block';
  const msgs = loadChat(e.id);
  if (!msgs.length) {
    area.innerHTML = `<div class="empty-office"><div style="font-size:40px">${e.emoji||'🤖'}</div><div style="margin-top:8px"><b>${esc(e.name)}</b> 에게 지시를 내려보세요.</div></div>`;
  } else {
    area.innerHTML = msgs.map(m => `
      <div class="msg ${m.role === 'user' ? 'user' : 'ai'}">
        <div class="msg-meta">${m.role === 'user' ? '나' : esc(e.name)} · ${m.ts || ''}</div>
        <div class="msg-bubble">${esc(m.content)}</div>
      </div>`).join('');
  }
  renderHandoff();
  area.scrollTop = area.scrollHeight;
}

function renderHandoff() {
  const e = curEmp();
  const bar = $('handoff-bar');
  const msgs = e ? loadChat(e.id) : [];
  const lastAi = [...msgs].reverse().find(m => m.role === 'assistant');
  if (!lastAi || employees.length < 2) { bar.innerHTML = ''; return; }
  const others = employees.filter(x => x.id !== e.id);
  bar.innerHTML = '<span style="font-size:11px;color:var(--gray-400);align-self:center">결과 넘기기 →</span>' +
    others.map(o => `<button class="btn btn-ghost btn-sm" onclick="handoff('${o.id}')">${o.emoji||'🤖'} ${esc(o.name)}</button>`).join('');
}

function renderAll() { renderEmpList(); renderTop(); renderChat(); }

// ── 동작 ──────────────────────────────────────────────────
function selectEmp(id) { currentEmpId = id; renderAll(); }

function autoGrow(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px'; }
function onChatKey(ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); sendCommand(); } }

async function sendCommand() {
  const e = curEmp(); if (!e) return;
  if (!GAS_URL || !SECRET) { alert('먼저 ⚙ 설정에서 GAS 주소와 키를 입력하세요.'); openOfficeConfig(); return; }
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text) return;

  const msgs = loadChat(e.id);
  msgs.push({ role: 'user', content: text, ts: nowHM() });
  saveChat(e.id, msgs);
  input.value = ''; autoGrow(input);
  renderChat();

  const area = $('chat-area');
  const busy = document.createElement('div');
  busy.className = 'ai-busy'; busy.textContent = e.name + ' 생각 중…';
  area.appendChild(busy); area.scrollTop = area.scrollHeight;
  $('send-btn').disabled = true;

  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({
        secretKey: SECRET, action: 'askClaude', model: MODEL, employee: e.name,
        system: e.role,
        messages: msgs.map(m => ({ role: m.role, content: m.content })),
      })
    });
    const json = await res.json();
    if (json.success) {
      msgs.push({ role: 'assistant', content: json.text, ts: nowHM() });
      saveChat(e.id, msgs);
      pushLog({ ts: new Date().toISOString(), employee: e.name, prompt: text, response: json.text });
    } else {
      msgs.push({ role: 'assistant', content: '⚠ 오류: ' + (json.message || '알 수 없음'), ts: nowHM() });
      saveChat(e.id, msgs);
    }
  } catch (err) {
    msgs.push({ role: 'assistant', content: '⚠ 연결 오류: ' + err.message, ts: nowHM() });
    saveChat(e.id, msgs);
  } finally {
    $('send-btn').disabled = false;
    renderChat();
  }
}

function handoff(toId) {
  const from = curEmp();
  const msgs = from ? loadChat(from.id) : [];
  const lastAi = [...msgs].reverse().find(m => m.role === 'assistant');
  if (!lastAi) return;
  currentEmpId = toId;
  renderAll();
  const input = $('chat-input');
  input.value = `다음은 ${from.name}의 결과입니다. 이걸 바탕으로 이어서 작업해주세요:\n\n${lastAi.content}`;
  autoGrow(input); input.focus();
}

function clearChat(id) {
  if (!confirm('이 직원과의 대화를 모두 지울까요?')) return;
  localStorage.removeItem(chatKey(id));
  renderChat();
  syncToGas();
}

// ── 직원 추가/수정 ────────────────────────────────────────
function addEmployee() {
  officeOpenModal('직원 추가', employeeForm({ emoji: '🤖', name: '', role: '' }, null));
}
function editEmployee(id) {
  const e = employees.find(x => x.id === id); if (!e) return;
  officeOpenModal('직원 수정', employeeForm(e, id));
}
function employeeForm(e, id) {
  return `
    <div class="form-group" style="margin-bottom:12px">
      <label>이모지</label>
      <input id="emp-emoji" class="form-control" value="${esc(e.emoji)}" maxlength="4" style="width:80px">
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label>이름 / 직책</label>
      <input id="emp-name" class="form-control" value="${esc(e.name)}" placeholder="예: 세무 담당">
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label>임무 (역할 지시문 = system prompt)</label>
      <textarea id="emp-role" class="form-control" style="min-height:120px" placeholder="이 직원이 어떤 전문가이고 어떻게 답해야 하는지 적으세요.">${esc(e.role)}</textarea>
    </div>
    <div style="display:flex;justify-content:space-between;gap:8px">
      ${id ? `<button class="btn btn-danger btn-sm" onclick="deleteEmployee('${id}')">삭제</button>` : '<span></span>'}
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" onclick="officeCloseModal()">취소</button>
        <button class="btn btn-primary" onclick="saveEmployee('${id || ''}')">저장</button>
      </div>
    </div>`;
}
function saveEmployee(id) {
  const emoji = $('emp-emoji').value.trim() || '🤖';
  const name  = $('emp-name').value.trim();
  const role  = $('emp-role').value.trim();
  if (!name) { alert('이름을 입력하세요.'); return; }
  if (id) {
    const e = employees.find(x => x.id === id);
    if (e) { e.emoji = emoji; e.name = name; e.role = role; }
  } else {
    const newId = 'e_' + Date.now();
    employees.push({ id: newId, emoji, name, role });
    currentEmpId = newId;
  }
  saveEmployees(); officeCloseModal(); renderAll();
}
function deleteEmployee(id) {
  if (!confirm('이 직원을 삭제할까요? (대화 기록도 삭제)')) return;
  employees = employees.filter(e => e.id !== id);
  localStorage.removeItem(chatKey(id));
  if (currentEmpId === id) currentEmpId = employees[0] ? employees[0].id : null;
  saveEmployees(); officeCloseModal(); renderAll();
}

// ── 로그 / 설정 ───────────────────────────────────────────
function openLogs() {
  const logs = loadLogs().slice().reverse();
  $('office-modal-box').classList.add('modal-lg');
  const rows = logs.length ? logs.map(l => {
    const t = new Date(l.ts);
    const ts = `${t.getMonth()+1}/${String(t.getDate()).padStart(2,'0')} ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
    return `<div style="border-bottom:1px solid var(--gray-100);padding:10px 0">
      <div style="font-size:11px;color:var(--gray-400)">${ts} · <b>${esc(l.employee)}</b></div>
      <div style="font-size:13px;margin-top:3px"><span style="color:var(--gray-500)">지시:</span> ${esc((l.prompt||'').slice(0,200))}</div>
      <div style="font-size:13px;margin-top:3px"><span style="color:var(--gray-500)">응답:</span> ${esc((l.response||'').slice(0,300))}</div>
    </div>`;
  }).join('') : '<div style="padding:20px;color:var(--gray-500);text-align:center">아직 로그가 없습니다.</div>';
  officeOpenModal('📜 전체 업무 로그', `<div style="max-height:60vh;overflow-y:auto">${rows}</div>`);
}

function openOfficeConfig() {
  officeOpenModal('⚙ 사무실 설정', `
    <p style="font-size:12px;color:var(--gray-500);margin-bottom:14px;line-height:1.6">
      GAS 주소/키는 장부앱과 같은 걸 쓰면 됩니다. 모델은 비용·성능에 따라 고르세요.<br>
      ⚠ GAS 스크립트 속성에 <b>CLAUDE_API_KEY</b> 가 등록돼 있어야 작동합니다.
    </p>
    <div class="form-group" style="margin-bottom:12px">
      <label>GAS 웹앱 URL</label>
      <input id="cfg-gas-url" class="form-control" value="${esc(GAS_URL)}" placeholder="https://script.google.com/macros/s/.../exec">
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label>Secret Key</label>
      <input id="cfg-gas-key" class="form-control" value="${esc(SECRET)}">
    </div>
    <div class="form-group" style="margin-bottom:16px">
      <label>모델</label>
      <select id="cfg-model" class="form-control">
        <option value="claude-sonnet-4-6" ${MODEL==='claude-sonnet-4-6'?'selected':''}>claude-sonnet-4-6 (균형·저렴, 추천)</option>
        <option value="claude-opus-4-8" ${MODEL==='claude-opus-4-8'?'selected':''}>claude-opus-4-8 (최고 성능·비쌈)</option>
        <option value="claude-haiku-4-5-20251001" ${MODEL==='claude-haiku-4-5-20251001'?'selected':''}>claude-haiku-4-5 (가장 빠르고 저렴)</option>
      </select>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px">
      <button class="btn btn-ghost" onclick="officeCloseModal()">취소</button>
      <button class="btn btn-primary" onclick="saveOfficeConfig()">저장</button>
    </div>`);
}
function saveOfficeConfig() {
  GAS_URL = $('cfg-gas-url').value.trim();
  SECRET  = $('cfg-gas-key').value.trim();
  MODEL   = $('cfg-model').value;
  localStorage.setItem('office_gas_url', GAS_URL);
  localStorage.setItem('office_gas_key', SECRET);
  localStorage.setItem('office_model', MODEL);
  officeCloseModal();
}

// ── 모달 ──────────────────────────────────────────────────
function officeOpenModal(title, html) {
  $('office-modal-title').textContent = title;
  $('office-modal-body').innerHTML = html;
  $('office-modal-overlay').classList.remove('hidden');
}
function officeCloseModal() {
  $('office-modal-overlay').classList.add('hidden');
  $('office-modal-body').innerHTML = '';
  $('office-modal-box').classList.remove('modal-lg');
}

document.getElementById('office-modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('office-modal-overlay')) officeCloseModal();
});

renderAll();
syncFromGas();
