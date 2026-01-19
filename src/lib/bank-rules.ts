// 은행별 PDF 파싱 규칙 정의

export interface BankColumn {
  name: string;           // 컬럼명
  type: "date" | "time" | "datetime" | "text" | "amount" | "balance" | "number";
  description?: string;   // 설명
  isDeposit?: boolean;    // 입금 컬럼 여부
  isWithdrawal?: boolean; // 출금 컬럼 여부
}

export interface BankParsingRule {
  bankId: string;         // 고유 ID (예: "woori", "nonghyup")
  bankName: string;       // 은행명
  bankNameAliases: string[]; // 은행명 별칭 (자동 감지용)

  // 문서 구조
  structure: {
    type: "line-separated" | "space-separated" | "table";
    description: string;
  };

  // 헤더 정보
  header: {
    keywords: string[];   // 헤더 감지 키워드
    columns: BankColumn[];
  };

  // 파싱 패턴
  patterns: {
    dateFormat: string;           // 날짜 형식 설명
    dateRegex: string;            // 날짜 정규식
    amountFormat: string;         // 금액 형식 설명
    transactionStartPattern: string; // 거래 시작 패턴 설명
  };

  // 특이사항
  notes: string[];

  // 샘플 데이터 (문서화용)
  sampleData?: string;

  // 메타데이터
  lastUpdated: string;
  version: string;
}

// 우리은행 파싱 규칙
export const WOORI_BANK_RULE: BankParsingRule = {
  bankId: "woori",
  bankName: "우리은행",
  bankNameAliases: ["우리", "WOORI", "WON뱅킹"],

  structure: {
    type: "line-separated",
    description: "각 필드가 줄바꿈으로 분리됨 (공백 구분 아님)",
  },

  header: {
    keywords: ["No.", "거래일시", "적요", "기재내용", "찾으신금액", "맡기신금액", "거래후잔액", "취급기관"],
    columns: [
      { name: "No.", type: "number", description: "거래 순번" },
      { name: "거래일시", type: "datetime", description: "날짜+시간 (YYYY.MM.DD HH:MM)" },
      { name: "적요", type: "text", description: "거래 유형 (모바일, 타행건별, F/B 등)" },
      { name: "기재내용", type: "text", description: "상세 내용 (상대방, 카드사 등)" },
      { name: "찾으신금액", type: "amount", description: "출금", isWithdrawal: true },
      { name: "맡기신금액", type: "amount", description: "입금", isDeposit: true },
      { name: "거래후잔액", type: "balance", description: "잔액 (음수 가능)" },
      { name: "취급기관", type: "text", description: "거래 처리 기관" },
      { name: "메모", type: "text", description: "비고 (대부분 비어있음)" },
    ],
  },

  patterns: {
    dateFormat: "YYYY.MM.DD HH:MM",
    dateRegex: "^\\d{4}\\.\\d{2}\\.\\d{2}\\s+\\d{2}:\\d{2}$",
    amountFormat: "쉼표 포함, 음수 가능 (-93,000,000)",
    transactionStartPattern: "숫자(No.)로 시작하고 다음 줄에 날짜가 오는 패턴",
  },

  notes: [
    "각 필드가 줄바꿈으로 분리됨 (공백 구분 아님)",
    "날짜 형식: YYYY.MM.DD HH:MM",
    "금액 형식: 쉼표 포함, 음수 가능",
    "페이지 간 연속: 페이지 구분 없이 거래 연속",
    "잔액이 음수일 수 있음 (마이너스 통장/대출 계좌)",
  ],

  sampleData: `1
2025.12.29 09:08
불량편입
불량채권편입
0
0
-93,000,000
여신관리부

2
2025.12.21 10:25
대출결산
대출이자원가
0
0
-93,000,000
잠실금융센터`,

  lastUpdated: "2025-01-20",
  version: "1.0.0",
};

// 농협은행 파싱 규칙
export const NONGHYUP_BANK_RULE: BankParsingRule = {
  bankId: "nonghyup",
  bankName: "NH농협은행",
  bankNameAliases: ["농협", "NH", "NONGHYUP", "NH농협"],

  structure: {
    type: "line-separated",
    description: "각 필드가 줄바꿈으로 분리됨. 순번으로 시작",
  },

  header: {
    keywords: ["순번", "거래일시", "출금금액", "입금금액", "거래후잔액", "거래내용", "거래기록사항", "거래점"],
    columns: [
      { name: "순번", type: "number", description: "거래 순번" },
      { name: "거래일시", type: "datetime", description: "날짜+시간 (YYYY/MM/DD HH:MM:SS)" },
      { name: "출금금액", type: "amount", description: "출금액", isWithdrawal: true },
      { name: "입금금액", type: "amount", description: "입금액", isDeposit: true },
      { name: "거래후잔액", type: "balance", description: "잔액" },
      { name: "거래내용", type: "text", description: "거래 유형" },
      { name: "거래기록사항", type: "text", description: "상대방 정보" },
      { name: "거래점", type: "text", description: "거래 지점" },
    ],
  },

  patterns: {
    dateFormat: "YYYY/MM/DD HH:MM:SS",
    dateRegex: "^\\d{4}/\\d{2}/\\d{2}$",
    amountFormat: "쉼표 포함, 원 단위",
    transactionStartPattern: "순번(숫자)로 시작하고 다음 줄에 날짜가 오는 패턴",
  },

  notes: [
    "순번 → 날짜 → 시간 → 출금 → 입금+거래내용 → 거래기록사항 → 거래점 순서",
    "입금금액과 거래내용이 한 줄에 붙어있을 수 있음",
  ],

  sampleData: `1
2024/03/08
00:55:46
57,105원
0원타기관오픈
토뱅　김우현
농협
001374`,

  lastUpdated: "2025-01-20",
  version: "1.0.0",
};

// 카카오뱅크 파싱 규칙
export const KAKAO_BANK_RULE: BankParsingRule = {
  bankId: "kakaobank",
  bankName: "카카오뱅크",
  bankNameAliases: ["카카오", "KAKAO", "카뱅", "카카오뱅크"],

  structure: {
    type: "line-separated",
    description: "줄바꿈으로 분리. 날짜+시간으로 시작",
  },

  header: {
    keywords: ["거래일시", "구분", "거래금액", "거래 후 잔액", "거래구분", "내용", "메모"],
    columns: [
      { name: "거래일시", type: "datetime", description: "날짜+시간 (YYYY.MM.DD HH:MM:SS)" },
      { name: "구분", type: "text", description: "입금/출금" },
      { name: "거래금액", type: "amount", description: "거래 금액 (음수는 출금)" },
      { name: "거래후잔액", type: "balance", description: "거래 후 잔액" },
      { name: "거래구분", type: "text", description: "거래 유형" },
      { name: "내용", type: "text", description: "상대방/내용" },
      { name: "메모", type: "text", description: "메모" },
    ],
  },

  patterns: {
    dateFormat: "YYYY.MM.DD HH:MM:SS",
    dateRegex: "^\\d{4}\\.\\d{2}\\.\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}$",
    amountFormat: "음수(-) 표시로 출금 구분",
    transactionStartPattern: "날짜+시간으로 시작하는 줄",
  },

  notes: [
    "금액 앞 '-' 표시는 출금",
    "구분: 입금/출금",
    "PDF와 엑셀 둘 다 제공됨",
  ],

  sampleData: `2023.03.02 04:08:10
출금
-24,856
-2,415,522
이자상환(한도)
대출이자`,

  lastUpdated: "2025-01-20",
  version: "1.0.0",
};

