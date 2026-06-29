// ── 장부관리 앱 Google Sheets 백업/복원 + 사업비 후보 서버 ──
// 이 파일 전체를 Google Apps Script 편집기에 붙여넣으세요.
// 배포 → 새 배포 → 웹 앱 → 액세스: 모든 사용자 → 배포

// ⚠ 아래 SECRET_KEY를 원하는 값으로 바꾸세요.
//    app.js의 ⚙ 시트설정에서 입력하는 키와 반드시 동일해야 합니다.
const SECRET_KEY = 'a4463116!';

// SMS 앱에서 보낼 secret (같게 둬도 되고, 따로 둬도 됨)
const SMS_SECRET = 'a4463116!';

const BUSINESS_CARDS = ['롯데카드'];   // 사업용 → pending 후보 등록 (라스베가스=롯데카드 별칭)
const PERSONAL_CARDS = ['현대카드'];   // 개인용 → excluded 기록

// ── 상태 확인 + 진단용 (브라우저로 URL 접속 시) ───────────
function doGet(e) {
  const info = { success: true, message: '서버 작동중 (v3-diag)', time: new Date().toISOString() };
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      info.스프레드시트연결 = '❌ 연결 안 됨 (독립형 스크립트 — 시트에 저장 불가!)';
      return respond(info);
    }
    info.스프레드시트이름 = ss.getName();
    info.시트목록 = ss.getSheets().map(function(s){ return s.getName(); });

    // sms_raw 최근 3건
    const raw = ss.getSheetByName('sms_raw');
    if (raw && raw.getLastRow() > 1) {
      const n = raw.getLastRow();
      const start = Math.max(2, n - 2);
      info.sms_raw_최근 = raw.getRange(start, 1, n - start + 1, 2).getValues();
    } else {
      info.sms_raw_최근 = '(sms_raw 비어있음 또는 없음)';
    }

    // expense_candidates 최근 3건
    const ec = ss.getSheetByName('expense_candidates');
    if (ec && ec.getLastRow() > 1) {
      const n2 = ec.getLastRow();
      const start2 = Math.max(2, n2 - 2);
      info.후보_최근 = ec.getRange(start2, 1, n2 - start2 + 1, 6).getValues();
    } else {
      info.후보_최근 = '(expense_candidates 비어있음 또는 없음)';
    }
  } catch (err) {
    info.오류 = err.message;
  }
  return respond(info);
}

// ── 진입점 ────────────────────────────────────────────────
function doPost(e) {
  try {
    const raw = (e && e.postData ? e.postData.contents : '');
    Logger.log('받은 원문(raw): ' + raw);
    const payload = parsePayload(raw);
    Logger.log('source=' + payload.source + ' / secret=' + payload.secret + ' / action=' + payload.action);

    // 1) SMS 수신 경로 (source: 'sms') — SMS_SECRET 사용
    if (payload.source === 'sms') {
      if (payload.secret !== SMS_SECRET) {
        Logger.log('→ 인증 실패: 받은 secret[' + payload.secret + '] vs 코드 SMS_SECRET[' + SMS_SECRET + ']');
        return respond({ success: false, message: '인증 실패(SMS)' });
      }
      const r = handleSms(payload);
      Logger.log('→ SMS 처리 완료');
      return r;
    }

    // 2) 그 외 — 기존 SECRET_KEY 사용
    if (payload.secretKey !== SECRET_KEY) {
      return respond({ success: false, message: '인증 실패: Secret Key가 다릅니다.' });
    }

    if (payload.action === 'ping') {
      return respond({ success: true, data: 'pong' });
    }

    if (payload.action === 'backupStorage') {
      if (!payload.data || typeof payload.data !== 'object') {
        return respond({ success: false, message: 'data 필드가 없거나 잘못된 형식입니다.' });
      }
      const mode = payload.snapshot || 'auto';   // 'auto' | 'force' | 'none'
      if (mode === 'auto') maybeAutoSnapshot();   // 덮어쓰기 전 상태를 10분 간격으로 보관
      saveStorage(payload.data);
      if (mode === 'force') createSnapshot();      // 수동: 방금 저장한 현재 상태 보관
      return respond({ success: true, count: Object.keys(payload.data).length });
    }

    if (payload.action === 'restoreStorage') {
      const data = loadStorage();
      return respond({ success: true, data });
    }

    if (payload.action === 'createSnapshot') {
      return respond({ success: true, snapshot: createSnapshot() });
    }

    if (payload.action === 'listSnapshots') {
      return respond({ success: true, snapshots: listSnapshots() });
    }

    if (payload.action === 'restoreSnapshot') {
      const snapData = restoreSnapshot(payload.id);
      if (!snapData) return respond({ success: false, message: '스냅샷을 찾을 수 없습니다: ' + payload.id });
      return respond({ success: true, data: snapData });
    }

    // 사업비 후보 API
    if (payload.action === 'getExpenseCandidates') {
      return respond({ success: true, candidates: getCandidates() });
    }
    if (payload.action === 'updateCandidateStatus') {
      return updateCandidateStatus(payload.id, payload.status);
    }

    return respond({ success: false, message: '알 수 없는 action: ' + payload.action });

  } catch (err) {
    return respond({ success: false, message: err.message });
  }
}

