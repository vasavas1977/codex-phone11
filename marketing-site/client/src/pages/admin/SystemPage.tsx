/*
 * System Status Page
 * Health monitoring for Kamailio, FreeSWITCH, RTPEngine, etc.
 */
import AdminLayout from "@/components/AdminLayout";
import {
  Server,
  Cpu,
  HardDrive,
  MemoryStick,
  Wifi,
  Shield,
  Globe,
  Phone,
  Activity,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
} from "lucide-react";

interface ServiceStatus {
  name: string;
  description: string;
  status: "healthy" | "degraded" | "down";
  uptime: string;
  version: string;
  metrics: { label: string; value: string; unit?: string }[];
  icon: typeof Server;
  color: string;
}

const services: ServiceStatus[] = [
  {
    name: "Kamailio SIP Proxy",
    description: "SIP registrar, proxy, load balancer, NAT traversal",
    status: "healthy",
    uptime: "6d 4h 23m",
    version: "5.8.4",
    metrics: [
      { label: "Active Registrations", value: "156" },
      { label: "Active Dialogs", value: "24" },
      { label: "TPS (current)", value: "45", unit: "req/s" },
      { label: "Memory Usage", value: "67", unit: "MB" },
    ],
    icon: Server,
    color: "#2F81F7",
  },
  {
    name: "FreeSWITCH Media Server",
    description: "Media processing, transcoding, conferencing",
    status: "healthy",
    uptime: "6d 4h 23m",
    version: "1.10.12",
    metrics: [
      { label: "Active Channels", value: "48" },
      { label: "Calls/sec", value: "12", unit: "cps" },
      { label: "CPU Usage", value: "23", unit: "%" },
      { label: "Memory Usage", value: "512", unit: "MB" },
    ],
    icon: Phone,
    color: "#3FB950",
  },
  {
    name: "RTPEngine",
    description: "RTP proxy for media relay and NAT traversal",
    status: "healthy",
    uptime: "6d 4h 23m",
    version: "mr12.5",
    metrics: [
      { label: "Active Streams", value: "48" },
      { label: "Packet Loss", value: "0.02", unit: "%" },
      { label: "Avg Jitter", value: "3.2", unit: "ms" },
      { label: "Port Range", value: "30000-40000" },
    ],
    icon: Wifi,
    color: "#A371F7",
  },
  {
    name: "SIP TLS (Port 5061)",
    description: "Encrypted SIP signaling with Let's Encrypt certificate",
    status: "healthy",
    uptime: "2h 15m",
    version: "TLSv1.2+",
    metrics: [
      { label: "Certificate", value: "sip.phone11.ai" },
      { label: "Issuer", value: "Let's Encrypt E8" },
      { label: "Expires", value: "Jul 25, 2026" },
      { label: "Active Connections", value: "12" },
    ],
    icon: Shield,
    color: "#3FB950",
  },
  {
    name: "WSS WebSocket (Port 7443)",
    description: "WebSocket Secure for WebRTC browser clients",
    status: "healthy",
    uptime: "2h 15m",
    version: "RFC 7118",
    metrics: [
      { label: "Active WebSockets", value: "8" },
      { label: "Certificate", value: "sip.phone11.ai" },
      { label: "Protocol", value: "WSS (TLS)" },
      { label: "WebRTC Clients", value: "5" },
    ],
    icon: Globe,
    color: "#D29922",
  },
  {
    name: "PostgreSQL Database",
    description: "AWS RDS PostgreSQL for CDR, users, and configuration",
    status: "healthy",
    uptime: "30d+",
    version: "16.4",
    metrics: [
      { label: "Connections", value: "12/100" },
      { label: "Storage Used", value: "2.3", unit: "GB" },
      { label: "Query Latency", value: "1.2", unit: "ms" },
      { label: "Region", value: "ap-southeast-7" },
    ],
    icon: HardDrive,
    color: "#2F81F7",
  },
];

const serverMetrics = {
  voip: {
    hostname: "ip-10-0-1-69",
    ip: "43.210.122.111 (10.0.1.69)",
    os: "Ubuntu 22.04 LTS",
    cpu: { usage: 34, cores: 4 },
    memory: { used: 2.8, total: 8, unit: "GB" },
    disk: { used: 12, total: 50, unit: "GB" },
    network: { in: "45 Mbps", out: "38 Mbps" },
  },
  backend: {
    hostname: "ip-10-0-2-156",
    ip: "43.209.112.208 (10.0.2.156)",
    os: "Ubuntu 22.04 LTS",
    cpu: { usage: 12, cores: 2 },
    memory: { used: 1.2, total: 4, unit: "GB" },
    disk: { used: 8, total: 30, unit: "GB" },
    network: { in: "12 Mbps", out: "8 Mbps" },
  },
};

const statusIcon: Record<string, typeof CheckCircle> = {
  healthy: CheckCircle,
  degraded: AlertTriangle,
  down: XCircle,
};

const statusColor: Record<string, string> = {
  healthy: "#3FB950",
  degraded: "#D29922",
  down: "#F85149",
};

