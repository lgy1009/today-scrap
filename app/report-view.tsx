"use client";

// 보고서 페이지: 선택한 기사를 "한눈에 보기 + 기사 전문"으로 한 문서에 담아 보여 준다.
// 브라우저의 인쇄 기능으로 "PDF로 저장"하는 용도다. (서버로 보내거나 저장하지 않는다)

import { KEYWORD_COLOR } from "@/lib/cardnews";
import { kstDateStamp } from "@/lib/textfile";
import { buildWordHtml } from "@/lib/worddoc";

export type ReportItem = {
  number: number; // 스크랩 파일의 기사 번호와 같다
  keyword: string;
  title: string;
  source: string;
  publishedAt: string; // UTC ISO
  link: string;
  mentionCount: number;
  body: string | null; // 본문을 가져오지 못했으면 null
  summary: string;
};

const KEYWORD_ORDER = ["노동", "교육", "청년", "인구", "연금", "AI", "양극화", "기타"];

function kst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function isSafeLink(link: string): boolean {
  return link.startsWith("https://") || link.startsWith("http://");
}

export default function ReportView({
  items,
  dateLabel,
  onClose,
}: {
  items: ReportItem[];
  dateLabel: string;
  onClose: () => void;
}) {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.keyword, (counts.get(it.keyword) ?? 0) + 1);
  const keys = KEYWORD_ORDER.filter((k) => counts.has(k));

  // 워드 파일(.doc)로 받는다: 워드에서 사진을 붙이거나 원문을 고친 뒤 PDF로 변환할 수 있다
  function downloadWord() {
    // 맨 앞의 BOM은 워드가 한글을 올바르게 읽도록 돕는다
    const html = "﻿" + buildWordHtml(items, dateLabel);
    const blob = new Blob([html], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `스크랩_${kstDateStamp()}.doc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <div className="report-root min-h-screen bg-[#f4f5f6] print:bg-white">
      {/* 화면에서만 보이는 도구 줄 (인쇄·PDF에는 나오지 않는다) */}
      <div className="no-print sticky top-0 z-30 border-b border-[#cdd1d5] bg-white">
        <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-2 px-4 py-3">
          <p className="text-sm text-[#464c53]">
            기사 {items.length}건 · 아래 <strong>&quot;PDF로 저장&quot;</strong>을 누르고, 인쇄 창의 대상(프린터)을{" "}
            <strong>&quot;PDF로 저장&quot;</strong>으로 선택해 주세요.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={downloadWord}
              className="rounded-lg border border-[#083891] bg-white px-4 py-2 text-sm font-bold text-[#083891] transition hover:bg-[#ecf2fe]"
            >
              워드 파일로 받기 (.doc)
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg bg-[#083891] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#052561]"
            >
              PDF로 저장
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#cdd1d5] bg-white px-4 py-2 text-sm font-medium text-[#464c53] hover:bg-[#f4f5f6]"
            >
              돌아가기
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[210mm] space-y-6 px-4 py-6 print:space-y-0 print:p-0">
        {/* 1쪽: 표지와 한눈에 보기 */}
        <section className="report-page bg-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] print:shadow-none">
          <div className="report-navy flex flex-wrap items-end justify-between gap-2 border-b-[6px] border-[#083891] px-8 pb-5 pt-8">
            <div className="border-l-8 border-[#083891] pl-4">
              <h1 className="text-3xl font-bold tracking-tight text-[#052561]">오늘의 스크랩</h1>
              <p className="mt-1 text-sm text-[#58616a]">경제구조개혁국 관련 기사 스크랩</p>
            </div>
            <div className="text-right">
              <p className="text-xl font-bold text-[#1e2124]">{dateLabel}</p>
              <p className="text-sm text-[#58616a]">기사 {items.length}건</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-[#dfe3e8] px-8 py-3 text-sm">
            {keys.map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span
                  className="report-color inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: KEYWORD_COLOR[k] ?? "#475569" }}
                />
                <strong className="text-[#1e2124]">{k}</strong>
                <span className="text-[#58616a]">{counts.get(k)}</span>
              </span>
            ))}
          </div>

          <ol className="grid grid-cols-2 gap-3 px-8 py-6">
            {items.map((it) => {
              const color = KEYWORD_COLOR[it.keyword] ?? "#475569";
              return (
                <li
                  key={it.number}
                  className="report-card break-inside-avoid rounded-lg border border-[#dfe3e8] bg-white"
                  style={{ borderTop: `4px solid ${color}` }}
                >
                  <div className="p-3">
                    <p className="flex items-center gap-2">
                      <span className="text-lg font-bold text-[#083891]">{String(it.number).padStart(2, "0")}</span>
                      <span
                        className="rounded-full border px-2 py-0 text-[11px] font-bold"
                        style={{ borderColor: color, color }}
                      >
                        {it.keyword}
                      </span>
                    </p>
                    <p className="mt-1 text-[13px] font-bold leading-snug text-[#1e2124]">{it.title}</p>
                    {it.summary && (
                      <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-[#58616a]">{it.summary}</p>
                    )}
                    <p className="mt-2 flex justify-between border-t border-[#dfe3e8] pt-1.5 text-[10.5px] text-[#6d7882]">
                      <span>
                        <strong className="text-[#58616a]">{it.source}</strong> · {kst(it.publishedAt).slice(6)}
                      </span>
                      {it.mentionCount > 1 && (
                        <strong className="text-[#083891]">{it.mentionCount}곳 보도</strong>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {/* 기사별 전문: 기사마다 새 쪽에서 시작 */}
        {items.map((it) => {
          const color = KEYWORD_COLOR[it.keyword] ?? "#475569";
          const paragraphs = (it.body ?? "")
            .split(/\n+/)
            .map((p) => p.trim())
            .filter(Boolean);
          return (
            <article
              key={it.number}
              // 인쇄(PDF 저장) 때 기사마다 새 쪽의 맨 위에서 시작한다
              style={{ breakBefore: "page", pageBreakBefore: "always" }}
              className="report-page report-article bg-white px-8 py-8 shadow-[0_1px_4px_rgba(0,0,0,0.08)] print:shadow-none"
            >
              <div className="flex items-center gap-2 border-b-[3px] pb-2" style={{ borderColor: color }}>
                <span className="text-2xl font-bold text-[#083891]">{String(it.number).padStart(2, "0")}</span>
                <span className="rounded-full border px-2.5 py-0.5 text-xs font-bold" style={{ borderColor: color, color }}>
                  {it.keyword}
                </span>
              </div>

              <h2 className="mt-4 text-[22px] font-bold leading-snug text-[#1e2124]">{it.title}</h2>
              <p className="mt-2 text-sm text-[#58616a]">
                <strong className="text-[#1e2124]">{it.source}</strong> · 입력 {kst(it.publishedAt)}
                {it.mentionCount > 1 && <span className="ml-2 font-bold text-[#083891]">{it.mentionCount}곳 보도</span>}
              </p>
              {isSafeLink(it.link) && (
                <p className="mt-1 break-all text-xs text-[#6d7882]">원문: {it.link}</p>
              )}

              <div className="mt-5 border-t border-[#dfe3e8] pt-5 text-[14px] leading-[1.85] text-[#1e2124]">
                {paragraphs.length > 0 ? (
                  paragraphs.map((p, i) => (
                    <p key={i} className="mb-3">
                      {p}
                    </p>
                  ))
                ) : (
                  <p className="text-[#58616a]">
                    본문을 가져오지 못했습니다. 위 원문 링크를 참고해 주세요.
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
