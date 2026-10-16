// 시험 기능: 정책 용어 풀이 (쉬운 설명)
// 주의: 아래 설명은 초안입니다. 기관에서 쓰는 정확한 정의와 다를 수 있으므로 사용자가 검수해 고쳐 쓴다.

export type GlossaryEntry = {
  term: string; // 대표 용어
  aliases?: readonly string[]; // 같은 뜻으로 쓰이는 다른 표기
  explanation: string; // 쉬운 설명
};

export const GLOSSARY: readonly GlossaryEntry[] = [
  // 연금
  { term: "모수개혁", explanation: "보험료율·소득대체율·수급 시작 나이처럼 연금의 '숫자'를 조정하는 개혁" },
  { term: "구조개혁", explanation: "연금 제도의 틀 자체(예: 연금 간 통합, 자동조정장치 도입)를 바꾸는 개혁" },
  { term: "소득대체율", explanation: "은퇴 전 평균 소득 대비 연금으로 받는 금액의 비율" },
  { term: "보험료율", explanation: "월 소득 중에서 연금보험료로 내는 비율" },
  { term: "리밸런싱", explanation: "투자 자산의 비중이 목표와 달라졌을 때 다시 목표대로 맞추는 조정" },
  { term: "기금운용", aliases: ["기금 운용"], explanation: "쌓아 둔 연금 적립금을 주식·채권 등에 투자해 불리는 일" },
  { term: "기금고갈", aliases: ["기금 고갈"], explanation: "연금 적립금이 바닥나서 그해 걷은 보험료로만 지급해야 하는 상태" },
  { term: "자동조정장치", explanation: "인구·경제 상황이 바뀌면 연금액이나 보험료를 자동으로 조정하는 장치" },
  { term: "퇴직연금", explanation: "회사가 근로자의 퇴직금을 금융기관에 맡겨 운용하는 제도" },
  { term: "기초연금", explanation: "소득이 낮은 노인에게 세금으로 지급하는 연금" },
  { term: "주택연금", explanation: "집을 담보로 맡기고 평생 매달 연금처럼 돈을 받는 제도" },
  { term: "중복수급", explanation: "둘 이상의 연금을 동시에 받는 것 (일부 연금은 이 경우 지급액이 줄어듦)" },
  // 노동
  { term: "최저임금", explanation: "법으로 정해 둔 시간당 최소 임금 (이보다 적게 줄 수 없음)" },
  { term: "중대재해처벌법", aliases: ["중대재해"], explanation: "산업재해로 사망 등 중대한 사고가 나면 경영책임자를 처벌하도록 한 법" },
  { term: "노란봉투법", aliases: ["개정노조법"], explanation: "하청 노동자가 원청과 교섭할 수 있게 하고, 파업 손해배상을 제한하는 노조법 개정" },
  { term: "주4.5일제", aliases: ["주 4.5일"], explanation: "일주일 근무일을 4일 반으로 줄이는 근로시간 단축 방안" },
  { term: "경사노위", aliases: ["경제사회노동위원회"], explanation: "정부·노동계·경영계가 모여 노동·경제 현안을 논의하는 대화 기구" },
  { term: "포괄임금제", explanation: "연장·야간 수당을 미리 월급에 포함시켜 주는 계약 방식" },
  { term: "비정규직", explanation: "계약 기간이 정해져 있거나 파견·시간제 등으로 일하는 근로자" },
  { term: "노동전환", explanation: "산업 구조가 바뀔 때 근로자가 새로운 일자리·직무로 옮겨 가도록 돕는 것" },
  { term: "플랫폼노동", aliases: ["플랫폼 노동"], explanation: "배달·운전 앱 등 플랫폼을 통해 일감을 받아 일하는 방식" },
  // 인구
  { term: "합계출산율", explanation: "여성 1명이 평생 낳을 것으로 예상되는 평균 자녀 수" },
  { term: "초고령사회", explanation: "65세 이상 인구가 전체의 20%를 넘는 사회" },
  { term: "생산연령인구", explanation: "경제활동의 중심이 되는 15~64세 인구" },
  { term: "인구절벽", explanation: "생산·소비의 중심인 인구가 급격히 줄어드는 현상" },
  { term: "저출생", aliases: ["저출산"], explanation: "태어나는 아이 수가 줄어드는 현상" },
  // 청년
  { term: "청년도약계좌", explanation: "청년의 목돈 마련을 돕기 위해 정부가 지원금을 얹어 주는 장기 적금" },
  { term: "자립준비청년", explanation: "보호시설 등에서 지내다 만 18세 이후 홀로서기를 준비하는 청년" },
  { term: "니트", aliases: ["NEET"], explanation: "일도 공부도 하지 않고 구직 활동도 하지 않는 청년층" },
  // 양극화·재정
  { term: "양극화", explanation: "소득·자산·일자리 등의 격차가 벌어져 두 극단으로 갈리는 현상" },
  { term: "지니계수", explanation: "소득 불평등 정도를 0~1로 나타낸 값 (1에 가까울수록 불평등)" },
  { term: "상대적빈곤율", explanation: "중위소득의 절반 미만으로 사는 사람의 비율" },
  { term: "소득분배", explanation: "경제 성과가 사람들 사이에 어떻게 나뉘는지를 나타내는 것" },
  { term: "관리재정수지", explanation: "사회보장성 기금을 빼고 계산한, 정부의 실질적인 수입과 지출의 차이" },
  { term: "세수", explanation: "정부가 세금으로 거둬들이는 돈" },
  { term: "서킷브레이커", explanation: "주가가 급락할 때 시장 거래를 잠시 멈추는 안전장치" },
  { term: "국정감사", aliases: ["국감"], explanation: "국회가 매년 정부 기관의 일을 점검하고 잘못을 따지는 절차" },
];
