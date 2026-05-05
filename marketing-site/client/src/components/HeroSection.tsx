/*
 * Signal Noir Design: Hero Section
 * - Full viewport cinematic scene
 * - Asymmetric 60/40 text-to-visual split
 * - Animated stat counters
 * - UCC-focused messaging
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, Play, Phone, Video, MessageSquare, Brain } from "lucide-react";

function AnimatedCounter({ target, suffix = "", duration = 2000 }: { target: number; suffix?: string; duration?: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const start = performance.now();
          const animate = (now: number) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.floor(eased * target));
            if (progress < 1) requestAnimationFrame(animate);
          };
          requestAnimationFrame(animate);
        }
      },
      { threshold: 0.5 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target, duration]);

  return (
    <span ref={ref} className="font-mono text-3xl md:text-4xl font-bold text-white tabular-nums">
      {count}{suffix}
    </span>
  );
}

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0">
        <img
          src="https://d2xsxph8kpxj0f.cloudfront.net/107568382/CqiHEBD7BgXS38HvbpP59M/phone11-hero-bg-Ds7a2FXuBHH2d4DtTQHJVk.webp"
          alt=""
          className="w-full h-full object-cover opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0F] via-[#0A0A0F]/60 to-[#0A0A0F]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0A0A0F] via-transparent to-[#0A0A0F]/80" />
      </div>

      <div className="container relative z-10 pt-24 pb-16 md:pt-32 md:pb-24">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          {/* Left: Text (7 cols) */}
          <div className="lg:col-span-7 space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 border border-blue-500/20 bg-blue-500/5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-xs font-medium text-blue-400 tracking-wider uppercase">
                AI-Powered Unified Communications
              </span>
            </div>

            {/* Headline */}
            <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.05] tracking-tight">
              <span className="text-white">Every call,</span>
              <br />
              <span className="text-gradient-blue">intelligently</span>
              <br />
              <span className="text-white">understood.</span>
            </h1>

            {/* Subheadline */}
            <p className="text-lg md:text-xl text-white/50 max-w-xl leading-relaxed">
              Phone11.ai unifies HD voice, video, messaging, and AI-powered call intelligence into one enterprise platform. Call, record, summarize, and act — all from a single pane of glass.
            </p>

            {/* UCC Channel Icons */}
            <div className="flex items-center gap-6 pt-1">
              {[
                { icon: Phone, label: "Voice" },
                { icon: Video, label: "Video" },
                { icon: MessageSquare, label: "Messaging" },
                { icon: Brain, label: "AI" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2">
                  <div className="w-8 h-8 flex items-center justify-center rounded-md bg-white/[0.04] text-blue-400/70">
                    <Icon size={16} strokeWidth={1.5} />
                  </div>
                  <span className="text-xs text-white/40 font-medium">{label}</span>
                </div>
              ))}
            </div>

            {/* CTAs */}
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Button
                size="lg"
                className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-6 text-base glow-blue group"
              >
                Start Free Trial
                <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="text-white/70 hover:text-white hover:bg-white/5 px-6 py-6 text-base group"
              >
                <Play className="mr-2 w-4 h-4" />
                Watch Demo
              </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-8 pt-8 border-t border-white/5">
              <div>
                <AnimatedCounter target={99} suffix=".99%" />
                <p className="text-sm text-white/40 mt-1">Uptime SLA</p>
              </div>
              <div>
                <AnimatedCounter target={150} suffix="+" />
                <p className="text-sm text-white/40 mt-1">Enterprise Clients</p>
              </div>
              <div>
                <AnimatedCounter target={10} suffix="M+" />
                <p className="text-sm text-white/40 mt-1">Calls Processed</p>
              </div>
            </div>
          </div>

          {/* Right: Product Visual (5 cols) */}
          <div className="lg:col-span-5 relative">
            <div className="relative">
              <img
                src="https://d2xsxph8kpxj0f.cloudfront.net/107568382/CqiHEBD7BgXS38HvbpP59M/phone11-dashboard-mockup-EHJcVjECWhRQTHR3BfkAak.webp"
                alt="Phone11.ai Dashboard"
                className="w-full h-auto rounded-lg"
              />
              {/* Glow effect behind the image */}
              <div className="absolute -inset-4 bg-blue-500/10 blur-3xl rounded-full -z-10" />
            </div>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-40">
        <span className="text-xs text-white/50 tracking-widest uppercase">Scroll</span>
        <div className="w-px h-8 bg-gradient-to-b from-white/30 to-transparent" />
      </div>
    </section>
  );
}
