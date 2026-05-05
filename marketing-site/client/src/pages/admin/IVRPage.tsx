/*
 * IVR Builder Page
 * Visual IVR flow configuration
 */
import AdminLayout from "@/components/AdminLayout";
import {
  GitBranch,
  Plus,
  Play,
  Pause,
  Volume2,
  Phone,
  Users,
  Clock,
  MessageSquare,
  ArrowDown,
  Edit,
  Trash2,
  Copy,
  ChevronRight,
} from "lucide-react";

interface IVRNode {
  id: string;
  type: "greeting" | "menu" | "queue" | "extension" | "voicemail" | "timecheck" | "announcement";
  label: string;
  description: string;
  children?: { key: string; label: string; targetId: string }[];
}

const ivrFlows = [
  {
    id: "main",
    name: "Main IVR",
    did: "+66 2 123 4567",
    status: "active" as const,
    lastModified: "2h ago",
    calls24h: 145,
  },
  {
    id: "support",
    name: "Support IVR",
    did: "+66 2 234 5678",
    status: "active" as const,
    lastModified: "1d ago",
    calls24h: 89,
  },
  {
    id: "after-hours",
    name: "After Hours",
    did: "All DIDs",
    status: "active" as const,
    lastModified: "5d ago",
    calls24h: 23,
  },
  {
    id: "holiday",
    name: "Holiday Greeting",
    did: "All DIDs",
    status: "inactive" as const,
    lastModified: "30d ago",
    calls24h: 0,
  },
];

// Visual IVR flow for the selected flow
const mainIVRNodes: IVRNode[] = [
  {
    id: "greeting",
    type: "greeting",
    label: "Welcome Greeting",
    description: "\"Thank you for calling Phone11.ai...\"",
  },
  {
    id: "timecheck",
    type: "timecheck",
    label: "Business Hours Check",
    description: "Mon-Fri 9:00-18:00 ICT",
    children: [
      { key: "open", label: "Open", targetId: "menu" },
      { key: "closed", label: "Closed", targetId: "afterhours" },
    ],
  },
  {
    id: "menu",
    type: "menu",
    label: "Main Menu",
    description: "Press 1 for Sales, 2 for Support, 3 for Billing",
    children: [
      { key: "1", label: "Press 1", targetId: "sales-queue" },
      { key: "2", label: "Press 2", targetId: "support-queue" },
      { key: "3", label: "Press 3", targetId: "billing-ext" },
      { key: "0", label: "Press 0", targetId: "operator" },
    ],
  },
];

const nodeTypeConfig: Record<string, { icon: typeof GitBranch; color: string; bgColor: string }> = {
  greeting: { icon: Volume2, color: "#A371F7", bgColor: "#A371F715" },
  menu: { icon: GitBranch, color: "#2F81F7", bgColor: "#2F81F715" },
  queue: { icon: Users, color: "#3FB950", bgColor: "#3FB95015" },
  extension: { icon: Phone, color: "#D29922", bgColor: "#D2992215" },
  voicemail: { icon: MessageSquare, color: "#F85149", bgColor: "#F8514915" },
  timecheck: { icon: Clock, color: "#D29922", bgColor: "#D2992215" },
  announcement: { icon: Volume2, color: "#8B949E", bgColor: "#8B949E15" },
};

