# 장부관리 앱 — 프로젝트 컨텍스트

## 개요
개인사업자용 단일파일 SPA. 프레임워크 없음, 순수 HTML/CSS/JS.
- `index.html` — 레이아웃 + 페이지 div
- `app.js` — 전체 로직 (~3700줄)
- `styles.css` — 스타일
- `Code.gs` — Google Apps Script (구글 시트 백업/SMS 수신)

## 스토리지 구조
```
localStorage
  acc_businesses            → 사업체 목록 [{id, name}]
  acc_current_biz           → 현재 사업체 ID
  acc_vendors               → 거래처 (공유, DBshared)
  acc_items                 → 품목 (공유, DBshared)
  acc_transactions__{bizId} → 거래내역 (사업체별, DB)
  acc_quotes__{bizId}       → 견적/발주 (사업체별, DB)
  acc_company__{bizId}      → 회사정보 (사업체별, DB)
  acc_expense_candidates    → 사업비 후보 (공유, DBshared)
  acc_merchant_cats         → 가맹점→카테고리 학습맵 (공유, DBshared)
  acc_sheets_url            → GAS 웹앱 URL
  acc_sheets_key            → GAS Secret Key (현재: a4463116!)
  acc_saved_at              → 마지막 저장 시각 (백업에 포함되어 시트의 버전 표식 역할)
  ledger_sync_base          → 이 기기가 마지막으로 시트와 일치했던 acc_saved_at (기기별, 백업 제외)
  ledger_prev_local         → 복원/동기화로 덮어쓰기 직전의 로컬 상태 (되돌리기용, 백업 제외)
  ledger_backup_pending     → 미전송 변경 플래그 (다음 시작 시 재전송)
  ht_template_b64           → 홈택스 일괄발급 양식 (기기별, 백업 제외)
```
※ `acc_` 접두사 키만 시트에 백업된다. 기기 고유 상태는 `ledger_`/`ht_` 접두사를 쓴다.

### 기기 간 동기화 규칙 (autoSyncFromSheets)
- 시트 savedAt == 기준점 → 로컬 변경만 있으면 push
- 시트 savedAt != 기준점 이고 로컬 변경 없음 → 시트 데이터 pull (직전 상태는 ledger_prev_local 보관)
- 양쪽 다 변경 → 자동 처리 금지, openSyncConflictModal로 거래 건수·최근 거래일을 보여주고 사용자가 선택
- 저장 함수는 scheduleSheetsBackup → 3초 후 runAutoSheetsBackup. 화면 이탈(visibilitychange hidden) 시 즉시 전송

### 헬퍼
```js
DB.load(key, fallback)      // bizKey(key) = key + '__' + currentBizId
DB.save(key, data)
DBshared.load(key, fallback) // prefix 없음
DBshared.save(key, data)
```

## 라우팅 패턴
```js
render(page)                // currentPage 갱신 + renderXxx(el) 호출
renderHomePage(el)
renderSummary(el)
renderVendors(el)
renderItems(el)
renderTransactions(el)
renderQuotes(el)
renderTaxPage(el)
renderCandidatesPage(el)
```

## 주요 유틸
```js
fmt(n)                      // 숫자 → 한국식 콤마 포맷
parseNum(id)                // input값 → 숫자 (콤마 제거)
parseNumNull(id)            // 빈값이면 null
openModal(title, html, large=false)
closeModal()
onNumInput(el)              // 입력 중 콤마 자동포맷
debounce(fn, ms)
```

## 데이터 모델

### Transaction
```js
{ id, date, type('매출'|'매입'), vendorId, paymentMethod,
  accountCategory, bizCategory('제조업'|'유통업'|'기타'),
  isPaid, items:[{itemName,unit,quantity,unitPrice,amount,tax,notes}] }
```

### Vendor
```js
{ id, companyName, representative, businessNumber, address, email, bizType }
```

### ExpenseCandidate (사업비 후보)
```js
{ id, date, merchant, amount, cardType, status('pending'|'confirmed'|'excluded'),
  suggestedCategory, category, memo, receivedAt, body }
```
- `EXPENSE_CATS = ['접대비','차량유지비','통신비','비품구입','복리후생비','기타경비']`
- `CAT_COLORS = { 접대비:'#ef4444', 차량유지비:'#f59e0b', 통신비:'#3b82f6', 비품구입:'#8b5cf6', 복리후생비:'#10b981', 기타경비:'#9ca3af' }`

