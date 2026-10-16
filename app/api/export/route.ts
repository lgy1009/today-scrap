// Design Ref: §3 API 명세 — POST /api/export { articles } → .txt 파일
// 선택한 기사의 본문은 서버가 직접 다시 가져온다(클라이언트가 보낸 본문은 믿지 않는다).
// 저장 금지 원칙: 파일은 디스크에 쓰지 않고 메모리에서 만들어 바로 응답하며, 기사 내용은 로그에 남기지 않는다.

import { KEYWORDS, OTHER_KEYWORD } from "@/lib/config";
import { extractBody } from "@/lib/extract";
import { summarize } from "@/lib/summary";
import { buildScrapText, kstDateStamp, type ScrapEntry } from "@/lib/textfile";
import type { ApiError } from "@/lib/types";

const MAX_ARTICLES = 35; // 키워드 7개 × 5건
const CONCURRENCY = 3; // 본문을 동시에 가져오는 수

function error(status: number, code: string, message: string) {
  const body: ApiError = { error: { code, message } };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

type Requested = {
  keyword: string;
  title: string;
  source: string;
  publishedAt: string;
  link: string;
};

// 요청에 들어온 기사 한 건이 형식에 맞는지 확인한다
function parseRequested(value: unknown): Requested | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  const { keyword, title, source, publishedAt, link } = r;
  if (
    typeof keyword !== "string" ||
    typeof title !== "string" ||
    typeof source !== "string" ||
    typeof publishedAt !== "string" ||
    typeof link !== "string"
  ) {
    return null;
  }
  if (!(KEYWORDS as readonly string[]).includes(keyword) && keyword !== OTHER_KEYWORD) return null;
  if (!title || title.length > 300 || !source || source.length > 50 || link.length > 2000) return null;
  if (Number.isNaN(Date.parse(publishedAt))) return null;
  return { keyword, title, source, publishedAt, link };
}

// 기사 수집·본문 가져오기에 시간이 걸릴 수 있어 최대 실행 시간을 늘려 둔다 (초)
export const maxDuration = 60;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    let sameHost = false;
    try {
      sameHost = new URL(origin).host === request.headers.get("host");
    } catch {
      sameHost = false;
    }
    if (!sameHost) return error(403, "FORBIDDEN", "허용되지 않은 요청입니다.");
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return error(400, "INVALID_REQUEST", "요청 형식이 올바르지 않습니다.");
  }

  let raw: unknown;
  try {
    const body: unknown = await request.json();
    raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>).articles : undefined;
  } catch {
    return error(400, "INVALID_REQUEST", "요청 형식이 올바르지 않습니다.");
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return error(400, "INVALID_REQUEST", "선택한 기사가 없습니다.");
  }
  if (raw.length > MAX_ARTICLES) {
    return error(400, "TOO_MANY", `한 번에 최대 ${MAX_ARTICLES}건까지 받을 수 있습니다.`);
  }
  const requested: Requested[] = [];
  for (const item of raw) {
    const parsed = parseRequested(item);
    if (!parsed) return error(400, "INVALID_REQUEST", "기사 정보가 올바르지 않습니다.");
    requested.push(parsed);
  }

  // 본문을 동시 3건씩 가져온다 (순서는 선택한 순서를 그대로 유지)
  const entries: ScrapEntry[] = new Array(requested.length);
  let next = 0;
  async function worker() {
    while (next < requested.length) {
      const index = next++;
      const article = requested[index];
      const result = await extractBody(article.link, article.title);
      const body = result.ok ? result.body : null;
      entries[index] = { ...article, body, summary: summarize(body, undefined, article.title) };
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, requested.length) }, worker));

  const text = buildScrapText(entries);
  const filename = `스크랩_${kstDateStamp()}.txt`;
  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // 한글 파일 이름은 filename* 방식으로 인코딩한다
      "Content-Disposition": `attachment; filename="scrap.txt"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
