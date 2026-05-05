/*
 * Signal Noir Design: AI Summary Section
 * - Showcase the flagship AI feature
 * - Split layout with visual on left, content on right
 * - Simulated AI summary card
 */
import { useEffect, useRef, useState } from "react";
import { Sparkles, CheckCircle2, Clock, Users } from "lucide-react";

function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.2 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

export default function AISummarySection() {
  return (
    <section id="ai-summary" className="py-24 md:py-32 relative overflow-hidden">
      {/* Subtle background glow */}
      <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-96 h-96 bg-blue-500/5 blur-[120px] rounded-full" />

      <div className="container relative z-10">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: AI Visual */}
          <FadeIn>
            <div className="relative">
              <img
                src="https://d2xsxph8kpxj0f.cloudfront.net/107568382/CqiHEBD7BgXS38HvbpP59M/phone11-ai-feature-mzmyD3CMQbuX9Lz2VWjSxq.webp"
                alt="AI Call Analysis"
                className="w-full h-auto rounded-lg opacity-80"
              />
              <div className="absolute -inset-8 bg-blue-500/5 blur-3xl rounded-full -z-10" />

              {/* Floating AI summary card */}
              <div className="absolute -bottom-6 -right-4 md:right-4 bg-[#0F1019]/90 backdrop-blur-xl border border-white/10 rounded-lg p-5 max-w-xs shadow-2xl">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-blue-400" />
                  <span className="text-xs font-mono text-blue-400 uppercase tracking-wider">AI Summary</span>
                </div>
                <p className="text-sm text-white/70 leading-relaxed mb-3">
                  "Client approved Q3 budget. Follow up with proposal by Friday. Schedule demo for engineering team next week."
                </p>
                <div className="flex items-center gap-3 text-xs text-white/30">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> 12 min call</span>
                  <span className="flex items-center gap-1"><Users className="w-3 h-3" /> 3 participants</span>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* Right: Content */}
          <div className="space-y-8">
            <FadeIn delay={100}>
              <span className="text-xs font-mono text-blue-400 tracking-widest uppercase">
                Flagship Feature
              </span>
            </FadeIn>

            <FadeIn delay={200}>
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white tracking-tight leading-tight">
                AI that listens
                <br />
                <span className="text-gradient-blue">so you don't have to.</span>
              </h2>
            </FadeIn>

            <FadeIn delay={300}>
              <p className="text-base text-white/40 leading-relaxed max-w-lg">
                Our AI engine processes every call in real time — transcribing conversations, identifying key decisions, extracting action items, and delivering concise summaries directly to your inbox.
              </p>
            </FadeIn>

            <FadeIn delay={400}>
              <div className="space-y-4 pt-4">
                {[
                  "Real-time transcription with 98% accuracy",
                  "Automatic action item extraction",
                  "Sentiment analysis and tone detection",
                  "Searchable call archive with AI-powered search",
                  "CRM integration — summaries sync automatically",
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-blue-400 mt-0.5 shrink-0" />
                    <span className="text-sm text-white/60">{item}</span>
                  </div>
                ))}
              </div>
            </FadeIn>
          </div>
        </div>
      </div>
    </section>
  );
}