// 케이뱅크 파싱 규칙
export const K_BANK_RULE: BankParsingRule = {
  bankId: "kbank",
  bankName: "케이뱅크",
  bankNameAliases: ["케이뱅크", "K뱅크", "KBANK", "K-BANK"],

  structure: {
    type: "line-separated",
    description: "줄바꿈으로 분리. 날짜+시간으로 시작",
  },

  header: {
    keywords: ["거래일시", "거래구분", "입금금액", "출금금액", "잔액", "상대 예금주명", "상대 은행", "적요내용"],
    columns: [
      { name: "거래일시", type: "datetime", description: "날짜+시간 (YYYY.MM.DD HH:MM:SS)" },
      { name: "거래구분", type: "text", description: "거래 유형" },
      { name: "입금금액", type: "amount", description: "입금액", isDeposit: true },
      { name: "출금금액", type: "amount", description: "출금액", isWithdrawal: true },
      { name: "잔액", type: "balance", description: "거래 후 잔액" },
      { name: "상대예금주명", type: "text", description: "상대방 이름" },
      { name: "상대은행", type: "text", description: "상대 은행" },
    ],
  },

  patterns: {
    dateFormat: "YYYY.MM.DD HH:MM:SS",
    dateRegex: "^\\d{4}\\.\\d{2}\\.\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}$",
    amountFormat: "쉼표 포함",
    transactionStartPattern: "날짜+시간으로 시작하는 줄",
  },

  notes: [
    "날짜+시간 → 거래구분 → 입금 → 출금 → 잔액 → 상대방 정보 순서",
    "입금/출금 중 하나는 0",
  ],

  sampleData: `2024.03.17 11:44:35
체크결제
0
4,700
1,282,965
엔에이치엔페이코 주`,

  lastUpdated: "2025-01-20",
  version: "1.0.0",
};

// 신한은행 파싱 규칙
export const SHINHAN_BANK_RULE: BankParsingRule = {
  bankId: "shinhan",
  bankName: "신한은행",
  bankNameAliases: ["신한", "SHINHAN"],

  structure: {
    type: "line-separated",
    description: "줄바꿈으로 분리. 날짜로 시작",
  },

  header: {
    keywords: ["거래일자", "거래시간", "적요", "출금", "입금", "내용", "잔액", "거래점"],
    columns: [
      { name: "거래일자", type: "date", description: "거래 날짜 (YYYY-MM-DD)" },
      { name: "거래시간", type: "time", description: "거래 시간 (HH:MM:SS)" },
      { name: "적요", type: "text", description: "거래 유형" },
      { name: "출금", type: "amount", description: "출금액", isWithdrawal: true },
      { name: "입금", type: "amount", description: "입금액", isDeposit: true },
      { name: "내용", type: "text", description: "상대방/내용" },
      { name: "잔액", type: "balance", description: "거래 후 잔액" },
      { name: "거래점", type: "text", description: "거래 지점" },
    ],
  },

  patterns: {
    dateFormat: "YYYY-MM-DD",
    dateRegex: "^\\d{4}-\\d{2}-\\d{2}$",
    amountFormat: "쉼표 포함",
    transactionStartPattern: "날짜로 시작하는 줄",
  },

  notes: [
    "날짜 → 시간 → 적요 → 출금/입금 → 내용 → 잔액 → 거래점 순서",
    "복잡한 구조로 AI 폴백 권장",
  ],

  sampleData: `2024-02-08
10:15:51
모바일
631,584
김우현
역촌동`,

  lastUpdated: "2025-01-20",
  version: "1.0.0",
};

// 국민은행 파싱 규칙
export const KOOKMIN_BANK_RULE: BankParsingRule = {
  bankId: "kookmin",
  bankName: "KB국민은행",
  bankNameAliases: ["국민", "KB", "KOOKMIN", "국민은행", "KBStar"],

  structure: {
    type: "line-separated",
    description: "줄바꿈으로 분리. 날짜-로 시작",
  },

  header: {
    keywords: ["거래일시", "적요", "보낸분", "받는분", "출금액", "입금액", "잔액", "송금메모", "거래점"],
    columns: [
      { name: "거래일시", type: "datetime", description: "날짜+시간 (YYYY-MM-DD HH:MM:SS)" },
      { name: "적요", type: "text", description: "거래 유형" },
      { name: "상대방", type: "text", description: "보낸분/받는분" },
      { name: "출금액", type: "amount", description: "출금액", isWithdrawal: true },
      { name: "입금액", type: "amount", description: "입금액", isDeposit: true },
      { name: "잔액", type: "balance", description: "거래 후 잔액" },
      { name: "거래점", type: "text", description: "거래 지점" },
    ],
  },

  patterns: {
    dateFormat: "YYYY-MM-DD HH:MM:SS",
    dateRegex: "^\\d{4}-\\d{2}-",
    amountFormat: "쉼표 포함",
    transactionStartPattern: "YYYY-MM-로 시작하는 줄",
  },

  notes: [
    "웹페이지 인쇄 형식 PDF",
    "날짜가 여러 줄에 걸쳐 있을 수 있음 (2024-03-14 줄바꿈 09:31:23)",
    "복잡한 구조로 AI 폴백 권장",
  ],

  sampleData: `2024-03-
14
09:31:23
체크카
드
씨유동
대문쇼
핑타운
8,100
0
1,427,626
KB카드`,

  lastUpdated: "2025-01-20",
  version: "1.0.0",
};

