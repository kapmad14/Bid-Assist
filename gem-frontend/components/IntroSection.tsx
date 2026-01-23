export default function IntroSection() {
  return (
    <section className="bg-[#F8F8F5]">
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">

        {/* Top positioning lines — same style as body */}
        <p className="text-[17px] leading-relaxed text-gray-600">
          Built for businesses participating in government procurement across India.
        </p>
        <p className="mt-2 text-[17px] leading-relaxed text-gray-600">
          Designed with SME and enterprise workflows in mind.
        </p>

        {/* Eyebrow */}
        <p className="mt-10 text-[13px] font-medium tracking-widest text-gray-500">
          MEET TENDERBOT
        </p>

        {/* Main headline */}
        <h2 className="mt-4 text-4xl font-semibold tracking-tight text-black sm:text-5xl">
          Tender intelligence, without the chaos.
        </h2>

        {/* Supporting copy */}
        <p className="mt-6 text-[17px] leading-relaxed text-gray-600">
          Tenderbot centralizes live tenders from GeM and other procurement
          platforms into a single, streamlined workspace — so teams can
          evaluate, compare, and act faster.
        </p>

      </div>
    </section>
  );
}
