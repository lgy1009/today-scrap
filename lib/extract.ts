// Design Ref: §3 데이터 흐름 [6 본문] — 기사 링크에서 본문 글자만 가져온다.
// Plan 작업 9. 보안 점검(B-2, B-3) 규칙: http(s)만, 내부 주소 차단, 이동·시간·크기 제한, 글자만 반환.
// 저장 금지 원칙(PRD 7번): 본문을 저장하지 않고 로그에도 남기지 않는다.

import { Readability } from "@mozilla/readability";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { JSDOM } from "jsdom";
import { cleanBodyText } from "./clean-body";
import { FEEDS } from "./feeds";

const FETCH_TIMEOUT_MS = 8000; // 기사 한 건당 기다리는 최대 시간
const MAX_BYTES = 2 * 1024 * 1024; // 받을 수 있는 최대 크기 (2MB)
const MAX_REDIRECTS = 4; // 따라갈 수 있는 이동 횟수
const MAX_BODY_CHARS = 20000; // 돌려주는 본문 글자 수 상한
const MIN_BODY_CHARS = 150; // 언론사별 영역을 찾을 때, 이 이상의 글자가 있는 영역만 본문 후보로 본다
const CONTAINER_MIN_CHARS = 60; // 정제한 뒤에도 이보다 짧으면 본문 추출 실패로 본다 (짧은 속보 기사 허용)

export type ExtractResult =
  | { ok: true; body: string }
  | { ok: false; reason: "허용되지 않은 주소" | "접속 실패" | "본문 없음" };

// ---- 주소 검사 ----

// co.kr 같은 이중 도메인을 고려해 "대표 도메인"만 뽑는다 (예: news.sbs.co.kr → sbs.co.kr)
function baseDomain(host: string): string {
  const labels = host.toLowerCase().split(".");
  const twoPartSuffix = ["co.kr", "or.kr", "go.kr", "ne.kr"];
  const last2 = labels.slice(-2).join(".");
  if (twoPartSuffix.includes(last2) && labels.length >= 3) return labels.slice(-3).join(".");
  return last2;
}

// 허용 도메인: 우리가 RSS를 읽는 언론사의 대표 도메인만
const ALLOWED_DOMAINS = new Set(FEEDS.map((f) => baseDomain(new URL(f.url).hostname)));

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9")) return true;
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.replace("::ffff:", ""));
  return false;
}

// 접속해도 되는 주소인지 확인한다 (프로토콜, 허용 도메인, 내부 IP 여부)
async function checkUrl(raw: string): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (isIP(url.hostname) !== 0) return null; // 숫자 주소로 직접 접속하는 것은 막는다
  if (!ALLOWED_DOMAINS.has(baseDomain(url.hostname))) return null;
  try {
    const addresses = await lookup(url.hostname, { all: true });
    if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) return null;
  } catch {
    return null;
  }
  return url;
}

// ---- 받아 오기 ----

// 이동(리다이렉트)을 직접 따라가며, 이동할 때마다 주소를 다시 검사한다
async function safeFetch(raw: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await checkUrl(current);
    if (!url) return null;

    const res = await fetch(url, {
      cache: "no-store",
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TodayScrap/0.1)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;
      current = new URL(location, url).toString();
      continue;
    }
    if (!res.ok || !res.body) return null;

    // 크기 상한을 넘으면 중단한다
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    return { bytes, contentType: res.headers.get("content-type") ?? "" };
  }
  return null;
}

