/*
 * Settings Page
 * System configuration and preferences
 */
import AdminLayout from "@/components/AdminLayout";
import {
  Settings,
  Globe,
  Phone,
  Mail,
  Bell,
  Shield,
  Database,
  Cloud,
  Save,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("general");

  const tabs = [
    { id: "general", label: "General", icon: Settings },
    { id: "sip", label: "SIP Settings", icon: Phone },
    { id: "email", label: "Email / SMTP", icon: Mail },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "backup", label: "Backup", icon: Database },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Settings
          </h1>
          <p className="text-sm text-[#8B949E] mt-0.5">System configuration and preferences</p>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Tabs sidebar */}
          <div className="lg:w-48 flex-shrink-0">
            <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm whitespace-nowrap transition-colors ${
                    activeTab === tab.id
                      ? "bg-[#1C2333] text-[#2F81F7]"
                      : "text-[#8B949E] hover:text-[#C9D1D9] hover:bg-[#161B22]"
                  }`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Settings content */}
          <div className="flex-1 bg-[#161B22] border border-[#21262D] rounded-lg">
            {activeTab === "general" && (
              <div>
                <div className="px-6 py-4 border-b border-[#21262D]">
                  <h2 className="text-sm font-medium text-white">General Settings</h2>
                  <p className="text-xs text-[#484F58] mt-0.5">Basic system configuration</p>
                </div>
                <div className="p-6 space-y-6">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs text-[#8B949E] mb-1.5">Company Name</label>
                      <input
                        type="text"
                        defaultValue="Phone11.ai"
                        className="w-full max-w-md bg-[#0D1117] border border-[#21262D] rounded-md px-3 py-2 text-sm text-[#C9D1D9] focus:outline-none focus:border-[#2F81F7] focus:ring-1 focus:ring-[#2F81F7]/30"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#8B949E] mb-1.5">Domain</label>
                      <input
                        type="text"
                        defaultValue="sip.phone11.ai"
                        className="w-full max-w-md bg-[#0D1117] border border-[#21262D] rounded-md px-3 py-2 text-sm text-[#C9D1D9] focus:outline-none focus:border-[#2F81F7] focus:ring-1 focus:ring-[#2F81F7]/30"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#8B949E] mb-1.5">Default Country</label>
                      <select className="w-full max-w-md bg-[#0D1117] border border-[#21262D] rounded-md px-3 py-2 text-sm text-[#C9D1D9] focus:outline-none focus:border-[#2F81F7]">
                        <option value="TH">Thailand (+66)</option>
                        <option value="US">United States (+1)</option>
                        <option value="GB">United Kingdom (+44)</option>
                        <option value="SG">Singapore (+65)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-[#8B949E] mb-1.5">Timezone</label>
                      <select className="w-full max-w-md bg-[#0D1117] border border-[#21262D] rounded-md px-3 py-2 text-sm text-[#C9D1D9] focus:outline-none focus:border-[#2F81F7]">
                        <option value="Asia/Bangkok">Asia/Bangkok (ICT, UTC+7)</option>
                        <option value="America/New_York">America/New_York (EST/EDT)</option>
                        <option value="Europe/London">Europe/London (GMT/BST)</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between max-w-md">
                      <div>
                        <label className="text-sm text-[#C9D1D9]">Call Recording</label>
                        <p className="text-xs text-[#484F58]">Record all calls by default</p>
                      </div>
                      <button className="w-10 h-5 rounded-full bg-[#2F81F7] relative transition-colors">
                        <span className="absolute right-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between max-w-md">
                      <div>
                        <label className="text-sm text-[#C9D1D9]">AI Call Summaries</label>
                        <p className="text-xs text-[#484F58]">Generate AI summaries for recorded calls</p>
                      </div>
                      <button className="w-10 h-5 rounded-full bg-[#2F81F7] relative transition-colors">
                        <span className="absolute right-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "sip" && (
              <div>
                <div className="px-6 py-4 border-b border-[#21262D]">
                  <h2 className="text-sm font-medium text-white">SIP Settings</h2>
                  <p className="text-xs text-[#484F58] mt-0.5">SIP proxy and media server configuration</p>
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-xs text-[#8B949E] mb-1.5">SIP Domain</label>
                    <input type="text" defaultValue="sip.phone11.ai" className="w-full max-w-md bg-[#0D1117] border border-[#21262D] rounded-md px-3 py-2 text-sm text-[#C9D1D9] focus:outline-none focus:border-[#2F81F7] focus:ring-1 focus:ring-[#2F81F7]/30" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#8B949E] mb-1.5">Outbound Proxy</label>
                    <input type="text" defaultValue="sip.phone11.ai:5060" className="w-full max-w-md bg-[#0D1117] border border-[#21262D] rounded-md px-3 py-2 text-sm text-[#C9D1D9] focus:outline-none focus:border-[#2F81F7] focus:ring-1 focus:ring-[#2F81F7]/30" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#8B949E] mb-1.5">STUN Server</label>
                    <input type="text" defaultValue="stun:stun.phone11.ai:3478" className="w-full max-w-md bg-[#0D1117] border border-[#21262D] rounded-md px-3 py-2 text-sm text-[#C9D1D9] focus:outline-none focus:border-[#2F81F7] focus:ring-1 focus:ring-[#2F81F7]/30" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#8B949E] mb-1.5">TURN Server</label>
                    <input type="text" defaultValue="turn:turn.phone11.ai:3478" className="w-full max-w-md bg-[#0D1117] border border-[#21262D] rounded-md px-3 py-2 text-sm text-[#C9D1D9] focus:outline-none focus:border-[#2F81F7] focus:ring-1 focus:ring-[#2F81F7]/30" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#8B949E] mb-1.5">Codec Priority</label>
                    <input type="text" defaultValue="opus, g722, pcmu, pcma" className="w-full max-w-md bg-[#0D1117] border border-[#21262D] rounded-md px-3 py-2 text-sm text-[#C9D1D9] focus:outline-none focus:border-[#2F81F7] focus:ring-1 focus:ring-[#2F81F7]/30" />
                  </div>
                  <div>
                    <label className="block text-xs text-[#8B949E] mb-1.5">Max Registration Expiry (seconds)</label>
                    <input type="number" defaultValue="3600" className="w-full max-w-md bg-[#0D1117] border border-[#21262D] rounded-md px-3 py-2 text-sm text-[#C9D1D9] focus:outline-none focus:border-[#2F81F7] focus:ring-1 focus:ring-[#2F81F7]/30" />
                  </div>
                </div>
              </div>
            )}

            {activeTab !== "general" && activeTab !== "sip" && (
              <div className="p-12 text-center">
                <Settings className="w-8 h-8 mx-auto text-[#484F58] mb-3" />
                <p className="text-sm text-[#8B949E]">
                  {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} settings coming soon
                </p>
                <p className="text-xs text-[#484F58] mt-1">This section is under development</p>
              </div>
            )}

            {/* Save bar */}
            <div className="px-6 py-3 border-t border-[#21262D] flex items-center justify-end gap-2">
              <button className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#0D1117] border border-[#21262D] rounded-md text-[#8B949E] hover:text-[#C9D1D9] hover:border-[#30363D] transition-colors">
                <RotateCcw className="w-4 h-4" /> Reset
              </button>
              <button className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#2F81F7] text-white rounded-md hover:bg-[#1F6FEB] transition-colors">
                <Save className="w-4 h-4" /> Save Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