// 하나은행 파싱 규칙
export const HANA_BANK_RULE: BankParsingRule = {
  bankId: "hana",
  bankName: "하나은행",
  bankNameAliases: ["하나", "HANA", "KEB하나"],

  structure: {
    type: "space-separated",
    description: "공백/탭으로 컬럼 구분. 한 줄에 모든 필드",
  },

  header: {
    keywords: ["거래일시", "구분", "적요", "출금액", "입금액", "잔액", "거래점"],
    columns: [
      { name: "거래일시", type: "datetime", description: "날짜+시간 (YYYY-MM-DD HH:MM)" },
      { name: "구분", type: "text", description: "거래 유형" },
      { name: "적요", type: "text", description: "거래 내용" },
      { name: "출금액", type: "amount", description: "출금액", isWithdrawal: true },
      { name: "입금액", type: "amount", description: "입금액", isDeposit: true },
      { name: "잔액", type: "balance", description: "거래 후 잔액" },
      { name: "거래점", type: "text", description: "거래 지점" },
    ],
  },

  patterns: {
    dateFormat: "YYYY-MM-DD HH:MM",
    dateRegex: "^\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}",
    amountFormat: "쉼표 포함",
    transactionStartPattern: "날짜+시간으로 시작하는 줄",
  },

  notes: [
    "한 줄에 모든 필드가 공백으로 구분됨",
    "날짜시간 구분 적요 상세내용 출금 입금 잔액 거래점 형식",
  ],

  sampleData: `2023-03-13 02:58 대출이자 대출결산이자 642 0 50,242 LS용산타워
2023-03-13 23:48 대체 토뱅 김우현 1,900,000 0 -1,849,758 대외기관0026`,

  lastUpdated: "2025-01-20",
  version: "1.0.0",
};

// 토스뱅크 파싱 규칙
export const TOSS_BANK_RULE: BankParsingRule = {
  bankId: "tossbank",
  bankName: "토스뱅크",
  bankNameAliases: ["토스", "TOSS", "토뱅"],

  structure: {
    type: "line-separated",
    description: "줄바꿈으로 분리. 날짜+시간으로 시작",
  },

  header: {
    keywords: ["거래일자", "구분", "거래금액", "거래 후 잔액", "거래내용"],
    columns: [
      { name: "거래일자", type: "datetime", description: "날짜+시간 (YYYY-MM-DD HH:MM:SS)" },
      { name: "구분", type: "text", description: "입금/출금" },
      { name: "거래금액", type: "amount", description: "거래 금액 (음수는 출금)" },
      { name: "거래후잔액", type: "balance", description: "거래 후 잔액" },
      { name: "거래내용", type: "text", description: "상대방/내용" },
    ],
  },

  patterns: {
    dateFormat: "YYYY-MM-DD HH:MM:SS",
    dateRegex: "^\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}$",
    amountFormat: "음수(-) 표시로 출금 구분",
    transactionStartPattern: "날짜+시간으로 시작하는 줄",
  },

  notes: [
    "금액 앞 '-' 표시는 출금",
    "구분: 입금/출금",
    "날짜+시간 → 구분 → 금액 → 잔액 → 내용 순서",
  ],

  sampleData: `2024-02-29 11:21:40
출금
-10,000
1,129,043
김우현`,

  lastUpdated: "2025-01-20",
  version: "1.0.0",
};

// 광주은행 파싱 규칙
export const GWANGJU_BANK_RULE: BankParsingRule = {
  bankId: "gwangju",
  bankName: "광주은행",
  bankNameAliases: ["광주", "GWANGJU", "KJB"],

  structure: {
    type: "line-separated",
    description: "줄바꿈으로 분리. 날짜+시간으로 시작",
  },

  header: {
    keywords: ["거래일시", "적요", "메모", "입/출금", "출금", "입금", "통장잔액", "처리결과", "거래구분", "취급점"],
    columns: [
      { name: "거래일시", type: "datetime", description: "날짜+시간 (YYYY-MM-DD HH:MM:SS)" },
      { name: "적요", type: "text", description: "거래 내용 (원리금, 김우현 등)" },
      { name: "입/출금", type: "text", description: "입금/출금 구분" },
      { name: "출금", type: "amount", description: "출금액", isWithdrawal: true },
      { name: "입금", type: "amount", description: "입금액", isDeposit: true },
      { name: "통장잔액", type: "balance", description: "거래 후 잔액" },
      { name: "처리결과", type: "text", description: "정상거래 등" },
      { name: "거래구분", type: "text", description: "전자망 등" },
      { name: "취급점", type: "text", description: "처리 지점" },
    ],
  },

  patterns: {
    dateFormat: "YYYY-MM-DD HH:MM:SS",
    dateRegex: "^\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}$",
    amountFormat: "쉼표 포함",
    transactionStartPattern: "날짜+시간으로 시작하는 줄",
  },

  notes: [
    "날짜+시간 → 적요 → 입/출금구분 → 출금액 → 입금액 → 잔액 → 처리결과 → (거래구분) → (취급점)",
    "처리결과 필드가 고유함 (정상거래)",
    "거래구분, 취급점은 선택적으로 있음",
  ],

  sampleData: `2024-02-01 12:22:21 원리금575701
출금
121,358
0
1,294
정상거래

2024-01-03 16:56:52 김우현
입금
0
486,000
486,935
정상거래
전자망
본부총괄`,

  lastUpdated: "2025-01-20",
  version: "1.0.0",
};

// 기업은행 파싱 규칙
export const IBK_BANK_RULE: BankParsingRule = {
  bankId: "ibk",
  bankName: "IBK기업은행",
  bankNameAliases: ["기업", "IBK", "기업은행", "중소기업은행"],

  structure: {
    type: "line-separated",
    description: "줄바꿈으로 분리. 순번 → 거래일시 → 출금 → 입금 → 잔액 → 거래내용 등",
  },

  header: {
    keywords: ["거래일시", "출금", "입금", "거래후 잔액", "거래내용", "상대계좌번호", "상대은행", "메모", "상대계좌예금주명"],
    columns: [
      { name: "순번", type: "number", description: "거래 순번" },
      { name: "거래일시", type: "datetime", description: "날짜+시간 (YYYY-MM-DD HH:MM:SS)" },
      { name: "출금", type: "amount", description: "출금액", isWithdrawal: true },
      { name: "입금", type: "amount", description: "입금액", isDeposit: true },
      { name: "거래후잔액", type: "balance", description: "거래 후 잔액" },
      { name: "거래내용", type: "text", description: "거래 내용" },
      { name: "상대계좌번호", type: "text", description: "상대 계좌번호" },
      { name: "상대은행", type: "text", description: "상대 은행" },
      { name: "메모", type: "text", description: "메모" },
      { name: "거래구분", type: "text", description: "거래 구분" },
      { name: "상대예금주명", type: "text", description: "상대방 이름" },
    ],
  },

  patterns: {
    dateFormat: "YYYY-MM-DD HH:MM:SS",
    dateRegex: "^\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}$",
    amountFormat: "쉼표 포함",
    transactionStartPattern: "순번(숫자)으로 시작하고 다음 줄에 날짜+시간이 오는 패턴",
  },

  notes: [
    "순번 → 거래일시 → 출금 → 입금 → 잔액 → 거래내용 → 상대계좌 → 상대은행 → 메모 → 거래구분 → ... → 상대예금주명",
    "거래내용에 줄바꿈이 있을 수 있음 (예: '원리금-3200031 다음납입\\n예정일-20240229')",
    "상대예금주명은 마지막에 위치",
  ],

  sampleData: `1
2024-02-19 07:36:53
0
0
335
2024년결산
이자
0

2
2024-02-05 18:59:26
571,579
0
335 원리금-3200031 다음납입
예정일-20240229
0451040503200031
CC
0`,

  lastUpdated: "2025-01-20",
  version: "1.0.0",
};

