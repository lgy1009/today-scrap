// Design Ref: §3 API 명세 — POST /api/search { start, end } → 키워드별 추천 기사
// 저장 금지 원칙(PRD 7번): 결과를 서버에 남기지 않고 캐시하지 않으며, 기사 내용을 로그에 쓰지 않는다.

import { clusterItems } from "@/lib/dedupe";
import { buildRadar } from "@/lib/radar";
import { collectFeedItems } from "@/lib/rss";
import { scoreItems } from "@/lib/score";
import { selectArticles } from "@/lib/select";
import type { ApiError, SearchResponse } from "@/lib/types";
import { parseKst, validateRange } from "@/lib/validate";

function error(status: number, code: string, message: string) {
  const body: ApiError = { error: { code, message } };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

// 기사 수집·본문 가져오기에 시간이 걸릴 수 있어 최대 실행 시간을 늘려 둔다 (초)
export const maxDuration = 60;

export async function POST(request: Request) {
  // 다른 사이트가 몰래 보낸 요청을 막는다: Origin이 있으면 이 사이트와 같아야 한다
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

  // 입력값을 그대로 믿지 않고 형식과 범위를 서버에서 다시 확인한다
  let start = "";
  let end = "";
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null) {
      const record = body as Record<string, unknown>;
      if (typeof record.start === "string") start = record.start;
      if (typeof record.end === "string") end = record.end;
    }
  } catch {
    return error(400, "INVALID_REQUEST", "요청 형식이 올바르지 않습니다.");
  }

  const rangeMessage = validateRange(start, end);
  if (rangeMessage) return error(400, "INVALID_RANGE", rangeMessage);

  const startMs = parseKst(start);
  const endMs = parseKst(end);
  if (startMs === null || endMs === null) {
    return error(400, "INVALID_RANGE", "시간 형식이 올바르지 않습니다.");
  }

  try {
    const { items, failedFeeds } = await collectFeedItems(
      new Date(startMs).toISOString(),
      new Date(endMs).toISOString(),
    );
    const scored = scoreItems(clusterItems(items));
    const results = selectArticles(scored);
    const response: SearchResponse = {
      results,
      radar: buildRadar(scored, results),
      collectedCount: items.length,
      failedFeedCount: failedFeeds.length,
    };
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // 오류 내용(기사 정보 포함 가능)은 응답과 로그에 남기지 않는다
    return error(502, "COLLECT_FAILED", "기사를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}
