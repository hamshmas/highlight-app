# 거래내역 하이라이트 (Highlight App)

은행 거래내역 PDF를 OCR로 추출하고, 기준 금액 이상 거래를 하이라이트하여 Excel로 생성합니다.

## 주요 기능

- 📄 **PDF/이미지 OCR**: Google Vision + Gemini AI로 거래내역 추출
- 🔍 **지능형 파싱**: 다양한 은행 형식 자동 인식
- 🎨 **하이라이트**: 기준 금액 이상 거래 색상 표시
- 📊 **Excel 생성**: 하이라이트된 결과를 Excel로 다운로드
- 💾 **캐싱**: 동일 파일 재처리 시 빠른 로드

## 기술 스택

- **Frontend**: Next.js 16, React 19, TypeScript
- **Styling**: Tailwind CSS
- **OCR**: Google Cloud Vision API
- **AI 파싱**: Google Gemini 2.0 Flash
- **인증**: NextAuth.js (Google OAuth)
- **Storage**: Supabase (캐싱 및 파일 저장)

## 프로젝트 구조

```
src/
├── app/                    # Next.js App Router
│   ├── page.tsx           # 메인 페이지 (548줄)
│   ├── layout.tsx         # 레이아웃
│   └── api/               # API 라우트
├── components/            # UI 컴포넌트
│   ├── ui/               # 공통 UI (ThemeToggle, ProgressBar)
│   └── ocr/              # OCR 관련 (VirtualizedTransactionTable)
├── hooks/                 # 커스텀 훅
│   ├── useTimer.ts       # 처리 시간 카운터
│   ├── useFileUpload.ts  # 파일 업로드
│   ├── useTransactionEditor.ts  # 거래내역 편집
│   ├── useOcrProcess.ts  # OCR 처리
│   ├── useTheme.ts       # 다크 모드
│   └── useKeyboardNavigation.ts  # 키보드 네비게이션
├── lib/                   # 유틸리티
│   ├── constants.ts      # 상수
│   ├── column-detection.ts  # 컬럼 감지
│   └── ocr/              # OCR 모듈
│       ├── clients.ts    # Vision/Gemini 클라이언트
│       ├── ai-parser.ts  # AI 파싱
│       ├── text-processor.ts  # 텍스트 전처리
│       └── token-calculator.ts  # 비용 계산
└── types/                 # TypeScript 타입
    └── transaction.ts    # 거래내역 타입
```

## 설치 및 실행

### 1. 의존성 설치
```bash
npm install
```

### 2. 환경변수 설정
`.env.local` 파일 생성:
```env
# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret

# Google Cloud (OCR)
GOOGLE_CLOUD_PROJECT_ID=your-project-id
GOOGLE_CLOUD_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_CLOUD_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Gemini AI
GEMINI_API_KEY=your-gemini-api-key

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 3. 개발 서버 실행
```bash
npm run dev
```

### 4. 프로덕션 빌드
```bash
npm run build
npm start
```

## 배포

Vercel에 배포됨: https://highlight-app.vercel.app

## 버전 히스토리

### v1.0.0 (2026-01-30)
- 🎉 리팩토링 완료
  - `page.tsx` 1,246줄 → 548줄 (56% 감소)
  - 7개 커스텀 훅 생성
  - 5개 OCR 유틸리티 모듈 분리
- ✨ 디자인 시스템 CSS 변수 추가
- ✨ 다크 모드 토글 (`useTheme`, `ThemeToggle`)
- ✨ 프로그레스 바 컴포넌트 (`ProgressBar`, `StepProgress`)
- ✨ 테이블 가상화 (`@tanstack/react-virtual`)
- ✨ 키보드 네비게이션 / 접근성 개선
- 🐛 하이라이트 기본값 버그 수정

## 라이선스

MIT License
