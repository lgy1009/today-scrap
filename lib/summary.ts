// 기사 요약: 본문 앞부분의 핵심 문장을 규칙으로 고른다. (AI 사용 안 함)
// 서버(스크랩 파일)와 브라우저(카드 이미지)에서 같이 쓴다.

const MAX_SUMMARY = 125;

// "[서울=뉴시스]윤정민 기자 =", "(서울=연합뉴스) 홍길동 기자", "입력 2026.10.15 06:30" 같은 머리말을 줄 안에서 없앤다
function cleanLine(line: string): string {
  return line
    .replace(/[\[(［（<][^\])］）>]{0,20}[=＝][^\])］）>]{0,30}[\])］）>]\s*([가-힣]{2,4}\s*(기자|특파원|선임기자))?\s*[=＝]?\s*/g, "")
    .replace(/[가-힣]{2,4}\s*(기자|특파원|선임기자)\s*[=＝]\s*/g, "")
    .replace(/^\s*[\[(［（][가-힣A-Za-z0-9 ]{2,12}[\])］）]\s*/, "") // 줄 맨 앞의 [파이낸셜뉴스] 같은 표시
    .replace(/\[email\s*protected\]/gi, "") // 이메일 주소가 가려진 자리
    .replace(/\d{4}[-.]\d{2}[-.]\d{2}\s+\d{2}:\d{2}(:\d{2})?/g, "") // 본문 끝에 붙는 "2026-10-15 17:02" 같은 시각
    .replace(/(입력|수정|등록)\s*\d{4}[.\-]\d{1,2}[.\-]\d{1,2}[^가-힣]{0,12}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 사진 설명·기자 서명·저작권 문구처럼 요약에 쓰면 안 되는 줄
function isNoiseLine(line: string): boolean {
  if (line.length < 14) return true;
  if (/^[▲◆■※▶●☞△▷]/.test(line)) return true; // 사진 설명, 참고 문구
  if (/(사진\s*[=:]|사진제공|ⓒ|저작권|무단\s*전재|재배포|@[A-Za-z0-9.-]+|이미지\s*(확대|축소))/.test(line)) return true;
  if (/기자\s*$/.test(line) || /^[\[(].{0,20}[\])]$/.test(line)) return true;
  // 언론사 하단 안내 문구 (등록번호·발행인·주소 등)
  if (/(등록번호|발행인|편집인|청소년\s*보호|제보\s*[:：]|구독\s*신청|주소\s*[:：]|전화\s*[:：]|대표\s*전화)/.test(line)) return true;
  if (/(통신판매|사업자\s*등록|통신판매업|\d{2,4}-\d{3,4}-\d{4})/.test(line)) return true; // 사업자 정보·전화번호 줄
  return false;
}

// 제목을 그대로 되풀이하는 줄인지 (글자 조각이 많이 겹치면 같은 줄로 본다)
function repeatsTitle(line: string, title: string): boolean {
  const norm = (s: string) => s.replace(/[^0-9A-Za-z가-힣]/g, "");
  const a = norm(line);
  const b = norm(title);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  return shared / Math.min(ga.size, gb.size) >= 0.7;
}

function clip(text: string): string {
  return text.length > MAX_SUMMARY ? text.slice(0, MAX_SUMMARY - 1).trimEnd() + "…" : text;
}

export function summarize(body: string | null | undefined, fallback?: string, title = ""): string {
  const text = (body ?? "").trim();
  if (text) {
    const lines = text
      .split(/\n+/)
      .map((l) => cleanLine(l))
      .filter((l) => l && !isNoiseLine(l) && !(title && repeatsTitle(l, title)));
    // 부제(문장 끝맺음이 없는 소제목)와 사진 설명을 피해, 마침표로 끝나는 문단을 우선 쓴다
    const sentenceLines = lines.filter((l) => /[.!?다”"'’)]\s*$/.test(l) && /(다|요|죠)[.!?”"']*\s*$/.test(l));
    const usable = sentenceLines.length > 0 ? sentenceLines : lines;
    if (usable.length > 0) {
      const joined = usable.join(" ");
      const sentences = joined.split(/(?<=[.!?다])\s+/).filter((s) => s.length >= 12);
      let out = "";
      for (const s of sentences) {
        if (!out) {
          out = s;
        } else if ((out + " " + s).length <= MAX_SUMMARY) {
          out += " " + s;
        } else {
          break;
        }
        if (out.length >= MAX_SUMMARY * 0.7) break;
      }
      if (out) return clip(out);
    }
  }
  const alt = (fallback ?? "").replace(/\s+/g, " ").trim();
  return alt ? clip(alt) : "";
}
