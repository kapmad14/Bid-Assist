'use client';

import { useState } from "react";

import { MarketingHeader } from '@/components/marketing-header';
import Hero from '@/components/Hero';
import HowItWorks from '@/components/HowItWorks';
import CTASection from '@/components/CTASection';
import Footer from '@/components/Footer';
import IntroSection from "@/components/IntroSection";
import FeatureGrid from "@/components/FeatureGrid";
import AISection from '@/components/AISection';
import LaunchOffer from '@/components/LaunchOffer';

export default function HomePage() {
  const [openDemoModal, setOpenDemoModal] = useState(false);

  return (
    <div className="bg-[#E6E6E1] min-h-screen">
      {/* Header */}
      <MarketingHeader onBookDemo={() => setOpenDemoModal(true)} />

      <main>
        <Hero />
        <IntroSection />
        <FeatureGrid />
        <AISection />
        <HowItWorks />
        <LaunchOffer onBookDemo={() => setOpenDemoModal(true)} />
        <CTASection />
      </main>

      <Footer />

      {/* Book a Demo Modal (shared) */}
      {openDemoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpenDemoModal(false)}
          />

          {/* Modal */}
          <div className="relative z-10 w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-black">
              Book a live demo
            </h3>

            <p className="mt-3 text-sm text-gray-600">
              We’ll open WhatsApp to send a message to the Tenderbot team so we can
              schedule a quick demo.
            </p>

            <div className="mt-6 flex items-center justify-end gap-4">
              <button
                onClick={() => setOpenDemoModal(false)}
                className="text-sm font-medium text-gray-600 hover:text-black"
              >
                Cancel
              </button>

              <a
                href="https://wa.me/919810155584?text=Hi%20Tenderbot%20team,%20I’d%20like%20to%20book%20a%20demo."
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpenDemoModal(false)}
                className="
                  inline-flex h-10 items-center justify-center
                  rounded-md bg-black px-5
                  text-sm font-semibold text-white
                  hover:bg-neutral-900
                "
              >
                Continue to WhatsApp
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
