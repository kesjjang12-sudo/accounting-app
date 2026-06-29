// ── 장부관리 앱 Google Sheets 백업/복원 + 사업비 후보 서버 ──
// 이 파일 전체를 Google Apps Script 편집기에 붙여넣으세요.
// 배포 → 새 배포 → 웹 앱 → 액세스: 모든 사용자 → 배포

// ⚠ 아래 SECRET_KEY를 원하는 값으로 바꾸세요.
//    app.js의 ⚙ 시트설정에서 입력하는 키와 반드시 동일해야 합니다.
const SECRET_KEY = 'a4463116!';

// SMS 앱에서 보낼 secret (같게 둬도 되고, 따로 둬도 됨)
const SMS_SECRET = 'a4463116!';

const BUSINESS_CARDS = ['롯데카드'];   // 사업용 → pending 후보 등록
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
    Logger.log('받은 원문(raw): ' + (e && e.postData ? e.postData.contents : '(없음)'));
    const payload = JSON.parse(e.postData.contents);
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
      saveStorage(payload.data);
      return respond({ success: true, count: Object.keys(payload.data).length });
    }

    if (payload.action === 'restoreStorage') {
      const data = loadStorage();
      return respond({ success: true, data });
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

// ── 저장: localStorage 데이터 → storage 시트 ──────────────
function saveStorage(data) {
  const sheet   = getStorageSheet();
  const now     = new Date().toISOString();
  const lastRow = sheet.getLastRow();

  // 기존 key → 행 번호 매핑
  const existing = {};
  if (lastRow > 1) {
    const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    values.forEach((row, i) => {
      if (row[0]) existing[row[0]] = i + 2;
    });
  }

  Object.entries(data).forEach(([key, value]) => {
    if (existing[key]) {
      // 기존 행 업데이트
      sheet.getRange(existing[key], 1, 1, 3).setValues([[key, value, now]]);
    } else {
      // 새 행 추가
      sheet.appendRow([key, value, now]);
    }
  });
}

// ── 불러오기: storage 시트 → key/value 객체 반환 ──────────
function loadStorage() {
  const sheet   = getStorageSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return {};

  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const result = {};
  values.forEach(row => {
    if (row[0]) result[row[0]] = row[1];
  });
  return result;
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

  // 카드사 판별
  const cardMatch = body.match(/롯데카드|현대카드|삼성카드|신한카드|국민카드|우리카드|하나카드|BC카드/);
  const cardType  = cardMatch ? cardMatch[0] : '';
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
  sheet.appendRow([
    id, parsed.date, parsed.merchant, parsed.amount, cardType,
    'pending', suggestCategory(parsed.merchant), receivedAt, body
  ]);
  return respond({ success: true, status: 'pending' });
}

function appendCandidate(body, receivedAt, cardType, status) {
  const parsed = parseSmsBody(body, receivedAt);
  const id     = [parsed.date, parsed.merchant, parsed.amount].join('|');
  const sheet  = getOrCreateSheet('expense_candidates', CANDIDATE_HEADERS);
  sheet.appendRow([
    id, parsed.date, parsed.merchant, parsed.amount, cardType,
    status, suggestCategory(parsed.merchant), receivedAt, body
  ]);
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
  let date = '';
  const d1 = body.match(/(\d{4})-(\d{2})-(\d{2})/);
  const d2 = body.match(/(\d{1,2})[\/월](\d{1,2})/);
  if (d1) {
    date = d1[0];
  } else if (d2) {
    const ref = isValidDate(receivedAt) ? new Date(receivedAt) : new Date();
    const y   = ref.getFullYear();
    const mm  = ('0' + d2[1]).slice(-2);
    const dd  = ('0' + d2[2]).slice(-2);
    date = y + '-' + mm + '-' + dd;
  }

  const amtMatch = body.match(/([\d,]+)원/);
  const amount   = amtMatch ? parseInt(amtMatch[1].replace(/,/g, ''), 10) : 0;

  let merchant = body
    .replace(/\[.*?\]/g, '')
    .replace(/롯데카드|현대카드|삼성카드|신한카드|국민카드|우리카드|하나카드|BC카드/g, '')
    .replace(/\d{1,4}[\/\-월]\d{1,2}[일]?(\s*\d{1,2}:\d{2})?/g, '')
    .replace(/[\d,]+원/g, '')
    .replace(/승인|취소|일시불|할부|포인트|캐시백/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .split(/\s/)[0] || '(가맹점 미확인)';

  return { date: date, amount: amount, merchant: merchant };
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
