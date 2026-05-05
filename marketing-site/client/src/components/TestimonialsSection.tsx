/*
 * Signal Noir Design: Testimonials Section
 * - Enterprise social proof
 * - Quote cards with company logos (text-based)
 */
import { useEffect, useRef, useState } from "react";
import { Quote } from "lucide-react";

const testimonials = [
  {
    quote:
      "Phone11.ai transformed how our sales team operates. The AI summaries save us 2 hours per rep per day — that's real revenue recovered.",
    name: "Sarah Chen",
    title: "VP of Sales",
    company: "TechVenture Corp",
  },
  {
    quote:
      "We evaluated every major VoIP provider. Phone11.ai was the only one that combined enterprise-grade reliability with genuinely useful AI features.",
    name: "Marcus Rodriguez",
    title: "CTO",
    company: "GlobalConnect Solutions",
  },
  {
    quote:
      "The call quality is exceptional, and the AI summaries are surprisingly accurate. Our support team's resolution time dropped 40% in the first month.",
    name: "Priya Sharma",
    title: "Head of Customer Success",
    company: "Nexus Enterprises",
  },
];

export default function TestimonialsSection() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.15 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="py-24 md:py-32 relative" ref={ref}>
      {/* Background accent */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-500/[0.02] to-transparent" />

      <div className="container relative z-10">
        {/* Section header */}
        <div className="max-w-2xl mx-auto text-center mb-16 md:mb-20">
          <span className="text-xs font-mono text-blue-400 tracking-widest uppercase mb-4 block">
            Trusted by Enterprises
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white tracking-tight">
            Don't take our word for it.
          </h2>
        </div>

        {/* Testimonial cards */}
        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {testimonials.map((t, i) => (
            <div
              key={t.name}
              className={`p-8 border border-white/5 bg-white/[0.02] space-y-6 transition-all duration-700 ${
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
              style={{ transitionDelay: `${i * 150}ms` }}
            >
              <Quote className="w-8 h-8 text-blue-500/30" />
              <p className="text-sm text-white/60 leading-relaxed italic">
                "{t.quote}"
              </p>
              <div className="pt-4 border-t border-white/5">
                <p className="text-sm font-semibold text-white">{t.name}</p>
                <p className="text-xs text-white/30 mt-0.5">
                  {t.title}, {t.company}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
