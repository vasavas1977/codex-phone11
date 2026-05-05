/*
 * DID Numbers Management Page
 * Manage phone number pool and routing
 */
import AdminLayout from "@/components/AdminLayout";
import { useState } from "react";
import {
  Globe,
  Plus,
  Search,
  Phone,
  ArrowRight,
  Edit,
  Trash2,
  Download,
  MapPin,
  Tag,
} from "lucide-react";

interface DID {
  id: number;
  number: string;
  country: string;
  city: string;
  type: "local" | "tollfree" | "mobile";
  assignedTo: string;
  routing: string;
  status: "active" | "inactive" | "reserved";
  monthlyFee: string;
}

const mockDIDs: DID[] = [
  { id: 1, number: "+66 2 123 4567", country: "TH", city: "Bangkok", type: "local", assignedTo: "Main IVR", routing: "IVR → Sales Queue", status: "active", monthlyFee: "฿150" },
  { id: 2, number: "+66 2 234 5678", country: "TH", city: "Bangkok", type: "local", assignedTo: "Support Line", routing: "IVR → Support Queue", status: "active", monthlyFee: "฿150" },
  { id: 3, number: "+66 81 234 5678", country: "TH", city: "Mobile", type: "mobile", assignedTo: "Somchai (1001)", routing: "Direct → Ext 1001", status: "active", monthlyFee: "฿200" },
  { id: 4, number: "+1 415 555 0100", country: "US", city: "San Francisco", type: "local", assignedTo: "US Sales", routing: "IVR → US Queue", status: "active", monthlyFee: "$4.99" },
  { id: 5, number: "+44 20 7946 0958", country: "GB", city: "London", type: "local", assignedTo: "—", routing: "Unassigned", status: "reserved", monthlyFee: "£3.50" },
  { id: 6, number: "+66 1800 123 456", country: "TH", city: "Nationwide", type: "tollfree", assignedTo: "Toll-Free Line", routing: "IVR → Main Menu", status: "active", monthlyFee: "฿500" },
  { id: 7, number: "+65 6100 1234", country: "SG", city: "Singapore", type: "local", assignedTo: "SG Office", routing: "Ring Group → SG Team", status: "active", monthlyFee: "S$5.00" },
  { id: 8, number: "+66 2 345 6789", country: "TH", city: "Bangkok", type: "local", assignedTo: "—", routing: "Unassigned", status: "inactive", monthlyFee: "฿150" },
];

const statusConfig: Record<string, { color: string; label: string }> = {
  active: { color: "#3FB950", label: "Active" },
  inactive: { color: "#484F58", label: "Inactive" },
  reserved: { color: "#D29922", label: "Reserved" },
};

const typeConfig: Record<string, { color: string; label: string }> = {
  local: { color: "#2F81F7", label: "Local" },
  tollfree: { color: "#A371F7", label: "Toll-Free" },
  mobile: { color: "#3FB950", label: "Mobile" },
};

const countryFlags: Record<string, string> = {
  TH: "🇹🇭",
  US: "🇺🇸",
  GB: "🇬🇧",
  SG: "🇸🇬",
};

export default function DIDsPage() {
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = mockDIDs.filter(
    (d) =>
      d.number.includes(searchQuery) ||
      d.assignedTo.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.city.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              DID Numbers
            </h1>
            <p className="text-sm text-[#8B949E] mt-0.5">
              {mockDIDs.length} numbers · {mockDIDs.filter((d) => d.status === "active").length} active
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#161B22] border border-[#21262D] rounded-md text-[#C9D1D9] hover:border-[#30363D] transition-colors">
              <Download className="w-4 h-4" /> Export
            </button>
            <button className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#2F81F7] text-white rounded-md hover:bg-[#1F6FEB] transition-colors">
              <Plus className="w-4 h-4" /> Add DID
            </button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total DIDs", value: mockDIDs.length, color: "#2F81F7" },
            { label: "Active", value: mockDIDs.filter((d) => d.status === "active").length, color: "#3FB950" },
            { label: "Countries", value: new Set(mockDIDs.map((d) => d.country)).size, color: "#D29922" },
            { label: "Unassigned", value: mockDIDs.filter((d) => d.assignedTo === "—").length, color: "#F85149" },
          ].map((stat) => (
            <div key={stat.label} className="bg-[#161B22] border border-[#21262D] rounded-lg p-3">
              <p className="text-xs text-[#8B949E]">{stat.label}</p>
              <p className="text-lg font-bold text-white mt-0.5" style={{ fontFamily: "'Fira Code', monospace" }}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#484F58]" />
          <input
            type="text"
            placeholder="Search by number, city, or assignment..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#0D1117] border border-[#21262D] rounded-md pl-9 pr-4 py-1.5 text-sm text-[#C9D1D9] placeholder-[#484F58] focus:outline-none focus:border-[#2F81F7] focus:ring-1 focus:ring-[#2F81F7]/30 transition-colors"
          />
        </div>

        {/* Table */}
        <div className="bg-[#161B22] border border-[#21262D] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[#8B949E] text-xs uppercase tracking-wider bg-[#0D1117]">
                  <th className="text-left px-4 py-2.5 font-medium">Number</th>
                  <th className="text-left px-4 py-2.5 font-medium">Location</th>
                  <th className="text-left px-4 py-2.5 font-medium">Type</th>
                  <th className="text-left px-4 py-2.5 font-medium">Assigned To</th>
                  <th className="text-left px-4 py-2.5 font-medium">Routing</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium">Cost</th>
                  <th className="text-right px-4 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((did) => (
                  <tr key={did.id} className="border-t border-[#21262D] hover:bg-[#1C2333] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5 text-[#2F81F7]" />
                        <span className="font-mono text-[#C9D1D9] font-medium">{did.number}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-base">{countryFlags[did.country]}</span>
                        <span className="text-[#8B949E]">{did.city}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: `${typeConfig[did.type].color}15`,
                          color: typeConfig[did.type].color,
                        }}
                      >
                        {typeConfig[did.type].label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#C9D1D9]">{did.assignedTo}</td>
                    <td className="px-4 py-3 text-xs text-[#8B949E]">{did.routing}</td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: `${statusConfig[did.status].color}15`,
                          color: statusConfig[did.status].color,
                        }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusConfig[did.status].color }} />
                        {statusConfig[did.status].label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[#8B949E] text-xs">{did.monthlyFee}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button className="p-1.5 rounded-md text-[#8B949E] hover:text-[#C9D1D9] hover:bg-[#21262D] transition-colors">
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button className="p-1.5 rounded-md text-[#8B949E] hover:text-[#F85149] hover:bg-[#F8514915] transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
