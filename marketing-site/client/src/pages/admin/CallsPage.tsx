/*
 * Call Analytics Page
 * CDR records and call statistics
 */
import AdminLayout from "@/components/AdminLayout";
import { useState } from "react";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Clock,
  TrendingUp,
  Search,
  Download,
  Filter,
  Calendar,
  Play,
  FileText,
  BarChart3,
} from "lucide-react";

const callStats = [
  { label: "Total Calls", value: "1,247", change: "+8.3%", icon: Phone, color: "#2F81F7" },
  { label: "Inbound", value: "687", change: "+12.1%", icon: PhoneIncoming, color: "#3FB950" },
  { label: "Outbound", value: "498", change: "+3.7%", icon: PhoneOutgoing, color: "#A371F7" },
  { label: "Missed", value: "62", change: "-15.2%", icon: PhoneMissed, color: "#F85149" },
  { label: "Avg Duration", value: "4:32", change: "+0:18", icon: Clock, color: "#D29922" },
  { label: "Answer Rate", value: "95.0%", change: "+1.2%", icon: TrendingUp, color: "#3FB950" },
];

interface CDRRecord {
  id: string;
  timestamp: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  direction: "inbound" | "outbound" | "internal";
  duration: string;
  status: "answered" | "missed" | "busy" | "failed";
  recording: boolean;
  aiSummary: boolean;
}

const mockCDR: CDRRecord[] = [
  { id: "CDR-001", timestamp: "2026-04-26 16:42:15", from: "+66812345678", fromName: "External", to: "1001", toName: "Somchai P.", direction: "inbound", duration: "4:23", status: "answered", recording: true, aiSummary: true },
  { id: "CDR-002", timestamp: "2026-04-26 16:38:02", from: "1002", fromName: "Nattaya S.", to: "+66898765432", toName: "External", direction: "outbound", duration: "7:12", status: "answered", recording: true, aiSummary: true },
  { id: "CDR-003", timestamp: "2026-04-26 16:35:18", from: "+66811112222", fromName: "External", to: "1004", toName: "Kannika T.", direction: "inbound", duration: "0:00", status: "missed", recording: false, aiSummary: false },
  { id: "CDR-004", timestamp: "2026-04-26 16:30:45", from: "1003", fromName: "Pichit W.", to: "1001", toName: "Somchai P.", direction: "internal", duration: "12:45", status: "answered", recording: false, aiSummary: false },
  { id: "CDR-005", timestamp: "2026-04-26 16:25:33", from: "+66833334444", fromName: "External", to: "IVR", toName: "Main IVR", direction: "inbound", duration: "1:30", status: "answered", recording: true, aiSummary: true },
  { id: "CDR-006", timestamp: "2026-04-26 16:20:11", from: "1005", fromName: "Wichai C.", to: "+66855556666", toName: "External", direction: "outbound", duration: "3:45", status: "answered", recording: true, aiSummary: false },
  { id: "CDR-007", timestamp: "2026-04-26 16:15:08", from: "+66877778888", fromName: "External", to: "1002", toName: "Nattaya S.", direction: "inbound", duration: "0:00", status: "busy", recording: false, aiSummary: false },
  { id: "CDR-008", timestamp: "2026-04-26 16:10:22", from: "1006", fromName: "Supaporn R.", to: "+66899990000", toName: "External", direction: "outbound", duration: "5:18", status: "answered", recording: true, aiSummary: true },
];

const statusConfig: Record<string, { color: string }> = {
  answered: { color: "#3FB950" },
  missed: { color: "#F85149" },
  busy: { color: "#D29922" },
  failed: { color: "#484F58" },
};

const directionConfig: Record<string, { icon: typeof Phone; color: string }> = {
  inbound: { icon: PhoneIncoming, color: "#3FB950" },
  outbound: { icon: PhoneOutgoing, color: "#2F81F7" },
  internal: { icon: Phone, color: "#A371F7" },
};

