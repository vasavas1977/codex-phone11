/*
 * Signal Noir Design: CTA / Contact Section
 * - Full-width CTA with enterprise team image background
 * - Contact form or simple CTA
 */
import { Button } from "@/components/ui/button";
import { ArrowRight, Mail, Phone, MapPin } from "lucide-react";

export default function CTASection() {
  return (
    <section id="contact" className="py-24 md:py-32 relative overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0">
        <img
          src="https://d2xsxph8kpxj0f.cloudfront.net/107568382/CqiHEBD7BgXS38HvbpP59M/phone11-enterprise-team-6RUHRtsbSoxdQ3ztdiirTw.webp"
          alt=""
          className="w-full h-full object-cover opacity-15"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0F] via-[#0A0A0F]/90 to-[#0A0A0F]/80" />
      </div>

      <div className="container relative z-10">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: CTA Content */}
          <div className="space-y-8">
            <span className="text-xs font-mono text-blue-400 tracking-widest uppercase">
              Get Started Today
            </span>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white tracking-tight leading-tight">
              Ready to make every call{" "}
              <span className="text-gradient-blue">count?</span>
            </h2>
            <p className="text-base text-white/40 leading-relaxed max-w-lg">
              Join 150+ enterprises already using Phone11.ai to transform their
              business communications. Start your free trial today — no credit
              card required.
            </p>
            <div className="flex flex-wrap gap-4">
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
                className="text-white/70 hover:text-white hover:bg-white/5 px-6 py-6 text-base"
              >
                Schedule a Demo
              </Button>
            </div>
          </div>

          {/* Right: Contact Info */}
          <div className="space-y-8 lg:pl-8">
            <div className="p-8 border border-white/5 bg-white/[0.02] space-y-6">
              <h3 className="text-lg font-semibold text-white">Contact Us</h3>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-blue-500/10">
                    <Mail className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs text-white/30 mb-0.5">Email</p>
                    <a
                      href="mailto:hello@phone11.ai"
                      className="text-sm text-white/70 hover:text-blue-400 transition-colors"
                    >
                      hello@phone11.ai
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-blue-500/10">
                    <Phone className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs text-white/30 mb-0.5">Sales</p>
                    <a
                      href="tel:+6620001234"
                      className="text-sm text-white/70 hover:text-blue-400 transition-colors"
                    >
                      +66 2 000 1234
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-blue-500/10">
                    <MapPin className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs text-white/30 mb-0.5">Headquarters</p>
                    <p className="text-sm text-white/70">Bangkok, Thailand</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
