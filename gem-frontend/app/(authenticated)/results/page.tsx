import { Suspense } from "react";
import ResultsPageClient from "./ResultsPageClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Loading results...</div>}>
      <ResultsPageClient />
    </Suspense>
  );
}
