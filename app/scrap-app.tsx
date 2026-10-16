"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MIN_ARTICLES_PER_KEYWORD,
  RADAR_BIG_ISSUE_SOURCES,
  RADAR_MIN_SOURCES,
  SCORE_WEIGHTS,
  type Keyword,
} from "@/lib/config";
import { renderCardPages } from "@/lib/cardnews";
import ReportView, { type ReportItem } from "./report-view";
import { summarize } from "@/lib/summary";
import { kstDateStamp } from "@/lib/textfile";
import type { Article, ApiError, ArticleExtras, SearchResponse } from "@/lib/types";
import { parseKst, validateRange } from "@/lib/validate";

// Design Ref: §2 화면 구성 — ① 검색 조건 / ② 추천 기사 (키워드별) / ③ 선택한 기사

type Status = "idle" | "loading" | "done" | "error";

// 기사 한 건의 본문 상태 (펼치기 전에는 항목이 없다)
type BodyState =
  | { state: "loading" }
  | { state: "ok"; body: string; extras?: ArticleExtras }
  | { state: "failed" };

// 뒤로 가기·새로고침 뒤에도 화면을 되살리기 위해 브라우저 탭 안에 임시로 보관하는 내용
type Saved = {
  start: string;
  end: string;
  data: SearchResponse | null;
  selected: string[];
  bodies: Record<string, BodyState>;
  open: Record<string, boolean>;
};
const STORAGE_KEY = "today-scrap-v1";
const SCROLL_KEY = "today-scrap-scroll-v1"; // 스크롤 위치(숫자)는 따로 보관한다

// 키워드마다 색을 달리해 구분하기 쉽게 한다 (Tailwind는 클래스 이름을 통째로 적어야 한다)
const KEYWORD_STYLE: Record<Keyword, { bar: string; chip: string }> = {
  노동: { bar: "border-l-blue-500", chip: "bg-blue-100 text-blue-800" },
  교육: { bar: "border-l-emerald-500", chip: "bg-emerald-100 text-emerald-800" },
  청년: { bar: "border-l-violet-500", chip: "bg-violet-100 text-violet-800" },
  인구: { bar: "border-l-amber-500", chip: "bg-amber-100 text-amber-800" },
  연금: { bar: "border-l-rose-500", chip: "bg-rose-100 text-rose-800" },
  AI: { bar: "border-l-cyan-500", chip: "bg-cyan-100 text-cyan-800" },
  양극화: { bar: "border-l-slate-500", chip: "bg-slate-200 text-slate-800" },
};