export default function SystemPage() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              System Status
            </h1>
            <p className="text-sm text-[#8B949E] mt-0.5">Infrastructure health monitoring</p>
          </div>
          <button className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#161B22] border border-[#21262D] rounded-md text-[#C9D1D9] hover:border-[#30363D] transition-colors">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        {/* Overall status banner */}
        <div className="bg-[#3FB95010] border border-[#3FB95030] rounded-lg p-4 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-[#3FB950]" />
          <div>
            <p className="text-sm font-medium text-[#3FB950]">All Systems Operational</p>
            <p className="text-xs text-[#8B949E]">All {services.length} services are running normally</p>
          </div>
        </div>

        {/* Server Resources */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Object.entries(serverMetrics).map(([key, server]) => (
            <div key={key} className="bg-[#161B22] border border-[#21262D] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <Server className="w-4 h-4 text-[#2F81F7]" />
                <h3 className="text-sm font-medium text-white capitalize">{key} Server</h3>
                <span className="text-[10px] font-mono text-[#484F58]">{server.ip}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {/* CPU */}
                <div className="bg-[#0D1117] rounded-md p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Cpu className="w-3 h-3 text-[#8B949E]" />
                    <span className="text-[10px] text-[#8B949E] uppercase tracking-wider">CPU</span>
                  </div>
                  <div className="flex items-end gap-1">
                    <span className="text-lg font-bold text-white font-mono">{server.cpu.usage}%</span>
                    <span className="text-[10px] text-[#484F58] mb-0.5">{server.cpu.cores} cores</span>
                  </div>
                  <div className="mt-2 h-1.5 bg-[#21262D] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${server.cpu.usage}%`,
                        backgroundColor: server.cpu.usage > 80 ? "#F85149" : server.cpu.usage > 60 ? "#D29922" : "#3FB950",
                      }}
                    />
                  </div>
                </div>
                {/* Memory */}
                <div className="bg-[#0D1117] rounded-md p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <MemoryStick className="w-3 h-3 text-[#8B949E]" />
                    <span className="text-[10px] text-[#8B949E] uppercase tracking-wider">Memory</span>
                  </div>
                  <div className="flex items-end gap-1">
                    <span className="text-lg font-bold text-white font-mono">{server.memory.used}</span>
                    <span className="text-[10px] text-[#484F58] mb-0.5">/ {server.memory.total} {server.memory.unit}</span>
                  </div>
                  <div className="mt-2 h-1.5 bg-[#21262D] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#2F81F7] transition-all"
                      style={{ width: `${(server.memory.used / server.memory.total) * 100}%` }}
                    />
                  </div>
                </div>
                {/* Disk */}
                <div className="bg-[#0D1117] rounded-md p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <HardDrive className="w-3 h-3 text-[#8B949E]" />
                    <span className="text-[10px] text-[#8B949E] uppercase tracking-wider">Disk</span>
                  </div>
                  <div className="flex items-end gap-1">
                    <span className="text-lg font-bold text-white font-mono">{server.disk.used}</span>
                    <span className="text-[10px] text-[#484F58] mb-0.5">/ {server.disk.total} {server.disk.unit}</span>
                  </div>
                  <div className="mt-2 h-1.5 bg-[#21262D] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#A371F7] transition-all"
                      style={{ width: `${(server.disk.used / server.disk.total) * 100}%` }}
                    />
                  </div>
                </div>
                {/* Network */}
                <div className="bg-[#0D1117] rounded-md p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Activity className="w-3 h-3 text-[#8B949E]" />
                    <span className="text-[10px] text-[#8B949E] uppercase tracking-wider">Network</span>
                  </div>
                  <div className="text-xs text-[#C9D1D9] space-y-1 mt-1">
                    <div className="flex justify-between">
                      <span className="text-[#8B949E]">In:</span>
                      <span className="font-mono">{server.network.in}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B949E]">Out:</span>
                      <span className="font-mono">{server.network.out}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Services Grid */}
        <h2 className="text-sm font-medium text-white">Services</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((svc) => {
            const StatusIcon = statusIcon[svc.status];
            return (
              <div
                key={svc.name}
                className="bg-[#161B22] border border-[#21262D] rounded-lg p-4 hover:border-[#30363D] transition-colors relative overflow-hidden"
              >
                <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ backgroundColor: svc.color }} />
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ backgroundColor: `${svc.color}15` }}>
                      <svc.icon className="w-4 h-4" style={{ color: svc.color }} />
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-white">{svc.name}</h3>
                      <p className="text-[10px] text-[#484F58]">v{svc.version}</p>
                    </div>
                  </div>
                  <StatusIcon className="w-4 h-4" style={{ color: statusColor[svc.status] }} />
                </div>
                <p className="text-xs text-[#8B949E] mb-3">{svc.description}</p>
                <div className="space-y-1.5">
                  {svc.metrics.map((m) => (
                    <div key={m.label} className="flex items-center justify-between text-xs">
                      <span className="text-[#484F58]">{m.label}</span>
                      <span className="font-mono text-[#C9D1D9]">
                        {m.value}
                        {m.unit && <span className="text-[#484F58] ml-0.5">{m.unit}</span>}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-2 border-t border-[#21262D] flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-[#484F58]" />
                  <span className="text-[10px] text-[#484F58]">Uptime: {svc.uptime}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AdminLayout>
  );
}
