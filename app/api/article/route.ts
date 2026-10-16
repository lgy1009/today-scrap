// Design Ref: §3 데이터 흐름 [6 본문] — POST /api/article { link } → { body }
// 추천된 기사 한 건의 본문 글자를 가져온다. 서버에 저장하지 않고 로그에도 남기지 않는다.
// 보안: 허용된 언론사 도메인만, 내부 주소 차단, 시간·크기 제한은 lib/extract.ts에서 처리한다.

import { extractBody } from "@/lib/extract";
import { buildExtras } from "@/lib/extras";
import type { ApiError } from "@/lib/types";

function error(status: number, code: string, message: string) {
  const body: ApiError = { error: { code, message } };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

// 기사 수집·본문 가져오기에 시간이 걸릴 수 있어 최대 실행 시간을 늘려 둔다 (초)
export const maxDuration = 60;

export async function POST(request: Request) {
  // 다른 사이트가 몰래 보낸 요청을 막는다
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

  let link = "";
  let title = "";
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null) {
      const record = body as Record<string, unknown>;
      if (typeof record.link === "string") link = record.link;
      if (typeof record.title === "string") title = record.title.slice(0, 300);
    }
  } catch {
    return error(400, "INVALID_REQUEST", "요청 형식이 올바르지 않습니다.");
  }
  if (!link || link.length > 2000) {
    return error(400, "INVALID_REQUEST", "기사 주소가 올바르지 않습니다.");
  }

  const result = await extractBody(link, title);
  if (!result.ok) {
    if (result.reason === "허용되지 않은 주소") {
      return error(400, "LINK_NOT_ALLOWED", "허용되지 않은 기사 주소입니다.");
    }
    return error(502, "BODY_FAILED", "본문을 가져오지 못했습니다. 원문 링크를 이용해 주세요.");
  }
  // 발언·용어는 본문에서 규칙으로 뽑는다 (시험 기능)
  const extras = buildExtras(title, result.body);
  return Response.json({ body: result.body, extras }, { headers: { "Cache-Control": "no-store" } });
}
