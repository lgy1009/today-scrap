// Design Ref: §3 데이터 흐름 [2 중복 제거] — 같은 내용(보도사만 다른) 기사를 하나로 묶고 언급량을 남긴다.
// Plan 작업 5. 기준값(제목 60% 겹침)은 임시값이며 개발 중 조정할 수 있다.

import { KEYWORD_TERMS, WORK_TERMS, sourceRank } from "./config";
import type { ClusteredItem, FeedItem, FlowEntry } from "./types";

// ---- 낱말 단위 비교 (같은 이슈를 찾기 위한 도구) ----

// 제목 비교에서 뜻이 약해 건너뛰는 낱말
const STOP_WORDS = new Set([
  "속보", "단독", "종합", "오늘", "내일", "어제", "관련", "대한", "위한", "통해", "이번", "지난", "올해", "내년",
  "정부", "대통령", "의원", "기자", "사진", "영상", "뉴스", "발표", "논란", "확대", "강화", "추진", "개최",
  "진행", "예정", "전망", "이후",
]);
// 낱말 끝에 붙는 조사 (길이가 긴 것부터 확인한다)
const PARTICLES = [
  "에서", "으로", "에게", "까지", "부터", "이며", "이다", "하고", "하며", "에는", "에도", "으로서", "로서",
  "로는", "이나", "보다", "처럼", "은", "는", "이", "가", "을", "를", "의", "에", "도", "만", "과", "와", "로",
].sort((a, b) => b.length - a.length);

function tokenize(title: string): Set<string> {
  const text = title.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/[^0-9A-Za-z가-힣]+/g, " ");
  const out = new Set<string>();
  for (let word of text.split(/\s+/)) {
    if (!word) continue;
    for (const p of PARTICLES) {
      if (word.length > p.length + 1 && word.endsWith(p)) {
        word = word.slice(0, -p.length);
        break;
      }
    }
    if (word.length >= 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word)) out.add(word);
  }
  return out;
}

// 키워드·업무 낱말을 품은 낱말 (예: 국민연금, 최저임금). 같은 이슈를 찾는 기준점으로 쓴다.
// 두 글자짜리 흔한 낱말(교육, 대학, 청년 등)은 너무 넓어 제외하고, 세 글자 이상의 구체적인 낱말만 쓴다.
const ANCHOR_TERMS = [...Object.values(KEYWORD_TERMS).flat(), ...WORK_TERMS].filter(
  (t) => t.length >= 3 && t !== "챗GPT",
);
function isAnchor(word: string): boolean {
  return word.length >= 3 && ANCHOR_TERMS.some((t) => word.includes(t));
}


// 제목이 이 비율 이상 겹치면 같은 내용으로 본다 (0~1)
export const SIMILARITY_THRESHOLD = 0.6;

// 제목을 비교하기 좋게 다듬는다: [단독] 같은 머리표, 기호, 공백을 없앤다
function normalize(title: string): string {
  return title
    .replace(/\[[^\]]*\]|\([^)]*\)|<[^>]*>/g, " ") // [단독], (종합) 등
    .replace(/[^0-9A-Za-z가-힣]/g, "") // 한글·영문·숫자만 남김
    .toLowerCase();
}

// 글자 2개씩 끊어 만든 조각 집합 (조사가 달라도 비슷하게 비교하기 위함)
function bigrams(text: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2));
  return set;
}

