/*
 * Signal Noir Design: Footer
 * - Minimal, dark footer
 * - Logo + nav links + social
 */

const footerLinks = {
  Product: ["Features", "AI Summary", "Pricing", "Integrations", "API Docs"],
  Company: ["About", "Careers", "Blog", "Press"],
  Support: ["Help Center", "Status", "Contact", "Security"],
  Legal: ["Privacy Policy", "Terms of Service", "Cookie Policy"],
};

export default function Footer() {
  return (
    <footer className="border-t border-white/5 bg-[#060609]">
      <div className="container py-16 md:py-20">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1 space-y-4">
            <img
              src="/manus-storage/04_horizontal_white_transparent_b7eeca35.png"
              alt="Phone11.ai"
              className="h-7 w-auto"
            />
            <p className="text-xs text-white/30 leading-relaxed max-w-xs">
              Enterprise cloud phone system with AI-powered call intelligence.
              Built in Thailand, serving the world.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-4">
                {category}
              </h4>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link}>
                    <a
                      href="#"
                      className="text-sm text-white/30 hover:text-white/60 transition-colors duration-300"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-16 pt-8 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-white/20">
            &copy; {new Date().getFullYear()} Phone11.ai. All rights reserved.
          </p>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-white/30">All systems operational</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
