// Design Ref: §3 API 명세 — 입력 검증 (끝<시작, 48시간 초과 → INVALID_RANGE)
// 화면과 (나중에 만들) 검색 API가 같은 규칙을 쓰도록 한 곳에 둔다.

// 검색 기간의 최대 길이 (시간)
export const MAX_RANGE_HOURS = 48;

// 화면의 시간 입력값("2026-10-15T09:00")은 한국시간(KST)으로 본다.
export function parseKst(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}:00+09:00`);
  return Number.isNaN(ms) ? null : ms;
}

// 문제가 있으면 사용자에게 보여 줄 안내 문구를, 괜찮으면 null을 돌려준다.
export function validateRange(start: string, end: string): string | null {
  if (!start) return "시작 시간을 입력해 주세요.";
  if (!end) return "끝 시간을 입력해 주세요.";

  const startMs = parseKst(start);
  const endMs = parseKst(end);
  if (startMs === null) return "시작 시간의 형식이 올바르지 않습니다. 다시 선택해 주세요.";
  if (endMs === null) return "끝 시간의 형식이 올바르지 않습니다. 다시 선택해 주세요.";

  if (endMs <= startMs) {
    return "끝 시간이 시작 시간보다 늦어야 합니다. 두 시간을 다시 확인해 주세요.";
  }
  if (endMs - startMs > MAX_RANGE_HOURS * 60 * 60 * 1000) {
    return `기간은 최대 ${MAX_RANGE_HOURS}시간까지 검색할 수 있습니다. 기간을 줄여 주세요.`;
  }
  return null;
}
