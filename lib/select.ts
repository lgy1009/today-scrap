// Design Ref: §3 데이터 흐름 [4 키워드 배정] [5 선별]
// Plan 작업 7·8: 여러 키워드에 걸린 기사를 한 곳에만 두고, 키워드별 4~5건을 고른다.
// 후보가 부족하면 기준을 낮추지 않고 있는 만큼만 보여 준다. (사용자 결정 2026-10-15)

import {
  BODY_UNAVAILABLE_SOURCES,
  KEYWORDS,
  MAX_ARTICLES_PER_KEYWORD,
  MIN_ARTICLES_PER_KEYWORD,
  type Keyword,
} from "./config";
import { scoreForKeyword, scoreParts, type ScoredItem } from "./score";
import type { Article, KeywordResult } from "./types";

// 기사 주소로 짧은 고유 번호를 만든다 (선택·순서 바꾸기에서 기사를 구별하는 용도)
export function makeId(link: string): string {
  let hash = 5381;
  for (let i = 0; i < link.length; i++) {
    hash = ((hash << 5) + hash + link.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function toArticle(item: ScoredItem, keyword: Keyword): Article {
  return {
    id: makeId(item.link),
    keyword,
    mentionCount: item.mentionCount,
    title: item.title,
    link: item.link,
    source: item.source,
    publishedAt: item.publishedAt,
    summary: item.summary,
    score: scoreParts(item, keyword) ?? undefined,
    alsoReportedBy: item.alsoReportedBy,
  };
}

// 점수 높은 순, 같으면 최신순
function byScoreThenNewest(keyword: Keyword) {
  return (a: ScoredItem, b: ScoredItem) => {
    const diff = (scoreForKeyword(b, keyword) ?? 0) - (scoreForKeyword(a, keyword) ?? 0);
    return diff !== 0 ? diff : b.publishedAt.localeCompare(a.publishedAt);
  };
}

// 점수 계산이 끝난 기사들에서 키워드별 추천 기사를 고른다. 결과는 KEYWORDS 순서.
export function selectArticles(items: readonly ScoredItem[]): KeywordResult[] {
  // 본문을 가져오지 못하는 보도사의 기사는 기사로 선정하지 않는다. (언급량 계산에는 이미 반영되어 있다)
  const pool = items.filter((i) => !i.excluded && !BODY_UNAVAILABLE_SOURCES.includes(i.source));

  // 키워드별 후보 수 (적은 키워드를 먼저 챙기기 위함)
  const candidateCount = new Map<Keyword, number>();
  for (const k of KEYWORDS) {
    candidateCount.set(k, pool.filter((i) => i.fit[k] > 0).length);
  }

  // 1단계 배정: 기사마다 가장 적합한 키워드 한 곳을 정한다. 같으면 후보가 적은 키워드를 우선한다.
  const assigned = new Map<Keyword, ScoredItem[]>(KEYWORDS.map((k) => [k, []]));
  for (const item of pool) {
    let best: Keyword | null = null;
    let bestScore = -1;
    for (const k of KEYWORDS) {
      const s = scoreForKeyword(item, k);
      if (s === null) continue;
      const better =
        s > bestScore ||
        (s === bestScore && best !== null && (candidateCount.get(k) ?? 0) < (candidateCount.get(best) ?? 0));
      if (better) {
        best = k;
        bestScore = s;
      }
    }
    if (best) assigned.get(best)!.push(item);
  }

  // 2단계 선별: 키워드마다 위에서부터 최대 5건
  const used = new Set<string>(); // 이미 쓴 기사 주소
  const picked = new Map<Keyword, ScoredItem[]>();
  for (const k of KEYWORDS) {
    const top = [...assigned.get(k)!].sort(byScoreThenNewest(k)).slice(0, MAX_ARTICLES_PER_KEYWORD);
    picked.set(k, top);
    for (const t of top) used.add(t.link);
  }

  // 3단계 보충: 4건에 못 미치는 키워드는, 다른 키워드에 배정됐지만 뽑히지 않은 기사 중
  // 제목에 그 키워드 낱말이 있는 기사만 가져온다. 그래도 모자라면 있는 만큼만 보여 준다. (기준을 낮추지 않는다)
  const needy = [...KEYWORDS].sort((x, y) => (candidateCount.get(x) ?? 0) - (candidateCount.get(y) ?? 0));
  for (const k of needy) {
    const list = picked.get(k)!;
    if (list.length >= MIN_ARTICLES_PER_KEYWORD) continue;
    const candidates = pool.filter((i) => !used.has(i.link) && i.fit[k] > 0).sort(byScoreThenNewest(k));
    for (const c of candidates) {
      if (list.length >= MIN_ARTICLES_PER_KEYWORD) break;
      list.push(c);
      used.add(c.link);
    }
  }

  return KEYWORDS.map((k) => ({
    keyword: k,
    articles: picked.get(k)!.map((i) => toArticle(i, k)),
    short: picked.get(k)!.length < MIN_ARTICLES_PER_KEYWORD || undefined,
  }));
}
