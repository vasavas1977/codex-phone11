/*
 * Admin Dashboard — System overview with KPIs
 * "Dark Ops" tactical operations center aesthetic
 */
import AdminLayout from "@/components/AdminLayout";
import {
  Phone,
  Users,
  Globe,
  Activity,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  Clock,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Server,
  Shield,
  Wifi,
} from "lucide-react";

const kpis = [
  { label: "Active Calls", value: "24", change: "+3", trend: "up", icon: PhoneCall, color: "#2F81F7" },
  { label: "Registered Users", value: "156", change: "+12", trend: "up", icon: Users, color: "#3FB950" },
  { label: "Active DIDs", value: "48", change: "0", trend: "neutral", icon: Globe, color: "#D29922" },
  { label: "Uptime", value: "99.97%", change: "30d", trend: "up", icon: Activity, color: "#A371F7" },
];

const recentCalls = [
  { from: "1001", to: "+66812345678", duration: "4:23", status: "completed", type: "outbound", time: "2 min ago" },
  { from: "+66898765432", to: "1002", duration: "0:00", status: "missed", type: "inbound", time: "5 min ago" },
  { from: "1003", to: "1001", duration: "12:45", status: "active", type: "internal", time: "12 min ago" },
  { from: "+66811112222", to: "1004", duration: "1:30", status: "completed", type: "inbound", time: "18 min ago" },
  { from: "1002", to: "+66833334444", duration: "7:12", status: "completed", type: "outbound", time: "25 min ago" },
  { from: "+66855556666", to: "IVR", duration: "0:45", status: "completed", type: "inbound", time: "32 min ago" },
];

const systemServices = [
  { name: "Kamailio SIP Proxy", status: "healthy", uptime: "6d 4h", port: "5060/5061/7443", icon: Server },
  { name: "FreeSWITCH Media", status: "healthy", uptime: "6d 4h", port: "16384-32768", icon: Phone },
  { name: "RTPEngine", status: "healthy", uptime: "6d 4h", port: "30000-40000", icon: Wifi },
  { name: "SIP TLS", status: "healthy", uptime: "2h 15m", port: "5061", icon: Shield },
  { name: "WSS WebRTC", status: "healthy", uptime: "2h 15m", port: "7443", icon: Globe },
];

const statusColor: Record<string, string> = {
  healthy: "#3FB950",
  degraded: "#D29922",
  down: "#F85149",
  completed: "#3FB950",
  active: "#2F81F7",
  missed: "#F85149",
};

