/*
 * Design: "Dark Ops" Tactical Operations Dashboard
 * Charcoal base (#0D1117) with blue-gray surface layers
 * Primary accent: vivid blue (#2F81F7)
 * Collapsible left navigation rail
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  Phone,
  Globe,
  GitBranch,
  BarChart3,
  Server,
  Shield,
  ChevronLeft,
  ChevronRight,
  Bell,
  Search,
  Settings,
  LogOut,
  Menu,
} from "lucide-react";

const navItems = [
  { path: "/admin", icon: LayoutDashboard, label: "Dashboard", exact: true },
  { path: "/admin/users", icon: Users, label: "Users & Extensions" },
  { path: "/admin/dids", icon: Globe, label: "DID Numbers" },
  { path: "/admin/ivr", icon: GitBranch, label: "IVR Builder" },
  { path: "/admin/calls", icon: Phone, label: "Call Analytics" },
  { path: "/admin/system", icon: Server, label: "System Status" },
  { path: "/admin/security", icon: Shield, label: "SIP TLS/WSS" },
  { path: "/admin/settings", icon: Settings, label: "Settings" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();

  const isActive = (path: string, exact?: boolean) => {
    if (exact) return location === path;
    return location.startsWith(path);
  };

  return (
    <div className="min-h-screen bg-[#0D1117] text-[#C9D1D9] flex">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 left-0 h-screen z-50 flex flex-col border-r border-[#21262D] bg-[#0D1117] transition-all duration-200 ${
          collapsed ? "w-[60px]" : "w-[240px]"
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        {/* Logo area */}
        <div className="h-14 flex items-center px-3 border-b border-[#21262D] gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#2F81F7] to-[#1F6FEB] flex items-center justify-center flex-shrink-0">
            <Phone className="w-4 h-4 text-white" />
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <div className="text-sm font-semibold text-white truncate">Phone11.ai</div>
              <div className="text-[10px] text-[#8B949E] truncate">Management Portal</div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const active = isActive(item.path, item.exact);
            return (
              <Link key={item.path} href={item.path}>
                <div
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-2.5 py-2 rounded-md text-sm transition-colors cursor-pointer ${
                    active
                      ? "bg-[#1C2333] text-[#2F81F7] border-l-2 border-[#2F81F7]"
                      : "text-[#8B949E] hover:text-[#C9D1D9] hover:bg-[#161B22]"
                  }`}
                >
                  <item.icon className={`w-4 h-4 flex-shrink-0 ${active ? "text-[#2F81F7]" : ""}`} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle */}
        <div className="border-t border-[#21262D] p-2 hidden lg:block">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center gap-2 px-2.5 py-2 rounded-md text-[#8B949E] hover:text-[#C9D1D9] hover:bg-[#161B22] text-sm transition-colors"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 border-b border-[#21262D] bg-[#0D1117]/80 backdrop-blur-sm flex items-center px-4 gap-4 sticky top-0 z-30">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden text-[#8B949E] hover:text-white"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Search */}
          <div className="flex-1 max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#484F58]" />
              <input
                type="text"
                placeholder="Search users, extensions, DIDs..."
                className="w-full bg-[#161B22] border border-[#21262D] rounded-md pl-9 pr-4 py-1.5 text-sm text-[#C9D1D9] placeholder-[#484F58] focus:outline-none focus:border-[#2F81F7] focus:ring-1 focus:ring-[#2F81F7]/30 transition-colors"
              />
              <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#484F58] bg-[#21262D] px-1.5 py-0.5 rounded border border-[#30363D]">
                ⌘K
              </kbd>
            </div>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <button className="relative text-[#8B949E] hover:text-white transition-colors">
              <Bell className="w-5 h-5" />
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-[#F85149] rounded-full" />
            </button>
            <div className="w-px h-6 bg-[#21262D]" />
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#2F81F7] to-[#8B5CF6] flex items-center justify-center text-xs text-white font-medium">
                A
              </div>
              {!collapsed && (
                <span className="text-sm text-[#C9D1D9] hidden sm:block">Admin</span>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
