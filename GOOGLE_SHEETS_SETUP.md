# Google Sheets 연동 설정 가이드

## 전체 흐름

앱 (localStorage) ↔ Apps Script (/exec URL) ↔ Google Sheets (storage 시트)

---

## 1단계: Google Sheet 만들기

1. [sheets.google.com](https://sheets.google.com) 접속
2. 새 스프레드시트 생성
3. 파일명: `장부관리_백업` (아무 이름이나 가능)
4. 시트 이름을 **storage** 로 변경
   - 하단 탭에서 "Sheet1" 더블클릭 → `storage` 입력
5. A1 셀에 `key`, B1 셀에 `value`, C1 셀에 `updatedAt` 입력
   - (Apps Script가 자동으로 만들어주므로 생략해도 됨)

---

## 2단계: Apps Script 열기

1. 구글 시트 메뉴에서: **확장 프로그램 → Apps Script**
2. Apps Script 편집기가 열림

---

## 3단계: Code.gs 붙여넣기

1. 편집기 왼쪽에서 `Code.gs` 파일 선택
2. 기존 내용 전부 삭제
3. `apps-script/Code.gs` 파일 내용 전체 복사 후 붙여넣기
4. **SECRET_KEY 변경** (필수!)
   ```javascript
   const SECRET_KEY = 'my-secret-key-1234';
   // → 원하는 값으로 바꾸세요. 예: 'xo-packing-2026'
   ```
5. 저장 (Ctrl+S)

---

## 4단계: 웹 앱으로 배포

1. 오른쪽 상단 **배포** 버튼 클릭
2. **새 배포** 선택
3. 설정:
   - 유형: **웹 앱**
   - 설명: 장부관리 백업 (선택사항)
   - 다음 사용자로 실행: **나 (본인 계정)**
   - 액세스 권한: **모든 사용자** (Anonymous 포함)
4. **배포** 클릭
5. 권한 요청 창이 뜨면 **권한 부여** → 구글 계정 선택 → 허용
6. 배포 완료 후 **웹 앱 URL** 복사
   - `https://script.google.com/macros/s/여기가_스크립트ID/exec` 형태

---

## 5단계: 앱에 URL 입력

1. 장부관리 앱 열기
2. 홈 화면 우상단 **⚙ 시트설정** 버튼 클릭
3. 입력:
   - **Apps Script 배포 URL**: 4단계에서 복사한 `/exec` URL
   - **Secret Key**: Code.gs의 `SECRET_KEY`와 동일한 값
4. **연결 테스트** 버튼으로 확인 → "✅ 연결 성공" 메시지 확인
5. **저장** 클릭

---

## 6단계: 백업/복원 사용

- **☁ 시트백업**: 현재 앱 데이터 전체를 Google Sheets에 저장
- **☁ 시트복원**: Google Sheets에서 데이터 불러와 앱에 복원 (기존 데이터 덮어씀)

---

## 주의사항

- Apps Script 코드를 수정하면 **새 배포**를 다시 해야 URL이 갱신됩니다.
  (기존 URL을 재사용하려면 "배포 관리 → 연필 아이콘 → 버전: 새 버전" 선택)
- SECRET_KEY는 외부에 노출되지 않도록 주의하세요.
- 복원 시 현재 데이터가 모두 덮어쓰여집니다. 복원 전 로컬 백업 권장.
- 다른 컴퓨터에서 사용할 때: URL과 Secret Key만 ⚙ 시트설정에 입력하면 됩니다.
