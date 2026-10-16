// 한눈에 보기 이미지: 선택한 모든 기사를 A4 1~2장에 요약 카드로 모아 그린다.
// 브라우저 안에서만 그리며(서버로 보내지 않음) 한글 문서 맨 앞에 이미지로 붙여 넣는 용도다.
// 카드의 번호는 스크랩 텍스트 파일의 기사 번호와 같다.

export type CardItem = {
  keyword: string;
  title: string;
  source: string;
  publishedAt: string; // UTC ISO
  summary: string; // 비어 있을 수 있다
  mentionCount: number; // 같은 이슈를 다룬 보도사 수 (1이면 표시하지 않는다)
};

const FONT = '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';

// 색 (재정경제부 누리집의 색 체계를 바탕으로 한 남색 계열)
const NAVY = "#083891";
const NAVY_DARK = "#052561";
const INK = "#1e2124";
const GRAY_TEXT = "#58616a";
const GRAY_LIGHT = "#8a949e";
const LINE = "#dfe3e8";
const PAGE_BG = "#f4f5f6";

// A4 세로 비율 (150dpi 기준 1240×1754)
const W = 1240;
const H = 1754;
const MARGIN = 56;
const TOP_H = 138; // 흰 머리 영역
const STRIP_H = 72; // 키워드별 건수 줄
const HEADER_H = TOP_H + 6 + STRIP_H;
const FOOTER_H = 48;
const COL_GAP = 20; // 두 열 사이 간격
const CARD_W = (W - MARGIN * 2 - COL_GAP) / 2; // 2열

// 카드 크기 단계. 기사가 적으면 크고 여유 있게, 많으면 글자·여백을 줄여 한 장에 넣는다.
type Level = {
  title: number; // 제목 최대 줄 수
  summary: number; // 요약 최대 줄 수
  titleSize: number;
  titleLead: number;
  sumSize: number;
  sumLead: number;
  pad: number; // 카드 안쪽 여백
  headH: number; // 번호·키워드 줄 높이
  footH: number; // 보도사·시각 줄 높이
  rowGap: number; // 카드 행 사이 간격
};
const BIG = { titleSize: 25, titleLead: 34, sumSize: 20, sumLead: 29, pad: 24, headH: 40, footH: 36, rowGap: 20 };
const COMPACT = { titleSize: 22, titleLead: 30, sumSize: 18, sumLead: 26, pad: 16, headH: 34, footH: 30, rowGap: 14 };
const TINY = { titleSize: 20, titleLead: 27, sumSize: 17, sumLead: 24, pad: 14, headH: 32, footH: 28, rowGap: 12 };

// 위에서부터 차례로 시도해 목표 장수 안에 들어가는 첫 단계를 쓴다
const LEVELS: readonly Level[] = [
  { title: 3, summary: 3, ...BIG },
  { title: 2, summary: 3, ...BIG },
  { title: 2, summary: 2, ...BIG },
  { title: 2, summary: 2, ...COMPACT },
  { title: 2, summary: 1, ...COMPACT },
  { title: 2, summary: 0, ...COMPACT },
  { title: 2, summary: 0, ...TINY },
];

// 기사가 이 수 이하이면 한 장에, 더 많으면 두 장 안에 넣으려고 한다
const ONE_PAGE_MAX_ITEMS = 14;

