/*
 * Signal Noir Design: Navbar
 * - Transparent on top, blurred glass on scroll
 * - White logo on dark background
 * - Minimal nav links, single CTA
 */
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "AI Summary", href: "#ai-summary" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
  { label: "Contact", href: "#contact" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleNavClick = (href: string) => {
    setMobileOpen(false);
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled
          ? "bg-[#0A0A0F]/80 backdrop-blur-xl border-b border-white/5"
          : "bg-transparent"
      }`}
    >
      <div className="container flex items-center justify-between h-16 md:h-20">
        {/* Logo */}
        <a href="#" className="flex items-center gap-2 shrink-0">
          <img
            src="/manus-storage/04_horizontal_white_transparent_b7eeca35.png"
            alt="Phone11.ai"
            className="h-8 md:h-9 w-auto"
          />
        </a>

        {/* Desktop Nav */}
        <div className="hidden lg:flex items-center gap-8">
          {navLinks.map((link) => (
            <button
              key={link.href}
              onClick={() => handleNavClick(link.href)}
              className="text-sm text-white/60 hover:text-white transition-colors duration-300 tracking-wide"
            >
              {link.label}
            </button>
          ))}
        </div>

        {/* Desktop CTA */}
        <div className="hidden lg:flex items-center gap-4">
          <Button
            variant="ghost"
            className="text-sm text-white/70 hover:text-white hover:bg-white/5"
            onClick={() => handleNavClick("#contact")}
          >
            Sign In
          </Button>
          <Button
            className="text-sm bg-blue-600 hover:bg-blue-500 text-white px-6 glow-blue-sm"
            onClick={() => handleNavClick("#contact")}
          >
            Get Started
          </Button>
        </div>

        {/* Mobile Menu Toggle */}
        <button
          className="lg:hidden text-white/80 hover:text-white p-2"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="lg:hidden bg-[#0A0A0F]/95 backdrop-blur-xl border-t border-white/5">
          <div className="container py-6 flex flex-col gap-4">
            {navLinks.map((link) => (
              <button
                key={link.href}
                onClick={() => handleNavClick(link.href)}
                className="text-left text-base text-white/70 hover:text-white py-2 transition-colors"
              >
                {link.label}
              </button>
            ))}
            <div className="pt-4 border-t border-white/10 flex flex-col gap-3">
              <Button variant="ghost" className="text-white/70 justify-start">
                Sign In
              </Button>
              <Button className="bg-blue-600 hover:bg-blue-500 text-white glow-blue-sm">
                Get Started
              </Button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
