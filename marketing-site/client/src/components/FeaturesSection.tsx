/*
 * Signal Noir Design: Features Section — UCC Key Features
 * - Comprehensive Unified Communications & Collaboration features
 * - Two-tier layout: hero features (large) + grid features (compact)
 * - Scroll-triggered animations
 */
import { useEffect, useRef, useState } from "react";
import {
  Phone,
  Brain,
  Shield,
  Globe,
  BarChart3,
  Headphones,
  Smartphone,
  Monitor,
  Mic,
  Video,
  MessageSquare,
  Users,
  PhoneForwarded,
  Voicemail,
  ListTree,
  Clock,
  Lock,
  Workflow,
} from "lucide-react";

const heroFeatures = [
  {
    icon: Phone,
    title: "HD Voice Calls",
    description:
      "Crystal-clear wideband audio with adaptive codecs (G.722, Opus) that dynamically optimize for any network condition. Experience voice quality that rivals face-to-face conversations.",
    tag: "Core",
  },
  {
    icon: Brain,
    title: "AI Call Summaries",
    description:
      "Every call is automatically transcribed and summarized by AI. Key decisions, action items, and follow-ups are extracted in real time and delivered to your inbox.",
    tag: "AI-Powered",
  },
  {
    icon: Mic,
    title: "Call Recording",
    description:
      "Automatic or on-demand call recording with secure cloud storage. Full compliance support with configurable retention policies, consent prompts, and encrypted archives.",
    tag: "Compliance",
  },
];

const gridFeatures = [
  {
    icon: Smartphone,
    title: "Mobile App",
    description:
      "Full-featured iOS and Android apps with push notifications, call transfer, and offline mode. Your office phone in your pocket.",
  },
  {
    icon: Monitor,
    title: "Web Calling (WebRTC)",
    description:
      "Make and receive calls directly from your browser — no plugins, no downloads. Works on Chrome, Firefox, Safari, and Edge.",
  },
  {
    icon: ListTree,
    title: "IVR / Auto-Attendant",
    description:
      "Multi-level interactive voice response with drag-and-drop builder. Route callers intelligently with AI-powered speech recognition.",
  },
  {
    icon: Video,
    title: "Video Conferencing",
    description:
      "HD video meetings with screen sharing, virtual backgrounds, and AI meeting notes. Up to 100 participants per call.",
  },
  {
    icon: MessageSquare,
    title: "Team Messaging & SMS",
    description:
      "Unified inbox for instant messaging, SMS, and MMS. Share files, create channels, and keep conversations in context.",
  },
  {
    icon: Users,
    title: "Conference Bridge",
    description:
      "Dedicated conference rooms with dial-in numbers, moderator controls, and automatic recording. Host up to 200 participants.",
  },
  {
    icon: PhoneForwarded,
    title: "Call Routing & ACD",
    description:
      "Automatic call distribution with skills-based routing, queue management, ring groups, and time-based rules. Never miss a call.",
  },
  {
    icon: Voicemail,
    title: "Visual Voicemail",
    description:
      "AI-transcribed voicemails delivered to your inbox. Read, search, and prioritize messages without listening to each one.",
  },
  {
    icon: Clock,
    title: "Real-Time Analytics",
    description:
      "Live dashboards showing call volume, wait times, agent performance, sentiment analysis, and SLA compliance at a glance.",
  },
  {
    icon: Globe,
    title: "Global Numbers",
    description:
      "Local, toll-free, and virtual numbers in 40+ countries. Low-latency routing through our Asia Pacific infrastructure.",
  },
  {
    icon: Lock,
    title: "Enterprise Security",
    description:
      "End-to-end TLS/SRTP encryption, SOC 2 compliance, SSO/SAML, role-based access control, and audit logging.",
  },
  {
    icon: Workflow,
    title: "CRM Integrations",
    description:
      "Native integrations with Salesforce, HubSpot, Zendesk, Microsoft Teams, and Slack. Open API for custom workflows.",
  },
];

function FadeInCard({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
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
    <div
      ref={ref}
      className={`transition-all duration-700 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

export default function FeaturesSection() {
  return (
    <section id="features" className="py-24 md:py-32 relative">
      {/* Section divider */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-16 bg-gradient-to-b from-transparent via-blue-500/30 to-transparent" />

      <div className="container">
        {/* Section header */}
        <div className="max-w-3xl mx-auto text-center mb-16 md:mb-20">
          <span className="text-xs font-mono text-blue-400 tracking-widest uppercase mb-4 block">
            Unified Communications & Collaboration
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white tracking-tight mb-6">
            One platform.{" "}
            <span className="text-gradient-blue">Every channel.</span>
          </h2>
          <p className="text-base text-white/40 leading-relaxed">
            Voice, video, messaging, and AI — unified in a single enterprise-grade platform
            engineered for reliability, intelligence, and scale.
          </p>
        </div>

        {/* Hero features — 3 large cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-6">
          {heroFeatures.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <FadeInCard key={feature.title} delay={i * 120}>
                <div className="group h-full p-8 md:p-10 border border-blue-500/15 bg-blue-500/[0.03] hover:bg-blue-500/[0.06] hover:border-blue-500/25 transition-all duration-500">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 flex items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20 transition-colors duration-300">
                      <Icon size={24} strokeWidth={1.5} />
                    </div>
                    <span className="text-[10px] font-mono text-blue-400/60 uppercase tracking-widest px-2 py-0.5 border border-blue-500/15 rounded-full">
                      {feature.tag}
                    </span>
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-3 tracking-tight">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-white/45 leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </FadeInCard>
            );
          })}
        </div>

        {/* Grid features — 12 compact cards in 4-column grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-white/5">
          {gridFeatures.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <FadeInCard key={feature.title} delay={i * 60}>
                <div className="group h-full p-6 bg-[#0A0A0F] hover:bg-white/[0.03] transition-all duration-400">
                  <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-white/[0.04] text-blue-400/70 mb-4 group-hover:bg-blue-500/10 group-hover:text-blue-400 transition-colors duration-300">
                    <Icon size={20} strokeWidth={1.5} />
                  </div>
                  <h3 className="text-sm font-semibold text-white mb-2 tracking-tight">
                    {feature.title}
                  </h3>
                  <p className="text-xs text-white/35 leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </FadeInCard>
            );
          })}
        </div>
      </div>
    </section>
  );
}