export default function Dashboard() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Dashboard
            </h1>
            <p className="text-sm text-[#8B949E] mt-0.5">Phone11.ai System Overview</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#8B949E]">
            <Clock className="w-3.5 h-3.5" />
            <span>Last updated: just now</span>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map((kpi) => (
            <div
              key={kpi.label}
              className="bg-[#161B22] border border-[#21262D] rounded-lg p-4 relative overflow-hidden group hover:border-[#30363D] transition-colors"
            >
              {/* Top accent line */}
              <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundColor: kpi.color }} />
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-[#8B949E] uppercase tracking-wider">{kpi.label}</p>
                  <p className="text-2xl font-bold text-white mt-1" style={{ fontFamily: "'Fira Code', monospace" }}>
                    {kpi.value}
                  </p>
                </div>
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${kpi.color}15` }}
                >
                  <kpi.icon className="w-4.5 h-4.5" style={{ color: kpi.color }} />
                </div>
              </div>
              <div className="flex items-center gap-1 mt-2">
                {kpi.trend === "up" ? (
                  <TrendingUp className="w-3 h-3 text-[#3FB950]" />
                ) : kpi.trend === "down" ? (
                  <TrendingDown className="w-3 h-3 text-[#F85149]" />
                ) : null}
                <span className={`text-xs ${kpi.trend === "up" ? "text-[#3FB950]" : kpi.trend === "down" ? "text-[#F85149]" : "text-[#8B949E]"}`}>
                  {kpi.change}
                </span>
                <span className="text-xs text-[#484F58]">vs last hour</span>
              </div>
            </div>
          ))}
        </div>

        {/* Main content grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Recent Calls — 2/3 width */}
          <div className="lg:col-span-2 bg-[#161B22] border border-[#21262D] rounded-lg">
            <div className="px-4 py-3 border-b border-[#21262D] flex items-center justify-between">
              <h2 className="text-sm font-medium text-white">Recent Calls</h2>
              <a href="/admin/calls" className="text-xs text-[#2F81F7] hover:underline flex items-center gap-1">
                View all <ArrowUpRight className="w-3 h-3" />
              </a>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[#8B949E] text-xs uppercase tracking-wider">
                    <th className="text-left px-4 py-2 font-medium">From</th>
                    <th className="text-left px-4 py-2 font-medium">To</th>
                    <th className="text-left px-4 py-2 font-medium">Duration</th>
                    <th className="text-left px-4 py-2 font-medium">Status</th>
                    <th className="text-left px-4 py-2 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCalls.map((call, i) => (
                    <tr key={i} className="border-t border-[#21262D] hover:bg-[#1C2333] transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {call.type === "outbound" ? (
                            <PhoneOutgoing className="w-3.5 h-3.5 text-[#2F81F7]" />
                          ) : call.type === "inbound" ? (
                            <PhoneIncoming className="w-3.5 h-3.5 text-[#3FB950]" />
                          ) : (
                            <Phone className="w-3.5 h-3.5 text-[#A371F7]" />
                          )}
                          <span className="font-mono text-[#C9D1D9]">{call.from}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[#C9D1D9]">{call.to}</td>
                      <td className="px-4 py-2.5 font-mono text-[#8B949E]">{call.duration}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: `${statusColor[call.status]}15`,
                            color: statusColor[call.status],
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: statusColor[call.status] }}
                          />
                          {call.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[#484F58] text-xs">{call.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* System Services — 1/3 width */}
          <div className="bg-[#161B22] border border-[#21262D] rounded-lg">
            <div className="px-4 py-3 border-b border-[#21262D] flex items-center justify-between">
              <h2 className="text-sm font-medium text-white">System Services</h2>
              <a href="/admin/system" className="text-xs text-[#2F81F7] hover:underline flex items-center gap-1">
                Details <ArrowUpRight className="w-3 h-3" />
              </a>
            </div>
            <div className="p-3 space-y-2">
              {systemServices.map((svc) => (
                <div
                  key={svc.name}
                  className="flex items-center gap-3 p-2.5 rounded-md bg-[#0D1117] border border-[#21262D] hover:border-[#30363D] transition-colors"
                >
                  <div className="w-8 h-8 rounded-md bg-[#161B22] flex items-center justify-center">
                    <svc.icon className="w-4 h-4 text-[#8B949E]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-[#C9D1D9] truncate">{svc.name}</div>
                    <div className="text-[10px] text-[#484F58] font-mono">Port {svc.port}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full animate-pulse"
                      style={{ backgroundColor: statusColor[svc.status] }}
                    />
                    <span className="text-[10px] text-[#8B949E]">{svc.uptime}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Call Volume Chart placeholder */}
        <div className="bg-[#161B22] border border-[#21262D] rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-white">Call Volume (24h)</h2>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#2F81F7]" /> Inbound
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#3FB950]" /> Outbound
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#A371F7]" /> Internal
              </span>
            </div>
          </div>
          {/* Simulated bar chart */}
          <div className="flex items-end gap-1.5 h-32">
            {Array.from({ length: 24 }, (_, i) => {
              const inbound = Math.floor(Math.random() * 60) + 10;
              const outbound = Math.floor(Math.random() * 40) + 5;
              return (
                <div key={i} className="flex-1 flex flex-col gap-0.5 items-center">
                  <div className="w-full flex flex-col gap-0.5">
                    <div
                      className="w-full rounded-t-sm bg-[#2F81F7]"
                      style={{ height: `${inbound}%` }}
                    />
                    <div
                      className="w-full bg-[#3FB950]"
                      style={{ height: `${outbound}%` }}
                    />
                  </div>
                  {i % 4 === 0 && (
                    <span className="text-[9px] text-[#484F58] mt-1">{`${i}:00`}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