// 모든 은행 규칙 모음
export const ALL_BANK_RULES: BankParsingRule[] = [
  WOORI_BANK_RULE,
  NONGHYUP_BANK_RULE,
  KAKAO_BANK_RULE,
  K_BANK_RULE,
  SHINHAN_BANK_RULE,
  KOOKMIN_BANK_RULE,
  HANA_BANK_RULE,
  TOSS_BANK_RULE,
  IBK_BANK_RULE,
  GWANGJU_BANK_RULE,
];

// 은행 ID로 규칙 찾기
export function getBankRuleById(bankId: string): BankParsingRule | undefined {
  return ALL_BANK_RULES.find(rule => rule.bankId === bankId);
}

// 은행명으로 규칙 찾기 (별칭 포함)
export function getBankRuleByName(bankName: string): BankParsingRule | undefined {
  const normalizedName = bankName.toLowerCase().replace(/\s/g, "");

  return ALL_BANK_RULES.find(rule => {
    if (rule.bankName.toLowerCase().replace(/\s/g, "") === normalizedName) {
      return true;
    }
    return rule.bankNameAliases.some(alias =>
      alias.toLowerCase().replace(/\s/g, "") === normalizedName
    );
  });
}

// 텍스트에서 은행 자동 감지
export function detectBankFromText(text: string): BankParsingRule | undefined {
  const firstPart = text.substring(0, 2000).toLowerCase();
  const textSample = text.substring(0, 5000);

  // 1단계: 특수 키워드로 먼저 매칭 (은행별 고유 키워드 - 가장 신뢰할 수 있음)
  // 기업은행: "상대계좌예금주명" (매우 고유한 키워드)
  if (firstPart.includes("상대계좌예금주명")) {
    return ALL_BANK_RULES.find(r => r.bankId === "ibk");
  }
  // 광주은행: "처리결과" + "정상거래" (고유한 조합)
  if (firstPart.includes("처리결과") && firstPart.includes("정상거래")) {
    return ALL_BANK_RULES.find(r => r.bankId === "gwangju");
  }
  // 우리은행: "맡기신금액", "찾으신금액"
  if (firstPart.includes("맡기신금액") || firstPart.includes("찾으신금액")) {
    return ALL_BANK_RULES.find(r => r.bankId === "woori");
  }
  // 농협: "거래기록사항"
  if (firstPart.includes("거래기록사항")) {
    return ALL_BANK_RULES.find(r => r.bankId === "nonghyup");
  }
  // 토스뱅크: "토스뱅크 통장" 또는 "거래일자" + "거래금액" + "거래 후 잔액" (거래구분 없음)
  if (firstPart.includes("토스뱅크 통장") ||
      (firstPart.includes("거래일자") && firstPart.includes("거래금액") && firstPart.includes("거래 후 잔액") && !firstPart.includes("거래구분"))) {
    return ALL_BANK_RULES.find(r => r.bankId === "tossbank");
  }
  // 카카오뱅크: "거래 후 잔액" + "거래구분" (둘 다 있어야 함)
  if (firstPart.includes("거래 후 잔액") && firstPart.includes("거래구분")) {
    return ALL_BANK_RULES.find(r => r.bankId === "kakaobank");
  }
  // 케이뱅크: "상대 예금주명" (띄어쓰기 포함)
  if (firstPart.includes("상대 예금주명")) {
    return ALL_BANK_RULES.find(r => r.bankId === "kbank");
  }

  // 2단계: 문서 구조 패턴으로 매칭
  // 하나은행: 한 줄에 날짜+시간 + 구분(한글) 패턴 (space-separated, 독특한 구조)
  const hanaPattern = /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[가-힣]+/;
  if (hanaPattern.test(textSample)) {
    const hanaRule = ALL_BANK_RULES.find(r => r.bankId === "hana");
    if (hanaRule) return hanaRule;
  }

  // 국민은행: 날짜가 여러 줄에 걸침 (YYYY-MM-\n...일\n...HH:MM:SS)
  const kookminPattern = /\d{4}-\d{2}-\n/;
  if (kookminPattern.test(textSample)) {
    const kookminRule = ALL_BANK_RULES.find(r => r.bankId === "kookmin");
    if (kookminRule) return kookminRule;
  }

  // 신한은행: 날짜와 시간이 별도 줄 (YYYY-MM-DD\nHH:MM:SS)
  const shinhanPattern = /\d{4}-\d{2}-\d{2}\n\d{2}:\d{2}:\d{2}/;
  if (shinhanPattern.test(textSample)) {
    const shinhanRule = ALL_BANK_RULES.find(r => r.bankId === "shinhan");
    if (shinhanRule) return shinhanRule;
  }

  // 토스뱅크: 날짜 형식이 YYYY-MM-DD HH:MM:SS이고 "거래금액" 키워드
  if (firstPart.includes("거래금액") && /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(textSample)) {
    return ALL_BANK_RULES.find(r => r.bankId === "tossbank");
  }

  // 3단계: 헤더 영역(처음 500자)에서 은행명 찾기
  const headerPart = text.substring(0, 500).toLowerCase();
  for (const rule of ALL_BANK_RULES) {
    const allNames = [rule.bankName, ...rule.bankNameAliases];
    for (const name of allNames) {
      if (headerPart.includes(name.toLowerCase())) {
        return rule;
      }
    }
  }

  // 4단계: 헤더 키워드 매칭 (가장 많이 매칭되는 은행 선택)
  let bestMatch: BankParsingRule | undefined;
  let bestScore = 0;

  for (const rule of ALL_BANK_RULES) {
    const matchedKeywords = rule.header.keywords.filter(kw =>
      firstPart.includes(kw.toLowerCase())
    );
    const score = matchedKeywords.length;

    if (score > bestScore && score >= 4) {
      bestScore = score;
      bestMatch = rule;
    }
  }

  return bestMatch;
}

// 검증 상태
export type ValidationStatus = "verified" | "needs-verification" | "unverified";

export function getRuleValidationStatus(rule: BankParsingRule): ValidationStatus {
  if (rule.sampleData && rule.version >= "1.0.0") {
    return "verified";
  }
  if (rule.version >= "0.5.0") {
    return "needs-verification";
  }
  return "unverified";
}

