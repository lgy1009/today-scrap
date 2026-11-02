// 워드 문서: 선택한 기사를 "표지·한눈에 보기 + 기사 전문"으로 담은 Word 파일(.doc)을 만든다.
// 새 라이브러리 없이, 워드가 그대로 열어 편집할 수 있는 형식(HTML 기반 문서)으로 브라우저 안에서 만든다.
// 사진 첨부, 원문 수정, PDF 변환은 워드에서 한다.

export type WordItem = {
  number: number;
  keyword: string;
  title: string;
  source: string;
  publishedAt: string; // UTC ISO
  link: string;
  mentionCount: number;
  body: string | null;
  summary: string;
};

const NAVY = "#083891";
const NAVY_DARK = "#052561";

const KEYWORD_COLOR: Record<string, string> = {
  노동: "#3b82f6",
  교육: "#10b981",
  청년: "#8b5cf6",
  인구: "#f59e0b",
  연금: "#f43f5e",
  AI: "#06b6d4",
  양극화: "#64748b",
  기타: "#475569",
};
const KEYWORD_ORDER = ["노동", "교육", "청년", "인구", "연금", "AI", "양극화", "기타"];

// 표지 문구 (보고서 화면과 워드 파일이 같이 쓴다)
export const COVER_TITLE = "경제구조개혁국 관련기사";
export const COVER_EDITORS = ["이가영", "정지우"];
export const COVER_FONT = '"함초롬바탕", "HCR Batang", "바탕", Batang, serif';

