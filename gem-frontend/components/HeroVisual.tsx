'use client';

import { useEffect, useState } from "react";
import { CheckCircle, Building2, Cpu, History } from "lucide-react";


export default function HeroInsight() {
    const TARGET_SCORE = 92;
const [score, setScore] = useState(0);

useEffect(() => {
  let start: number | null = null;
  const duration = 850; // animation duration in ms

  const animate = (timestamp: number) => {
    if (!start) start = timestamp;
    const progress = Math.min((timestamp - start) / duration, 1);

    // easeOutCubic for smooth finish
    const eased = 1 - Math.pow(1 - progress, 3);
    setScore(Math.round(eased * TARGET_SCORE));

    if (progress < 1) {
      requestAnimationFrame(animate);
    }
  };

  requestAnimationFrame(animate);
}, []);

  return (
    <div
    className="
        group relative w-full
        transition-transform duration-500 ease-out

        [@media(pointer:fine)]:hover:-translate-y-1
        [@media(pointer:fine)]:motion-safe:hover:[transform:translateY(-4px)_rotateX(1deg)_rotateY(-1deg)]
    "
    >

        <div
        className="
            relative rounded-3xl bg-white p-10
            shadow-[0_40px_90px_rgba(0,0,0,0.12)]
            transition-shadow duration-500
            [@media(pointer:fine)]:group-hover:shadow-[0_48px_120px_rgba(0,0,0,0.18)]
            motion-reduce:transition-none

        "
        >

        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">
            Live TenderBot Intelligence
          </span>
          <span className="rounded-full bg-black px-4 py-1.5 text-xs text-white">
            Active
          </span>
        </div>

        {/* Core layout */}
        <div className="grid grid-cols-[1fr_auto] gap-12 items-start">

          {/* Left signals */}
          <div className="space-y-7">
            <div className="flex items-center gap-3">
              <Cpu className="h-5 w-5 text-gray-500" />
              <span className="text-base font-semibold text-black">
                Networking Equipment
              </span>
            </div>

            <div className="flex items-center gap-3">
              <Building2 className="h-5 w-5 text-gray-500" />
              <span className="text-sm text-gray-600">
                Ministry of Electronics & IT
              </span>
            </div>

            <div className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-[#F5C84C]" />
              <span className="text-sm font-medium text-gray-700">
                Matches your product catalogue
              </span>
            </div>

            {/* Product fit — micro visual */}
            <div className="pt-2 space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Relevance signals
              </p>

              <div className="space-y-2 max-w-[260px]">
                {[
                  { label: "Product fit", value: 4 },
                  { label: "Past awards", value: 5 },
                  { label: "Category overlap", value: 3 },
                  { label: "Value range", value: 4 },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center gap-3"
                  >
                    <span className="w-32 text-xs text-gray-600">
                      {item.label}
                    </span>

                    <div className="flex gap-1">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <span
                          key={i}
                          className={`
                            h-2 w-3 rounded-sm
                            ${i < item.value
                              ? "bg-[#F5C84C]"
                              : "bg-gray-200"}
                          `}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right intelligence column */}
          <div className="flex flex-col items-center gap-6">

            {/* Relevance core */}
            <div className="relative">
                <div
                className="
                    absolute inset-0 rounded-2xl
                    bg-[#F5C84C]/30 blur-2xl
                    transition-all duration-500

                    [@media(pointer:fine)]:group-hover:bg-[#F5C84C]/40
                    [@media(pointer:fine)]:group-hover:blur-3xl
                "
                />


                <div
                className="
                    relative rounded-2xl bg-[#FFF7DD] px-7 py-6 text-center shadow
                    motion-safe:animate-[score-pop_0.9s_ease-out]
                "
                >
                <span className="inline-block rounded-full bg-[#F5C84C] px-3 py-1 text-xs font-medium text-black mb-3">
                  Strong match
                </span>
                <p className="text-4xl font-semibold text-black tabular-nums">
                {score}%
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  Relevance score
                </p>
              </div>
            </div>

            {/* Past tenders */}
            <div className="w-full max-w-[220px] pt-2">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium text-gray-500">
                <History className="h-4 w-4" />
                Relevant past tenders
              </div>

              <div className="space-y-3 border-l border-[#F5C84C]/40 pl-4">
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    Networking Equipment
                  </p>
                  <p className="text-xs text-gray-500">
                    ₹46L · Awarded
                  </p>
                </div>

                <div>
                  <p className="text-sm font-medium text-gray-800">
                    Data Center Hardware
                  </p>
                  <p className="text-xs text-gray-500">
                    ₹1.1Cr · Awarded
                  </p>
                </div>

                <div>
                  <p className="text-sm font-medium text-gray-800">
                    Cloud Services
                  </p>
                  <p className="text-xs text-gray-500">
                    ₹92L · Similar scope
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Depth */}
      <div className="pointer-events-none absolute -right-6 -bottom-6 h-full w-full rounded-3xl bg-black/5" />
    </div>
  );
}