// ── 헬퍼: 본문 파싱 (SMS 줄바꿈으로 JSON이 깨져도 복구) ────
function parsePayload(raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    const obj = {};
    const s   = raw.match(/"secret"\s*:\s*"([^"]*)"/);            if (s)   obj.secret     = s[1];
    const src = raw.match(/"source"\s*:\s*"([^"]*)"/);            if (src) obj.source     = src[1];
    const act = raw.match(/"action"\s*:\s*"([^"]*)"/);            if (act) obj.action     = act[1];
    const r   = raw.match(/"receivedAt"\s*:\s*"([^"]*)"/);        if (r)   obj.receivedAt = r[1];
    const b   = raw.match(/"body"\s*:\s*"([\s\S]*?)"\s*\}\s*$/);  if (b)   obj.body       = b[1];
    return obj;
  }
}

// ── 헬퍼: JSON 응답 반환 ──────────────────────────────────
function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 헬퍼: storage 시트 가져오기 (없으면 생성) ─────────────
function getStorageSheet() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName('storage');
  if (!sheet) {
    sheet = ss.insertSheet('storage');
    sheet.getRange('A1:C1').setValues([['key', 'value', 'updatedAt']]);
    sheet.setFrozenRows(1);
    sheet.getRange('A1:C1').setFontWeight('bold');
  }
  return sheet;
}

// 구글시트 셀 1칸 최대 5만 자 → 안전하게 45,000자 단위로 청크 분할
var MAX_CELL = 45000;

// ── 저장: localStorage 데이터 → storage 시트 (큰 값 자동 청크 분할) ──
function saveStorage(data) {
  writeKvSheet(getStorageSheet(), data);
}

// ── 불러오기: storage 시트 → key/value 객체 (청크 재조립) ──
function loadStorage() {
  return readKvSheet(getStorageSheet());
}

// key/value(+청크)를 시트에 통째로 다시 기록 (전체 스냅샷이 매번 전송되므로 clear & rewrite)
function writeKvSheet(sheet, data) {
  const now  = new Date().toISOString();
  const rows = [];
  Object.keys(data).forEach(function (key) {
    var value = data[key];
    value = (value == null) ? '' : String(value);
    if (value.length <= MAX_CELL) {
      rows.push([key, value, now]);
    } else {
      var n = Math.ceil(value.length / MAX_CELL);
      rows.push([key, '__CHUNKED__:' + n, now]);          // 마커 행
      for (var i = 0; i < n; i++) {
        rows.push([key + '::c' + i, value.substr(i * MAX_CELL, MAX_CELL), now]);
      }
    }
  });
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 3).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, 3).setValues(rows);
}

// 시트 → key/value 객체 (청크 재조립)
function readKvSheet(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return {};
  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const map = {};
  values.forEach(function (row) { if (row[0]) map[row[0]] = row[1]; });

  const result = {};
  Object.keys(map).forEach(function (key) {
    if (key.indexOf('::c') > -1) return;                  // 청크 조각은 출력에서 제외
    var v = map[key];
    if (typeof v === 'string' && v.indexOf('__CHUNKED__:') === 0) {
      var n = parseInt(v.split(':')[1], 10) || 0;
      var joined = '';
      for (var i = 0; i < n; i++) joined += (map[key + '::c' + i] || '');
      result[key] = joined;
    } else {
      result[key] = v;
    }
  });
  return result;
}

// ══════════════════════════════════════════════════════════
// ── 스냅샷 (롤백용) — storage 시트를 복제해 최근 10개 보관 ──
// ══════════════════════════════════════════════════════════
var SNAP_PREFIX      = 'snap_';
var SNAP_KEEP        = 10;
var SNAP_INTERVAL_MS = 10 * 60 * 1000;   // 자동 스냅샷 최소 간격 10분

