import Link from "next/link";

export default function FinalCTA() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-4xl px-6 py-24 text-center">

        {/* Headline */}
        <h2 className="text-4xl font-semibold tracking-tight text-black sm:text-5xl">
          Stop chasing tenders.
          <br />
          Start bidding smarter.
        </h2>

        {/* CTA */}
        <div className="mt-12">
          <Link
            href="/signup"
            className="
              inline-flex h-14 min-w-[240px] items-center justify-center
              rounded-md bg-[#F5C84C] px-10
              text-[18px] font-semibold text-black
              shadow-[0_8px_24px_rgba(245,200,76,0.35)]
              transition-all duration-300 ease-out
              hover:-translate-y-0.5
              hover:bg-[#e6b93f]
              hover:shadow-[0_12px_32px_rgba(245,200,76,0.45)]
              focus:outline-none focus:ring-2 focus:ring-black/20
            "
          >
            Try Tenderbot Free
          </Link>
        </div>

      </div>
    </section>
  );
}
