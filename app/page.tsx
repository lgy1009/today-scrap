"use client";

import dynamic from "next/dynamic";

// 보관된 화면(뒤로 가기·새로고침 후 복원)은 브라우저에서만 읽을 수 있어 서버 렌더링 없이 불러온다
const ScrapApp = dynamic(() => import("./scrap-app"), {
  ssr: false,
  loading: () => <p className="p-8 text-center text-sm text-gray-500">화면을 불러오는 중입니다…</p>,
});

export default function Home() {
  return <ScrapApp />;
}