export default function CallsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [dateRange, setDateRange] = useState("today");

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Call Analytics
            </h1>
            <p className="text-sm text-[#8B949E] mt-0.5">Call detail records and performance metrics</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-[#0D1117] border border-[#21262D] rounded-md p-0.5">
              {["today", "7d", "30d", "custom"].map((range) => (
                <button
                  key={range}
                  onClick={() => setDateRange(range)}
                  className={`px-3 py-1 text-xs rounded-md transition-colors capitalize ${
                    dateRange === range ? "bg-[#21262D] text-white" : "text-[#8B949E] hover:text-[#C9D1D9]"
                  }`}
                >
                  {range === "custom" ? "Custom" : range === "today" ? "Today" : range}
                </button>
              ))}
            </div>
            <button className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#161B22] border border-[#21262D] rounded-md text-[#C9D1D9] hover:border-[#30363D] transition-colors">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {callStats.map((stat) => (
            <div key={stat.label} className="bg-[#161B22] border border-[#21262D] rounded-lg p-3 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundColor: stat.color }} />
              <div className="flex items-center gap-2 mb-1">
                <stat.icon className="w-3.5 h-3.5" style={{ color: stat.color }} />
                <span className="text-[10px] text-[#8B949E] uppercase tracking-wider">{stat.label}</span>
              </div>
              <p className="text-lg font-bold text-white" style={{ fontFamily: "'Fira Code', monospace" }}>
                {stat.value}
              </p>
              <p className={`text-[10px] mt-0.5 ${stat.change.startsWith("+") ? "text-[#3FB950]" : stat.change.startsWith("-") ? "text-[#F85149]" : "text-[#8B949E]"}`}>
                {stat.change} vs yesterday
              </p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#484F58]" />
          <input
            type="text"
            placeholder="Search by number, extension, or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#0D1117] border border-[#21262D] rounded-md pl-9 pr-4 py-1.5 text-sm text-[#C9D1D9] placeholder-[#484F58] focus:outline-none focus:border-[#2F81F7] focus:ring-1 focus:ring-[#2F81F7]/30 transition-colors"
          />
        </div>

        {/* CDR Table */}
        <div className="bg-[#161B22] border border-[#21262D] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[#8B949E] text-xs uppercase tracking-wider bg-[#0D1117]">
                  <th className="text-left px-4 py-2.5 font-medium">Time</th>
                  <th className="text-left px-4 py-2.5 font-medium">Direction</th>
                  <th className="text-left px-4 py-2.5 font-medium">From</th>
                  <th className="text-left px-4 py-2.5 font-medium">To</th>
                  <th className="text-left px-4 py-2.5 font-medium">Duration</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium">Features</th>
                </tr>
              </thead>
              <tbody>
                {mockCDR.map((cdr) => {
                  const DirIcon = directionConfig[cdr.direction].icon;
                  return (
                    <tr key={cdr.id} className="border-t border-[#21262D] hover:bg-[#1C2333] transition-colors cursor-pointer">
                      <td className="px-4 py-2.5">
                        <div className="font-mono text-xs text-[#8B949E]">{cdr.timestamp.split(" ")[1]}</div>
                        <div className="text-[10px] text-[#484F58]">{cdr.timestamp.split(" ")[0]}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <DirIcon className="w-4 h-4" style={{ color: directionConfig[cdr.direction].color }} />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-mono text-[#C9D1D9] text-xs">{cdr.from}</div>
                        <div className="text-[10px] text-[#484F58]">{cdr.fromName}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-mono text-[#C9D1D9] text-xs">{cdr.to}</div>
                        <div className="text-[10px] text-[#484F58]">{cdr.toName}</div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[#C9D1D9] text-xs">{cdr.duration}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full capitalize"
                          style={{
                            backgroundColor: `${statusConfig[cdr.status].color}15`,
                            color: statusConfig[cdr.status].color,
                          }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusConfig[cdr.status].color }} />
                          {cdr.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {cdr.recording && (
                            <button className="p-1 rounded bg-[#0D1117] text-[#8B949E] hover:text-[#2F81F7]" title="Play recording">
                              <Play className="w-3 h-3" />
                            </button>
                          )}
                          {cdr.aiSummary && (
                            <button className="p-1 rounded bg-[#0D1117] text-[#8B949E] hover:text-[#A371F7]" title="AI Summary">
                              <FileText className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
