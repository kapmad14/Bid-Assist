import { MarketingHeader } from '@/components/marketing-header';
import Hero from '@/components/Hero';
import HowItWorks from '@/components/HowItWorks';
import CTASection from '@/components/CTASection';
import Footer from '@/components/Footer';
import IntroSection from "@/components/IntroSection";
import FeatureGrid from "@/components/FeatureGrid";
import AISection from '@/components/AISection';
import LaunchOffer from '@/components/LaunchOffer'

export default function HomePage() {
  return (
    <div className="bg-[#E6E6E1] min-h-screen">
      <MarketingHeader />

      <main>
        <Hero />
        <IntroSection />
        <FeatureGrid />
        <AISection />
        <HowItWorks/>
        <LaunchOffer />
        <CTASection />
      </main>

      <Footer />
    </div>
  );
}