// 두 집합이 얼마나 겹치는지 (0~1)
function jaccard(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const g of small) if (large.has(g)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

// 같은 내용의 기사를 묶는다. 가장 먼저 나온 기사를 대표로 삼는다.
// 묶을 때는 "대표 기사"와만 비교해서, A-B-C가 사슬처럼 이어져 엉뚱한 기사까지 묶이는 일을 막는다.
export function clusterItems(
  items: readonly FeedItem[],
  threshold: number = SIMILARITY_THRESHOLD,
): ClusteredItem[] {
  const ordered = [...items].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));

  type Cluster = {
    rep: FeedItem; // 비교 기준 (가장 먼저 나온 기사). 화면에 보여 줄 대표는 마지막에 다시 고른다.
    grams: Set<string>;
    members: FeedItem[];
    sources: Set<string>;
  };
  const clusters: Cluster[] = [];
  // 조각 → 그 조각을 가진 대표 기사 번호들 (후보를 빨리 좁히기 위한 색인)
  const index = new Map<string, number[]>();

  for (const item of ordered) {
    const grams = bigrams(normalize(item.title));
    if (grams.size === 0) {
      clusters.push({ rep: item, grams, members: [item], sources: new Set([item.source]) });
      continue;
    }

    // 조각을 공유하는 대표 기사만 후보로 센다
    const counts = new Map<number, number>();
    for (const g of grams) {
      const list = index.get(g);
      if (!list) continue;
      for (const ci of list) counts.set(ci, (counts.get(ci) ?? 0) + 1);
    }

    let best = -1;
    let bestScore = 0;
    for (const ci of counts.keys()) {
      const score = jaccard(grams, clusters[ci].grams);
      if (score >= threshold && score > bestScore) {
        best = ci;
        bestScore = score;
      }
    }

    if (best >= 0) {
      const c = clusters[best];
      c.members.push(item);
      // 같은 보도사의 기사는 언급량에 다시 세지 않는다
      c.sources.add(item.source);
    } else {
      const ci = clusters.length;
      clusters.push({ rep: item, grams, members: [item], sources: new Set([item.source]) });
      for (const g of grams) {
        const list = index.get(g);
        if (list) list.push(ci);
        else index.set(g, [ci]);
      }
    }
  }

  // 같은 내용 안에서는 규모가 큰 보도사(단계가 높은 곳)의 기사를 대표로 하고, 같은 단계면 먼저 나온 기사를 뽑는다
  const clustered = clusters.map((c) => {
    const rep = [...c.members].sort(byRankThenTime)[0];
    const seen = new Set<string>([rep.source]);
    const others: { source: string; link: string }[] = [];
    for (const m of c.members) {
      if (m === rep || seen.has(m.source)) continue;
      seen.add(m.source);
      others.push({ source: m.source, link: m.link });
    }
    return { ...rep, mentionCount: c.sources.size, alsoReportedBy: others };
  });
  return applyIssueMentions(mergeSameIssue(clustered), ordered);
}

// 대표 기사 순서: 보도사 규모 단계가 높은 쪽이 먼저, 같으면 먼저 나온 쪽이 먼저
function byRankThenTime(a: FeedItem, b: FeedItem): number {
  return sourceRank(a.source) - sourceRank(b.source) || a.publishedAt.localeCompare(b.publishedAt);
}

// 낱말 색인: 낱말 → 그 낱말이 제목에 든 기사 번호들. 너무 흔한 낱말(전체의 2% 초과)은 뺀다.
function buildIndex(titles: readonly string[]) {
  const tokens = titles.map(tokenize);
  const df = new Map<string, number>();
  for (const set of tokens) for (const w of set) df.set(w, (df.get(w) ?? 0) + 1);
  const limit = Math.max(10, titles.length * 0.02);
  const common = new Set([...df].filter(([, c]) => c > limit).map(([w]) => w));
  const index = new Map<string, number[]>();
  tokens.forEach((set, i) => {
    for (const w of set) {
      if (common.has(w)) continue;
      const list = index.get(w);
      if (list) list.push(i);
      else index.set(w, [i]);
    }
  });
  return { tokens, df, common, index };
}

