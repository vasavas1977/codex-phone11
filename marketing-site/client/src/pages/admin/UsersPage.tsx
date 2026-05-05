/*
 * Users & Extensions Management Page
 * Manage SIP users, extensions, and registrations
 */
import AdminLayout from "@/components/AdminLayout";
import { useState } from "react";
import {
  Users,
  Plus,
  Search,
  MoreHorizontal,
  Phone,
  Mail,
  Shield,
  CheckCircle,
  XCircle,
  Edit,
  Trash2,
  Download,
  Filter,
} from "lucide-react";

interface SipUser {
  id: number;
  extension: string;
  name: string;
  email: string;
  department: string;
  status: "registered" | "offline" | "busy" | "dnd";
  device: string;
  lastSeen: string;
  callsToday: number;
}

const mockUsers: SipUser[] = [
  { id: 1, extension: "1001", name: "Somchai Prasert", email: "somchai@phone11.ai", department: "Sales", status: "registered", device: "Phone11 iOS", lastSeen: "Online now", callsToday: 12 },
  { id: 2, extension: "1002", name: "Nattaya Srisuk", email: "nattaya@phone11.ai", department: "Support", status: "busy", device: "Phone11 Android", lastSeen: "In call", callsToday: 8 },
  { id: 3, extension: "1003", name: "Pichit Wongsawat", email: "pichit@phone11.ai", department: "Engineering", status: "registered", device: "Web Client", lastSeen: "Online now", callsToday: 3 },
  { id: 4, extension: "1004", name: "Kannika Thongdee", email: "kannika@phone11.ai", department: "Sales", status: "offline", device: "Phone11 iOS", lastSeen: "2h ago", callsToday: 0 },
  { id: 5, extension: "1005", name: "Wichai Chaiyaphum", email: "wichai@phone11.ai", department: "Management", status: "dnd", device: "Desk Phone", lastSeen: "DND enabled", callsToday: 5 },
  { id: 6, extension: "1006", name: "Supaporn Rattana", email: "supaporn@phone11.ai", department: "Support", status: "registered", device: "Phone11 Android", lastSeen: "Online now", callsToday: 15 },
  { id: 7, extension: "1007", name: "Arthit Jaidee", email: "arthit@phone11.ai", department: "Engineering", status: "offline", device: "Web Client", lastSeen: "1d ago", callsToday: 0 },
  { id: 8, extension: "1008", name: "Ploy Suwannarat", email: "ploy@phone11.ai", department: "HR", status: "registered", device: "Phone11 iOS", lastSeen: "Online now", callsToday: 6 },
];

const statusConfig: Record<string, { color: string; label: string }> = {
  registered: { color: "#3FB950", label: "Online" },
  offline: { color: "#484F58", label: "Offline" },
  busy: { color: "#D29922", label: "In Call" },
  dnd: { color: "#F85149", label: "DND" },
};

export default function UsersPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const filtered = mockUsers.filter((u) => {
    const matchSearch =
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.extension.includes(searchQuery) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchStatus = filterStatus === "all" || u.status === filterStatus;
    return matchSearch && matchStatus;
  });

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Users & Extensions
            </h1>
            <p className="text-sm text-[#8B949E] mt-0.5">
              {mockUsers.length} users · {mockUsers.filter((u) => u.status === "registered" || u.status === "busy").length} online
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#161B22] border border-[#21262D] rounded-md text-[#C9D1D9] hover:border-[#30363D] transition-colors">
              <Download className="w-4 h-4" /> Export
            </button>
            <button className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#2F81F7] text-white rounded-md hover:bg-[#1F6FEB] transition-colors">
              <Plus className="w-4 h-4" /> Add User
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#484F58]" />
            <input
              type="text"
              placeholder="Search by name, extension, or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#0D1117] border border-[#21262D] rounded-md pl-9 pr-4 py-1.5 text-sm text-[#C9D1D9] placeholder-[#484F58] focus:outline-none focus:border-[#2F81F7] focus:ring-1 focus:ring-[#2F81F7]/30 transition-colors"
            />
          </div>
          <div className="flex items-center gap-1 bg-[#0D1117] border border-[#21262D] rounded-md p-0.5">
            {["all", "registered", "busy", "offline", "dnd"].map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1 text-xs rounded-md transition-colors capitalize ${
                  filterStatus === s
                    ? "bg-[#21262D] text-white"
                    : "text-[#8B949E] hover:text-[#C9D1D9]"
                }`}
              >
                {s === "all" ? "All" : statusConfig[s]?.label || s}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="bg-[#161B22] border border-[#21262D] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[#8B949E] text-xs uppercase tracking-wider bg-[#0D1117]">
                  <th className="text-left px-4 py-2.5 font-medium">Extension</th>
                  <th className="text-left px-4 py-2.5 font-medium">User</th>
                  <th className="text-left px-4 py-2.5 font-medium">Department</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium">Device</th>
                  <th className="text-left px-4 py-2.5 font-medium">Calls Today</th>
                  <th className="text-left px-4 py-2.5 font-medium">Last Seen</th>
                  <th className="text-right px-4 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr key={user.id} className="border-t border-[#21262D] hover:bg-[#1C2333] transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-[#2F81F7] font-medium">{user.extension}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <div className="text-[#C9D1D9] font-medium">{user.name}</div>
                        <div className="text-[10px] text-[#484F58]">{user.email}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[#8B949E]">{user.department}</td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: `${statusConfig[user.status].color}15`,
                          color: statusConfig[user.status].color,
                        }}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${user.status === "registered" || user.status === "busy" ? "animate-pulse" : ""}`}
                          style={{ backgroundColor: statusConfig[user.status].color }}
                        />
                        {statusConfig[user.status].label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#8B949E] text-xs">{user.device}</td>
                    <td className="px-4 py-3 font-mono text-[#C9D1D9]">{user.callsToday}</td>
                    <td className="px-4 py-3 text-[#484F58] text-xs">{user.lastSeen}</td>
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
          {filtered.length === 0 && (
            <div className="text-center py-12 text-[#484F58]">
              <Users className="w-8 h-8 mx-auto mb-2" />
              <p className="text-sm">No users found matching your criteria</p>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
