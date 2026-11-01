# 🕊 사랑을 경희대를 타고

캠퍼스에서 스쳐 간 사람에게 날짜·장소·인상착의로 마음을 남기고, 닉네임으로 쪽지를 주고받는 사이트예요.

## 폴더 구성

```
pigeon-site/
├─ server.js          ← 서버 (가입·로그인·글·쪽지)
├─ supabase.sql       ← Supabase 표 만들기 명령어
├─ package.json       ← 실행 명령어 설정
├─ public/            ← 화면
│  ├─ index.html
│  ├─ style.css       ← 디자인 (색, 글씨체)
│  ├─ app.js          ← 화면 동작
│  ├─ privacy.html    ← 개인정보 처리방침 (초안 — 꼭 채워 넣기)
│  └─ favicon.svg     ← 비둘기 아이콘
└─ data/              ← 실행하면 자동 생성. 회원·글·쪽지가 db.json에 저장됨
```

## 처음 실행하기 (내 컴퓨터에서)

1. **Node.js 설치** — https://nodejs.org 에서 **LTS** 버전을 받아 설치해요. (이미 있으면 건너뛰기)
2. **VS Code 열기** → 메뉴 `파일 → 폴더 열기` → `pigeon-site` 폴더 선택
3. **터미널 열기** → 메뉴 `터미널 → 새 터미널`
4. 아래 한 줄을 입력해요. (추가로 설치할 라이브러리가 없어서 `npm install`은 필요 없어요)
   ```
   npm start
   ```
5. `http://localhost:3000` 이 뜨면 브라우저에서 열어요. 끝!

- 서버를 끄려면 터미널에서 `Ctrl + C`
- 코드를 고치면서 쓰려면 `npm start` 대신 `npm run dev` → 저장할 때마다 서버가 자동으로 다시 켜져요. (화면 파일만 고쳤다면 브라우저 새로고침만 하면 돼요)

### 혼자 테스트하는 팁
쪽지를 시험하려면 계정이 두 개 필요해요. 일반 창에서 하나, **시크릿 창**에서 하나 가입해서 서로 주고받아 보세요.

### 같은 와이파이의 친구 폰에서 열어보기
터미널에 `ipconfig`(Windows)로 내 IPv4 주소(예: 192.168.0.12)를 확인하고, 친구 폰 브라우저에서 `http://192.168.0.12:3000` 으로 접속해요. (방화벽 허용 창이 뜨면 허용)

## 자주 고칠 곳

| 바꾸고 싶은 것 | 파일 |
|---|---|
| 색깔 | `public/style.css` 맨 위 `:root` 안의 `--crimson`, `--sky` 등 |
| 글씨체·자간 | `public/style.css`의 `--font`, `--track` |
| 문구 (슬로건, 안내문) | `public/index.html` |
| 장소 추천 목록 | `public/index.html`의 `<datalist id="places">` |
| 글자 수 제한, 가입 규칙 | `server.js` 위쪽 `입력 검사` 부분 |

## 인터넷에 올리기 (진짜 주소 받기)

데이터는 **Supabase**(무료 데이터베이스)에, 사이트는 **Render**(무료 호스팅)에 둬요.
서버는 환경변수 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`가 있으면 Supabase에 저장하고, 없으면 `data/db.json`에 저장해요.

### 1) Supabase 표 만들기
- Supabase 프로젝트 → 왼쪽 **SQL Editor** → `supabase.sql` 내용을 붙여넣고 **Run**
- **Project Settings → API Keys**에서 **Secret key**(`sb_secret_...`)를 복사
- **Project URL**(`https://xxxx.supabase.co`)도 복사 (Connect 버튼이나 Settings에 있어요)
- ⚠️ Secret key는 비밀번호와 같아요. GitHub나 코드에 절대 붙여넣지 마세요.

### 2) Render에 올리기
- render.com → GitHub로 로그인 → **New + → Web Service** → `pigeon-site` 저장소 선택
- Language: **Node** / Build Command: 비워두기 / Start Command: `node server.js` / Instance Type: **Free**
- **Environment Variables**에 3개 추가
  - `SUPABASE_URL` = 복사한 Project URL
  - `SUPABASE_SECRET_KEY` = 복사한 Secret key
  - `NODE_ENV` = `production`
- **Deploy** → 몇 분 뒤 `https://pigeon-site-xxxx.onrender.com` 주소가 생겨요

무료 서버는 15분 동안 접속이 없으면 잠들어서, 다음 첫 접속은 1분 정도 걸릴 수 있어요. 데이터는 Supabase에 있어서 사라지지 않아요.

### 3) 코드를 고친 뒤 다시 올리기
GitHub 저장소에서 **Add file → Upload files**로 바뀐 파일을 다시 올리면 Render가 자동으로 새 버전을 배포해요.

## 운영 전 체크리스트

- [ ] `public/privacy.html`의 [운영자 이름], [이메일], [시행일] 채우기
- [ ] 문제 글 신고 기능, 회원 탈퇴 기능 추가 (다음 업데이트 후보)
- [ ] 학교 로고·교표는 허락 없이 쓰지 않기
