/*
 * SIP TLS/WSS Security Page
 * TLS certificate status and WSS endpoint configuration
 */
import AdminLayout from "@/components/AdminLayout";
import {
  Shield,
  Lock,
  Globe,
  Key,
  CheckCircle,
  AlertTriangle,
  Clock,
  RefreshCw,
  Copy,
  ExternalLink,
  FileText,
  Server,
} from "lucide-react";
import { useState } from "react";

const endpoints = [
  {
    protocol: "SIP UDP",
    uri: "sip:sip.phone11.ai:5060",
    port: 5060,
    status: "active",
    encrypted: false,
    description: "Standard SIP over UDP (unencrypted)",
  },
  {
    protocol: "SIP TCP",
    uri: "sip:sip.phone11.ai:5060",
    port: 5060,
    status: "active",
    encrypted: false,
    description: "SIP over TCP (unencrypted)",
  },
  {
    protocol: "SIP TLS",
    uri: "sips:sip.phone11.ai:5061",
    port: 5061,
    status: "active",
    encrypted: true,
    description: "SIP over TLS (encrypted signaling)",
  },
  {
    protocol: "WSS",
    uri: "wss://wss.phone11.ai:7443",
    port: 7443,
    status: "active",
    encrypted: true,
    description: "WebSocket Secure for WebRTC clients",
  },
];

const certificate = {
  subject: "sip.phone11.ai",
  san: ["sip.phone11.ai", "media.phone11.ai", "wss.phone11.ai"],
  issuer: "Let's Encrypt E8",
  serialNumber: "67ab3b135a40308aef8c0b8be00206f0a67",
  keyType: "ECDSA P-256",
  protocol: "TLSv1.2+",
  notBefore: "Apr 26, 2026 13:15:40 UTC",
  notAfter: "Jul 25, 2026 13:15:39 UTC",
  daysRemaining: 89,
  autoRenewal: true,
  lastRenewal: "Apr 26, 2026",
  certPath: "/etc/letsencrypt/live/sip.phone11.ai/fullchain.pem",
  keyPath: "/etc/letsencrypt/live/sip.phone11.ai/privkey.pem",
};

const securityChecks = [
  { label: "TLS 1.2+ enforced", status: "pass", detail: "Minimum TLSv1.2 required for all TLS connections" },
  { label: "Strong cipher suites", status: "pass", detail: "HIGH:!aNULL:!MD5 cipher configuration" },
  { label: "Certificate valid", status: "pass", detail: `Valid for ${certificate.daysRemaining} more days` },
  { label: "Auto-renewal configured", status: "pass", detail: "Certbot renewal hook installed" },
  { label: "SRTP media encryption", status: "pass", detail: "SRTP enforced for TLS/WSS calls" },
  { label: "SIP digest auth", status: "pass", detail: "MD5/SHA-256 digest authentication enabled" },
  { label: "Rate limiting (PIKE)", status: "pass", detail: "Anti-flood protection active" },
  { label: "Topology hiding", status: "warning", detail: "Internal IPs may be exposed in SIP headers" },
];

