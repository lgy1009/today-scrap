// Design Ref: §3 데이터 흐름 [3 점수] — 항목별 가중치를 합친 총점(100점 만점)
// Plan 작업 6. 항목: 업무 관련성 40 · 키워드 적합도 25 · 언급량 25 · 정책·시한 낱말 10, 사설·칼럼 −20
// 판단 재료는 제목과 RSS 요약뿐이다. 지역·시상·인사 기사는 제외 표시를 한다.

import {
  AWARD_TERMS,
  EXCLUDE_TITLE_PREFIXES,
  IMPORTANT_MENTION_COUNT,
  KEYWORDS,
  KEYWORD_TERMS,
  MENTION_FULL_SOURCES,
  OPINION_PENALTY,
  OPINION_PREFIXES,
  POLICY_TERMS,
  REGION_TERMS,
  SCORE_WEIGHTS,
  WORK_TERMS,
  type Keyword,
} from "./config";
import type { ClusteredItem, ScoreParts } from "./types";

const TITLE_WEIGHT = 3; // 제목에서 찾은 낱말 하나당
const SUMMARY_WEIGHT = 1; // 요약에서 찾은 낱말 하나당
const MAX_MATCH_SCORE = 6; // 낱말 점수 상한: 제목에 낱말 2개면 그 항목 만점

export type ScoredItem = ClusteredItem & {
  fit: Record<Keyword, number>; // 키워드별 적합도 원점수 (0이면 그 키워드와 무관)
  workRelevance: number; // 업무 관련성 원점수
  policyHits: number; // 제목 속 정책 낱말 수
  isOpinion: boolean; // 사설·칼럼 여부
  excluded: boolean; // 제외 대상인지
  excludeReason?: "머리표" | "지역·시상";
};

// 영문 "AI"는 다른 영단어 안에 든 경우(MAIN, SAID 등)를 빼고 단독 낱말일 때만 인정한다
function hasTerm(text: string, term: string): boolean {
  if (term === "AI") return /(^|[^A-Za-z])AI([^A-Za-z]|$)/.test(text);
  return text.toLowerCase().includes(term.toLowerCase());
}

// 제목·요약에서 찾은 낱말 수를 원점수(0~12)로 바꾼다
// titleOnly가 true면 제목에 낱말이 하나도 없을 때 0점이다 (요약만 맞는 기사는 키워드와 무관하다고 본다)
function matchScore(title: string, summary: string, terms: readonly string[], titleOnly = false): number {
  let score = 0;
  let titleHit = false;
  for (const term of terms) {
    if (hasTerm(title, term)) {
      score += TITLE_WEIGHT;
      titleHit = true;
    } else if (summary && hasTerm(summary, term)) {
      score += SUMMARY_WEIGHT;
    }
  }
  if (titleOnly && !titleHit) return 0;
  return Math.min(score, MAX_MATCH_SCORE);
}

export function scoreItem(item: ClusteredItem): ScoredItem {
  const title = item.title;
  const summary = item.summary ?? "";
  const trimmed = title.trim();

  const fit = {} as Record<Keyword, number>;
  for (const keyword of KEYWORDS) {
    fit[keyword] = matchScore(title, summary, KEYWORD_TERMS[keyword], true);
  }
  const workRelevance = matchScore(title, summary, WORK_TERMS);
  const policyHits = POLICY_TERMS.filter((t) => hasTerm(title, t)).length;
  const isOpinion = OPINION_PREFIXES.some((p) => trimmed.startsWith(p));

  // 제외 판단: 머리표(인사·부고 등) → 지역·시상(단, 중요 이슈면 포함)
  let excluded = false;
  let excludeReason: ScoredItem["excludeReason"];
  if (EXCLUDE_TITLE_PREFIXES.some((p) => trimmed.startsWith(p))) {
    excluded = true;
    excludeReason = "머리표";
  } else if (item.mentionCount < IMPORTANT_MENTION_COUNT) {
    const isRegional = REGION_TERMS.some((t) => title.includes(t));
    const isAward = AWARD_TERMS.some((t) => title.includes(t));
    if (isRegional || isAward) {
      excluded = true;
      excludeReason = "지역·시상";
    }
  }

  return { ...item, fit, workRelevance, policyHits, isOpinion, excluded, excludeReason };
}

// 한 키워드 기준의 항목별 점수와 총점(0~100). 그 키워드와 무관하면(적합도 0) null.
export function scoreParts(item: ScoredItem, keyword: Keyword): ScoreParts | null {
  const fit = item.fit[keyword];
  if (fit <= 0) return null;

  const work = Math.round((item.workRelevance / MAX_MATCH_SCORE) * SCORE_WEIGHTS.work);
  const keywordScore = Math.round((fit / MAX_MATCH_SCORE) * SCORE_WEIGHTS.keyword);
  const mention = Math.round(
    (Math.min(item.mentionCount - 1, MENTION_FULL_SOURCES - 1) / (MENTION_FULL_SOURCES - 1)) *
      SCORE_WEIGHTS.mention,
  );
  const policy = Math.round((Math.min(item.policyHits, 2) / 2) * SCORE_WEIGHTS.policy);
  const penalty = item.isOpinion ? OPINION_PENALTY : 0;
  const total = Math.max(0, Math.min(100, work + keywordScore + mention + policy - penalty));

  return { work, keyword: keywordScore, mention, policy, penalty, total };
}

// 한 키워드 안에서 기사를 줄 세울 때 쓰는 총점. 그 키워드와 무관하면 null.
export function scoreForKeyword(item: ScoredItem, keyword: Keyword): number | null {
  return scoreParts(item, keyword)?.total ?? null;
}

export function scoreItems(items: readonly ClusteredItem[]): ScoredItem[] {
  return items.map(scoreItem);
}
