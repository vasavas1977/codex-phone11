/*
 * Signal Noir Design: How It Works
 * - 3-step horizontal flow
 * - Numbered steps with connecting line
 * - Clean, minimal layout
 */
import { useEffect, useRef, useState } from "react";
import { UserPlus, PhoneCall, FileText } from "lucide-react";

const steps = [
  {
    number: "01",
    icon: UserPlus,
    title: "Set Up in Minutes",
    description:
      "Create your account, assign phone numbers, and invite your team. No hardware required — works with any device, anywhere.",
  },
  {
    number: "02",
    icon: PhoneCall,
    title: "Make & Receive Calls",
    description:
      "Crystal-clear HD voice calls through our global network. AI listens in the background, capturing every detail automatically.",
  },
  {
    number: "03",
    icon: FileText,
    title: "Get AI Summaries",
    description:
      "After every call, receive an intelligent summary with key points, action items, and follow-ups. Searchable, shareable, actionable.",
  },
];

export default function HowItWorksSection() {
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
    <section id="how-it-works" className="py-24 md:py-32 relative" ref={ref}>
      <div className="container">
        {/* Section header */}
        <div className="max-w-2xl mx-auto text-center mb-16 md:mb-20">
          <span className="text-xs font-mono text-blue-400 tracking-widest uppercase mb-4 block">
            How It Works
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white tracking-tight mb-6">
            Three steps to{" "}
            <span className="text-gradient-blue">smarter calls.</span>
          </h2>
        </div>

        {/* Steps */}
        <div className="grid md:grid-cols-3 gap-12 md:gap-8 relative">
          {/* Connecting line (desktop only) */}
          <div className="hidden md:block absolute top-16 left-[16.67%] right-[16.67%] h-px bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />

          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <div
                key={step.number}
                className={`text-center space-y-6 transition-all duration-700 ${
                  visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
                }`}
                style={{ transitionDelay: `${i * 200}ms` }}
              >
                {/* Step number + icon */}
                <div className="relative inline-flex flex-col items-center">
                  <span className="font-mono text-xs text-blue-400/50 mb-3 tracking-widest">
                    {step.number}
                  </span>
                  <div className="w-16 h-16 flex items-center justify-center rounded-full border border-blue-500/20 bg-blue-500/5 relative z-10">
                    <Icon size={28} className="text-blue-400" strokeWidth={1.5} />
                  </div>
                </div>

                <h3 className="text-xl font-semibold text-white tracking-tight">
                  {step.title}
                </h3>
                <p className="text-sm text-white/40 leading-relaxed max-w-xs mx-auto">
                  {step.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
