// 본문 정제: 기사 본문 글자에 딸려 오는 사진 설명·저작권 문구·기자 이메일·관련 기사 목록·댓글 창 문구 등을 줄 단위로 걷어 낸다.
// 규칙 기반이며 서버(본문 추출)와 같은 규칙을 한 곳에 둔다.

// 한 줄이 통째로 잡음인지 판단하는 규칙들
const NOISE_LINE: RegExp[] = [
  /무단\s*전재|재배포|저작권|Copyright|AI\s*학습|ⓒ|\(c\)/i, // 저작권 문구
  /\[email\s*protected\]/i, // 가려진 이메일 자리
  /^#.{1,30}$/, // 해시태그 줄
  /^(AD|ADVERTISEMENT|광고|Advertisement)$/i, // 광고 표시
  /^구글에서/, // "구글에서 선호하는 매체로 추가"
  /^원문\s*보기|View\s*Original|View\s*English|영문\s*기사|영문\s*번역|English\s*Translation/i,
  /카톡|^제보하기|^다른\s*기사\s*보기|^기사\s*보기/,
  /제보를\s*기다립니다|제보\s*[:：]|카카오톡\s*(채널|ID)/,
  /^<[^>]{1,10}>$/, // "<연합>" 같은 출처 줄
  /^(관련\s*기사|관련\s*뉴스|많이\s*본\s*뉴스|추천\s*기사|이\s*기사를\s*추천|기사\s*제보|댓글|스크랩|글자\s*크기|공유하기|뉴스\s*듣기|무료\s*회원|로그인|구독|Shorts|외국어\s*서비스)/,
  /기사\s*바로가기|바로가기\s*[▶>]/,
  /^[▲△◆■●▶▷☞※◎]/, // 사진 설명·참고 문구·"◎공감언론 뉴시스"
  /(사진\s*[=:]|사진\s*제공|제공\s*[=:]|\/\s*사진|photo@|재판매\s*및\s*DB\s*금지|이미지\s*(확대|축소)|사진\s*확대)/,
  /^(입력|수정|등록|송고|기사입력)\s*[:：]?\s*\d{4}/, // "입력 2026.10.16 08:11"
  /^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}(\s*\(.\))?(\s+\d{1,2}:\d{2}(:\d{2})?)?(\s*\(.\))?$/, // 날짜만 있는 줄
  /^\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*\d{1,2}시\s*\d{1,2}분\s*송고$/,
  /^[가-힣]{2,4}\s*(기자|특파원|논설위원|선임기자|인턴기자|객원기자)\s*[\w.+-]*@?[\w.-]*$/, // "홍길동 기자" 서명 줄
  /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/, // 이메일만 있는 줄
  /^(Q\.|기사를\s*끝까지|세\s*줄\s*요약|AI\s*퀴즈)/, // 퀴즈·요약 위젯
  /^본문\s*\/\s*\d+|^내\s*댓글|^비밀번호$/, // 댓글 입력창
];

// 이 줄을 만나면 이후는 본문이 아니라고 보고 잘라 낸다 (짧은 줄에만 적용: 긴 문단이 우연히 포함한 경우를 피한다)
const TAIL_MARKER =
  /저작권자|Copyright|ⓒ|무단\s*전재|재배포\s*금지|GoodNews\s*paper|^관련\s*기사|^관련\s*뉴스|^많이\s*본|이\s*기사를\s*추천|기사를\s*끝까지|AI\s*퀴즈|^본문\s*\/|^내\s*댓글|^기사\s*제보|^▶|^☞|^\[저작권/;

// 줄 맨 앞의 "[서울=뉴시스] 홍길동 기자 =" 같은 머리말을 지운다
function stripLead(line: string): string {
  return line
    .replace(/^\s*[\[(［（<][^\])］）>]{0,20}[=＝][^\])］）>]{0,30}[\])］）>]\s*([가-힣]{2,4}\s*(기자|특파원|선임기자))?\s*[=＝]?\s*/, "")
    .replace(/^\s*[\[(［（][가-힣A-Za-z0-9 ]{2,12}[\])］）]\s*(?=[가-힣])/, "") // "[파이낸셜뉴스] ..."
    .replace(/^\s*[가-힣]{2,4}\s*(기자|특파원|선임기자)\s*[=＝]\s*/, "")
    .trim();
}

function isNoise(line: string): boolean {
  // 이메일 주소가 든 짧은 줄은 기자 서명 줄이다 (긴 문단이 우연히 이메일을 포함한 경우는 본문으로 둔다)
  if (line.length <= 70 && /\S+@\S+\.\S+/.test(line)) return true;
  return NOISE_LINE.some((re) => re.test(line));
}

// 끝부분에 문장이 아닌 짧은 제목이 줄줄이 이어지면 "다른 기사 목록"으로 보고 잘라 낸다
function trimHeadlineTail(lines: string[]): string[] {
  const sentenceEnd = /[.!?다요죠”"'’)]\s*$/;
  let cut = lines.length;
  while (cut > 3 && lines[cut - 1].length <= 70 && !/[.!?다요죠”"]$/.test(lines[cut - 1].trim())) cut--;
  // 3줄 이상이 연속으로 제목 모양일 때만 잘라 낸다
  if (lines.length - cut >= 3 && cut >= 3 && sentenceEnd.test(lines[cut - 1])) return lines.slice(0, cut);
  return lines;
}

// 본문 안에 다시 들어 있는 기사 제목 줄인지 (글자만 비교)
function sameAsTitle(line: string, title: string): boolean {
  const norm = (s: string) => s.replace(/[^0-9A-Za-z가-힣]/g, "");
  const a = norm(line);
  const b = norm(title);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.length >= 10 && b.length >= 10 && (b.includes(a) || a.includes(b)) && Math.abs(a.length - b.length) <= 8;
}

export function cleanBodyText(raw: string, title = ""): string {
  let lines = raw
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean);

  // 1) 맨 앞의 기자 머리말을 줄 안에서 지운다
  lines = lines.map(stripLead).filter(Boolean);

  // 2) 꼬리 표지(저작권·관련기사 등)에서 잘라 낸다. 앞에 본문이 어느 정도 있을 때만.
  const markerAt = lines.findIndex((l, i) => i >= 2 && l.length <= 140 && TAIL_MARKER.test(l));
  if (markerAt >= 0) lines = lines.slice(0, markerAt);

  // 3) 잡음 줄 제거 (제목이 본문 안에 되풀이된 줄 포함)
  lines = lines.filter((l) => !isNoise(l) && !(title && sameAsTitle(l, title)));

  // 4) 맨 앞의 아주 짧은 줄(분류명·기호 등)은 본문이 아니다. 첫 긴 줄 앞에서만 지운다.
  const firstLong = lines.findIndex((l) => l.length >= 30);
  if (firstLong > 0) lines = lines.slice(0, firstLong).filter((l) => l.length > 14).concat(lines.slice(firstLong));

  // 5) 끝에 이어진 다른 기사 제목 목록
  lines = trimHeadlineTail(lines);

  // 6) 바로 앞 줄과 같은 줄(중복) 제거
  lines = lines.filter((l, i) => i === 0 || l !== lines[i - 1]);

  return lines.join("\n\n").trim();
}
