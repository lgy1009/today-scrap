// Design Ref: §3 주고받는 데이터 — 기사 한 건의 데이터 형태
// Plan 작업 1: 기사 데이터 형태 정의

import type { Keyword, OTHER_KEYWORD } from "./config";

// 같은 이슈를 다룬 보도사 한 곳의 첫 기사 (보도 흐름을 시간순으로 보여 줄 때 사용)
export type FlowEntry = {
  source: string;
  title: string;
  link: string;
  publishedAt: string; // UTC ISO 형식
};

// 기사 한 건. RSS에서 찾은 정보와, 나중에 가져오는 본문을 함께 담는다.
export type Article = {
  id: string; // 기사 고유 번호 (링크를 바탕으로 만든다. 선택·순서 바꾸기에 사용)
  keyword: Keyword | typeof OTHER_KEYWORD; // 이 기사가 속한 키워드 (레이더 기사는 "기타")
  flow?: FlowEntry[]; // 같은 이슈의 보도 흐름 (보도 시각 순, 레이더 기사에만 있음)
  radarKind?: "economy" | "big"; // 레이더 기사의 종류: 경제·정책 이슈 / 정치·사건 등 큰 이슈
  mentionCount: number; // 언급량: 같은 이슈를 다룬 기사 수 (중복 제거 때 묶인 수)
  title: string; // 기사 제목
  link: string; // 기사 원문 주소
  source: string; // 보도사 이름
  publishedAt: string; // 입력시간 (UTC ISO 형식 문자열, 화면에 보일 때 한국시간으로 바꾼다)
  summary?: string; // RSS 요약 (없는 언론사도 있음)
  score?: ScoreParts; // 이 키워드 기준의 총점과 항목별 점수
  alsoReportedBy?: { source: string; link: string }[]; // 같은 내용을 다룬 다른 보도사
  body?: string; // 본문 텍스트 (본문을 가져오기 전에는 없음)
  bodyFailed?: boolean; // 본문을 가져오지 못했으면 true
};

// RSS에서 읽어 온 기사 한 건 (아직 키워드·점수가 붙기 전의 원본)
export type FeedItem = {
  title: string; // 제목
  link: string; // 기사 원문 주소 (추적용 문구 제거됨)
  source: string; // 보도사 이름
  section: string; // 어느 RSS 섹션에서 왔는지
  publishedAt: string; // 입력시간 (UTC ISO 형식. 화면에 보일 때 한국시간으로 바꾼다)
  summary?: string; // RSS에 요약이 있으면 글자만 (없는 언론사도 있음)
};

// 총점을 이루는 항목별 점수 (총점 100점 만점, 사설·칼럼은 감점)
export type ScoreParts = {
  work: number; // 업무 관련성
  keyword: number; // 키워드 적합도
  mention: number; // 언급량
  policy: number; // 정책 낱말
  penalty: number; // 감점 (사설·칼럼)
  total: number; // 총점 (0~100)
};

// 같은 내용의 기사를 하나로 묶은 결과 (중복 제거 후)
export type ClusteredItem = FeedItem & {
  mentionCount: number; // 언급량: 같은 이슈를 다룬 서로 다른 보도사 수 (자기 자신 포함)
  alsoReportedBy: { source: string; link: string }[]; // 같은 내용을 다룬 다른 보도사
  issueFlow?: FlowEntry[]; // 같은 이슈를 다룬 보도사별 첫 기사 (시간순)
};

// 검색 요청: 사용자가 입력한 시작·끝 시간 (한 번에 키워드 7개 결과를 받는다)
export type SearchRequest = {
  start: string; // 시작 시간 (ISO 형식, 한국시간)
  end: string; // 끝 시간 (ISO 형식, 한국시간)
};

// 키워드 한 개의 검색 결과
export type KeywordResult = {
  keyword: Keyword;
  articles: Article[]; // 추천 기사 (4~5건)
  short?: boolean; // 후보가 4건에 못 미쳐 있는 만큼만 보여 주는 경우 true
};

// API 오류 응답 형식
export type ApiError = {
  error: { code: string; message: string };
};

// 검색 응답: 키워드별 추천 기사
export type SearchResponse = {
  results: KeywordResult[];
  radar: Article[]; // 놓친 이슈 레이더: 키워드 밖에서 크게 보도된 이슈
  collectedCount: number; // 시간 범위 안에서 모은 기사 수
  failedFeedCount: number; // 읽지 못한 RSS 수 (안내용)
};

// 시험 기능: 본문에서 뽑은 부가 정보 (발언·용어). 규칙 기반 추출이라 참고용이다.
export type ArticleExtras = {
  quotes: { speaker: string | null; text: string }[]; // 발언
  terms: { term: string; explanation: string }[]; // 용어 풀이
};