// ==================== 규칙 기반 파싱 함수 ====================

export type TransactionRow = Record<string, string | number>;

// 금액 파싱 (쉼표, 음수 처리)
function parseAmount(str: string): number {
  if (!str || str === "-") return 0;
  const cleaned = str.replace(/[,\s원₩]/g, "").trim();
  if (!cleaned || cleaned === "") return 0;
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// 우리은행 전용 파싱 (줄 단위 분리)
export function parseWooriBank(text: string): TransactionRow[] {
  const lines = text.split("\n").map(l => l.trim());
  const transactions: TransactionRow[] = [];

  // 날짜+시간 패턴: 2025.12.29 09:08
  const dateTimeRegex = /^\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}$/;
  // 순번 패턴
  const numberRegex = /^\d+$/;

  // 먼저 모든 거래 시작점(순번+날짜) 인덱스를 찾기
  const startIndices: number[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (numberRegex.test(lines[i]) && dateTimeRegex.test(lines[i + 1])) {
      startIndices.push(i);
    }
  }

  // 각 거래 파싱
  for (let idx = 0; idx < startIndices.length; idx++) {
    const i = startIndices[idx];
    const nextStart = idx + 1 < startIndices.length ? startIndices[idx + 1] : lines.length;

    const no = parseInt(lines[i]);
    const datetime = lines[i + 1] || "";
    const summary = lines[i + 2] || "";      // 적요
    const content = lines[i + 3] || "";      // 기재내용
    const withdrawal = lines[i + 4] || "0";  // 찾으신금액
    const deposit = lines[i + 5] || "0";     // 맡기신금액
    const balanceLine = lines[i + 6] || "0"; // 거래후잔액 (취급기관이 붙어있을 수 있음)

    // 잔액과 취급기관 분리 (예: "-90,195,876 개인영업전략부(카드)")
    const balanceParts = balanceLine.split(/\s+/);
    const balance = balanceParts[0] || "0";

    // 취급기관: 잔액 줄에 붙어있거나, 다음 줄에 있거나, 다음 거래 전까지 남은 줄에서 찾기
    let branch = balanceParts.slice(1).join(" ");
    if (!branch && i + 7 < nextStart) {
      branch = lines[i + 7] || "";
    }

    transactions.push({
      "No.": no,
      "거래일시": datetime,
      "적요": summary,
      "기재내용": content,
      "찾으신금액": parseAmount(withdrawal),
      "맡기신금액": parseAmount(deposit),
      "거래후잔액": parseAmount(balance),
      "취급기관": branch,
    });
  }

  return transactions;
}

// 농협은행 전용 파싱
export function parseNonghyupBank(text: string): TransactionRow[] {
  const lines = text.split("\n").map(l => l.trim());
  const transactions: TransactionRow[] = [];

  // 날짜 패턴: 2024/03/08
  const dateRegex = /^\d{4}\/\d{2}\/\d{2}$/;
  // 시간 패턴: 00:55:46
  const timeRegex = /^\d{2}:\d{2}:\d{2}$/;
  // 순번 패턴
  const numberRegex = /^\d+$/;

  // 거래 시작점 찾기 (순번 + 날짜 + 시간)
  const startIndices: number[] = [];
  for (let i = 0; i < lines.length - 2; i++) {
    if (numberRegex.test(lines[i]) && dateRegex.test(lines[i + 1]) && timeRegex.test(lines[i + 2])) {
      startIndices.push(i);
    }
  }

  for (let idx = 0; idx < startIndices.length; idx++) {
    const i = startIndices[idx];
    const nextStart = idx + 1 < startIndices.length ? startIndices[idx + 1] : lines.length;

    const no = parseInt(lines[i]);
    const date = lines[i + 1] || "";
    const time = lines[i + 2] || "";
    const datetime = `${date} ${time}`;

    // 출금금액 (원 단위)
    const withdrawalLine = lines[i + 3] || "0";
    // 입금금액 + 거래내용이 붙어있을 수 있음 (예: "0원타기관오픈")
    const depositLine = lines[i + 4] || "0";

    // 입금금액과 거래내용 분리
    const depositMatch = depositLine.match(/^([\d,]+)원(.*)$/);
    let deposit = "0";
    let txType = "";
    if (depositMatch) {
      deposit = depositMatch[1];
      txType = depositMatch[2] || "";
    } else {
      deposit = depositLine.replace(/[원,]/g, "") || "0";
    }

    // 거래기록사항, 거래점, 메모
    const recordInfo = lines[i + 5] || "";
    const branch = lines[i + 6] || "";

    transactions.push({
      "순번": no,
      "거래일시": datetime,
      "출금금액": parseAmount(withdrawalLine),
      "입금금액": parseAmount(deposit),
      "거래내용": txType,
      "거래기록사항": recordInfo,
      "거래점": branch,
    });
  }

  return transactions;
}

// 카카오뱅크 전용 파싱
export function parseKakaoBank(text: string): TransactionRow[] {
  const lines = text.split("\n").map(l => l.trim());
  const transactions: TransactionRow[] = [];

  // 날짜+시간 패턴: 2023.03.02 04:08:10
  const dateTimeRegex = /^\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}$/;

  // 거래 시작점 찾기
  const startIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (dateTimeRegex.test(lines[i])) {
      startIndices.push(i);
    }
  }

  for (let idx = 0; idx < startIndices.length; idx++) {
    const i = startIndices[idx];
    const nextStart = idx + 1 < startIndices.length ? startIndices[idx + 1] : lines.length;

    const datetime = lines[i];
    const txType = lines[i + 1] || "";         // 입금/출금
    const amount = lines[i + 2] || "0";        // 거래금액 (음수는 출금)
    const balance = lines[i + 3] || "0";       // 거래후잔액
    const category = lines[i + 4] || "";       // 거래구분
    const content = lines[i + 5] || "";        // 내용
    const memo = i + 6 < nextStart ? lines[i + 6] || "" : "";

    const amountNum = parseAmount(amount);

    transactions.push({
      "거래일시": datetime,
      "구분": txType,
      "거래금액": amountNum,
      "출금": amountNum < 0 ? Math.abs(amountNum) : 0,
      "입금": amountNum > 0 ? amountNum : 0,
      "거래후잔액": parseAmount(balance),
      "거래구분": category,
      "내용": content,
      "메모": memo,
    });
  }

  return transactions;
}

