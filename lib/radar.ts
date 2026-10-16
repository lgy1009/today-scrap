// 놓친 이슈 레이더: 7개 키워드에 뽑히지 않았지만 여러 보도사가 크게 다룬 이슈를 찾는다.
// 새로 수집하지 않고, 이미 읽은 기사와 언급량(같은 이슈를 다룬 보도사 수)만 쓴다. (규칙 기반)

import {
  BODY_UNAVAILABLE_SOURCES,
  OTHER_KEYWORD,
  RADAR_BIG_ISSUE_SOURCES,
  RADAR_BIG_ONLY_TERMS,
  RADAR_ECON_TERMS,
  RADAR_EXCLUDE_TERMS,
  RADAR_MAX_BIG,
  RADAR_MAX_ECONOMY,
  RADAR_MIN_SOURCES,
} from "./config";
import type { ScoredItem } from "./score";
import { makeId } from "./select";
import type { Article, FlowEntry, KeywordResult } from "./types";

// 경제·정책 이슈인지: 제목에 경제 낱말이 있고, 정치·사건 낱말은 없을 때
function isEconomic(title: string): boolean {
  return RADAR_ECON_TERMS.some((t) => title.includes(t)) && !RADAR_BIG_ONLY_TERMS.some((t) => title.includes(t));
}

function radarMinSources(title: string): number {
  return isEconomic(title) ? RADAR_MIN_SOURCES : RADAR_BIG_ISSUE_SOURCES;
}

// ---- 보도 흐름 다듬기 ----
// 낱말이 조금 겹친다고 같은 이슈로 묶으면 다른 이슈(예: 코픽스, 해상운임)가 섞인다.
// 그래서 제목이 서로 충분히 비슷한 기사끼리 이어 붙이고, 가장 큰 한 덩어리만 같은 이슈로 인정한다.

const FLOW_LINK_SIMILARITY = 0.2; // 제목 글자 조각이 이 비율 이상 겹치면 같은 이슈로 이어 붙인다

function bigramsOf(title: string): Set<string> {
  const text = title
    .replace(/\[[^\]]*\]|\([^)]*\)|<[^>]*>/g, " ")
    .replace(/[^0-9A-Za-z가-힣]/g, "")
    .toLowerCase();
  const set = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2));
  return set;
}

function similarity(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const g of a) if (b.has(g)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

// 가장 큰 덩어리를 돌려준다 (시간순). 대표 기사는 덩어리 안에서 다른 기사들과 가장 비슷한 기사다.
function refineFlow(flow: readonly FlowEntry[]): { entries: FlowEntry[]; rep: FlowEntry } | null {
  const n = flow.length;
  if (n === 0) return null;
  const grams = flow.map((f) => bigramsOf(f.title));
  const sim: number[][] = flow.map((_, i) => flow.map((__, j) => (i === j ? 0 : similarity(grams[i], grams[j]))));

  const parent = flow.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) if (sim[i][j] >= FLOW_LINK_SIMILARITY) parent[find(j)] = find(i);
  }

  const groups = new Map<number, number[]>();
  flow.forEach((_, i) => {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(i);
    else groups.set(root, [i]);
  });
  // 가장 큰 덩어리 (같으면 더 일찍 시작한 쪽)
  const best = [...groups.values()].sort(
    (a, b) => b.length - a.length || flow[a[0]].publishedAt.localeCompare(flow[b[0]].publishedAt),
  )[0];

  const entries = best.map((i) => flow[i]).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  let repIndex = -1;
  let repScore = -1;
  for (const i of best) {
    if (BODY_UNAVAILABLE_SOURCES.includes(flow[i].source)) continue; // 본문을 못 가져오는 곳은 대표로 쓰지 않는다
    const score = best.reduce((sum, j) => sum + sim[i][j], 0);
    if (score > repScore) {
      repScore = score;
      repIndex = i;
    }
  }
  if (repIndex < 0) return null; // 본문을 가져올 수 있는 기사가 하나도 없으면 레이더에 올리지 않는다
  return { entries, rep: flow[repIndex] };
}

// 키워드별 추천 기사에 이미 들어간 이슈는 레이더에서 뺀다
export function buildRadar(items: readonly ScoredItem[], results: readonly KeywordResult[]): Article[] {
  const byLink = new Map(items.map((i) => [i.link, i]));

  // 이미 보여 준 이슈에 속한 기사 주소들 (대표 기사 + 같은 이슈로 묶인 기사)
  const covered = new Set<string>();
  for (const r of results) {
    for (const a of r.articles) {
      covered.add(a.link);
      for (const o of a.alsoReportedBy ?? []) covered.add(o.link);
      for (const f of byLink.get(a.link)?.issueFlow ?? []) covered.add(f.link);
    }
  }

  type Candidate = { entries: FlowEntry[]; rep: FlowEntry };
  const candidates: Candidate[] = [];
  for (const i of items) {
    if (i.excluded || i.isOpinion) continue;
    const flow = i.issueFlow ?? [];
    if (flow.length < RADAR_MIN_SOURCES) continue; // 빠른 1차 거름
    if (covered.has(i.link) || flow.some((f) => covered.has(f.link))) continue;

    const refined = refineFlow(flow);
    if (!refined) continue;
    const { rep, entries } = refined;
    if (RADAR_EXCLUDE_TERMS.some((t) => rep.title.includes(t))) continue;
    // 경제·정책 이슈는 4곳, 정치·사건 등은 아주 크게 보도된 경우(8곳)만 올린다
    if (entries.length < radarMinSources(rep.title)) continue;
    candidates.push(refined);
  }
  candidates.sort(
    (a, b) => b.entries.length - a.entries.length || b.rep.publishedAt.localeCompare(a.rep.publishedAt),
  );

  const radar: Article[] = [];
  const taken = new Set<string>();
  const count = { economy: 0, big: 0 };
  const limit = { economy: RADAR_MAX_ECONOMY, big: RADAR_MAX_BIG };
  for (const c of candidates) {
    const kind = isEconomic(c.rep.title) ? "economy" : "big";
    if (count[kind] >= limit[kind]) continue;
    const links = c.entries.map((e) => e.link);
    if (links.some((l) => taken.has(l))) continue; // 이미 뽑은 이슈와 같은 이슈
    links.forEach((l) => taken.add(l));
    count[kind]++;
    radar.push({
      id: makeId(c.rep.link),
      keyword: OTHER_KEYWORD,
      mentionCount: c.entries.length, // 화면의 "N곳 보도"는 흐름에 보이는 수와 같다
      title: c.rep.title,
      link: c.rep.link,
      source: c.rep.source,
      publishedAt: c.rep.publishedAt,
      summary: byLink.get(c.rep.link)?.summary,
      radarKind: kind,
    });
  }
  return radar;
}
