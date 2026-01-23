import Link from "next/link";
import Image from "next/image";
import { Check } from "lucide-react";

export default function Hero() {
  return (
    <section className="bg-white">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-20 px-6 pt-12 pb-28 md:grid-cols-[1.15fr_0.85fr]">

        {/* Left column */}
        <div>
            <h1 className="text-5xl font-semibold leading-tight tracking-tight text-black">
            All GeM tenders.
            <br />
            One intelligent workspace.
            </h1>


          <p className="mt-8 max-w-xl text-[17px] leading-relaxed text-gray-600">
            Tenderbot brings together tenders from GeM and other government
            procurement portals into one seamless platform — with instant
            summaries, hosted documents, and insights designed to power smarter
            bids.
          </p>

          {/* Checklist */}
          <ul className="mt-10 space-y-4">
            <li className="flex items-start gap-3 text-[15px] text-gray-700">
              <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#F5C84C]">
                <Check className="h-3.5 w-3.5 text-black" />
              </span>
              See key tender details before opening PDFs
            </li>
            <li className="flex items-start gap-3 text-[15px] text-gray-700">
              <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#F5C84C]">
                <Check className="h-3.5 w-3.5 text-black" />
              </span>
              Access all documents directly within the platform
            </li>
            <li className="flex items-start gap-3 text-[15px] text-gray-700">
              <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#F5C84C]">
                <Check className="h-3.5 w-3.5 text-black" />
              </span>
              Save hours of manual effort on every tender cycle
            </li>
          </ul>

          {/* CTAs — reused, rectangular rounded */}
          <div className="mt-14 flex flex-wrap items-center gap-6">
            {/* Primary CTA — Sign Up */}
            <Link
              href="/signup"
              className="
                relative inline-flex h-14 min-w-[180px] items-center justify-center
                rounded-md bg-black px-10
                text-[18px] font-normal text-white
                overflow-hidden
                shadow-[0_8px_24px_rgba(0,0,0,0.18)]
                transition-all hover:bg-neutral-900
                hover:shadow-[0_10px_30px_rgba(0,0,0,0.22)]
                hover:-translate-y-0.5
                focus:outline-none focus:ring-2 focus:ring-[#F5C84C]/40
              "
            >
              <span
                aria-hidden
                className="
                  pointer-events-none absolute inset-0
                  -translate-x-full
                  bg-gradient-to-r
                  from-transparent
                  via-white/25
                  to-transparent
                  animate-[cta-shine_3.2s_ease-in-out_infinite]
                "
              />
              <span className="relative z-10">Sign Up</span>
            </Link>

            {/* Secondary CTA — Login */}
            <Link
              href="/login"
              className="
                inline-flex h-14 min-w-[180px] items-center justify-center
                rounded-md bg-[#F5C84C] px-10
                text-[18px] font-normal text-black
                shadow-[0_8px_24px_rgba(245,200,76,0.35)]
                transition-all hover:bg-[#e6b93f]
                hover:shadow-[0_10px_30px_rgba(245,200,76,0.45)]
                hover:-translate-y-0.5
                focus:outline-none focus:ring-2 focus:ring-black/20
              "
            >
              Login
            </Link>
          </div>
        </div>

        {/* Right column — dashboard visual */}
        <div className="flex items-center justify-start md:-ml-[6%]">
        <Image
            src="/dash2.png"
            alt="Tenderbot dashboard preview"
            width={1200}
            height={750}
            priority
            className="
            w-full md:w-[125%] max-w-none
            drop-shadow-[0_24px_48px_rgba(0,0,0,0.22)]
            transition-transform duration-300
            hover:-translate-y-1
            "
        />
        </div>
        </div>
    </section>
  );
}
