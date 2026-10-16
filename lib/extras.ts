// 시험 기능: 기사 본문에서 발언·용어를 뽑는다. (규칙 기반, AI 사용 안 함)
// 결과는 "참고용 추출"이며 정확한 내용은 원문으로 확인해야 한다.

import { GLOSSARY } from "./glossary";
import type { ArticleExtras } from "./types";

// ---- 발언 ----

const TITLES =
  "(?:의원|장관|차관|위원장|상임위원|대표|대변인|총리|대통령|교수|연구위원|연구원|원장|국장|과장|회장|이사장|청장|실장|위원|사무총장|본부장|부총리|시장|지사|노조)";
const SPEECH =
  /말했다|밝혔다|주장했다|강조했다|지적했다|설명했다|비판했다|전했다|요구했다|촉구했다|덧붙였다|언급했다|말했|밝혔|물었다|답했다|반박했다|우려했다|당부했다/;

export function extractQuotes(body: string): ArticleExtras["quotes"] {
  const quotes: ArticleExtras["quotes"] = [];
  const seen = new Set<string>();

  for (const m of body.matchAll(/[“"]([^”"\n]{12,220})[”"]/g)) {
    const text = m[1].trim();
    const start = m.index ?? 0;
    const after = body.slice(start + m[0].length, start + m[0].length + 70);
    const before = body.slice(Math.max(0, start - 50), start);

    const finder = new RegExp(`([가-힣]{2,4})\\s*${TITLES}`);
    const roleFinder = new RegExp(`([가-힣]{2,6}\\s*)?([가-힣]{2,4}\\s*${TITLES})`);
    const speakerMatch = finder.exec(after) ?? finder.exec(before);
    const roleMatch = roleFinder.exec(after) ?? roleFinder.exec(before);
    const speaks = SPEECH.test(after);
    if (!speaks && !speakerMatch) continue; // 발언으로 보기 어려운 따옴표(제목 인용 등)는 건너뜀

    const speaker = (roleMatch ? roleMatch[0] : speakerMatch ? speakerMatch[0] : "").replace(/\s+/g, " ").trim();
    const key = text.slice(0, 20);
    if (seen.has(key)) continue;
    seen.add(key);
    quotes.push({ speaker: speaker || null, text: text.slice(0, 160) });
    if (quotes.length >= 4) break;
  }
  return quotes;
}

// ---- 용어 ----

export function findTerms(text: string, max = 6): ArticleExtras["terms"] {
  const found: ArticleExtras["terms"] = [];
  for (const entry of GLOSSARY) {
    const names = [entry.term, ...(entry.aliases ?? [])];
    if (names.some((n) => text.includes(n))) {
      found.push({ term: entry.term, explanation: entry.explanation });
      if (found.length >= max) break;
    }
  }
  return found;
}

export function buildExtras(title: string, body: string): ArticleExtras {
  return {
    quotes: extractQuotes(body),
    terms: findTerms(`${title}\n${body}`),
  };
}
