import { Globe, Zap, FileText, Target } from "lucide-react";

const features = [
  {
    icon: Globe,
    title: "Everything in one place",
    description:
      "View live tenders from GeM and other government procurement channels without jumping between portals.",
  },
  {
    icon: Zap,
    title: "Understand tenders in seconds",
    description:
      "Each tender is carefully summarized so you can assess scope, eligibility, value, and requirements before opening the full document.",
  },
  {
    icon: FileText,
    title: "No downloads. No switching tabs.",
    description:
      "All tender documents and PDFs are hosted directly within Tenderbot for faster review and collaboration.",
  },
  {
    icon: Target,
    title: "Built for speed and clarity",
    description:
      "Reduce manual effort, avoid missed details, and focus only on tenders that truly matter.",
  },
];

export default function FeatureGrid() {
  return (
    <section id="features" className="bg-white">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, idx) => (
                <div
                key={idx}
                className="
                    group rounded-xl bg-white p-8
                    shadow-[inset_0_0_0_1px_rgba(0,0,0,0.11)]
                    transition-all duration-300 ease-out
                    hover:-translate-y-1
                    hover:shadow-[0_12px_32px_rgba(245,200,76,0.25),inset_0_0_0_1px_#F5C84C]
                "
                >

              {/* Icon */}
                <div
                className="
                    mb-6 flex h-12 w-12 items-center justify-center
                    rounded-lg bg-gray-100
                    transition-colors duration-300
                    group-hover:bg-[#F5C84C]/30
                "
                >
                <feature.icon className="h-6 w-6 text-black" />
                </div>


              {/* Title */}
              <h3 className="text-lg font-semibold text-black">
                {feature.title}
              </h3>

              {/* Description */}
              <p className="mt-3 text-[15px] leading-relaxed text-gray-600">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
