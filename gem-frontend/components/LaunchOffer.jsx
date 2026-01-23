import Link from "next/link";

export default function LaunchOffer() {
  return (
    <section className="bg-[#F5C84C]">
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">

        {/* Headline */}
        <h2 className="text-4xl font-semibold tracking-tight text-black sm:text-5xl">
          Free during launch
        </h2>

        {/* Description */}
        <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-black/80">
          Tenderbot is currently free to use during our launch phase.
          <br />
          Explore the platform, evaluate real tenders, and experience the
          workflow — with no cost.
        </p>

        {/* CTA */}
        <div className="mt-12">
          <Link
            href="/signup"
            className="
              inline-flex h-14 min-w-[260px] items-center justify-center
              rounded-md bg-black px-10
              text-[18px] font-normal text-white
              shadow-[0_8px_24px_rgba(0,0,0,0.25)]
              transition-all duration-300 ease-out
              hover:-translate-y-0.5
              hover:shadow-[0_12px_32px_rgba(0,0,0,0.35)]
              focus:outline-none focus:ring-2 focus:ring-black/30
            "
          >
            Get Started — Book a Demo
          </Link>
        </div>

        {/* Footnote */}
        <p className="mt-6 text-sm text-black/70">
          No credit card required
        </p>

      </div>
    </section>
  );
}
