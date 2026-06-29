# 장부관리

거래처·품목·매출·매입·견적을 관리하는 단일 파일 SPA 장부 프로그램입니다.  
데이터는 브라우저 localStorage에 저장되며, Google Sheets로 자동 백업됩니다.

---

## Netlify Drop 배포 방법

1. [drop.netlify.com](https://drop.netlify.com) 접속
2. 이 폴더(`accounting/`)를 통째로 드래그 앤 드롭
3. 배포 완료 후 생성된 URL로 접속

> 배포할 때 포함해야 할 파일: `index.html`, `styles.css`, `app.js`  
> 포함하지 않아도 되는 파일: `apps-script/`, `*.json` 백업파일, `README.md`

---

## 새 기기에서 사용 시작하는 방법

새 기기에서는 localStorage가 비어 있으므로 아래 순서로 진행하세요.

### 1단계 — 배포된 주소 접속
Netlify에서 받은 URL을 브라우저에서 열기

### 2단계 — 시트 연동 설정
- 홈 화면 우상단 **⚙ 시트설정** 클릭
- **Apps Script 배포 URL** 입력 (`https://script.google.com/macros/s/.../exec` 형태)
- **Secret Key** 입력 (Code.gs의 `SECRET_KEY`와 동일한 값)
- **연결 테스트** 클릭 → "✅ 연결 성공" 확인
- **저장** 클릭

### 3단계 — 데이터 복원
- 홈 화면 **☁ 시트복원** 클릭
- "복원 완료" 메시지 확인 후 앱 자동 새로고침
- 기존 데이터 전부 복원됨

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 거래 내역 | 매출/매입 입력, 결제 처리, 미수금/미지급 관리 |
| 거래처 관리 | 등록/수정/삭제, 엑셀 업로드/다운로드 |
| 품목 관리 | 코드·단가·거래처 연결, 엑셀 업로드/다운로드 |
| 집계 | 거래처별·계정별·판매현황, 기간 필터 |
| 견적/발주 | 견적서·발주서 작성, PDF 출력, 거래 전환 |
| 다중 사업체 | 사업체별 거래 분리, 거래처·품목 공유 |
| 자동 백업 | 저장 시 3초 후 자동으로 Google Sheets 백업 |
| 수동 백업 | ☁ 시트백업 버튼으로 즉시 백업 |
| JSON 백업 | 💾 전체 백업으로 로컬 파일 저장 |

---

## Google Sheets 백업 구조

```
앱 (localStorage) ←→ Apps Script (/exec URL) ←→ Google Sheets (storage 시트)
```

- 자동 백업: 데이터 저장 후 3초 debounce → 우측 상단에 "☁ 자동 백업 완료" 표시
- 백업 실패해도 localStorage 데이터는 유지됨
- Apps Script URL/SecretKey 미설정 시 자동 백업은 조용히 건너뜀

Apps Script 설정 방법은 `GOOGLE_SHEETS_SETUP.md` 참고

---

## 기술 스택

- 순수 HTML / CSS / JavaScript (프레임워크 없음)
- localStorage 기반 데이터 저장
- SheetJS (xlsx@0.18.5) — 엑셀 기능
- Google Apps Script — 클라우드 백업 서버