// UTC 입력시간을 한국시간 "10월 15일 09:30" 형태로 보여 준다
function formatKst(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// 기사 링크가 http/https일 때만 링크로 연결한다
function isSafeLink(link: string): boolean {
  return link.startsWith("https://") || link.startsWith("http://");
}

// 시간 입력창에 넣는 값("2026-10-15T09:30")을 한국시간 기준으로 만든다
function toInputValue(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(" ", "T");
}

// 입력값을 "10월 15일 (목) 오후 3:49" 형태로 읽기 쉽게 보여 준다 (비었거나 형식이 틀리면 null)
function friendlyTime(value: string): string | null {
  const ms = parseKst(value);
  if (ms === null) return null;
  return new Date(ms).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// 빠른 선택: 지금 기준 최근 N시간, 또는 "어제 18시 ~ 오늘 09시"
const QUICK_RANGES: { label: string; make: () => { start: string; end: string } }[] = [
  {
    label: "최근 12시간",
    make: () => {
      const now = new Date();
      return { start: toInputValue(new Date(now.getTime() - 12 * 3600_000)), end: toInputValue(now) };
    },
  },
  {
    label: "최근 24시간",
    make: () => {
      const now = new Date();
      return { start: toInputValue(new Date(now.getTime() - 24 * 3600_000)), end: toInputValue(now) };
    },
  },
  {
    label: "어제 18시 ~ 오늘 09시",
    make: () => {
      const now = new Date();
      const today = toInputValue(now).slice(0, 10);
      const yesterday = toInputValue(new Date(now.getTime() - 24 * 3600_000)).slice(0, 10);
      return { start: `${yesterday}T18:00`, end: `${today}T09:00` };
    },
  },
];

// 두 시간 사이를 "24시간", "12시간 30분"처럼 보여 준다
function durationLabel(startMs: number, endMs: number): string {
  const minutes = Math.round((endMs - startMs) / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}시간` : h === 0 ? `${m}분` : `${h}시간 ${m}분`;
}

// 탭 안에 보관된 화면을 읽는다 (없거나 읽을 수 없으면 null)
function readSaved(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

export default function ScrapApp() {
  // 처음 만들어질 때 보관된 화면이 있으면 그 값으로 시작한다 (뒤로 가기·새로고침 대응)
  const [saved] = useState<Saved | null>(readSaved);
  const [start, setStart] = useState(saved?.start ?? "");
  const [end, setEnd] = useState(saved?.end ?? "");
  const [status, setStatus] = useState<Status>(saved?.data ? "done" : "idle");
  const [message, setMessage] = useState<string | null>(null);
  const [data, setData] = useState<SearchResponse | null>(saved?.data ?? null);
  const [bodies, setBodies] = useState<Record<string, BodyState>>(() => {
    // 가져오던 중이던 본문은 다시 가져올 수 있도록 제외한다
    const ok: Record<string, BodyState> = {};
    for (const [id, b] of Object.entries(saved?.bodies ?? {})) if (b.state === "ok" || b.state === "failed") ok[id] = b;
    return ok;
  }); // 기사 id → 본문 상태
  const [open, setOpen] = useState<Record<string, boolean>>(saved?.open ?? {}); // 기사 id → 펼침 여부
  const [selected, setSelected] = useState<string[]>(saved?.selected ?? []); // 선택한 기사 id (선택한 순서)
  const [exporting, setExporting] = useState(false);
  const [analysis, setAnalysis] = useState<{ done: number; total: number } | null>(null); // 미리 분석 진행 상황
  const [exportError, setExportError] = useState<string | null>(null);
  const [cardPages, setCardPages] = useState<string[] | null>(null); // 카드뉴스 이미지(PNG 주소) 목록
  const [cardBusy, setCardBusy] = useState(false);
  const [reportItems, setReportItems] = useState<ReportItem[] | null>(null); // 보고서 페이지 내용
  const [reportBusy, setReportBusy] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false); // 로고 파일이 없으면 true

  // 보관된 스크롤 위치로 돌아간다 (화면이 다 그려진 뒤에도 한 번 더 맞춘다)
  useEffect(() => {
    let y = 0;
    try {
      y = Number(sessionStorage.getItem(SCROLL_KEY) ?? 0) || 0;
    } catch {
      y = 0;
    }
    if (y <= 0) return;
    const first = window.setTimeout(() => window.scrollTo(0, y), 50);
    const second = window.setTimeout(() => window.scrollTo(0, y), 400);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, []);

  // 바뀔 때마다 화면 상태를 보관한다
  useEffect(() => {
    try {
      const saved: Saved = { start, end, data, selected, bodies, open };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // 보관 공간이 막혀 있어도 사용에는 지장이 없다
    }
  }, [start, end, data, selected, bodies, open]);

  // 스크롤 위치를 보관한다
  useEffect(() => {
    function remember() {
      try {
        sessionStorage.setItem(SCROLL_KEY, String(Math.round(window.scrollY)));
      } catch {
        // 무시
      }
    }
    window.addEventListener("scroll", remember, { passive: true });
    window.addEventListener("pagehide", remember);
    return () => {
      window.removeEventListener("scroll", remember);
      window.removeEventListener("pagehide", remember);
    };
  }, []);

  // 놓친 이슈 레이더 (예전에 저장된 결과에는 없을 수 있다)
  const radar = useMemo(
    () => (data?.radar ?? []).filter((a) => bodies[a.id]?.state !== "failed"),
    [data, bodies],
  );

  // 기사 id → 기사 (선택 목록을 그릴 때 사용). 레이더 기사도 포함한다.
  const articleById = useMemo(() => {
    const map = new Map<string, Article>();
    for (const result of data?.results ?? []) {
      for (const article of result.articles) map.set(article.id, article);
    }
    for (const article of radar) map.set(article.id, article);
    return map;
  }, [data, radar]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const problem = validateRange(start, end);
    if (problem) {
      setStatus("error");
      setMessage(problem);
      return;
    }
    // 이미 고른 기사가 있으면 다시 검색할 때 사라진다는 것을 확인받는다
    if (selected.length > 0 && !window.confirm("다시 검색하면 지금 선택한 기사가 모두 사라집니다. 계속할까요?")) {
      return;
    }

    setStatus("loading");
    setMessage(null);
    setData(null);
    setBodies({});
    setOpen({});
    setSelected([]);
    setExportError(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start, end }),
      });
      const body: unknown = await res.json();
      if (!res.ok) {
        const err = body as ApiError;
        setStatus("error");
        setMessage(err.error?.message ?? "기사를 불러오지 못했습니다. 다시 시도해 주세요.");
        return;
      }
      const response = body as SearchResponse;
      setData(response);
      setStatus("done");
      void analyzeAll(response.results.flatMap((r) => r.articles));
    } catch {
      setStatus("error");
      setMessage("기사를 불러오지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.");
    }
  }

  // 기사 한 건의 본문과 부가 정보(일정·발언·용어)를 서버에서 가져와 보관한다
  async function fetchBody(article: Article) {
    setBodies((prev) => ({ ...prev, [article.id]: { state: "loading" } }));
    // 일시적인 오류일 수 있어 한 번 더 시도한다 (허용되지 않은 주소 등 400번대 오류는 다시 시도하지 않는다)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch("/api/article", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            link: article.link,
            title: article.title,
            publishedAt: article.publishedAt,
          }),
        });
        if (res.ok) {
          const json = (await res.json()) as { body: string; extras?: ArticleExtras };
          setBodies((prev) => ({ ...prev, [article.id]: { state: "ok", body: json.body, extras: json.extras } }));
          return;
        }
        if (res.status < 500) break;
      } catch {
        // 네트워크 오류: 한 번 더 시도
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    // 본문을 가져오지 못한 기사는 기사로 선정하지 않는다 (목록에서 숨기고 선택도 해제)
    setBodies((prev) => ({ ...prev, [article.id]: { state: "failed" } }));
    setSelected((prev) => prev.filter((id) => id !== article.id));
  }

  // 시험 기능: 검색이 끝나면 후보 기사의 본문을 뒤에서 미리 가져와 일정·발언·용어를 분석한다 (동시 3건)
  async function analyzeAll(list: Article[]) {
    const todo = list.filter((a) => bodies[a.id]?.state !== "ok");
    if (todo.length === 0) return;
    setAnalysis({ done: 0, total: todo.length });
    let next = 0;
    async function worker() {
      while (next < todo.length) {
        const article = todo[next++];
        await fetchBody(article);
        setAnalysis((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    setAnalysis(null);
  }

  // 본문 펼치기: 아직 가져오지 못했으면 가져온다
  async function toggleBody(article: Article) {
    const willOpen = !open[article.id];
    setOpen((prev) => ({ ...prev, [article.id]: willOpen }));
    const current = bodies[article.id]?.state;
    if (!willOpen || current === "ok" || current === "loading") return;
    await fetchBody(article);
  }

  function toggleSelect(id: string) {
    setExportError(null);
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // 선택한 기사의 순서를 한 칸씩 바꾼다 (-1: 위로, +1: 아래로)
  function move(id: string, delta: -1 | 1) {
    setSelected((prev) => {
      const index = prev.indexOf(id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  // 선택한 기사들의 본문을 모은다 (이미 가져온 것은 그대로 쓰고, 없으면 한 번 가져온다. 동시 3건)
  async function loadTexts(list: Article[]): Promise<Record<string, string | null>> {
    const texts: Record<string, string | null> = {};
    let next = 0;
    async function worker() {
      while (next < list.length) {
        const a = list[next++];
        const known = bodies[a.id];
        if (known?.state === "ok") {
          texts[a.id] = known.body;
          continue;
        }
        try {
          const res = await fetch("/api/article", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ link: a.link, title: a.title }),
          });
          texts[a.id] = res.ok ? ((await res.json()) as { body: string }).body : null;
        } catch {
          texts[a.id] = null;
        }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    return texts;
  }

  function todayLabel(): string {
    return new Date().toLocaleDateString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    });
  }

  // 선택한 기사로 한눈에 보기 이미지를 만든다
  async function handleCards() {
    const list = selected.map((id) => articleById.get(id)).filter((a): a is Article => a !== undefined);
    if (list.length === 0) return;

    setCardBusy(true);
    setExportError(null);
    try {
      const texts = await loadTexts(list);
      const items = list.map((a) => ({
        keyword: a.keyword,
        title: a.title,
        source: a.source,
        publishedAt: a.publishedAt,
        summary: summarize(texts[a.id], a.summary, a.title),
        mentionCount: a.mentionCount,
      }));
      setCardPages(renderCardPages(items, todayLabel()));
    } catch {
      setExportError("이미지를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setCardBusy(false);
    }
  }

  // 선택한 기사를 전문이 담긴 보고서 페이지로 만든다 (PDF로 저장하는 용도)
  async function handleReport() {
    const list = selected.map((id) => articleById.get(id)).filter((a): a is Article => a !== undefined);
    if (list.length === 0) return;

    setReportBusy(true);
    setExportError(null);
    try {
      const texts = await loadTexts(list);
      setReportItems(
        list.map((a, i) => ({
          number: i + 1,
          keyword: a.keyword,
          title: a.title,
          source: a.source,
          publishedAt: a.publishedAt,
          link: a.link,
          mentionCount: a.mentionCount,
          body: texts[a.id],
          summary: summarize(texts[a.id], a.summary, a.title),
        })),
      );
      window.scrollTo(0, 0);
    } catch {
      setExportError("보고서를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setReportBusy(false);
    }
  }

  // 만든 이미지를 모두 받는다 (브라우저가 막지 않도록 간격을 두고 하나씩)
  async function downloadAllCards() {
    if (!cardPages) return;
    for (let i = 0; i < cardPages.length; i++) {
      const a = document.createElement("a");
      a.href = cardPages[i];
      a.download = `스크랩카드_${kstDateStamp()}_${i + 1}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  // 선택한 기사를 텍스트 파일로 받는다
  async function handleExport() {
    const articles = selected
      .map((id) => articleById.get(id))
      .filter((a): a is Article => a !== undefined)
      .map((a) => ({
        keyword: a.keyword,
        title: a.title,
        source: a.source,
        publishedAt: a.publishedAt,
        link: a.link,
      }));
    if (articles.length === 0) return;

    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articles }),
      });
      if (!res.ok) {
        const err = (await res.json()) as ApiError;
        setExportError(err.error?.message ?? "파일을 만들지 못했습니다. 다시 시도해 주세요.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `스크랩_${kstDateStamp()}.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("파일을 만들지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.");
    } finally {
      setExporting(false);
    }
  }

  // 시간을 바꾸면 이전 안내를 지운다
  function handleChange(setter: (value: string) => void, value: string) {
    setter(value);
    if (status === "error") {
      setStatus("idle");
      setMessage(null);
    }
  }

  const loading = status === "loading";

  // 본문을 가져오지 못해 목록에서 뺀 기사 수 (이번 검색 결과에 속한 것만 센다)
  const failedCount = data
    ? [...data.results.flatMap((r) => r.articles), ...(data.radar ?? [])].filter(
        (a) => bodies[a.id]?.state === "failed",
      ).length
    : 0;

  // 보고서 페이지가 열려 있으면 그것만 보여 준다
  if (reportItems) {
    return <ReportView items={reportItems} dateLabel={todayLabel()} onClose={() => setReportItems(null)} />;
  }

  return (
    <div className="min-h-screen pb-28">
      {/* 머리: 이름 */}
      <header className="bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-5">
          <div className="flex items-center gap-2.5">
            {/* public/logo.png 파일이 있으면 그 이미지를 보여 준다 */}
            {!logoFailed && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/logo.png" alt="" className="h-8 w-auto shrink-0" onError={() => setLogoFailed(true)} />
            )}
            <span className="text-lg font-extrabold tracking-[-0.04em]">오늘의 스크랩</span>
          </div>
          <span className="rounded-full border border-[#083891] px-3 py-1 text-xs font-medium text-[#083891]">경제구조개혁국</span>
        </div>
      </header>

      {/* 큰 제목 */}
      <div className="bg-gradient-to-b from-[#094080] to-[#052561] px-4 pb-24 pt-10 text-white">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-[46px] font-extrabold uppercase leading-[1.02] tracking-[-0.045em] sm:text-[76px]">
            Today&apos;s
            <br />
            Scrap
          </h1>
          <p className="mt-4 text-sm text-[#d6e0eb]">경제구조개혁국 관련 기사 스크랩</p>
        </div>
      </div>

      <main className="mx-auto -mt-14 w-full max-w-3xl space-y-8 px-4">
        {/* ① 검색 조건 */}
        <section className="rounded-[24px] border border-[#ebebeb] bg-white p-5 shadow-[0_10px_28px_rgba(5,37,97,0.22)]">
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-bold text-[#111111]">검색 기간</h2>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_RANGES.map((q) => (
                    <button
                      key={q.label}
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        const r = q.make();
                        handleChange(setStart, r.start);
                        handleChange(setEnd, r.end);
                      }}
                      className="rounded border border-[#ebebeb] bg-white px-2.5 py-1 text-xs font-medium text-[#555555] transition hover:border-[#083891] hover:text-[#083891] disabled:opacity-50"
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
                {[
                  { key: "start", title: "시작", value: start, set: setStart },
                  { key: "end", title: "끝", value: end, set: setEnd },
                ].flatMap((f, i) => {
                  const box = (
                    <label
                      key={f.key}
                      className={`block rounded-2xl border-2 bg-white p-3 transition focus-within:border-[#256ef4] ${
                        f.value ? "border-[#ebebeb]" : "border-dashed border-[#ebebeb]"
                      }`}
                    >
                      <span className="flex items-center gap-2 text-xs font-bold text-gray-500">
                        <span className="rounded bg-[#083891] px-1.5 py-0.5 text-white">{f.title}</span>
                        시간
                      </span>
                      <input
                        type="datetime-local"
                        value={f.value}
                        onChange={(e) => handleChange(f.set, e.target.value)}
                        disabled={loading}
                        aria-label={`${f.title} 시간`}
                        aria-invalid={status === "error"}
                        className="mt-1.5 block w-full bg-transparent text-lg font-semibold text-gray-900 focus:outline-none disabled:text-gray-400"
                      />
                      <span className="mt-1 block text-sm text-gray-600">
                        {friendlyTime(f.value) ?? "날짜와 시간을 선택해 주세요"}
                      </span>
                    </label>
                  );
                  return i === 0
                    ? [
                        box,
                        <span
                          key="arrow"
                          aria-hidden="true"
                          className="hidden items-center justify-center text-2xl text-gray-400 sm:flex"
                        >
                          →
                        </span>,
                      ]
                    : [box];
                })}
              </div>

              {/* 선택한 기간을 한 줄로 요약하고, 문제가 있으면 바로 알려 준다 */}
              {(() => {
                if (!start || !end) {
                  return <p className="mt-2 text-sm text-gray-500">시작과 끝 시간을 정하면 기간이 여기에 표시됩니다.</p>;
                }
                const problem = validateRange(start, end);
                const s = parseKst(start);
                const e = parseKst(end);
                if (problem || s === null || e === null) {
                  return (
                    <p role="status" className="mt-2 text-sm font-medium text-red-700">
                      {problem}
                    </p>
                  );
                }
                return (
                  <p className="mt-2 text-sm text-gray-700">
                    총 <strong className="text-gray-900">{durationLabel(s, e)}</strong> 동안의 기사를 찾습니다.
                    <span className="ml-1 text-gray-500">(한국시간 기준, 최대 48시간)</span>
                  </p>
                );
              })()}
            </div>

            {status === "error" && message && (
              <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-[#083891] px-8 py-3 text-sm font-bold text-white transition hover:bg-[#052561] disabled:opacity-60 sm:w-auto"
            >
              {loading ? "기사를 찾는 중입니다…" : "기사 찾기"}
            </button>
          </form>
        </section>

        {loading && (
          <div role="status" className="flex items-center gap-3 rounded-[20px] bg-white p-5 text-sm text-gray-600 border border-[#ebebeb]">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-600 border-t-transparent" />
            언론사 RSS에서 기사를 모아 키워드별로 고르고 있습니다. 5~10초 정도 걸립니다.
          </div>
        )}

        {/* ② 추천 기사 */}
        {status === "done" && data && (
          <>
            <p className="px-1 text-sm text-gray-600">
              시간 범위 안에서 기사{" "}
              <strong className="text-gray-900">{data.collectedCount.toLocaleString("ko-KR")}건</strong>을 모아
              키워드별로 골랐습니다.
              {data.failedFeedCount > 0 && ` (일부 RSS ${data.failedFeedCount}곳은 불러오지 못했습니다.)`}
              {failedCount > 0 && (
                <span className="ml-1 text-gray-500">
                  본문을 가져오지 못한 기사 {failedCount}건은 기사로 선정하지 않았습니다.
                </span>
              )}
              {analysis && (
                <span className="ml-2 text-xs text-gray-600">
                  기사 본문 분석 중 {analysis.done}/{analysis.total}
                </span>
              )}
            </p>

            {/* 놓친 이슈 레이더: 키워드 밖에서 여러 보도사가 크게 다룬 이슈 + 보도 흐름 */}
            <section className="rounded-2xl border-l-4 border-l-[#083891] bg-white p-5 border border-[#ebebeb]">
              <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold">
                <span className="rounded bg-[#083891] px-3 py-0.5 text-sm text-white">📡 놓친 이슈 레이더</span>
                <span className="text-sm font-normal text-gray-500">{radar.length}건</span>
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                7개 키워드에는 걸리지 않았지만 크게 보도된 이슈입니다. (경제·정책은 {RADAR_MIN_SOURCES}곳 이상,
                정치·사건 등은 {RADAR_BIG_ISSUE_SOURCES}곳 이상) 스크랩에 넣을지는 직접 골라 주세요.
              </p>
              {radar.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">
                  이 시간 범위에는 키워드 밖에서 크게 보도된 이슈가 없습니다.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-gray-100">
                  {radar.map((item) => {
                    const checked = selected.includes(item.id);
                    return (
                      <li key={item.id} className={`flex gap-3 py-3 ${checked ? "bg-[#ecf2fe]" : ""}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelect(item.id)}
                          aria-label={`${item.title} 선택`}
                          className="mt-1.5 h-4 w-4 shrink-0 accent-[#083891]"
                        />
                        <div className="min-w-0 flex-1">
                          {isSafeLink(item.link) ? (
                            <a
                              href={item.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold leading-snug text-gray-900 hover:text-[#083891] hover:underline"
                            >
                              {item.title}
                            </a>
                          ) : (
                            <span className="font-semibold leading-snug">{item.title}</span>
                          )}
                          <p className="mt-0.5 text-xs text-gray-500">
                            {item.source} · {formatKst(item.publishedAt)}
                            <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">
                              {item.mentionCount}곳 보도
                            </span>
                            <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
                              {item.radarKind === "big" ? "정치·사건 등 큰 이슈" : "경제·정책"}
                            </span>
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {data.results.map((result) => {
              const style = KEYWORD_STYLE[result.keyword];
              // 본문을 가져오지 못한 기사는 기사로 선정하지 않고 목록에서 뺀다 (언급량 계산에는 이미 쓰였다)
              const shown = result.articles.filter((a) => bodies[a.id]?.state !== "failed");
              return (
                <section
                  key={result.keyword}
                  className={`rounded-[20px] border-l-4 bg-white p-5 border border-[#ebebeb] ${style.bar}`}
                >
                  <h2 className="flex items-center gap-2 text-lg font-bold">
                    <span className={`rounded px-3 py-0.5 text-sm ${style.chip}`}>{result.keyword}</span>
                    <span className="text-sm font-normal text-gray-500">{shown.length}건</span>
                  </h2>

                  {shown.length === 0 && (
                    <p className="mt-3 text-sm text-gray-500">이 시간 범위에는 관련 기사를 찾지 못했습니다.</p>
                  )}
                  {result.short && shown.length > 0 && (
                    <p className="mt-3 rounded-2xl bg-gray-100 px-3 py-1.5 text-sm text-gray-700">
                      후보가 {MIN_ARTICLES_PER_KEYWORD}건에 못 미쳐 있는 만큼만 보여 드립니다.
                    </p>
                  )}

                  <ul className="mt-3 divide-y divide-gray-100">
                    {shown.map((article) => {
                      const checked = selected.includes(article.id);
                      return (
                        <li key={article.id} className={`flex gap-3 py-3 ${checked ? "bg-[#ecf2fe]" : ""}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSelect(article.id)}
                            aria-label={`${article.title} 선택`}
                            className="mt-1.5 h-4 w-4 shrink-0 accent-[#083891]"
                          />
                          <div className="min-w-0 flex-1">
                            {isSafeLink(article.link) ? (
                              <a
                                href={article.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-semibold leading-snug text-gray-900 hover:text-[#083891] hover:underline"
                              >
                                {article.title}
                              </a>
                            ) : (
                              <span className="font-semibold leading-snug">{article.title}</span>
                            )}
                            <p className="mt-0.5 text-xs text-gray-500">
                              {article.source} · {formatKst(article.publishedAt)}
                              {article.mentionCount > 1 && (
                                <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
                                  같은 이슈 {article.mentionCount}곳 보도
                                </span>
                              )}
                            </p>
                            {article.score && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                                <span className="rounded bg-[#083891] px-2.5 py-0.5 font-semibold text-white">
                                  총점 {article.score.total}
                                </span>
                                {[
                                  { label: "업무 관련성", value: article.score.work, max: SCORE_WEIGHTS.work },
                                  { label: "키워드", value: article.score.keyword, max: SCORE_WEIGHTS.keyword },
                                  { label: "언급량", value: article.score.mention, max: SCORE_WEIGHTS.mention },
                                  { label: "정책", value: article.score.policy, max: SCORE_WEIGHTS.policy },
                                ].map((part) => (
                                  <span
                                    key={part.label}
                                    className={`rounded px-1.5 py-0.5 ${
                                      part.value > 0 ? "bg-gray-100 text-gray-800" : "bg-gray-100 text-gray-400"
                                    }`}
                                  >
                                    {part.label} <strong>{part.value}</strong>/{part.max}
                                  </span>
                                ))}
                                {article.score.penalty > 0 && (
                                  <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">
                                    사설·칼럼 −{article.score.penalty}
                                  </span>
                                )}
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleBody(article)}
                              className="mt-1.5 text-xs font-medium text-[#083891] hover:underline"
                            >
                              {open[article.id] ? "본문 접기 ▲" : "본문 펼치기 ▼"}
                            </button>
                            {open[article.id] && (
                              <div className="mt-2 max-h-96 overflow-y-auto rounded-2xl bg-gray-50 p-3 text-sm leading-relaxed text-gray-800 ring-1 ring-gray-200">
                                {bodies[article.id]?.state === "loading" && (
                                  <p className="text-gray-500">본문을 가져오는 중입니다…</p>
                                )}
                                {bodies[article.id]?.state === "failed" && (
                                  <p className="text-gray-600">
                                    본문을 가져오지 못했습니다.
                                    {article.summary ? ` 요약: ${article.summary}` : ""} 위 제목의 원문 링크를
                                    이용해 주세요.
                                  </p>
                                )}
                                {(() => {
                                  const b = bodies[article.id];
                                  if (b?.state !== "ok") return null;
                                  const ex = b.extras;
                                  return (
                                    <>
                                      {ex && ex.terms.length > 0 && (
                                        <div className="mb-3 rounded-2xl bg-gray-100 p-2.5 text-xs text-gray-800">
                                          <p className="mb-1 font-semibold">
                                            📖 용어 풀이 <span className="font-normal text-gray-500">(초안, 검수 필요)</span>
                                          </p>
                                          <ul className="space-y-0.5">
                                            {ex.terms.map((t) => (
                                              <li key={t.term}>
                                                <strong>{t.term}</strong>: {t.explanation}
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}
                                      {ex && ex.quotes.length > 0 && (
                                        <div className="mb-3 rounded-2xl bg-gray-100 p-2.5 text-xs text-gray-800">
                                          <p className="mb-1 font-semibold">
                                            💬 발언 <span className="font-normal text-gray-500">(참고용 추출)</span>
                                          </p>
                                          <ul className="space-y-1">
                                            {ex.quotes.map((q) => (
                                              <li key={q.text.slice(0, 16)}>
                                                {q.speaker && <strong>{q.speaker}: </strong>}“{q.text}”
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}
                                      <p className="whitespace-pre-wrap">{b.body}</p>
                                    </>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}

            {/* ③ 선택한 기사 */}
            <section id="selected" className="scroll-mt-20 rounded-[20px] border border-[#ebebeb] bg-white p-5">
              <h2 className="text-lg font-bold">
                선택한 기사 <span className="text-sm font-normal text-gray-500">{selected.length}건</span>
              </h2>

              {selected.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">위 목록에서 스크랩할 기사를 체크해 주세요.</p>
              ) : (
                <ol className="mt-3 space-y-2">
                  {selected.map((id, index) => {
                    const article = articleById.get(id);
                    if (!article) return null;
                    return (
                      <li key={id} className="flex items-center gap-2 rounded-2xl bg-gray-50 px-3 py-2 text-sm">
                        <span className="w-6 shrink-0 font-semibold text-[#083891]">{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate">
                          <span className={`mr-1.5 rounded px-2 py-0.5 text-xs ${
                            article.keyword === "기타" ? "bg-gray-200 text-gray-800" : KEYWORD_STYLE[article.keyword].chip
                          }`}>
                            {article.keyword}
                          </span>
                          {article.title}
                          <span className="text-gray-500"> · {article.source}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => move(id, -1)}
                          disabled={index === 0}
                          aria-label="위로"
                          className="rounded border border-gray-300 bg-white px-2 py-0.5 disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => move(id, 1)}
                          disabled={index === selected.length - 1}
                          aria-label="아래로"
                          className="rounded border border-gray-300 bg-white px-2 py-0.5 disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleSelect(id)}
                          className="rounded border border-gray-300 bg-white px-2 py-0.5 text-red-700"
                        >
                          제거
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}

              {exportError && (
                <p role="alert" className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {exportError}
                </p>
              )}
            </section>
          </>
        )}
      </main>

      <footer className="mt-10 border-t border-[#ebebeb] bg-[#f4f5f6] px-4 py-6 text-xs text-[#6d7882]">
        <div className="mx-auto max-w-3xl space-y-1">
          <p className="text-sm font-bold text-[#555555]">오늘의 스크랩</p>
          <p>내부 업무용 도구입니다. 기사 선별 결과·요약·점수는 참고용이므로 원문을 확인해 주세요. 기사의 저작권은 각 언론사에 있습니다.</p>
        </div>
      </footer>

      {/* 화면 아래에 항상 떠 있는 파일 받기 줄 */}
      {status === "done" && data && (
        <div className="fixed inset-x-0 bottom-0 border-t border-[#ebebeb] bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <p className="text-sm text-gray-700">
              선택한 기사 <strong className="text-[#083891]">{selected.length}건</strong>
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={handleCards}
                disabled={selected.length === 0 || cardBusy}
                className="rounded-2xl border border-[#083891] bg-white px-4 py-2 text-sm font-semibold text-[#083891] shadow-sm transition hover:bg-gray-100 disabled:opacity-40"
              >
                {cardBusy ? "이미지를 만드는 중…" : "한눈에 보기 이미지 만들기"}
              </button>
              <button
                type="button"
                onClick={handleReport}
                disabled={selected.length === 0 || reportBusy}
                className="rounded-2xl border border-[#083891] bg-white px-4 py-2 text-sm font-semibold text-[#083891] transition hover:bg-[#ecf2fe] disabled:opacity-40"
              >
                {reportBusy ? "보고서를 만드는 중…" : "보고서 보기 (PDF 저장)"}
              </button>
              <button
                type="button"
                onClick={handleExport}
                disabled={selected.length === 0 || exporting}
                className="rounded-2xl bg-[#083891] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#052561] disabled:opacity-40"
              >
                {exporting ? "파일을 만드는 중입니다…" : "텍스트 파일로 받기 (.txt)"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 카드뉴스 이미지 미리보기 */}
      {cardPages && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="카드뉴스 이미지 미리보기"
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
        >
          <div className="my-4 w-full max-w-xl rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold">
                한눈에 보기 이미지 <span className="text-sm font-normal text-gray-500">A4 {cardPages.length}장</span>
              </h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={downloadAllCards}
                  className="rounded-2xl bg-[#083891] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#052561]"
                >
                  모두 받기 (.png)
                </button>
                <button
                  type="button"
                  onClick={() => setCardPages(null)}
                  className="rounded-2xl border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
                >
                  닫기
                </button>
              </div>
            </div>
            <p className="mb-3 text-xs text-gray-500">
              선택한 기사 전체를 A4 크기 이미지로 모았습니다. 한글 문서 맨 앞에 붙여 넣어 쓰세요. 카드 번호는
              스크랩 파일의 기사 번호와 같습니다. 이미지는 이 브라우저 안에서만 만들어지며 서버에 저장되지 않고,
              요약은 본문 앞부분을 자동으로 고른 것이므로 보고 전에 확인해 주세요.
            </p>
            <div className="space-y-4">
              {cardPages.map((url, i) => (
                <div key={i}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`카드뉴스 ${i + 1}쪽`} className="w-full rounded-2xl ring-1 ring-gray-200" />
                  <a
                    href={url}
                    download={`스크랩카드_${kstDateStamp()}_${i + 1}.png`}
                    className="mt-1.5 inline-block text-sm font-medium text-[#083891] hover:underline"
                  >
                    {i + 1}쪽 이미지 받기
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