## GAS (Code.gs)
- `SECRET_KEY = SMS_SECRET = 'a4463116!'`
- `BUSINESS_CARDS = ['롯데카드']` → pending 후보 등록
- `PERSONAL_CARDS = ['현대카드']` → excluded 기록
- actions: `ping`, `backupStorage`, `restoreStorage`, `getSavedAt`, `createSnapshot`, `listSnapshots`, `restoreSnapshot`, `askClaude`, `getExpenseCandidates`, `updateCandidateStatus`, `getDepositCandidates`, `updateDepositStatus`
- `backupStorage`는 LockService로 직렬화. `expectSavedAt`(기기의 동기화 기준점)이 시트의 `acc_saved_at`과 다르면 `{conflict:true}`로 거부 (`force:true`면 덮어씀, `dryRun:true`면 검증만). `snapshot`: auto(10분 간격) | before(저장 전) | force(저장 후) | none
- storage 시트 value 열은 텍스트 서식('@') 고정 — 날짜/수식 자동변환 방지
- SMS 경로: MacroDroid → POST `{secret, source:'sms', receivedAt, body}` → GAS → sms_raw + expense_candidates 시트

## 구글 시트 자동 백업
저장 함수 호출 시 3초 debounce → `runAutoSheetsBackup()` 자동 실행.
`saveTransactions()`, `saveVendors()`, `saveItems()`, `saveQuotes()`, `saveCompanyInfo()` 모두 `scheduleSheetsBackup()` 호출.

## CSS 클래스 (존재하는 것만)
`table-wrapper`, `form-control`, `form-group`, `filter-bar`, `td-actions`,
`btn`, `btn-sm`, `btn-ghost`, `btn-primary`, `btn-success`, `btn-danger`,
`badge`, `badge-sales`, `badge-purchase`,
`card`, `card-title`, `page-header`, `page-title`, `page-subtitle`,
`modal-overlay`, `modal-box`, `modal-header`, `modal-body`, `modal-title`,
`sidebar`, `sidebar-nav`, `nav-item`, `nav-icon`,
`empty-state`, `empty-icon`, `search-input`

## 다중 선택 (Bulk Select)
```js
const _sel = { vendors:Set, items:Set, txRows:Set, quotes:Set }
toggleSel(page, id)
selAll(page, checkboxEl)
_updateSelUI(page)          // sel-del-{page} + sel-bulk-{page} 버튼 갱신
deleteSelected(page)
bulkEditTxModal()           // txRows 선택 후 bizCategory/accountCategory 일괄변경
doBulkEditTx()
```

## 세금 분석 (renderTaxPage / recalcTax)
- 사업비 후보 confirmed 항목 → `getConfirmedExpenseByCategory()` → 세금분석 기타경비 자동합산
- 절세효과 = 경비 없을 때 세금 - 경비 있을 때 세금
- 종소세 8구간, 근로소득공제, 카드공제, 4대보험, 창업감면50%, 연금세액공제

## 코딩 규칙
- 전체 리팩토링 금지 — 기존 구조 최대한 유지, 최소 변경
- 기존 CSS 클래스만 사용 (위 목록 참고)
- 주석 금지 (WHY가 명확한 경우만 한 줄)
- `type="text" inputmode="numeric"` + `onNumInput(el)` (금액 입력)
- fetch POST 시 Content-Type 헤더 없음 (GAS 제약)
- 사업비 후보는 acc_transactions에 push하지 않음 (candidates만 관리)

## GitHub
- Repo: https://github.com/kesjjang12-sudo/accounting-app
- Branch: main

## 배포 워크플로 (필수)
작업 완료 후 배포 순서:
1. `git push origin main:main-backup` — main 백업 (기존 main-backup 브랜치 덮어쓰기)
2. `git push origin HEAD:main` — main에 직접 반영 → GitHub Pages 자동 배포

PR 생성 금지. 브랜치에서 직접 main으로 올린다.
