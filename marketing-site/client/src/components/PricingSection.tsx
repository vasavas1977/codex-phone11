/*
 * Signal Noir Design: Pricing Section
 * - 3 tiers with the middle one highlighted
 * - Clean card layout with blue accent on popular plan
 */
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const plans = [
  {
    name: "Starter",
    price: "$29",
    period: "/user/mo",
    description: "For small teams getting started with cloud calling.",
    features: [
      "HD voice calling",
      "5 local numbers",
      "Basic call analytics",
      "Email support",
      "Mobile & desktop apps",
    ],
    cta: "Start Free Trial",
    popular: false,
  },
  {
    name: "Business",
    price: "$59",
    period: "/user/mo",
    description: "For growing teams that need AI-powered insights.",
    features: [
      "Everything in Starter",
      "AI call summaries",
      "25 local numbers",
      "Advanced analytics",
      "CRM integrations",
      "Priority support",
      "Call recording",
    ],
    cta: "Start Free Trial",
    popular: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For organizations with advanced security and scale needs.",
    features: [
      "Everything in Business",
      "Unlimited numbers",
      "Custom AI models",
      "SSO & SAML",
      "Dedicated account manager",
      "SLA guarantee",
      "On-premise option",
      "API access",
    ],
    cta: "Contact Sales",
    popular: false,
  },
];

export default function PricingSection() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.1 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="pricing" className="py-24 md:py-32 relative" ref={ref}>
      <div className="container">
        {/* Section header */}
        <div className="max-w-2xl mx-auto text-center mb-16 md:mb-20">
          <span className="text-xs font-mono text-blue-400 tracking-widest uppercase mb-4 block">
            Pricing
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white tracking-tight mb-6">
            Simple, transparent{" "}
            <span className="text-gradient-blue">pricing.</span>
          </h2>
          <p className="text-base text-white/40">
            No hidden fees. No long-term contracts. Scale up or down anytime.
          </p>
        </div>

        {/* Pricing cards */}
        <div className="grid md:grid-cols-3 gap-6 lg:gap-8 max-w-5xl mx-auto">
          {plans.map((plan, i) => (
            <div
              key={plan.name}
              className={`relative p-8 transition-all duration-700 ${
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              } ${
                plan.popular
                  ? "border border-blue-500/30 bg-blue-500/[0.03]"
                  : "border border-white/5 bg-white/[0.02]"
              }`}
              style={{ transitionDelay: `${i * 150}ms` }}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-blue-600 text-xs font-medium text-white tracking-wider uppercase">
                  Most Popular
                </div>
              )}

              <div className="mb-8">
                <h3 className="text-lg font-semibold text-white mb-2">{plan.name}</h3>
                <p className="text-sm text-white/30 mb-6">{plan.description}</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-white font-mono">{plan.price}</span>
                  <span className="text-sm text-white/30">{plan.period}</span>
                </div>
              </div>

              <div className="space-y-3 mb-8">
                {plan.features.map((feature) => (
                  <div key={feature} className="flex items-center gap-3">
                    <Check className="w-4 h-4 text-blue-400 shrink-0" />
                    <span className="text-sm text-white/50">{feature}</span>
                  </div>
                ))}
              </div>

              <Button
                className={`w-full py-5 ${
                  plan.popular
                    ? "bg-blue-600 hover:bg-blue-500 text-white glow-blue-sm"
                    : "bg-white/5 hover:bg-white/10 text-white border border-white/10"
                }`}
              >
                {plan.cta}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