export const KEYWORD_COLOR: Record<string, string> = {
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

// 글자 폭을 재면서 줄을 나눈다. 가능하면 띄어쓰기에서 끊고, maxLines를 넘으면 …으로 줄인다.
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  if (maxLines <= 0 || !text) return [];
  const lines: string[] = [];
  let current = "";
  let lastSpace = -1;
  for (const ch of text) {
    const next = current + ch;
    if (ctx.measureText(next).width > maxWidth && current) {
      if (lastSpace > 0 && ch !== " ") {
        lines.push(current.slice(0, lastSpace).trimEnd());
        current = current.slice(lastSpace + 1) + ch;
      } else {
        lines.push(current);
        current = ch === " " ? "" : ch;
      }
      lastSpace = -1;
      continue;
    }
    if (ch === " ") lastSpace = next.length - 1;
    current = next;
  }
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;
  const cut = lines.slice(0, maxLines);
  let last = cut[maxLines - 1];
  while (last.length > 1 && ctx.measureText(last + "…").width > maxWidth) last = last.slice(0, -1);
  cut[maxLines - 1] = last.trimEnd() + "…";
  return cut;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type Layout = {
  number: number; // 스크랩 파일의 기사 번호
  item: CardItem;
  titleLines: string[];
  summaryLines: string[];
  height: number;
  level: Level;
};

function layoutCard(
  ctx: CanvasRenderingContext2D,
  item: CardItem,
  number: number,
  level: Level,
): Layout {
  const innerW = CARD_W - level.pad * 2;
  ctx.font = `bold ${level.titleSize}px ${FONT}`;
  const titleLines = wrap(ctx, item.title, innerW, level.title);
  ctx.font = `${level.sumSize}px ${FONT}`;
  const summaryLines = wrap(ctx, item.summary, innerW, level.summary);
  const height =
    level.pad +
    level.headH +
    titleLines.length * level.titleLead +
    (summaryLines.length > 0 ? 8 + summaryLines.length * level.sumLead : 0) +
    16 +
    level.footH +
    level.pad -
    12;
  return { number, item, titleLines, summaryLines, height, level };
}

// 카드를 2열 행으로 묶고, 행을 쪽(이미지)에 채운다
function paginate(layouts: Layout[]): Layout[][][] {
  const usable = H - HEADER_H - 24 - FOOTER_H;
  const rows: Layout[][] = [];
  for (let i = 0; i < layouts.length; i += 2) rows.push(layouts.slice(i, i + 2));

  const pages: Layout[][][] = [];
  let current: Layout[][] = [];
  let used = 0;
  for (const row of rows) {
    const rowH = Math.max(...row.map((l) => l.height)) + row[0].level.rowGap;
    if (current.length > 0 && used + rowH > usable) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(row);
    used += rowH;
  }
  if (current.length > 0) pages.push(current);
  return pages;
}

function drawCard(ctx: CanvasRenderingContext2D, l: Layout, x: number, y: number, height: number) {
  const lv = l.level;
  const color = KEYWORD_COLOR[l.item.keyword] ?? "#475569";

  // 흰 카드 + 얇은 선
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, x, y, CARD_W, height, 8);
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 위쪽 색 선 (키워드 색)
  ctx.save();
  roundRect(ctx, x, y, CARD_W, height, 8);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(x, y, CARD_W, 5);
  ctx.restore();

  const tx = x + lv.pad;
  let ty = y + lv.pad;

  // 번호 (두 자리) + 키워드 이름
  ctx.textBaseline = "alphabetic";
  ctx.font = `bold 28px ${FONT}`;
  ctx.fillStyle = NAVY;
  const num = String(l.number).padStart(2, "0");
  ctx.fillText(num, tx, ty + 26);
  const numW = ctx.measureText(num).width;

  ctx.font = `bold 17px ${FONT}`;
  const kwW = ctx.measureText(l.item.keyword).width + 22;
  const kx = tx + numW + 14;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  roundRect(ctx, kx, ty + 4, kwW, 28, 14);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(l.item.keyword, kx + 11, ty + 24);
  ty += lv.headH;

  // 제목
  ctx.font = `bold ${lv.titleSize}px ${FONT}`;
  ctx.fillStyle = INK;
  for (const line of l.titleLines) {
    ctx.fillText(line, tx, ty + lv.titleSize - 2);
    ty += lv.titleLead;
  }

  // 요약
  if (l.summaryLines.length > 0) {
    ty += 8;
    ctx.font = `${lv.sumSize}px ${FONT}`;
    ctx.fillStyle = GRAY_TEXT;
    for (const line of l.summaryLines) {
      ctx.fillText(line, tx, ty + lv.sumSize - 2);
      ty += lv.sumLead;
    }
  }

  // 아래: 얇은 구분선 + 보도사·시각 / 보도사 수
  const footY = y + height - lv.pad + 4 - lv.footH;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(tx, footY);
  ctx.lineTo(x + CARD_W - lv.pad, footY);
  ctx.stroke();

  ctx.font = `bold 17px ${FONT}`;
  ctx.fillStyle = GRAY_TEXT;
  const sourceText = l.item.source;
  ctx.fillText(sourceText, tx, footY + lv.footH - 11);
  const sw = ctx.measureText(sourceText).width;
  ctx.font = `17px ${FONT}`;
  ctx.fillStyle = GRAY_LIGHT;
  ctx.fillText(`  ·  ${timeLabel(l.item.publishedAt)}`, tx + sw, footY + lv.footH - 11);

  if (l.item.mentionCount > 1) {
    ctx.font = `bold 17px ${FONT}`;
    ctx.fillStyle = NAVY;
    ctx.textAlign = "right";
    ctx.fillText(`${l.item.mentionCount}곳 보도`, x + CARD_W - lv.pad, footY + lv.footH - 11);
    ctx.textAlign = "left";
  }
}