export default function IVRPage() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              IVR Builder
            </h1>
            <p className="text-sm text-[#8B949E] mt-0.5">Configure interactive voice response flows</p>
          </div>
          <button className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#2F81F7] text-white rounded-md hover:bg-[#1F6FEB] transition-colors">
            <Plus className="w-4 h-4" /> New IVR Flow
          </button>
        </div>

        {/* IVR Flow List */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ivrFlows.map((flow) => (
            <div
              key={flow.id}
              className="bg-[#161B22] border border-[#21262D] rounded-lg p-4 hover:border-[#30363D] transition-colors cursor-pointer group"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#2F81F715] flex items-center justify-center">
                    <GitBranch className="w-5 h-5 text-[#2F81F7]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-white">{flow.name}</h3>
                    <p className="text-xs text-[#484F58] font-mono mt-0.5">{flow.did}</p>
                  </div>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full ${
                    flow.status === "active"
                      ? "bg-[#3FB95015] text-[#3FB950]"
                      : "bg-[#484F5815] text-[#484F58]"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      flow.status === "active" ? "bg-[#3FB950] animate-pulse" : "bg-[#484F58]"
                    }`}
                  />
                  {flow.status}
                </span>
              </div>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#21262D]">
                <div className="flex items-center gap-4 text-xs text-[#8B949E]">
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3" /> {flow.calls24h} calls/24h
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {flow.lastModified}
                  </span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="p-1.5 rounded-md text-[#8B949E] hover:text-[#C9D1D9] hover:bg-[#21262D]">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button className="p-1.5 rounded-md text-[#8B949E] hover:text-[#C9D1D9] hover:bg-[#21262D]">
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  <button className="p-1.5 rounded-md text-[#8B949E] hover:text-[#F85149] hover:bg-[#F8514915]">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Visual IVR Flow Editor */}
        <div className="bg-[#161B22] border border-[#21262D] rounded-lg">
          <div className="px-4 py-3 border-b border-[#21262D] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium text-white">Main IVR Flow</h2>
              <span className="text-xs text-[#484F58]">— Visual Editor</span>
            </div>
            <div className="flex items-center gap-2">
              <button className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[#0D1117] border border-[#21262D] rounded-md text-[#8B949E] hover:text-[#C9D1D9] hover:border-[#30363D]">
                <Play className="w-3 h-3" /> Test
              </button>
              <button className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[#2F81F7] text-white rounded-md hover:bg-[#1F6FEB]">
                Save Changes
              </button>
            </div>
          </div>

          {/* Flow visualization */}
          <div className="p-6">
            <div className="flex flex-col items-center gap-2">
              {mainIVRNodes.map((node, index) => {
                const config = nodeTypeConfig[node.type];
                const Icon = config.icon;
                return (
                  <div key={node.id} className="w-full max-w-lg">
                    {/* Node */}
                    <div className="bg-[#0D1117] border border-[#21262D] rounded-lg p-4 hover:border-[#30363D] transition-colors cursor-pointer">
                      <div className="flex items-start gap-3">
                        <div
                          className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: config.bgColor }}
                        >
                          <Icon className="w-4 h-4" style={{ color: config.color }} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[#C9D1D9]">{node.label}</span>
                            <span className="text-[10px] text-[#484F58] uppercase tracking-wider px-1.5 py-0.5 bg-[#161B22] rounded">
                              {node.type}
                            </span>
                          </div>
                          <p className="text-xs text-[#8B949E] mt-1">{node.description}</p>
                        </div>
                      </div>

                      {/* Children / branches */}
                      {node.children && (
                        <div className="mt-3 pt-3 border-t border-[#21262D]">
                          <div className="grid grid-cols-2 gap-2">
                            {node.children.map((child) => (
                              <div
                                key={child.key}
                                className="flex items-center gap-2 px-2.5 py-1.5 bg-[#161B22] rounded-md text-xs"
                              >
                                <span className="text-[#2F81F7] font-mono font-medium">{child.label}</span>
                                <ChevronRight className="w-3 h-3 text-[#484F58]" />
                                <span className="text-[#8B949E] truncate">{child.targetId}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Connector arrow */}
                    {index < mainIVRNodes.length - 1 && (
                      <div className="flex justify-center py-1">
                        <ArrowDown className="w-4 h-4 text-[#21262D]" />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add node button */}
              <button className="mt-2 flex items-center gap-2 px-4 py-2 border border-dashed border-[#21262D] rounded-lg text-xs text-[#484F58] hover:text-[#8B949E] hover:border-[#30363D] transition-colors">
                <Plus className="w-4 h-4" /> Add Node
              </button>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