// 글자 인코딩을 찾아 글자로 바꾼다 (헤더 → 문서 안 meta → 기본 utf-8)
function decodeHtml(bytes: Uint8Array, contentType: string): string {
  let charset = /charset=([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase();
  if (!charset) {
    const head = new TextDecoder("latin1").decode(bytes.slice(0, 2048));
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  }
  if (charset === "ks_c_5601-1987" || charset === "euc_kr") charset = "euc-kr";
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

// ---- 본문 추출 ----

// 언론사(대표 도메인)별 본문 영역. 앞에 있는 것부터 시도하고, 모두 실패하면 공통 후보, 그다음 Readability를 쓴다.
const SITE_SELECTORS: Record<string, string[]> = {
  "newsis.com": ["[itemprop=articleBody]", ".viewer article"],
  "heraldcorp.com": ["#articleText"],
  "labortoday.co.kr": ["#article-view-content-div"],
  "sisajournal.com": ["#article-view-content-div"],
  "newscj.com": ["#article-view-content-div"],
  "donga.com": ["section.news_view"],
  "ajunews.com": ["#articleBody"],
  "fnnews.com": [".article-view__body"],
  "asiae.co.kr": [".article-body__contents", ".article_view"],
  "mt.co.kr": ["#articleView", "#articleBody"],
  "hankyung.com": ["#articletxt"],
  "mk.co.kr": ["[itemprop=articleBody]"],
  "seoul.co.kr": ["#articleContent"],
  "khan.co.kr": ["#articleBody"],
  "kmib.co.kr": ["#articleBody"],
  "sedaily.com": ["#article-body"],
  "segye.com": ["#article_txt"],
  "yna.co.kr": [".story-news.article", "#articleWrap"],
  "dt.co.kr": ["#article-body"],
};
const GENERIC_SELECTORS = [
  "[itemprop=articleBody]",
  "#articleBody",
  "#article-view-content-div",
  "#articletxt",
  "#article_txt",
  "#articleText",
  "#article-body",
  "#newsct_article",
  ".article_body",
  ".article-body",
];

// 본문 영역 안에서 먼저 걷어 낼 요소들 (사진·설명·공유·댓글·관련 기사·광고 등)
const STRIP_SELECTOR = [
  "script", "style", "noscript", "iframe", "form", "button", "nav", "aside", "footer",
  "figure", "figcaption", "video", "audio", "svg",
  '[class*="caption"]', '[class*="Caption"]', '[class*="photo"]', '[class*="Photo"]',
  '[class*="related"]', '[class*="Related"]', '[class*="recommend"]', '[class*="share"]', '[class*="sns"]',
  '[class*="comment"]', '[class*="reply"]', '[class*="banner"]', '[class*="advert"]', '[class*="adsense"]',
  '[class*="reporter"]', '[class*="byline"]', '[class*="copyright"]', '[class*="subscribe"]',
  '[class*="thumb"]', '[class*="mainnews"]', '[class*="raw-html"]',
].join(",");

const BLOCK_TAGS = new Set([
  "P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "SECTION", "ARTICLE", "TR", "TABLE",
]);

// 요소 안의 글자를 문단 단위(줄바꿈)로 모은다
function nodeText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  if (el.tagName === "BR") return "\n";
  const inner = Array.from(el.childNodes).map(nodeText).join("");
  return BLOCK_TAGS.has(el.tagName) ? "\n" + inner + "\n" : inner;
}

function pickContainer(doc: Document, host: string): Element | null {
  const selectors = [...(SITE_SELECTORS[host] ?? []), ...GENERIC_SELECTORS];
  for (const sel of selectors) {
    try {
      const el = doc.querySelector(sel);
      if (el && (el.textContent ?? "").trim().length >= MIN_BODY_CHARS) return el;
    } catch {
      // 선택자 오류는 건너뛴다
    }
  }
  return null;
}

export async function extractBody(link: string, title = ""): Promise<ExtractResult> {
  try {
    if (!(await checkUrl(link))) return { ok: false, reason: "허용되지 않은 주소" };

    const fetched = await safeFetch(link);
    if (!fetched) return { ok: false, reason: "접속 실패" };

    const html = decodeHtml(fetched.bytes, fetched.contentType);
    // 스크립트 실행·외부 자원 불러오기를 끈 기본 설정 그대로 사용한다
    const dom = new JSDOM(html, { url: link });
    const doc = dom.window.document;
    const readabilityDoc = doc.cloneNode(true) as Document; // 아래에서 doc을 고치므로 미리 복사해 둔다

    let text = "";
    const container = pickContainer(doc, baseDomain(new URL(link).hostname));
    if (container) {
      container.querySelectorAll(STRIP_SELECTOR).forEach((n) => n.remove());
      // 글자가 전부 링크로 이루어진 짧은 블록(관련 기사 제목, "다른 기사 보기" 등)은 본문이 아니다
      container.querySelectorAll("p, div, li").forEach((el) => {
        const links = el.querySelectorAll("a");
        if (links.length === 0) return;
        const whole = (el.textContent ?? "").replace(/\s+/g, "");
        const inLinks = Array.from(links)
          .map((a) => a.textContent ?? "")
          .join("")
          .replace(/\s+/g, "");
        if (whole.length > 0 && whole.length <= 120 && whole === inLinks) el.remove();
      });
      text = cleanBodyText(nodeText(container), title);
    }
    // 언론사별 영역을 찾지 못한 경우에만 Readability로 다시 시도한다.
    // (영역은 찾았는데 정제 뒤 남은 글이 없다면 본문 없는 기사이므로, 화면 장식을 본문으로 잡지 않는다)
    if (!container) {
      const article = new Readability(readabilityDoc).parse();
      const alt = cleanBodyText(article?.textContent ?? "", title);
      if (alt.length > text.length) text = alt;
    }
    dom.window.close();

    if (text.length < CONTAINER_MIN_CHARS) return { ok: false, reason: "본문 없음" };
    return { ok: true, body: text.slice(0, MAX_BODY_CHARS) };
  } catch {
    // 오류 내용에 기사 정보가 섞일 수 있어 남기지 않는다
    return { ok: false, reason: "접속 실패" };
  }
}
