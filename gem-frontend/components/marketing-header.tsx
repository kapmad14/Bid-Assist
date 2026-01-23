'use client';

import Link from 'next/link';
import Image from 'next/image';

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-50 w-full bg-black">
      <div className="mx-auto flex h-[70px] max-w-7xl items-center justify-between px-6">
        {/* Left: Logo */}
        <Link href="/" className="flex items-center">
          <Image
            src="/logo/tenderbot-header.png"
            alt="TenderBot"
            width={200}
            height={36}
            priority
          />
        </Link>

        {/* Right: Nav + CTA */}
        <div className="flex items-center gap-10">
          <nav className="hidden items-center gap-8 md:flex">
            <NavItem href="#features">Features</NavItem>
            <NavItem href="#how-it-works">How it works</NavItem>
            <NavItem href="#ai-insights">Smart AI</NavItem>
          </nav>

          {/* Primary CTA */}
          <Link
            href="/book-demo"
            className="
              inline-flex h-10 items-center
              rounded-md bg-[#F5C84C] px-6
              text-[15px] font-medium text-black
              transition-colors hover:bg-[#e6b93f]
            "
          >
            Book a demo
          </Link>
        </div>
      </div>
    </header>
  );
}

function NavItem({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="
        text-[15px] font-normal text-white
        transition-colors hover:text-[#F5C84C]
      "
    >
      {children}
    </Link>
  );
}
