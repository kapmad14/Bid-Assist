import {
  UserPlus,
  Bookmark,
  Package,
  BarChart3,
} from "lucide-react";

const steps = [
  {
    title: "Get access",
    description:
      "Sign up and instantly access all active, published GeM tenders — free during launch.",
    icon: UserPlus,
  },
  {
    title: "Track what matters",
    description:
      "Shortlist tenders you care about and stay updated without manual monitoring.",
    icon: Bookmark,
  },
  {
    title: "Customize your catalogue",
    description:
      "Add your products and services to receive relevant, tailored tender recommendations.",
    icon: Package,
  },
  {
    title: "Bid smarter",
    description:
      "Analyze published results and upcoming AI insights to improve bid decisions.",
    icon: BarChart3,
    comingSoon: true,
  },
];

export default function HowItWorksFlow() {
  return (
    <section id="how-it-works" className="bg-white">
      <div className="mx-auto max-w-7xl px-6 py-24">

        {/* Header */}
        <div className="mx-auto mb-20 max-w-3xl text-center">
          <h2 className="text-4xl font-semibold tracking-tight text-black sm:text-5xl">
            How it works
          </h2>
          <p className="mt-4 text-[17px] text-gray-600">
            A simple workflow designed to reduce effort and help you bid with confidence.
          </p>
        </div>

        {/* Steps */}
        <div className="grid grid-cols-1 gap-14 md:grid-cols-4">

          {steps.map((step, index) => (
            <div
              key={index}
              className="
                flex flex-col items-center text-center
                transition-all duration-300
                hover:-translate-y-1
              "
            >
              {/* Icon */}
              <div
                className="
                  mb-6 flex h-16 w-16 items-center justify-center
                  rounded-full bg-[#F5C84C]
                  shadow-[0_8px_24px_rgba(245,200,76,0.45)]
                  transition-all duration-300
                  group-hover:shadow-[0_12px_32px_rgba(245,200,76,0.6)]
                "
              >
                <step.icon className="h-8 w-8 text-white" />
              </div>

              {/* Title */}
              <h3 className="text-lg font-semibold text-black">
                {step.title}
              </h3>

              {/* Description */}
              <p className="mt-2 text-[15px] leading-relaxed text-gray-600">
                {step.description}
              </p>

              {step.comingSoon && (
                <span className="mt-3 inline-block rounded-full bg-[#F5C84C]/20 px-3 py-1 text-xs font-medium text-black">
                  AI coming soon
                </span>
              )}
            </div>
          ))}

        </div>
      </div>
    </section>
  );
}
