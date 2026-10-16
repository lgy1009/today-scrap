// Design Ref: §3 데이터 흐름 [7 파일] — 선택한 기사를 순서대로 한 개의 텍스트로 이어 붙인다.
// PRD 5번 must 2 (텍스트 형식으로 확정, 사용자 결정 2026-10-15)

export type ScrapEntry = {
  keyword: string;
  title: string;
  source: string; // 보도사
  publishedAt: string; // UTC ISO 형식
  link: string;
  body: string | null; // 본문을 가져오지 못했으면 null
  summary?: string; // 한눈에 보기에 쓰는 요약 (없으면 요약 줄을 생략)
};

const BODY_MISSING = "(본문을 가져오지 못했습니다. 위 원문 링크를 참고해 주세요.)";
const DIVIDER = "=".repeat(60);

// UTC ISO 시간을 한국시간 "2026-10-15 09:30" 형태로 바꾼다
export function formatKst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return parts; // 예: 2026-10-15 09:30
}

// 파일 이름용 한국 날짜 "20261015"
export function kstDateStamp(now: Date = new Date()): string {
  return formatKst(now.toISOString()).slice(0, 10).replace(/-/g, "");
}

// 한글 프로그램에서 바로 열리도록 맨 앞에 BOM(﻿)을 붙이고 줄바꿈은 Windows 방식(\r\n)으로 쓴다
export function buildScrapText(entries: readonly ScrapEntry[], now: Date = new Date()): string {
  // 맨 앞에 "한눈에 보기": 번호·키워드·제목·보도사와 한 줄 요약 (번호는 아래 기사 번호와 같다)
  const overview = entries.flatMap((e, index) => {
    const lines = [`${index + 1}. [${e.keyword}] ${e.title} (${e.source})`];
    if (e.summary) lines.push(`   - ${e.summary}`);
    return lines;
  });
  const header = [
    `오늘의 스크랩 (${formatKst(now.toISOString()).slice(0, 10)})`,
    `기사 ${entries.length}건`,
    "",
    "■ 한눈에 보기",
    ...overview,
    "",
  ];

  const blocks = entries.map((e, index) => {
    const lines = [
      DIVIDER,
      `${index + 1}. [${e.keyword}] ${e.title}`,
      `보도사: ${e.source}`,
      `입력시간: ${formatKst(e.publishedAt)}`,
      `원문: ${e.link}`,
      "",
      e.body && e.body.trim() ? e.body.trim() : BODY_MISSING,
      "",
    ];
    return lines.join("\n");
  });

  const text = [...header, ...blocks, DIVIDER, ""].join("\n");
  return "﻿" + text.replace(/\r?\n/g, "\r\n");
}