// 같은 사건을 다른 표현으로 쓴 기사들(예: 같은 판결 속보)을 한 줄로 합친다.
// 제목 낱말이 3개 이상 겹치거나, 2개 이상 겹치면서 작은 쪽의 60% 이상이면 같은 사건으로 본다.
function mergeSameIssue(items: ClusteredItem[]): ClusteredItem[] {
  const { tokens, common, index } = buildIndex(items.map((i) => i.title));
  const parent = items.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));

  for (let i = 0; i < items.length; i++) {
    const mine = [...tokens[i]].filter((w) => !common.has(w));
    const counts = new Map<number, number>();
    for (const w of mine) for (const j of index.get(w) ?? []) if (j > i) counts.set(j, (counts.get(j) ?? 0) + 1);
    for (const [j, shared] of counts) {
      const other = [...tokens[j]].filter((w) => !common.has(w)).length;
      const smaller = Math.min(mine.length, other);
      if (shared >= 3 || (shared >= 2 && smaller > 0 && shared / smaller >= 0.6)) {
        parent[find(j)] = find(i);
      }
    }
  }

  // 같은 묶음 안에서는 가장 먼저 나온 기사를 대표로 하고, 다른 보도사를 모은다
  const groups = new Map<number, ClusteredItem[]>();
  items.forEach((it, i) => {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(it);
    else groups.set(root, [it]);
  });
  const result: ClusteredItem[] = [];
  for (const group of groups.values()) {
    group.sort(byRankThenTime);
    const rep = group[0];
    const sources = new Set<string>([rep.source, ...rep.alsoReportedBy.map((o) => o.source)]);
    const others = [...rep.alsoReportedBy];
    for (const g of group.slice(1)) {
      for (const o of [{ source: g.source, link: g.link }, ...g.alsoReportedBy]) {
        if (!sources.has(o.source)) {
          sources.add(o.source);
          others.push(o);
        }
      }
    }
    result.push({ ...rep, mentionCount: sources.size, alsoReportedBy: others });
  }
  return result;
}

// 언급량: 같은 이슈를 다룬 서로 다른 보도사 수를 센다. (사용자가 수기로 찾던 "관련 기사가 많은 이슈")
// 같은 이슈의 기준: 키워드·업무 낱말을 품은 낱말(예: 국민연금)을 함께 쓰거나,
// 드문 낱말을 포함해 2개 이상의 낱말이 겹치는 기사.
function applyIssueMentions(clusters: ClusteredItem[], all: readonly FeedItem[]): ClusteredItem[] {
  const { tokens, df, common, index } = buildIndex(all.map((i) => i.title));
  const byLink = new Map(all.map((it, i) => [it.link, i]));

  return clusters.map((c) => {
    const i = byLink.get(c.link);
    if (i === undefined) return c;
    const mine = [...tokens[i]].filter((w) => !common.has(w));
    const hits = new Map<number, string[]>();
    for (const w of mine) for (const j of index.get(w) ?? []) if (j !== i) hits.set(j, [...(hits.get(j) ?? []), w]);

    const sources = new Set<string>([c.source, ...c.alsoReportedBy.map((o) => o.source)]);

    // 보도 흐름: 보도사별로 가장 먼저 나온 기사만 모은다
    const flow = new Map<string, FlowEntry>();
    const addFlow = (it: FeedItem) => {
      const cur = flow.get(it.source);
      if (!cur || it.publishedAt < cur.publishedAt) {
        flow.set(it.source, { source: it.source, title: it.title, link: it.link, publishedAt: it.publishedAt });
      }
    };
    addFlow(c);
    for (const o of c.alsoReportedBy) {
      const k = byLink.get(o.link);
      if (k !== undefined) addFlow(all[k]);
    }

    for (const [j, words] of hits) {
      const anchored = words.some((w) => isAnchor(w) && (df.get(w) ?? 0) <= 40);
      const distinctive = words.length >= 2 && words.some((w) => (df.get(w) ?? 0) <= 6);
      if (anchored || distinctive || words.length >= 3) sources.add(all[j].source);
      // 보도 흐름은 더 엄격하게: 제목 낱말이 2개 이상 겹치는 기사만 같은 이슈로 본다
      if (words.length >= 2 && (anchored || distinctive || words.length >= 3)) addFlow(all[j]);
    }
    const issueFlow = [...flow.values()].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt)).slice(0, 15);
    return { ...c, mentionCount: Math.max(c.mentionCount, sources.size), issueFlow };
  });
}
