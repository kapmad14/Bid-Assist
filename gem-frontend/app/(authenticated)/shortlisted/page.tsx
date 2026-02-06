'use client';

import { useEffect, useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";

import TendersExplorer from "@/app/(authenticated)/_components/tenders/TendersExplorer";

export default function ShortlistedPage() {
  const [showModal, setShowModal] = useState(false);

  // ✅ Check shortlist count on page load
  useEffect(() => {
    async function checkShortlist() {
      try {
        const res = await fetch("/api/shortlist/count");
        const data = await res.json();

        if (data.count === 0) {
          setShowModal(true);
        }
      } catch (err) {
        console.error("Failed to check shortlist count", err);
      }
    }

    checkShortlist();
  }, []);

  return (
    <>
      {/* ✅ Modal shown only when shortlist = 0 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">

            <Star className="w-12 h-12 text-yellow-500 mx-auto mb-4" />

            <h2 className="text-xl font-bold text-gray-900">
              No shortlisted tenders yet
            </h2>

            <p className="text-gray-600 mt-2">
              Click ⭐ Shortlist on any tender and it will appear here.
            </p>

            <div className="mt-6 flex flex-col gap-3">
              <Link
                href="/tenders2"
                className="px-5 py-2 rounded-lg bg-yellow-600 text-white font-semibold hover:bg-yellow-700"
              >
                Browse Active Tenders
              </Link>

              <button
                onClick={() => setShowModal(false)}
                className="text-gray-500 hover:underline text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ Explorer stays untouched */}
      <TendersExplorer mode="shortlisted" />
    </>
  );
}