function snapshotSheets() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets().filter(function (s) {
    return s.getName().indexOf(SNAP_PREFIX) === 0;
  });
}
function snapEpoch(name) { return parseInt(name.substring(SNAP_PREFIX.length), 10) || 0; }
function snapsByNewest() {
  return snapshotSheets().sort(function (a, b) { return snapEpoch(b.getName()) - snapEpoch(a.getName()); });
}

// 현재 storage 상태를 스냅샷으로 복제 (빈 상태는 건너뜀)
function createSnapshot() {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const storage = getStorageSheet();
  if (storage.getLastRow() <= 1) return '';
  const name = SNAP_PREFIX + Date.now();
  storage.copyTo(ss).setName(name);
  rotateSnapshots();
  return name;
}

// 직전 스냅샷이 10분 이상 지났을 때만 생성 (초 단위 중복 방지)
function maybeAutoSnapshot() {
  const snaps  = snapsByNewest();
  const newest = snaps.length ? snapEpoch(snaps[0].getName()) : 0;
  if (Date.now() - newest >= SNAP_INTERVAL_MS) createSnapshot();
}

// 최근 SNAP_KEEP개만 남기고 오래된 스냅샷 삭제
function rotateSnapshots() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const snaps = snapsByNewest();
  for (var i = SNAP_KEEP; i < snaps.length; i++) ss.deleteSheet(snaps[i]);
}

function listSnapshots() {
  return snapsByNewest().map(function (sheet) {
    var epoch = snapEpoch(sheet.getName());
    var txCount = 0;
    try {
      var data = readKvSheet(sheet);
      Object.keys(data).forEach(function (k) {
        if (k.indexOf('acc_transactions') === 0) {
          try { txCount += (JSON.parse(data[k]) || []).length; } catch (e) {}
        }
      });
    } catch (e) {}
    return { id: sheet.getName(), epoch: epoch, time: new Date(epoch).toISOString(), txCount: txCount };
  });
}

function restoreSnapshot(id) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(id);
  if (!sheet) return null;
  return readKvSheet(sheet);
}

// ══════════════════════════════════════════════════════════
// ── 사업비 후보 (SMS 카드 승인 문자) ──────────────────────
// ══════════════════════════════════════════════════════════

const CANDIDATE_HEADERS = ['id','date','merchant','amount','cardType','status','suggestedCategory','receivedAt','body'];

function handleSms(payload) {
  const body       = payload.body || '';
  // receivedAt 이 유효한 날짜가 아니면(예: MacroDroid가 [time] 치환 실패) 서버 시간 사용
  const receivedAt = isValidDate(payload.receivedAt) ? payload.receivedAt : new Date().toISOString();

  Logger.log('handleSms body=' + body);

  // 원문 기록
  const raw = getOrCreateSheet('sms_raw', ['receivedAt','body']);
  raw.appendRow([receivedAt, body]);
  Logger.log('sms_raw 시트에 기록 완료 (스프레드시트: ' + SpreadsheetApp.getActiveSpreadsheet().getName() + ')');

  // 카드사 판별 (라스베가스 = 롯데카드 별칭 → 롯데카드로 정규화)
  const cardMatch = body.match(/라스베가스|롯데카드|현대카드/);
  let   cardType  = cardMatch ? cardMatch[0] : '';
  if (cardType === '라스베가스') cardType = '롯데카드';
  Logger.log('인식된 카드: [' + cardType + ']');

  if (PERSONAL_CARDS.indexOf(cardType) > -1) {
    appendCandidate(body, receivedAt, cardType, 'excluded');
    return respond({ success: true, status: 'excluded' });
  }
  if (BUSINESS_CARDS.indexOf(cardType) === -1) {
    return respond({ success: true, status: 'skipped' });
  }

  // 사업용 → 중복 체크 후 pending 등록
  const parsed = parseSmsBody(body, receivedAt);
  const id     = [parsed.date, parsed.merchant, parsed.amount].join('|');
  const sheet  = getOrCreateSheet('expense_candidates', CANDIDATE_HEADERS);
  const rows   = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) return respond({ success: true, status: 'duplicate' });
  }
  appendCandidateRow(sheet, [
    id, parsed.date, parsed.merchant, parsed.amount, cardType,
    'pending', suggestCategory(parsed.merchant), receivedAt, body
  ]);
  return respond({ success: true, status: 'pending' });
}

function appendCandidate(body, receivedAt, cardType, status) {
  const parsed = parseSmsBody(body, receivedAt);
  const id     = [parsed.date, parsed.merchant, parsed.amount].join('|');
  const sheet  = getOrCreateSheet('expense_candidates', CANDIDATE_HEADERS);
  appendCandidateRow(sheet, [
    id, parsed.date, parsed.merchant, parsed.amount, cardType,
    status, suggestCategory(parsed.merchant), receivedAt, body
  ]);
}