function drawPage(
  ctx: CanvasRenderingContext2D,
  rows: Layout[][],
  dateLabel: string,
  page: number,
  pages: number,
  items: readonly CardItem[],
) {
  ctx.fillStyle = PAGE_BG;
  ctx.fillRect(0, 0, W, H);

  // 흰 머리 영역
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, TOP_H);
  ctx.textBaseline = "alphabetic";

  // 왼쪽: 이름과 부제목
  ctx.fillStyle = NAVY;
  ctx.fillRect(MARGIN, 40, 8, 62);
  ctx.font = `bold 46px ${FONT}`;
  ctx.fillStyle = NAVY_DARK;
  ctx.fillText("오늘의 스크랩", MARGIN + 26, 78);
  ctx.font = `23px ${FONT}`;
  ctx.fillStyle = GRAY_TEXT;
  ctx.fillText("경제구조개혁국 관련 기사 스크랩", MARGIN + 26, 112);

  // 오른쪽: 날짜와 건수
  ctx.textAlign = "right";
  ctx.font = `bold 30px ${FONT}`;
  ctx.fillStyle = INK;
  ctx.fillText(dateLabel, W - MARGIN, 72);
  ctx.font = `22px ${FONT}`;
  ctx.fillStyle = GRAY_TEXT;
  ctx.fillText(`기사 ${items.length}건${pages > 1 ? `  ·  ${page} / ${pages}쪽` : ""}`, W - MARGIN, 108);
  ctx.textAlign = "left";

  // 남색 선
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, TOP_H, W, 6);

  // 키워드별 건수 줄
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, TOP_H + 6, W, STRIP_H);
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.keyword, (counts.get(it.keyword) ?? 0) + 1);
  const keys = KEYWORD_ORDER.filter((k) => counts.has(k));
  let cx = MARGIN;
  const cy = TOP_H + 6 + STRIP_H / 2 + 7;
  for (const k of keys) {
    const color = KEYWORD_COLOR[k] ?? "#475569";
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx + 8, cy - 7, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `bold 21px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText(k, cx + 24, cy);
    const kw = ctx.measureText(k).width;
    ctx.font = `21px ${FONT}`;
    ctx.fillStyle = GRAY_TEXT;
    const cnt = ` ${counts.get(k)}`;
    ctx.fillText(cnt, cx + 24 + kw, cy);
    cx += 24 + kw + ctx.measureText(cnt).width + 30;
  }
  ctx.fillStyle = LINE;
  ctx.fillRect(0, TOP_H + 6 + STRIP_H - 1, W, 1);

  // 카드
  let y = HEADER_H + 28;
  for (const row of rows) {
    const rowH = Math.max(...row.map((l) => l.height));
    row.forEach((l, col) => drawCard(ctx, l, MARGIN + col * (CARD_W + COL_GAP), y, rowH));
    y += rowH + row[0].level.rowGap;
  }

  // 아래: 선과 안내
  ctx.fillStyle = LINE;
  ctx.fillRect(MARGIN, H - FOOTER_H, W - MARGIN * 2, 1);
  ctx.font = `19px ${FONT}`;
  ctx.fillStyle = GRAY_LIGHT;
  if (pages > 1) {
    ctx.textAlign = "right";
    ctx.fillText(`${page} / ${pages}`, W - MARGIN, H - 26);
    ctx.textAlign = "left";
  }
}

// 모든 기사를 A4 1~2장(기사가 아주 많으면 더 늘어남)의 이미지로 만들어 PNG 주소(data URL)들을 돌려준다
export function renderCardPages(items: readonly CardItem[], dateLabel: string): string[] {
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("canvas unavailable");

  const targetPages = items.length <= ONE_PAGE_MAX_ITEMS ? 1 : 2;
  let pages: Layout[][][] = [];
  for (const level of LEVELS) {
    const layouts = items.map((item, i) => layoutCard(measure, item, i + 1, level));
    pages = paginate(layouts);
    if (pages.length <= targetPages) break;
  }

  return pages.map((rows, index) => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    drawPage(ctx, rows, dateLabel, index + 1, pages.length, items);
    return canvas.toDataURL("image/png");
  });
}
