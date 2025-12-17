import { Suspense } from "react";
import TendersPageClient from "./TendersPageClient";

export default function Page() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TendersPageClient />
    </Suspense>
  );
}