// 후보 행 추가 — 날짜 칸(2열)을 텍스트로 고정해 시트의 자동 날짜변환(시각 손실) 방지
function appendCandidateRow(sheet, row) {
  sheet.appendRow(row);
  const r = sheet.getLastRow();
  sheet.getRange(r, 2).setNumberFormat('@').setValue(String(row[1]));
}

function getCandidates() {
  const sheet = getOrCreateSheet('expense_candidates', CANDIDATE_HEADERS);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  const headers = rows[0];
  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i]; });
    obj.amount = Number(obj.amount) || 0;
    return obj;
  });
}

function updateCandidateStatus(id, status) {
  const sheet = getOrCreateSheet('expense_candidates', CANDIDATE_HEADERS);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      sheet.getRange(i + 1, 6).setValue(status); // status = 6번째 열
      return respond({ success: true });
    }
  }
  return respond({ success: false, message: 'not found' });
}

// ── SMS 파싱 ─────────────────────────────────────────────
function parseSmsBody(body, receivedAt) {
  // 날짜·시각: 문자 수신 시각(receivedAt) 기준 한국시간(KST)으로 기록
  let date = '';
  if (isValidDate(receivedAt)) {
    date = Utilities.formatDate(new Date(receivedAt), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  } else {
    // receivedAt이 없을 때만 본문에서 날짜/시각 추출
    const d1 = body.match(/(\d{4})-(\d{2})-(\d{2})/);
    const d2 = body.match(/(\d{1,2})[\/월](\d{1,2})/);
    if (d1) {
      date = d1[0];
    } else if (d2) {
      const ref = new Date();
      date = ref.getFullYear() + '-' + ('0' + d2[1]).slice(-2) + '-' + ('0' + d2[2]).slice(-2);
    }
    const tMatch = body.match(/(\d{1,2}):(\d{2})/);
    if (date && tMatch) {
      date = date + ' ' + ('0' + tMatch[1]).slice(-2) + ':' + tMatch[2];
    }
  }

  const amtMatch = body.replace(/누적\s*[\d,]+원/g, '').match(/([\d,]+)원/);
  const amount   = amtMatch ? parseInt(amtMatch[1].replace(/,/g, ''), 10) : 0;

  const merchant = extractMerchant(body);

  return { date: date, amount: amount, merchant: merchant };
}

// 가맹점명: 카드 승인 문자의 첫 줄이 가맹점 (예: 네이버파이낸셜)
function extractMerchant(body) {
  const lines = String(body).split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  const NOISE = /[\d,]+원|라스베가스|롯데카드|현대카드|승인|취소/;
  if (lines.length > 1 && lines[0] && lines[0].indexOf('[') === -1 && !NOISE.test(lines[0])) {
    return lines[0];
  }
  return body
    .replace(/\[.*?\]/g, '')
    .replace(/라스베가스|롯데카드|현대카드/g, '')
    .replace(/누적\s*[\d,]+원/g, '')
    .replace(/\d{1,4}[\/\-월]\d{1,2}[일]?(\s*\d{1,2}:\d{2})?/g, '')
    .replace(/[\d,]+원/g, '')
    .replace(/승인|취소|일시불|할부|포인트|캐시백/g, '')
    .replace(/[가-힣]\*[가-힣]/g, '')
    .replace(/[\d*]{3,}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .split(/\s/)[0] || '(가맹점 미확인)';
}

function suggestCategory(merchant) {
  const m = merchant || '';
  if (/주유|GS칼텍스|SK에너지|현대오일|오일뱅크|S-OIL|세차/i.test(m))    return '차량유지비';
  if (/KT|SKT|LGU|통신|휴대폰|알뜰폰|인터넷/i.test(m))                    return '통신비';
  if (/마트|이마트|홈플러스|코스트코|다이소|오피스|문구/i.test(m))          return '비품구입';
  if (/식당|고기|해장|치킨|피자|카페|커피|베이커리|파리바게|스타벅/i.test(m)) return '접대비';
  if (/AWS|Google|클라우드|호스팅|도메인|GPT|구독|소프트웨어/i.test(m))     return '통신비';
  if (/병원|약국|건강/i.test(m))                                            return '복리후생비';
  return '기타경비';
}

// ── 공용 유틸 ─────────────────────────────────────────────
function isValidDate(v) {
  if (!v) return false;
  const t = new Date(v).getTime();
  return !isNaN(t);
}

function getOrCreateSheet(name, headers) {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}