// 케이뱅크 전용 파싱
export function parseKBank(text: string): TransactionRow[] {
  const lines = text.split("\n").map(l => l.trim());
  const transactions: TransactionRow[] = [];

  // 날짜+시간 패턴: 2024.03.17 11:44:35
  const dateTimeRegex = /^\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}$/;

  const startIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (dateTimeRegex.test(lines[i])) {
      startIndices.push(i);
    }
  }

  for (let idx = 0; idx < startIndices.length; idx++) {
    const i = startIndices[idx];
    const nextStart = idx + 1 < startIndices.length ? startIndices[idx + 1] : lines.length;

    const datetime = lines[i];
    const txType = lines[i + 1] || "";
    const depositStr = lines[i + 2] || "0";
    const withdrawalStr = lines[i + 3] || "0";
    const balance = lines[i + 4] || "0";
    const counterparty = i + 5 < nextStart ? lines[i + 5] || "" : "";

    transactions.push({
      "거래일시": datetime,
      "거래구분": txType,
      "입금금액": parseAmount(depositStr),
      "출금금액": parseAmount(withdrawalStr),
      "잔액": parseAmount(balance),
      "상대예금주명": counterparty,
    });
  }

  return transactions;
}

// 토스뱅크 전용 파싱
export function parseTossBank(text: string): TransactionRow[] {
  const lines = text.split("\n").map(l => l.trim());
  const transactions: TransactionRow[] = [];

  // 날짜+시간 패턴: 2024-02-29 11:21:40
  const dateTimeRegex = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/;

  const startIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (dateTimeRegex.test(lines[i])) {
      startIndices.push(i);
    }
  }

  for (let idx = 0; idx < startIndices.length; idx++) {
    const i = startIndices[idx];
    const nextStart = idx + 1 < startIndices.length ? startIndices[idx + 1] : lines.length;

    const datetime = lines[i];
    const txType = lines[i + 1] || "";
    const amount = lines[i + 2] || "0";
    const balance = lines[i + 3] || "0";
    const content = i + 4 < nextStart ? lines[i + 4] || "" : "";

    const amountNum = parseAmount(amount);

    transactions.push({
      "거래일자": datetime,
      "구분": txType,
      "거래금액": amountNum,
      "출금": amountNum < 0 ? Math.abs(amountNum) : 0,
      "입금": amountNum > 0 ? amountNum : 0,
      "거래후잔액": parseAmount(balance),
      "거래내용": content,
    });
  }

  return transactions;
}

// 하나은행 전용 파싱 (줄바꿈 구분)
export function parseHanaBank(text: string): TransactionRow[] {
  const lines = text.split("\n").map(l => l.trim());
  const transactions: TransactionRow[] = [];

  // 날짜+시간+구분 패턴: 2023-03-13 02:58 대출이자
  const dateTimeRegex = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+)$/;

  // 거래 시작점 찾기
  const startIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (dateTimeRegex.test(lines[i])) {
      startIndices.push(i);
    }
  }

  for (let idx = 0; idx < startIndices.length; idx++) {
    const i = startIndices[idx];
    const nextStart = idx + 1 < startIndices.length ? startIndices[idx + 1] : lines.length;

    const match = lines[i].match(dateTimeRegex);
    if (!match) continue;

    const datetime = `${match[1]} ${match[2]}`;
    const txType = match[3] || "";  // 거래 유형 (대출이자, 대체, 타행이체 등)

    // 다음 줄: 적요/상세내용
    const detail = lines[i + 1] || "";

    // 출금액 (줄 2)
    const withdrawalStr = lines[i + 2] || "0";

    // 입금액 (줄 3)
    const depositStr = lines[i + 3] || "0";

    // 잔액+거래점 (줄 4) - 예: "-1,890,000 토스뱅크1008" 또는 "50,242 LS용산타워"
    const balanceLine = lines[i + 4] || "0";
    const balanceMatch = balanceLine.match(/^(-?[\d,]+)\s*(.*)$/);
    let balance = "0";
    let branch = "";
    if (balanceMatch) {
      balance = balanceMatch[1];
      branch = balanceMatch[2] || "";
    } else {
      balance = balanceLine;
    }

    transactions.push({
      "거래일시": datetime,
      "구분": txType,
      "적요": detail,
      "출금액": parseAmount(withdrawalStr),
      "입금액": parseAmount(depositStr),
      "잔액": parseAmount(balance),
      "거래점": branch,
    });
  }

  return transactions;
}

// 기업은행 전용 파싱
export function parseIBKBank(text: string): TransactionRow[] {
  const lines = text.split("\n").map(l => l.trim());
  const transactions: TransactionRow[] = [];

  // 날짜+시간 패턴: 2024-02-19 07:36:53
  const dateTimeRegex = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/;
  // 순번 패턴 (1~4자리 숫자만)
  const numberRegex = /^\d{1,4}$/;

  // 거래 시작점 찾기 (순번 + 날짜+시간)
  const startIndices: number[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (numberRegex.test(lines[i]) && dateTimeRegex.test(lines[i + 1])) {
      startIndices.push(i);
    }
  }

  for (let idx = 0; idx < startIndices.length; idx++) {
    const i = startIndices[idx];
    const nextStart = idx + 1 < startIndices.length ? startIndices[idx + 1] : lines.length;

    const no = parseInt(lines[i]);
    const datetime = lines[i + 1] || "";
    const withdrawal = lines[i + 2] || "0";
    const deposit = lines[i + 3] || "0";

    // 잔액과 거래내용이 붙어있을 수 있음 (예: "335 원리금-3200031 다음납입")
    const balanceLine = lines[i + 4] || "0";
    const balanceMatch = balanceLine.match(/^(-?[\d,]+)\s*(.*)$/);
    let balance = "0";
    let contentPart = "";
    if (balanceMatch) {
      balance = balanceMatch[1];
      contentPart = balanceMatch[2] || "";
    } else {
      balance = balanceLine;
    }

    // 나머지 필드들 추출 (가변 길이)
    const remainingLines: string[] = [];
    for (let j = i + 5; j < nextStart; j++) {
      const line = lines[j];
      // 페이지 구분 텍스트 스킵
      if (line && !line.startsWith("거래내역조회") && !line.startsWith("계좌번호:") && !line.startsWith("예금주명:") && !line.startsWith("현재잔액:") && !line.startsWith("조회시작일자:") && !line.startsWith("합계")) {
        remainingLines.push(line);
      }
    }

    // 거래내용 조합: 잔액 줄에 붙어있거나 다음 줄에 있음
    let content = contentPart;
    if (!content && remainingLines.length > 0) {
      content = remainingLines.shift() || "";
    }

    // 거래구분이 다음 줄에 있으면 추가 (예: "타행이체", "이자", "펌뱅킹" 등)
    // 단, 숫자나 계좌번호 형식이 아닌 경우에만
    if (remainingLines.length > 0) {
      const nextLine = remainingLines[0];
      // 계좌번호 패턴이 아니고, 숫자만 있는게 아니면 거래내용의 일부
      if (nextLine && !nextLine.match(/^\d{10,}$/) && !nextLine.match(/^[\d,]+$/) && nextLine.length < 20 && !nextLine.match(/^0$/)) {
        const addContent = remainingLines.shift() || "";
        if (addContent && addContent !== "0") {
          content = content ? `${content} ${addContent}` : addContent;
        }
      }
    }

    // 상대은행/상대정보 추출
    let counterBank = "";
    let memo = "";
    let counterpartyName = "";

    // 남은 필드들: 상대계좌번호(?), 상대은행, 메모, 거래구분, 수표어음금액(0), 상대예금주명
    // 패턴: 은행 이름이나 거래구분 키워드 찾기
    for (let r = 0; r < remainingLines.length; r++) {
      const val = remainingLines[r];
      if (!val) continue;

      // 은행 이름 패턴
      if (val.match(/(은행|뱅크|CC|펌뱅킹|타행이체|인터넷|API이체)$/)) {
        if (!counterBank) {
          counterBank = val;
        } else {
          memo = val;
        }
      }
      // 수표어음금액(0) 스킵
      else if (val === "0") {
        continue;
      }
      // 상대예금주명 (한글 2~10자)
      else if (val.match(/^[가-힣]{2,10}$/) && !counterpartyName) {
        counterpartyName = val;
      }
    }

    transactions.push({
      "순번": no,
      "거래일시": datetime,
      "출금": parseAmount(withdrawal),
      "입금": parseAmount(deposit),
      "거래후잔액": parseAmount(balance),
      "거래내용": content.trim(),
      "상대은행": counterBank,
      "메모": memo,
      "상대예금주명": counterpartyName,
    });
  }

  return transactions;
}