export default function SecurityPage() {
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              SIP TLS / WSS Security
            </h1>
            <p className="text-sm text-[#8B949E] mt-0.5">Transport encryption and certificate management</p>
          </div>
          <button className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#161B22] border border-[#21262D] rounded-md text-[#C9D1D9] hover:border-[#30363D] transition-colors">
            <RefreshCw className="w-4 h-4" /> Renew Certificate
          </button>
        </div>

        {/* Certificate Status Card */}
        <div className="bg-[#161B22] border border-[#21262D] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-[#21262D] flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#3FB950]" />
            <h2 className="text-sm font-medium text-white">TLS Certificate</h2>
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full bg-[#3FB95015] text-[#3FB950]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#3FB950] animate-pulse" />
              Valid
            </span>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                {[
                  { label: "Subject", value: certificate.subject },
                  { label: "SAN", value: certificate.san.join(", ") },
                  { label: "Issuer", value: certificate.issuer },
                  { label: "Key Type", value: certificate.keyType },
                  { label: "Protocol", value: certificate.protocol },
                ].map((item) => (
                  <div key={item.label} className="flex items-start gap-3">
                    <span className="text-xs text-[#484F58] w-20 flex-shrink-0 pt-0.5">{item.label}</span>
                    <span className="text-xs font-mono text-[#C9D1D9]">{item.value}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                {[
                  { label: "Valid From", value: certificate.notBefore },
                  { label: "Expires", value: certificate.notAfter },
                  { label: "Days Left", value: `${certificate.daysRemaining} days`, highlight: true },
                  { label: "Auto-Renew", value: certificate.autoRenewal ? "Enabled" : "Disabled" },
                  { label: "Last Renewed", value: certificate.lastRenewal },
                ].map((item) => (
                  <div key={item.label} className="flex items-start gap-3">
                    <span className="text-xs text-[#484F58] w-24 flex-shrink-0 pt-0.5">{item.label}</span>
                    <span className={`text-xs font-mono ${item.highlight ? "text-[#3FB950] font-medium" : "text-[#C9D1D9]"}`}>
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Certificate expiry progress bar */}
            <div className="mt-4 pt-4 border-t border-[#21262D]">
              <div className="flex items-center justify-between text-xs text-[#8B949E] mb-2">
                <span>Certificate Lifetime</span>
                <span>{certificate.daysRemaining} / 90 days remaining</span>
              </div>
              <div className="h-2 bg-[#21262D] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#3FB950] transition-all"
                  style={{ width: `${(certificate.daysRemaining / 90) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* SIP Endpoints */}
        <div className="bg-[#161B22] border border-[#21262D] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-[#21262D] flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#2F81F7]" />
            <h2 className="text-sm font-medium text-white">SIP Endpoints</h2>
          </div>
          <div className="divide-y divide-[#21262D]">
            {endpoints.map((ep) => (
              <div key={ep.protocol} className="px-4 py-3 flex items-center gap-4 hover:bg-[#1C2333] transition-colors">
                <div className="w-10 h-10 rounded-md flex items-center justify-center bg-[#0D1117]">
                  {ep.encrypted ? (
                    <Lock className="w-4 h-4 text-[#3FB950]" />
                  ) : (
                    <Globe className="w-4 h-4 text-[#8B949E]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{ep.protocol}</span>
                    {ep.encrypted && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#3FB95015] text-[#3FB950]">Encrypted</span>
                    )}
                  </div>
                  <p className="text-xs text-[#484F58] mt-0.5">{ep.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-[#C9D1D9] bg-[#0D1117] px-2 py-1 rounded border border-[#21262D]">
                    {ep.uri}
                  </code>
                  <button
                    onClick={() => copyToClipboard(ep.uri, ep.protocol)}
                    className="p-1.5 rounded-md text-[#8B949E] hover:text-[#C9D1D9] hover:bg-[#21262D] transition-colors"
                  >
                    {copied === ep.protocol ? (
                      <CheckCircle className="w-3.5 h-3.5 text-[#3FB950]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Security Audit */}
        <div className="bg-[#161B22] border border-[#21262D] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-[#21262D] flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#A371F7]" />
            <h2 className="text-sm font-medium text-white">Security Audit</h2>
            <span className="ml-auto text-xs text-[#8B949E]">
              {securityChecks.filter((c) => c.status === "pass").length}/{securityChecks.length} passed
            </span>
          </div>
          <div className="divide-y divide-[#21262D]">
            {securityChecks.map((check) => (
              <div key={check.label} className="px-4 py-2.5 flex items-center gap-3 hover:bg-[#1C2333] transition-colors">
                {check.status === "pass" ? (
                  <CheckCircle className="w-4 h-4 text-[#3FB950] flex-shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-[#D29922] flex-shrink-0" />
                )}
                <div className="flex-1">
                  <span className="text-sm text-[#C9D1D9]">{check.label}</span>
                </div>
                <span className="text-xs text-[#484F58]">{check.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
