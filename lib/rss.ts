// Design Ref: §3 데이터 흐름 [1 수집] — 언론사 RSS를 읽어 시간 범위 안의 기사만 남긴다.
// Plan 작업 4: RSS 수집 + 시작·끝 시간 필터
// 저장 금지 원칙(PRD 7번)에 따라 캐시를 쓰지 않고, 기사 내용은 로그에 남기지 않는다.

import { XMLParser } from "fast-xml-parser";
import { FEEDS, type Feed } from "./feeds";
import type { FeedItem } from "./types";

const FETCH_TIMEOUT_MS = 8000; // RSS 한 개당 기다리는 최대 시간
const MAX_BYTES = 3 * 1024 * 1024; // RSS 한 개당 받는 최대 크기 (3MB)
const CONCURRENCY = 6; // 동시에 읽는 RSS 수

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  processEntities: true,
});

// ---- 작은 도우미들 ----

// 여러 모양(글자, {#text}, 배열)으로 오는 값을 글자 하나로 만든다
function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === "object") return text((value as Record<string, unknown>)["#text"]);
  return "";
}

// HTML 태그와 흔한 기호를 걷어 내 글자만 남긴다 (요약용)
function plain(html: string): string {
  // 일부 언론사는 기호를 두 번 감싸서(&amp;quot;) 보내므로 두 번 풀어 준다
  let out = html.replace(/<[^>]*>/g, " ");
  for (let i = 0; i < 2; i++) {
    out = out
      .replace(/&nbsp;/g, " ")
      .replace(/&hellip;/g, "…")
      .replace(/&middot;/g, "·")
      .replace(/&ldquo;|&rdquo;|&quot;/g, '"')
      .replace(/&lsquo;|&rsquo;|&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
      .replace(/&amp;/g, "&");
  }
  // 원본에서 &가 빠진 채 오는 기호(quot; hellip;)도 바로잡는다
  out = out.replace(/\bquot;/g, '"').replace(/\bhellip;/g, "…");
  return out.replace(/\s+/g, " ").trim();
}

// 기사 주소에서 추적용 문구(utm_*)를 지우고, http/https만 허용한다
function cleanLink(raw: string): string | null {
  try {
    // 주소가 두 번 감싸진 경우(&amp;amp;)를 풀어 준다
    const url = new URL(raw.trim().replace(/&(amp;)+/g, "&"));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_")) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

// 입력시간 글자를 UTC ISO로 바꾼다. 시간대 표시가 없으면 한국시간으로 본다.
function parseDate(raw: string): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    value = value.replace(" ", "T") + "+09:00";
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// 응답 바이트를 글자로 바꾼다. XML 첫 줄에 euc-kr이 적혀 있으면 그에 맞춰 읽는다.
function decode(bytes: Uint8Array): string {
  const head = new TextDecoder("utf-8").decode(bytes.slice(0, 200)).toLowerCase();
  const charset = /encoding="(euc-kr|ks_c_5601-1987)"/.test(head) ? "euc-kr" : "utf-8";
  return new TextDecoder(charset).decode(bytes);
}

// ---- RSS 한 개 읽기 ----

async function readFeed(feed: Feed): Promise<FeedItem[]> {
  const res = await fetch(feed.url, {
    cache: "no-store",
    // HTTP 헤더에는 한글을 쓸 수 없으므로 영문으로 적는다
    headers: { "User-Agent": "Mozilla/5.0 (compatible; TodayScrap/0.1)" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const buffer = new Uint8Array(await res.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) throw new Error("응답이 너무 큽니다");

  const doc = parser.parse(decode(buffer));
  // RSS 2.0은 rss.channel.item, Atom은 feed.entry
  const rawItems: unknown = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? [];
  const list = (Array.isArray(rawItems) ? rawItems : [rawItems]) as Record<string, unknown>[];

  const items: FeedItem[] = [];
  for (const raw of list) {
    const title = plain(text(raw.title));
    // Atom의 link는 { "@_href": ... } 모양이다
    const linkNode = raw.link as unknown;
    const linkRaw =
      typeof linkNode === "object" && linkNode !== null && !Array.isArray(linkNode) && "@_href" in linkNode
        ? String((linkNode as Record<string, unknown>)["@_href"])
        : text(linkNode);
    const link = cleanLink(linkRaw);
    const publishedAt = parseDate(
      text(raw.pubDate) || text(raw["dc:date"]) || text(raw.published) || text(raw.updated),
    );
    if (!title || !link || !publishedAt) continue; // 제목·주소·시간 중 하나라도 없으면 건너뜀

    const summaryText = plain(text(raw.description) || text(raw.summary));
    items.push({
      title,
      link,
      source: feed.publisher,
      section: feed.section,
      publishedAt,
      // 요약이 제목과 같거나 너무 짧으면 의미가 없으므로 뺀다
      summary: summaryText.length > 20 && summaryText !== title ? summaryText.slice(0, 300) : undefined,
    });
  }
  return items;
}

// ---- 여러 RSS를 읽어 시간 범위로 거르기 ----

export type CollectResult = {
  items: FeedItem[];
  failedFeeds: string[]; // 읽지 못한 RSS ("보도사 섹션" 형태, 안내용)
};

// start·end는 ISO 형식 글자(한국시간 표시 포함 가능)다. 범위는 start 이상 end 이하.
export async function collectFeedItems(
  start: string,
  end: string,
  feeds: readonly Feed[] = FEEDS,
): Promise<CollectResult> {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new Error("시작·끝 시간 형식이 올바르지 않습니다");
  }

  const results: FeedItem[][] = [];
  const failedFeeds: string[] = [];
  let next = 0;

  // 동시에 CONCURRENCY개씩만 읽는다
  async function worker() {
    while (next < feeds.length) {
      const feed = feeds[next++];
      try {
        results.push(await readFeed(feed));
      } catch {
        // 오류 내용에 기사 정보는 없지만, 안내용으로 어느 RSS인지만 남긴다
        failedFeeds.push(`${feed.publisher} ${feed.section}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, feeds.length) }, worker));

  // 시간 범위 필터 + 같은 주소(여러 섹션에 중복)는 한 번만
  const seen = new Set<string>();
  const items: FeedItem[] = [];
  for (const item of results.flat()) {
    const t = Date.parse(item.publishedAt);
    if (t < startMs || t > endMs) continue;
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    items.push(item);
  }
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)); // 최신순
  return { items, failedFeeds };
}