// 신한은행 전용 파싱
export function parseShinhanBank(text: string): TransactionRow[] {
  const lines = text.split("\n").map(l => l.trim());
  const transactions: TransactionRow[] = [];

  // 날짜 패턴: 2024-02-08
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  // 시간 패턴: 10:15:51
  const timeRegex = /^\d{2}:\d{2}:\d{2}$/;

  // 거래 시작점 찾기 (날짜 + 시간)
  const startIndices: number[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (dateRegex.test(lines[i]) && timeRegex.test(lines[i + 1])) {
      startIndices.push(i);
    }
  }

  // 입금 관련 적요
  const depositKeywords = ["연입금", "이자수", "이자", "예금이자", "입금"];
  // 출금 관련 적요
  const withdrawalKeywords = ["모바일", "타행MB", "타행PC", "타행이체", "출금", "체크", "통신요금", "대출이자"];

  for (let idx = 0; idx < startIndices.length; idx++) {
    const i = startIndices[idx];
    const nextStart = idx + 1 < startIndices.length ? startIndices[idx + 1] : lines.length;

    const date = lines[i];
    const time = lines[i + 1];
    const datetime = `${date} ${time}`;

    // 적요 (거래 유형)
    const txType = lines[i + 2] || "";

    // 다음 줄: 금액 또는 금액+추가정보
    const amountLine = lines[i + 3] || "0";
    // 금액에 추가 정보가 붙어있을 수 있음 (예: "57,877 311162184023")
    const amountMatch = amountLine.match(/^([\d,]+)(\s+.*)?$/);
    let amount = "0";
    let extraInfo = "";
    if (amountMatch) {
      amount = amountMatch[1];
      extraInfo = (amountMatch[2] || "").trim();
    } else {
      amount = amountLine;
    }

    // 입금/출금 결정
    let withdrawal = 0;
    let deposit = 0;
    const amountNum = parseAmount(amount);

    const isDeposit = depositKeywords.some(kw => txType.includes(kw));
    const isWithdrawal = withdrawalKeywords.some(kw => txType.includes(kw));

    if (isDeposit && !isWithdrawal) {
      deposit = amountNum;
    } else if (isWithdrawal && !isDeposit) {
      withdrawal = amountNum;
    } else {
      // 기본값: 출금으로 처리 (대부분의 거래가 출금)
      withdrawal = amountNum;
    }

    // 나머지 필드들 추출
    const remainingLines: string[] = [];
    for (let j = i + 4; j < nextStart; j++) {
      if (lines[j]) remainingLines.push(lines[j]);
    }

    // 내용 (상대방 이름 등)
    let content = remainingLines.shift() || "";

    // 잔액 찾기 (숫자 패턴)
    let balance = "0";
    let branch = "";
    for (let r = 0; r < remainingLines.length; r++) {
      const val = remainingLines[r];
      // 금액 패턴 (쉼표 포함 숫자)
      if (/^[\d,]+$/.test(val) && val.length > 2) {
        balance = val;
      }
      // 거래점 (한글+영문+숫자 조합)
      else if (val.match(/^[가-힣a-zA-Z0-9]+$/) && val.length >= 2 && val.length <= 20) {
        branch = val;
      }
    }

    // 은행명 추출 (괄호 안의 은행명)
    let counterBank = "";
    for (let r = 0; r < remainingLines.length; r++) {
      const val = remainingLines[r];
      if (val.match(/^\([가-힣]+\)$/) || val.match(/^\(토스\)$/) || val.match(/^\(카카\)$/)) {
        counterBank = val.replace(/[()]/g, "");
      }
    }

    transactions.push({
      "거래일시": datetime,
      "적요": txType,
      "출금": withdrawal,
      "입금": deposit,
      "내용": content,
      "잔액": parseAmount(balance),
      "거래점": branch,
      "상대은행": counterBank,
    });
  }

  return transactions;
}

