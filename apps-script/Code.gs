// ── 장부관리 앱 Google Sheets 백업/복원 서버 ──────────────
// 이 파일 전체를 Google Apps Script 편집기에 붙여넣으세요.
// 배포 → 새 배포 → 웹 앱 → 액세스: 모든 사용자 → 배포

// ⚠ 아래 SECRET_KEY를 원하는 값으로 바꾸세요.
//    app.js의 ⚙ 시트설정에서 입력하는 키와 반드시 동일해야 합니다.
const SECRET_KEY = 'my-secret-key-1234';

// ── 진입점 ────────────────────────────────────────────────
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

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