// 표지 작성일: "2026년 11월 2일 월" → "2026년 11월 2일 월요일"
export function coverDate(dateLabel: string): string {
  const m = dateLabel.match(/^(.*?\d+일)\s*\(?([월화수목금토일])\)?/);
  return m ? `${m[1]} ${m[2]}요일` : dateLabel;
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function kst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// 목차가 한 쪽에 들어가도록 기사 수가 많으면 요약을 줄이거나 뺀다 (워드는 줄 수를 자를 수 없어 글자 수로 줄인다)
function tocSummary(summary: string, count: number): string {
  if (!summary || count > 14) return "";
  const limit = count > 8 ? 42 : 90;
  return summary.length > limit ? `${summary.slice(0, limit)}…` : summary;
}

export function buildWordHtml(items: readonly WordItem[], dateLabel: string, withCover = true): string {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.keyword, (counts.get(it.keyword) ?? 0) + 1);
  const countLine = KEYWORD_ORDER.filter((k) => counts.has(k))
    .map((k) => `<span style="color:${KEYWORD_COLOR[k] ?? "#475569"}">●</span> <b>${esc(k)}</b> ${counts.get(k)}`)
    .join("&nbsp;&nbsp;&nbsp;");

  const coverText = `margin:0;color:#000;font-family:${COVER_FONT.replaceAll('"', "'")};`;

  const rows = items
    .map((it) => {
      const color = KEYWORD_COLOR[it.keyword] ?? "#475569";
      const summary = tocSummary(it.summary, items.length);
      const dense = items.length > 14;
      const pad = dense ? "1.5pt 4pt" : "3pt 4pt";
      return `<tr>
<td style="width:1.1cm;border:1px solid #dfe3e8;padding:${pad};text-align:center"><b style="color:${NAVY};font-size:10.5pt">${String(it.number).padStart(2, "0")}</b></td>
<td style="width:1.5cm;border:1px solid #dfe3e8;padding:${pad};text-align:center;font-size:9pt"><b style="color:${color}">${esc(it.keyword)}</b></td>
<td style="border:1px solid #dfe3e8;padding:${pad}">
<p style="margin:0;font-size:${dense ? 9 : 10}pt"><b>${esc(it.title)}</b></p>
${summary ? `<p style="margin:1pt 0 0 0;color:#58616a;font-size:8.5pt">${esc(summary)}</p>` : ""}
</td>
<td style="width:2.4cm;border:1px solid #dfe3e8;padding:${pad};text-align:center;color:#6d7882;font-size:8.5pt">${esc(it.source)}</td>
</tr>`;
    })
    .join("\n");

  const articles = items
    .map((it) => {
      const color = KEYWORD_COLOR[it.keyword] ?? "#475569";
      const paragraphs = (it.body ?? "")
        .split(/\n+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `<p style="margin:0 0 8pt 0;line-height:170%">${esc(p)}</p>`)
        .join("\n");
      return `<h2 style="page-break-before:always;margin:0 0 6pt 0;border-bottom:2.25pt solid ${color};padding-bottom:4pt"><span style="color:${NAVY};font-size:18pt">${String(
        it.number,
      ).padStart(2, "0")}</span>&nbsp;&nbsp;<span style="color:${color};font-size:11pt">[${esc(it.keyword)}]</span></h2>
<p style="margin:8pt 0 4pt 0;font-size:16pt;line-height:140%"><b>${esc(it.title)}</b></p>
<p style="margin:0 0 2pt 0;color:#58616a;font-size:10pt"><b>${esc(it.source)}</b> · 입력 ${esc(kst(it.publishedAt))}${
        it.mentionCount > 1 ? ` · ${it.mentionCount}곳 보도` : ""
      }</p>
<p style="margin:0 0 10pt 0;color:#6d7882;font-size:8.5pt">${it.link ? `원문: ${esc(it.link)}` : "&nbsp;"}</p>
${paragraphs || `<p style="color:#58616a">본문을 가져오지 못했습니다. 위 원문 링크를 참고해 주세요.</p>`}`;
    })
    .join("\n");

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>오늘의 스크랩</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
@page WordSection1 { size: 21.0cm 29.7cm; margin: 1.8cm 2.0cm 1.8cm 2.0cm; }
div.WordSection1 { page: WordSection1; }
body { font-family: "맑은 고딕", "Malgun Gothic", sans-serif; font-size: 10.5pt; color: #1e2124; }
p { font-family: "맑은 고딕", "Malgun Gothic", sans-serif; }
table { border-collapse: collapse; width: 100%; }
</style>
</head>
<body>
<div class="WordSection1">
${
  withCover
    ? `<table style="width:100%;border-collapse:collapse"><tr>
<td style="width:100%;padding:0">&nbsp;</td>
<td nowrap style="vertical-align:top;padding:4pt 3pt 4pt 8pt;border:1pt solid #000;border-right:none;white-space:nowrap"><p style="${coverText}font-size:12pt"><b>편집 :</b></p></td>
<td nowrap style="vertical-align:top;padding:4pt 8pt 4pt 3pt;border:1pt solid #000;border-left:none;white-space:nowrap">${COVER_EDITORS.map((name) => `<p style="${coverText}font-size:12pt"><b>${esc(name)}</b></p>`).join("")}</td>
</tr></table>
<p style="margin:270pt 0 0 0;font-size:1pt">&nbsp;</p>
<table align="center" style="width:auto;border-collapse:collapse"><tr>
<td nowrap style="padding:19pt 34pt;border:1pt solid #000;border-right:4.5pt solid #888;border-bottom:4.5pt solid #888;white-space:nowrap"><p style="${coverText}text-align:center;font-size:30pt"><b>${esc(COVER_TITLE)}</b></p></td>
</tr></table>
<p style="${coverText}margin-top:96pt;text-align:center;font-size:21pt"><b>${esc(coverDate(dateLabel))}</b></p>
<p style="page-break-before:always;margin:0;font-size:18pt;color:${NAVY_DARK}"><b>목차</b></p>`
    : `<p style="margin:0;font-size:18pt;color:${NAVY_DARK}"><b>오늘의 스크랩</b></p>`
}
<p style="margin:2pt 0 0 0;font-size:10pt;color:#58616a"><b>${esc(dateLabel)}</b> · 기사 ${items.length}건</p>
<p style="margin:4pt 0 6pt 0;border-top:3pt solid ${NAVY};padding-top:4pt;font-size:9.5pt">${countLine}</p>
<table>
${rows}
</table>
${articles}
</div>
</body>
</html>`;
}