// 국민은행 전용 파싱
export function parseKookminBank(text: string): TransactionRow[] {
  const lines = text.split("\n").map(l => l.trim());
  const transactions: TransactionRow[] = [];

  // 날짜 시작 패턴: 2024-03-
  const dateStartRegex = /^(\d{4})-(\d{2})-$/;

  // 거래 시작점 찾기
  const startIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (dateStartRegex.test(lines[i])) {
      startIndices.push(i);
    }
  }

  for (let idx = 0; idx < startIndices.length; idx++) {
    const i = startIndices[idx];
    const nextStart = idx + 1 < startIndices.length ? startIndices[idx + 1] : lines.length;

    // 날짜 조합: "2024-03-" + "" + "14" → "2024-03-14"
    const dateStart = lines[i];
    let day = "";
    let time = "";
    let offset = 1;

    // 빈 줄 스킵하면서 일자 찾기
    while (i + offset < nextStart && !day) {
      const val = lines[i + offset];
      if (val && /^\d{1,2}$/.test(val)) {
        day = val.padStart(2, "0");
      }
      offset++;
    }

    // 빈 줄 스킵하면서 시간 찾기
    while (i + offset < nextStart && !time) {
      const val = lines[i + offset];
      if (val && /^\d{2}:\d{2}:\d{2}$/.test(val)) {
        time = val;
      }
      offset++;
    }

    if (!day || !time) continue;

    const datetime = `${dateStart}${day} ${time}`;

    // 나머지 필드들 수집 (빈 줄 제외)
    const remainingLines: string[] = [];
    for (let j = i + offset; j < nextStart; j++) {
      const val = lines[j];
      if (val && val.trim() && val !== " ") {
        remainingLines.push(val);
      }
    }

    // 적요 조합 (여러 줄에 걸쳐 있을 수 있음: "체크카" + "드")
    let txType = "";
    while (remainingLines.length > 0) {
      const val = remainingLines[0];
      // 금액 패턴이면 중단
      if (/^[\d,]+$/.test(val) && val.length > 2) break;
      // 이름 패턴이면 중단 (한글 2~10자)
      if (/^[가-힣]{2,10}$/.test(val) && remainingLines.length > 2) {
        // 다음이 금액인지 확인
        if (/^[\d,]+$/.test(remainingLines[1])) break;
      }
      txType += remainingLines.shift() || "";
    }

    // 상대방 이름 (여러 줄 조합 가능: "씨유동" + "대문쇼" + "핑타운")
    let counterparty = "";
    while (remainingLines.length > 0) {
      const val = remainingLines[0];
      // 금액 패턴이면 중단
      if (/^[\d,]+$/.test(val)) break;
      counterparty += remainingLines.shift() || "";
    }

    // 출금액
    const withdrawalStr = remainingLines.shift() || "0";
    // 입금액
    const depositStr = remainingLines.shift() || "0";
    // 잔액
    const balanceStr = remainingLines.shift() || "0";
    // 거래점
    let branch = "";
    while (remainingLines.length > 0) {
      const val = remainingLines.shift() || "";
      if (val && val !== " ") {
        branch += val;
      }
    }

    transactions.push({
      "거래일시": datetime,
      "적요": txType,
      "상대방": counterparty,
      "출금액": parseAmount(withdrawalStr),
      "입금액": parseAmount(depositStr),
      "잔액": parseAmount(balanceStr),
      "거래점": branch,
    });
  }

  return transactions;
}

// 광주은행 전용 파싱
export function parseGwangjuBank(text: string): TransactionRow[] {
  const lines = text.split("\n").map(l => l.trim());
  const transactions: TransactionRow[] = [];

  // 날짜+시간+적요 패턴: 2024-02-01 12:22:21 원리금575701
  const dateTimeRegex = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(.+)$/;

  // 거래 시작점 찾기
  const startIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (dateTimeRegex.test(lines[i])) {
      startIndices.push(i);
    }
  }

  for (let idx = 0; idx < startIndices.length; idx++) {
    const i = startIndices[idx];
    const nextStart = idx + 1 < startIndices.length ? startIndices[idx + 1] : lines.length;

    const match = lines[i].match(dateTimeRegex);
    if (!match) continue;

    const datetime = `${match[1]} ${match[2]}`;
    const summary = match[3] || "";  // 적요 (원리금575701, 김우현 등)

    // 입/출금 구분
    const txType = lines[i + 1] || "";

    // 출금액
    const withdrawalStr = lines[i + 2] || "0";
    // 입금액
    const depositStr = lines[i + 3] || "0";
    // 통장잔액
    const balance = lines[i + 4] || "0";
    // 처리결과
    const result = lines[i + 5] || "";

    // 나머지 필드 (거래구분, 취급점) - 선택적
    let txCategory = "";
    let branch = "";

    // 다음 거래 전까지 남은 줄 수집
    for (let j = i + 6; j < nextStart; j++) {
      const val = lines[j];
      if (!val || val === "") continue;

      // 거래구분 패턴 (전자망, 오픈뱅킹출금 등)
      if (!txCategory && val.match(/^[가-힣a-zA-Z0-9]+$/)) {
        txCategory = val;
      } else if (!branch && val.match(/^[가-힣a-zA-Z0-9]+$/)) {
        branch = val;
      }
    }

    transactions.push({
      "거래일시": datetime,
      "적요": summary,
      "입/출금": txType,
      "출금": parseAmount(withdrawalStr),
      "입금": parseAmount(depositStr),
      "통장잔액": parseAmount(balance),
      "처리결과": result,
      "거래구분": txCategory,
      "취급점": branch,
    });
  }

  return transactions;
}

// 규칙 기반 파싱 메인 함수
export interface RuleBasedParseResult {
  success: boolean;
  transactions: TransactionRow[];
  columns: string[];
  bankRule: BankParsingRule | null;
  error?: string;
}

export function parseWithBankRule(text: string, bankId?: string): RuleBasedParseResult {
  // 1. 은행 규칙 찾기
  let rule: BankParsingRule | undefined;

  if (bankId) {
    rule = getBankRuleById(bankId);
  }

  if (!rule) {
    rule = detectBankFromText(text);
  }

  if (!rule) {
    return {
      success: false,
      transactions: [],
      columns: [],
      bankRule: null,
      error: "은행을 자동 감지할 수 없습니다.",
    };
  }

  // 2. 검증된 규칙만 사용
  const status = getRuleValidationStatus(rule);
  if (status === "unverified") {
    return {
      success: false,
      transactions: [],
      columns: [],
      bankRule: rule,
      error: `${rule.bankName} 규칙이 아직 검증되지 않았습니다.`,
    };
  }

  // 3. 은행별 파싱 실행
  let transactions: TransactionRow[] = [];

  switch (rule.bankId) {
    case "woori":
      transactions = parseWooriBank(text);
      break;
    case "nonghyup":
      transactions = parseNonghyupBank(text);
      break;
    case "kakaobank":
      transactions = parseKakaoBank(text);
      break;
    case "kbank":
      transactions = parseKBank(text);
      break;
    case "tossbank":
      transactions = parseTossBank(text);
      break;
    case "hana":
      transactions = parseHanaBank(text);
      break;
    case "ibk":
      transactions = parseIBKBank(text);
      break;
    case "shinhan":
      transactions = parseShinhanBank(text);
      break;
    case "kookmin":
      transactions = parseKookminBank(text);
      break;
    case "gwangju":
      transactions = parseGwangjuBank(text);
      break;
    default:
      return {
        success: false,
        transactions: [],
        columns: [],
        bankRule: rule,
        error: `${rule.bankName} 파싱 함수가 아직 구현되지 않았습니다.`,
      };
  }

  if (transactions.length === 0) {
    return {
      success: false,
      transactions: [],
      columns: [],
      bankRule: rule,
      error: "거래내역을 파싱할 수 없습니다.",
    };
  }

  // 4. 컬럼 추출
  const columns = rule.header.columns.map(c => c.name);

  return {
    success: true,
    transactions,
    columns,
    bankRule: rule,
  };
}
