import { Check } from "lucide-react";

const features = [
  "Match active tenders with past outcomes",
  "Analyze awarded values and patterns",
  "Get clear, actionable recommendations",
  "Make confident, data-driven bidding decisions",
];

export default function AISection() {
  return (
    <section id="ai-insights" className="bg-black">
      <div className="mx-auto max-w-7xl px-6 py-20 text-center">

        {/* Coming soon pill */}
        <div className="mb-6 flex justify-center">
          <span className="rounded-full bg-[#F5C84C] px-4 py-1 text-xs font-semibold tracking-wide text-black">
            COMING SOON
          </span>
        </div>

        {/* Heading */}
        <h2 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          AI-powered bidding insights
        </h2>

        {/* Description */}
        <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-gray-400">
          Tenderbot is building an AI layer that connects active tenders with
          historically similar tenders whose results have already been
          published.
        </p>

        {/* Feature grid — FORCE single row on desktop */}
        <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((text, idx) => (
                <div
                key={idx}
                className="
                    group flex items-center gap-3 rounded-lg
                    bg-[#0F0F0F] px-6 py-5
                    shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]
                    transition-all duration-300 ease-out
                    hover:-translate-y-1
                    hover:shadow-[0_12px_32px_rgba(245,200,76,0.25),inset_0_0_0_1px_#F5C84C]
                "
                >

              <Check className="h-5 w-5 text-[#F5C84C]" />
              <span className="text-left text-sm text-gray-200">
                {text}
              </span>
            </div>
          ))}
        </div>

        {/* Footer tagline */}
        <p className="mt-20 text-sm font-medium text-gray-400">
          Less guesswork.{" "}
          <span className="text-white">More winning bids.</span>
        </p>

        {/* Yellow underline */}
        <div className="mx-auto mt-3 h-[2px] w-16 bg-[#F5C84C]" />
      </div>
    </section>
  );
}
