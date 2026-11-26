"use client";
import { useEffect, useState } from "react";

type Intrusion = {
  id: number;
  attacker_ip: string;
  target_port: number;
  raw_payload: string | null;
  created_at: string;
};

type TempRecord = {
  id: number;
  temperature: number;
  humidity: number | null;
  sensor_ip: string | null;
  created_at: string;
};

type MaintenanceLog = {
  id: number;
  username: string;
  action: string;
  notes: string | null;
  created_at: string;
};

export default function Home() {
  const [intrusions, setIntrusions] = useState<Intrusion[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'telemetry' | 'forensic' | 'settings' | 'terminal'>('telemetry');
  const [isPaused, setIsPaused] = useState(false);
  const [clearBufferDate, setClearBufferDate] = useState<Date | null>(null);
  const [systemStatus, setSystemStatus] = useState<'SAFE' | 'WARNING' | 'CRITICAL'>('SAFE');
  const [liveSearch, setLiveSearch] = useState('');

  // Server Room Temperature (3-Hour Retention) & Maintenance Mode States
  const [latestTemp, setLatestTemp] = useState<TempRecord | null>(null);
  const [tempHistory3h, setTempHistory3h] = useState<TempRecord[]>([]);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceUser, setMaintenanceUser] = useState<string | null>(null);

  // Maintenance Login Modal
  const [showMaintModal, setShowMaintModal] = useState(false);
  const [maintUsername, setMaintUsername] = useState('');
  const [maintPassword, setMaintPassword] = useState('');
  const [maintNotes, setMaintNotes] = useState('');
  const [maintError, setMaintError] = useState('');
  const [maintSubmitting, setMaintSubmitting] = useState(false);

  // Password Gate for Forensic & Maintenance Logs
  const [logsUnlocked, setLogsUnlocked] = useState(false);
  const [logsAuthUser, setLogsAuthUser] = useState('');
  const [logsPasswordInput, setLogsPasswordInput] = useState('');
  const [logsAuthError, setLogsAuthError] = useState('');
  const [maintenanceLogs, setMaintenanceLogs] = useState<MaintenanceLog[]>([]);

  // Forensic Filters
  const [filterDate, setFilterDate] = useState('');
  const [filterPort, setFilterPort] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchTemperaturesAndStatus = async () => {
    try {
      const res = await fetch("http://127.0.0.1:8000/api/honeypot/temperatures");
      const data = await res.json();
      if (data) {
        setMaintenanceMode(Boolean(data.maintenance_mode));
        setMaintenanceUser(data.maintenance_user || null);
        if (data.latest) setLatestTemp(data.latest);
        if (Array.isArray(data.history_3h)) setTempHistory3h(data.history_3h);
      }
    } catch {
      // Abaikan jika backend sedang restart
    }
  };

  const fetchIntrusions = async () => {
    try {
      const res = await fetch("http://127.0.0.1:8000/api/honeypot/history");
      const data = await res.json();
      if (Array.isArray(data)) {
        setIntrusions(prev => {
          if (prev.length > 0 && data.length > 0 && data[0].id !== prev[0].id) {
            const port = Number(data[0].target_port);
            let newLevel: 'WARNING' | 'CRITICAL' = 'WARNING';
            if (port === 22 || port === 80 || port === 443 || port === 999) {
              newLevel = 'CRITICAL';
            } else if (port === 21 || port === 23 || port === 998) {
              newLevel = 'WARNING';
            }
            
            setSystemStatus(current => {
              // Jangan turunkan CRITICAL menjadi WARNING jika belum di-reset SAFE
              if (current === 'CRITICAL' && newLevel === 'WARNING') return 'CRITICAL';
              return newLevel;
            });
          }
          return data;
        });
      }
      fetchTemperaturesAndStatus();
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (!isPaused) {
      fetchIntrusions();
      interval = setInterval(fetchIntrusions, 2000);
    }
    return () => clearInterval(interval);
  }, [isPaused]);

  const handleSimulate = async (level: 'SAFE' | 'WARNING' | 'CRITICAL' | 'PIR') => {
    const mappedStatus = level === 'PIR' ? 'CRITICAL' : level;
    setSystemStatus(mappedStatus);
    if (level === 'SAFE') {
      // Kirim perintah RESET/SAFE langsung ke PQC Gateway (:3005) -> EMQX Online -> ESP32
      try {
        await fetch("http://127.0.0.1:3005/api/pqc/command", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'SAFE' })
        });
      } catch {
        // Fallback ke Node-RED jika PQC Gateway sedang restart
      }
      return;
    }

    const payload = level === 'PIR'
      ? { attacker_ip: 'PHYSICAL-PIR', target_port: 999, raw_payload: 'PHYSICAL BREACH: Motion detected at Server Rack -> Servo LOCKED [90 deg] | Temp: 26.8C' }
      : level === 'CRITICAL' 
      ? { attacker_ip: '192.168.1.99', target_port: 22, raw_payload: 'SIMULASI: ssh login brute-force attempt -> Servo LOCKED [90 deg]' }
      : { attacker_ip: '10.0.0.123', target_port: 23, raw_payload: 'SIMULASI: telnet root attempt [RackTemp:26.5C]' };

    try {
      await fetch("http://127.0.0.1:8000/api/honeypot/log", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload)
      });
      fetchIntrusions();
    } catch (err) {
      console.error('Simulate failed', err);
    }
  };

  const handleToggleMaintenance = async (e: React.FormEvent) => {
    e.preventDefault();
    setMaintError('');
    setMaintSubmitting(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/honeypot/maintenance", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          username: maintUsername,
          password: maintPassword,
          notes: maintNotes || (maintenanceMode ? 'Selesai perbaikan ruang server' : 'Perbaikan ruang server & pengecekan rak'),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setMaintError(data.message || 'Username atau Password salah!');
      } else {
        setMaintenanceMode(Boolean(data.maintenance_mode));
        setMaintenanceUser(data.maintenance_user || null);
        if (data.maintenance_mode) {
          setSystemStatus('SAFE');
        }
        // Teruskan perintah MAINTENANCE_ON / MAINTENANCE_OFF langsung ke PQC Gateway (:3005) -> EMQX -> ESP32
        try {
          await fetch("http://127.0.0.1:3005/api/pqc/command", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              command: data.mqtt_command || (data.maintenance_mode ? 'MAINTENANCE_ON' : 'MAINTENANCE_OFF')
            }),
          });
        } catch {
          // Abaikan jika sudah dikirim oleh Laravel
        }
        setShowMaintModal(false);
        setMaintPassword('');
        setMaintNotes('');
      }
    } catch {
      setMaintError('Gagal menghubungi server Laravel.');
    } finally {
      setMaintSubmitting(false);
    }
  };

  const handleUnlockLogs = async (e: React.FormEvent) => {
    e.preventDefault();
    setLogsAuthError('');
    try {
      const res = await fetch("http://127.0.0.1:8000/api/honeypot/verify-logs", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          username: logsAuthUser || 'admin',
          password: logsPasswordInput,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setLogsAuthError(data.message || 'Password salah!');
      } else {
        setLogsUnlocked(true);
        if (Array.isArray(data.maintenance_logs)) {
          setMaintenanceLogs(data.maintenance_logs);
        }
        if (Array.isArray(data.intrusions)) {
          setIntrusions(data.intrusions);
        }
      }
    } catch {
      setLogsAuthError('Gagal memverifikasi password ke server.');
    }
  };

  const getSeverity = (port: number) => {
    const p = Number(port);
    if (p === 22 || p === 80 || p === 443 || p === 999) {
      return {
        level: 'CRITICAL',
        label: p === 999 ? 'Physical Breach' : 'Critical',
        dotColor: 'bg-rose-400',
        badgeClass: 'bg-rose-500/15 text-rose-200 border-rose-300/25',
        barColor: 'bg-rose-400/90'
      };
    }
    if (p === 21 || p === 23 || p === 998) {
      return {
        level: 'WARNING',
        label: p === 998 ? 'Thermal Alert' : 'Warning',
        dotColor: 'bg-yellow-400',
        badgeClass: 'bg-yellow-500/20 text-yellow-200 border-yellow-300/35',
        barColor: 'bg-yellow-400/90'
      };
    }
    return {
      level: 'INFO',
      label: 'Normal',
      dotColor: 'bg-teal-300',
      badgeClass: 'bg-white/10 text-slate-200 border-white/20',
      barColor: 'bg-teal-300/85'
    };
  };

  const getPortName = (port: number) => {
    const map: Record<number, string> = {
      21: 'FTP',
      22: 'SSH',
      23: 'Telnet',
      80: 'HTTP',
      443: 'HTTPS',
      3306: 'MySQL',
      998: 'DHT Thermal',
      999: 'PIR Motion',
    };
    return map[port] || 'TCP';
  };

  const filteredIntrusions = intrusions.filter(item => {
    if (filterPort !== 'ALL' && item.target_port.toString() !== filterPort) return false;
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const ip = item.attacker_ip.toLowerCase();
      const payload = (item.raw_payload || '').toLowerCase();
      if (!ip.includes(q) && !payload.includes(q)) return false;
    }
    
    if (filterDate) {
      const itemDate = new Date(item.created_at).toISOString().split('T')[0];
      if (itemDate !== filterDate) return false;
    }
    
    return true;
  });

  const liveFilteredIntrusions = intrusions.filter(item => {
    if (clearBufferDate && new Date(item.created_at) <= clearBufferDate) return false;
    if (!liveSearch) return true;
    const q = liveSearch.toLowerCase();
    return (
      item.attacker_ip.toLowerCase().includes(q) ||
      item.target_port.toString().includes(q) ||
      (item.raw_payload || '').toLowerCase().includes(q)
    );
  });

  const portCounts: Record<number, number> = {};
  intrusions.forEach(item => {
    portCounts[item.target_port] = (portCounts[item.target_port] || 0) + 1;
  });
  
  const sortedPorts = Object.entries(portCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4);

  const totalProbes = intrusions.length;
  const mostProbedPort = sortedPorts.length > 0 ? sortedPorts[0][0] : '—';
  const lastIntrusion = intrusions[0];
  const lastSeverity = lastIntrusion ? getSeverity(lastIntrusion.target_port) : null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        .glass-wallpaper {
          background-color: #0b1120;
          background-image:
            radial-gradient(at 12% 18%, rgba(45, 212, 191, 0.24) 0px, transparent 50%),
            radial-gradient(at 88% 15%, rgba(56, 189, 248, 0.22) 0px, transparent 50%),
            radial-gradient(at 52% 85%, rgba(99, 102, 241, 0.22) 0px, transparent 55%),
            radial-gradient(at 20% 82%, rgba(14, 165, 233, 0.16) 0px, transparent 45%),
            linear-gradient(135deg, #090d16 0%, #0f172a 50%, #0b1324 100%);
          background-attachment: fixed;
        }
        .glass-wallpaper-warning {
          background-color: #261c04;
          background-image:
            radial-gradient(at 15% 20%, rgba(250, 204, 21, 0.45) 0px, transparent 55%),
            radial-gradient(at 85% 25%, rgba(234, 179, 8, 0.40) 0px, transparent 55%),
            radial-gradient(at 50% 85%, rgba(245, 158, 11, 0.35) 0px, transparent 60%),
            linear-gradient(135deg, #1f1703 0%, #2e2105 50%, #1c1403 100%);
          background-attachment: fixed;
        }
        .glass-wallpaper-critical {
          background-color: #1f090d;
          background-image:
            radial-gradient(at 15% 20%, rgba(244, 63, 94, 0.38) 0px, transparent 55%),
            radial-gradient(at 85% 25%, rgba(220, 38, 38, 0.35) 0px, transparent 55%),
            radial-gradient(at 50% 85%, rgba(190, 18, 60, 0.30) 0px, transparent 60%),
            linear-gradient(135deg, #160609 0%, #240a10 50%, #17060a 100%);
          background-attachment: fixed;
        }
        .frosted-card {
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.11) 0%, rgba(255, 255, 255, 0.04) 100%);
          backdrop-filter: blur(24px) saturate(160%);
          -webkit-backdrop-filter: blur(24px) saturate(160%);
          border: 1px solid rgba(255, 255, 255, 0.16);
          box-shadow:
            0 12px 32px -4px rgba(0, 0, 0, 0.35),
            inset 0 1px 1px 0 rgba(255, 255, 255, 0.28),
            inset 0 -1px 1px 0 rgba(255, 255, 255, 0.04);
        }
        .frosted-pill {
          background: rgba(255, 255, 255, 0.08);
          backdrop-filter: blur(16px) saturate(140%);
          -webkit-backdrop-filter: blur(16px) saturate(140%);
          border: 1px solid rgba(255, 255, 255, 0.15);
          box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.2);
        }
        .frosted-well {
          background: rgba(9, 13, 22, 0.42);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.25);
        }
        .material-symbols-outlined {
          font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 20;
          display: inline-block;
          vertical-align: middle;
          line-height: 1;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.18);
          border-radius: 9999px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.32);
        }
        @keyframes cursor-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        .blinking-cursor {
          animation: cursor-blink 1s infinite;
        }
      `}} />

      <div className={`min-h-screen flex flex-col font-body-md text-slate-100 antialiased selection:bg-teal-400/25 selection:text-teal-100 transition-colors duration-700 ${
        systemStatus === 'CRITICAL'
          ? 'glass-wallpaper-critical'
          : systemStatus === 'WARNING'
          ? 'glass-wallpaper-warning'
          : 'glass-wallpaper'
      }`}>
        
        {/* Tense Emergency Glass Frame (Active until Acknowledge / Safe is clicked) */}
        {systemStatus !== 'SAFE' && (
          <div className={`pointer-events-none fixed inset-0 z-40 border-[6px] transition-opacity duration-500 ${
            systemStatus === 'CRITICAL'
              ? 'border-rose-500/85 shadow-[inset_0_0_120px_rgba(244,63,94,0.5)] animate-pulse'
              : 'border-yellow-400/90 shadow-[inset_0_0_110px_rgba(250,204,21,0.45)] animate-pulse'
          }`} />
        )}

        {/* FLOATING GLASS HEADER */}
        <header className="sticky top-3 z-50 mx-4 md:mx-6 mt-3">
          <div className="max-w-[1440px] mx-auto frosted-card rounded-2xl px-5 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center border transition-colors ${
                  systemStatus === 'CRITICAL' ? 'bg-rose-500/25 border-rose-300/40 text-rose-200' :
                  systemStatus === 'WARNING' ? 'bg-amber-500/25 border-amber-300/40 text-amber-200' :
                  'bg-white/10 border-white/25 text-teal-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]'
                }`}>
                  <span className="material-symbols-outlined text-base" data-icon="radar">radar</span>
                </div>
                <div>
                  <span className="text-sm font-headline-md tracking-tight text-white font-semibold">HoneyTrap</span>
                  <span className="text-xs text-slate-300/80 font-code-sm ml-2">/ esp32-node-01</span>
                </div>
              </div>

              <nav className="hidden md:flex items-center gap-1 p-1 rounded-xl bg-black/20 border border-white/10">
                {[
                  { id: 'telemetry', label: 'Overview' },
                  { id: 'forensic', label: 'Forensic logs' },
                  { id: 'terminal', label: 'Live shell' },
                  { id: 'settings', label: 'Settings' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as typeof activeTab)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 ${
                      activeTab === tab.id
                        ? 'bg-white/15 text-white border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'
                        : 'text-slate-300 hover:text-white hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>

            <div className="flex items-center gap-2.5 z-50">
              {systemStatus !== 'SAFE' && (
                <button
                  onClick={() => handleSimulate('SAFE')}
                  className="font-medium text-xs text-white px-3.5 py-1.5 rounded-xl border border-rose-300/50 bg-rose-500/80 hover:bg-rose-500 backdrop-blur-md shadow-[0_4px_20px_rgba(244,63,94,0.45),inset_0_1px_0_rgba(255,255,255,0.35)] transition-colors flex items-center gap-1.5"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                  Acknowledge &amp; Unlock Servo
                </button>
              )}

              <button
                onClick={() => setIsPaused(!isPaused)}
                className={`hidden sm:flex items-center gap-2 text-xs font-medium px-3.5 py-1.5 rounded-xl transition-colors duration-150 ${
                  isPaused
                    ? 'bg-amber-500/20 text-amber-200 border border-amber-300/30'
                    : 'frosted-pill text-slate-100 hover:bg-white/15'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isPaused ? 'bg-amber-300' : 'bg-teal-300'}`} />
                {isPaused ? 'Paused' : 'Streaming (2s)'}
              </button>

              <button
                onClick={() => alert(`Detected ${intrusions.filter(i => getSeverity(i.target_port).level === 'CRITICAL').length} critical events in history.`)}
                className="p-1.5 rounded-xl frosted-pill text-slate-200 hover:text-white hover:bg-white/15 transition-colors"
                title="Critical Alert Summary"
              >
                <span className="material-symbols-outlined text-base" data-icon="notifications">notifications</span>
              </button>
            </div>
          </div>
        </header>

        <div className="flex flex-1 w-full max-w-[1440px] mx-auto px-4 md:px-6 py-5 gap-5">
          {/* FROSTED GLASS SIDEBAR */}
          <aside className="hidden lg:flex flex-col justify-between w-60 shrink-0 frosted-card rounded-2xl p-4 h-[calc(100vh-6.2rem)] sticky top-20">
            <div className="space-y-5">
              <div className="p-3 rounded-xl frosted-well">
                <div className="text-xs font-medium text-white">Sensor network</div>
                <div className="text-[11px] font-code-sm text-slate-300/80 mt-0.5 tabular-nums">192.168.1.0/24 · VLAN 10</div>
              </div>

              <div className="space-y-1">
                <div className="px-2.5 pb-1 text-[11px] font-medium text-slate-300/70">Workspace</div>
                {[
                  { id: 'telemetry', label: 'Telemetry stream', icon: 'monitoring' },
                  { id: 'forensic', label: 'Forensic archive', icon: 'manage_search' },
                  { id: 'terminal', label: 'Terminal feed', icon: 'terminal' },
                  { id: 'settings', label: 'Node configuration', icon: 'tune' },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id as typeof activeTab)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-150 ${
                      activeTab === item.id
                        ? 'bg-white/15 text-white border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'
                        : 'text-slate-300 border border-transparent hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <span className="material-symbols-outlined text-base opacity-85">{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="p-3 rounded-xl frosted-well space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-300">
                <span>Decoy node</span>
                <span className="flex items-center gap-1.5 text-white font-code-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-300" />
                  Online
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-300/80 font-code-sm tabular-nums">
                <span>Ports open</span>
                <span>21, 22, 23, 80</span>
              </div>
            </div>
          </aside>

          {/* MAIN CONTENT */}
          <main className="flex-1 min-w-0 space-y-5">
            {activeTab === 'telemetry' ? (
              <>
                {/* STATUS BAR & SIMULATION CONTROLS */}
                <div className="frosted-card rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium ${
                      systemStatus === 'SAFE'
                        ? 'frosted-pill text-white'
                        : systemStatus === 'WARNING'
                        ? 'bg-amber-500/20 text-amber-100 border-amber-300/35'
                        : 'bg-rose-500/25 text-rose-100 border-rose-300/40'
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${
                        systemStatus === 'SAFE' ? 'bg-teal-300' : systemStatus === 'WARNING' ? 'bg-amber-300 animate-ping' : 'bg-rose-400 animate-ping'
                      }`} />
                      <span>State: <strong className="font-semibold">{systemStatus}</strong></span>
                    </div>

                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium ${
                      systemStatus === 'CRITICAL'
                        ? 'bg-rose-500/25 text-rose-100 border-rose-300/40'
                        : 'frosted-pill text-teal-200'
                    }`}>
                      <span className="material-symbols-outlined text-sm">
                        {systemStatus === 'CRITICAL' ? 'lock' : 'lock_open'}
                      </span>
                      <span>
                        Rack Servo: <strong className="font-semibold">{systemStatus === 'CRITICAL' ? 'LOCKED (90°)' : 'UNLOCKED (0°)'}</strong>
                      </span>
                    </div>

                    <button
                      onClick={() => {
                        setMaintError('');
                        setShowMaintModal(true);
                      }}
                      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border text-xs font-medium transition-all ${
                        maintenanceMode
                          ? 'bg-sky-500/25 text-sky-100 border-sky-300/50 shadow-[0_0_20px_rgba(56,189,248,0.35)] animate-pulse'
                          : 'frosted-pill text-slate-100 hover:bg-white/15'
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm">build</span>
                      <span>
                        {maintenanceMode
                          ? `Mode Perbaikan: AKTIF (${maintenanceUser || 'Teknisi'}) · PIR Nonaktif`
                          : 'Mode Perbaikan Ruang Server'}
                      </span>
                    </button>

                    <div className="flex items-center gap-1 frosted-well p-1 rounded-xl">
                      <span className="px-2.5 text-[11px] text-slate-300/80">Simulate:</span>
                      <button
                        onClick={() => handleSimulate('SAFE')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                          systemStatus === 'SAFE'
                            ? 'bg-white/15 text-white border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        Safe (Unlock)
                      </button>
                      <button
                        onClick={() => handleSimulate('WARNING')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                          systemStatus === 'WARNING'
                            ? 'bg-amber-500/25 text-amber-100 border border-amber-300/35'
                            : 'text-slate-300 hover:text-amber-200'
                        }`}
                      >
                        Warning (Port 23)
                      </button>
                      <button
                        onClick={() => handleSimulate('CRITICAL')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                          systemStatus === 'CRITICAL'
                            ? 'bg-rose-500/30 text-rose-100 border border-rose-300/40'
                            : 'text-slate-300 hover:text-rose-200'
                        }`}
                      >
                        Critical (Port 22)
                      </button>
                      <button
                        onClick={() => handleSimulate('PIR')}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium text-rose-200 hover:bg-rose-500/25 transition-all"
                      >
                        PIR Motion (Lockdown)
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {clearBufferDate && (
                      <button
                        onClick={() => setClearBufferDate(null)}
                        className="text-xs text-slate-300 hover:text-white px-2.5 py-1"
                      >
                        Restore history
                      </button>
                    )}
                    <button
                      onClick={() => setClearBufferDate(new Date())}
                      className="frosted-pill hover:bg-white/15 text-slate-100 text-xs font-medium px-3.5 py-1.5 rounded-xl transition-colors flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-sm">clear_all</span>
                      Clear view buffer
                    </button>
                  </div>
                </div>

                {/* SUMMARY CARDS (4 Cards: Probes, Port Distribution, Server Room Temp 3H, Latest Incident) */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-5">
                  {/* Primary Metric (3 cols) */}
                  <div className="lg:col-span-3 frosted-card rounded-2xl p-5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between text-xs text-slate-200/90">
                        <span>Total captured probes</span>
                        <span className="font-code-sm text-[11px] text-slate-300/75">All time</span>
                      </div>
                      <div className="mt-3 flex items-baseline gap-3">
                        <span className="text-4xl font-semibold text-white tracking-tight font-code-lg tabular-nums">
                          {intrusions.length.toLocaleString()}
                        </span>
                        <span className="text-xs text-slate-200/80 tabular-nums">
                          {intrusions.filter(i => getSeverity(i.target_port).level === 'CRITICAL').length} critical
                        </span>
                      </div>
                    </div>

                    <div className="mt-6 pt-3.5 border-t border-white/15 flex items-center justify-between text-xs">
                      <span className="text-slate-300">Primary target</span>
                      <span className="font-code-sm text-white font-medium tabular-nums">
                        {mostProbedPort !== '—' ? `Port ${mostProbedPort} (${getPortName(Number(mostProbedPort))})` : 'No traffic'}
                      </span>
                    </div>
                  </div>

                  {/* Port Distribution Horizontal Bars (3 cols) */}
                  <div className="lg:col-span-3 frosted-card rounded-2xl p-5 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-xs text-slate-200/90 mb-3">
                      <span>Port distribution</span>
                      <span className="font-code-sm text-[11px] text-slate-300/75">Top 4</span>
                    </div>

                    <div className="space-y-2.5 flex-1 flex flex-col justify-center">
                      {sortedPorts.map(([portStr, count]) => {
                        const port = parseInt(portStr);
                        const percentage = totalProbes > 0 ? ((count / totalProbes) * 100).toFixed(1) : '0.0';
                        const { barColor } = getSeverity(port);
                        return (
                          <div key={port} className="space-y-1">
                            <div className="flex justify-between text-xs font-code-sm tabular-nums">
                              <span className="text-white">:{port} <span className="text-slate-300/80">{getPortName(port)}</span></span>
                              <span className="text-slate-200/90">{count} ({percentage}%)</span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-black/30 border border-white/10 overflow-hidden">
                              <div className={`h-full rounded-full ${barColor} transition-all duration-300`} style={{ width: `${percentage}%` }} />
                            </div>
                          </div>
                        );
                      })}
                      {sortedPorts.length === 0 && (
                        <div className="text-xs text-slate-300/70 py-6 text-center">No probe activity recorded yet.</div>
                      )}
                    </div>
                  </div>

                  {/* Server Room Temperature Card (3-Hour Rolling Window) (3 cols) */}
                  <div className="lg:col-span-3 frosted-card rounded-2xl p-5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between text-xs text-slate-200/90">
                        <span>Suhu Ruang Server</span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-code-sm bg-teal-500/15 text-teal-200 border border-teal-300/25">
                          Retensi 3 Jam
                        </span>
                      </div>
                      <div className="mt-3 flex items-baseline justify-between">
                        <div className="flex items-baseline gap-2">
                          <span className="text-3xl font-semibold text-white tracking-tight font-code-lg tabular-nums">
                            {latestTemp ? `${Number(latestTemp.temperature).toFixed(1)}°C` : '26.5°C'}
                          </span>
                          <span className="text-xs text-teal-200 font-code-sm tabular-nums">
                            {latestTemp && latestTemp.humidity ? `${Number(latestTemp.humidity).toFixed(0)}% RH` : '54% RH'}
                          </span>
                        </div>
                      </div>
                      <div className="mt-3 frosted-well rounded-xl p-2 space-y-1 max-h-20 overflow-y-auto custom-scrollbar">
                        <div className="text-[10px] text-slate-300/75 flex justify-between">
                          <span>Riwayat 3 Jam Terakhir ({tempHistory3h.length} log)</span>
                          <span>WIB</span>
                        </div>
                        {tempHistory3h.slice(0, 4).map((t) => (
                          <div key={t.id} className="flex justify-between text-[11px] font-code-sm text-slate-200 tabular-nums">
                            <span>{Number(t.temperature).toFixed(1)}°C / {Number(t.humidity ?? 54).toFixed(0)}%</span>
                            <span className="text-slate-400">
                              {new Date(t.created_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-white/15 flex items-center justify-between text-[11px] text-slate-300/80 font-code-sm">
                      <span>Sensor gerak PIR</span>
                      <span className={maintenanceMode ? 'text-sky-300 font-semibold' : 'text-teal-300 font-semibold'}>
                        {maintenanceMode ? 'BYPASSED (Perbaikan)' : 'ARMED (Aktif)'}
                      </span>
                    </div>
                  </div>

                  {/* Latest Incident Inspector (3 cols) */}
                  <div className="lg:col-span-3 frosted-card rounded-2xl p-5 flex flex-col justify-between">
                    <div className="flex items-center justify-between text-xs text-slate-200/90">
                      <span>Latest incident</span>
                      {lastSeverity && (
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${lastSeverity.badgeClass}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${lastSeverity.dotColor}`} />
                          {lastSeverity.label}
                        </span>
                      )}
                    </div>

                    {lastIntrusion ? (
                      <div className="my-3 space-y-2.5">
                        <div className="flex items-baseline justify-between">
                          <span className="font-code-lg text-lg font-semibold text-white tabular-nums">{lastIntrusion.attacker_ip}</span>
                          <span className="font-code-sm text-xs text-slate-200/90 tabular-nums">
                            Port {lastIntrusion.target_port}
                          </span>
                        </div>
                        <div className="frosted-well rounded-xl p-2.5 font-code-sm text-xs">
                          <div className="text-[11px] text-slate-300/75 mb-0.5">Captured payload</div>
                          <div className="text-white truncate">{lastIntrusion.raw_payload || 'Empty payload'}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-300/70 py-6 text-center">Waiting for incoming packets...</div>
                    )}

                    <div className="pt-2.5 border-t border-white/15 flex items-center justify-between text-[11px] text-slate-300/80 font-code-sm tabular-nums">
                      <span>Timestamp (WIB)</span>
                      <span>{lastIntrusion ? new Date(lastIntrusion.created_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }) : '—'}</span>
                    </div>
                  </div>
                </div>

                {/* SPLIT WORKSPACE: LIVE TABLE (7 cols) + TERMINAL STREAM (5 cols) */}
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
                  {/* Recent Intrusions Table */}
                  <div className="xl:col-span-7 frosted-card rounded-2xl overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-white/15 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-sm font-medium text-white">Incoming packet log</h2>
                      </div>
                      <div className="relative w-full sm:w-64">
                        <span className="material-symbols-outlined absolute left-3 top-2 text-slate-300/80 text-sm" data-icon="search">search</span>
                        <input
                          value={liveSearch}
                          onChange={(e) => setLiveSearch(e.target.value)}
                          className="w-full pl-8 pr-3 py-1.5 rounded-xl frosted-well font-code-sm text-xs text-white placeholder-slate-300/60 focus:outline-none focus:border-white/35 transition-colors"
                          placeholder="Filter IP, port, payload..."
                          type="text"
                        />
                      </div>
                    </div>

                    <div className="overflow-x-auto max-h-[420px] overflow-y-auto custom-scrollbar">
                      <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-slate-900/75 backdrop-blur-xl border-b border-white/15">
                          <tr className="text-slate-200/90 text-[11px] font-medium">
                            <th className="py-2.5 px-4 font-medium">Time</th>
                            <th className="py-2.5 px-4 font-medium">Source IP</th>
                            <th className="py-2.5 px-4 font-medium">Port</th>
                            <th className="py-2.5 px-4 font-medium">Payload</th>
                            <th className="py-2.5 px-4 font-medium text-right">Severity</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10 font-code-sm text-xs tabular-nums">
                          {loading ? (
                            <tr><td colSpan={5} className="p-8 text-center text-slate-300/70">Loading telemetry...</td></tr>
                          ) : liveFilteredIntrusions.length === 0 ? (
                            <tr><td colSpan={5} className="p-8 text-center text-slate-300/70">No events in current buffer.</td></tr>
                          ) : (
                            liveFilteredIntrusions.map((item) => {
                              const { label, dotColor, badgeClass } = getSeverity(item.target_port);
                              return (
                                <tr key={item.id} className="hover:bg-white/[0.07] transition-colors">
                                  <td className="py-2.5 px-4 text-slate-300 whitespace-nowrap">
                                    {new Date(item.created_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false })}
                                  </td>
                                  <td className="py-2.5 px-4 text-white font-medium whitespace-nowrap">
                                    {item.attacker_ip}
                                  </td>
                                  <td className="py-2.5 px-4 text-slate-200 whitespace-nowrap">
                                    :{item.target_port} <span className="text-slate-300/70 text-[11px]">{getPortName(item.target_port)}</span>
                                  </td>
                                  <td className="py-2.5 px-4 max-w-[220px]">
                                    <code className="text-xs text-slate-100 truncate block">{item.raw_payload || '—'}</code>
                                  </td>
                                  <td className="py-2.5 px-4 whitespace-nowrap text-right">
                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] border ${badgeClass}`}>
                                      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                                      {label}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Serial / Daemon Log Stream */}
                  <div className="xl:col-span-5 frosted-card rounded-2xl overflow-hidden flex flex-col h-[475px]">
                    <div className="px-4 py-3.5 border-b border-white/15 flex items-center justify-between bg-white/[0.04]">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-teal-300" />
                        <span className="font-code-sm text-xs text-white font-medium">sensor-feed.tty1</span>
                      </div>
                      <span className="font-code-sm text-[11px] text-slate-300/80">115200 baud</span>
                    </div>

                    <div className="p-4 bg-slate-950/45 font-code-sm text-xs text-slate-200 space-y-2 flex-1 overflow-y-auto custom-scrollbar leading-relaxed tabular-nums">
                      <div className="text-slate-400">[boot] esp32 listener active on 21, 22, 23, 80</div>
                      {intrusions.slice(0, 25).map((item) => {
                        const { level } = getSeverity(item.target_port);
                        const levelText = level === 'CRITICAL' ? 'text-rose-300 font-semibold' : level === 'WARNING' ? 'text-amber-300 font-semibold' : 'text-teal-200';
                        return (
                          <div key={item.id} className="leading-snug">
                            <span className="text-slate-400">{new Date(item.created_at).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false })}</span>{' '}
                            <span className={levelText}>[{level.toLowerCase()}]</span>{' '}
                            <span className="text-white">{item.attacker_ip}</span>
                            <span className="text-slate-400"> -&gt; :{item.target_port} </span>
                            <span className="text-slate-300">&quot;{item.raw_payload || ''}&quot;</span>
                          </div>
                        );
                      })}
                      <div className="flex items-center gap-1.5 text-teal-200 pt-1">
                        <span>$</span>
                        <span className="inline-block w-2 h-3.5 bg-teal-200 blinking-cursor" />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : activeTab === 'forensic' ? (
              // PASSWORD-PROTECTED FORENSIC & MAINTENANCE LOGS TAB
              !logsUnlocked ? (
                <div className="frosted-card rounded-2xl p-8 min-h-[65vh] flex flex-col items-center justify-center">
                  <form onSubmit={handleUnlockLogs} className="w-full max-w-md frosted-well rounded-2xl p-6 space-y-4 border border-white/15">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-teal-500/20 border border-teal-300/30 flex items-center justify-center text-teal-200">
                        <span className="material-symbols-outlined">lock</span>
                      </div>
                      <div>
                        <h2 className="text-base font-semibold text-white">Proteksi Arsip Log &amp; Perbaikan</h2>
                        <p className="text-xs text-slate-300/80">Masukkan kredensial teknisi/admin untuk membuka log</p>
                      </div>
                    </div>

                    {logsAuthError && (
                      <div className="p-2.5 rounded-xl bg-rose-500/20 border border-rose-400/40 text-xs text-rose-200">
                        {logsAuthError}
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="text-xs text-slate-200">Username Teknisi / Admin</label>
                      <input
                        type="text"
                        value={logsAuthUser}
                        onChange={(e) => setLogsAuthUser(e.target.value)}
                        placeholder="admin / teknisi / gopi"
                        className="w-full px-3.5 py-2 rounded-xl bg-black/40 border border-white/15 text-xs text-white focus:outline-none focus:border-teal-300/60"
                        required
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-slate-200">Password</label>
                      <input
                        type="password"
                        value={logsPasswordInput}
                        onChange={(e) => setLogsPasswordInput(e.target.value)}
                        placeholder="Masukkan password..."
                        className="w-full px-3.5 py-2 rounded-xl bg-black/40 border border-white/15 text-xs text-white focus:outline-none focus:border-teal-300/60"
                        required
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2.5 rounded-xl bg-teal-500/80 hover:bg-teal-500 text-white text-xs font-semibold border border-teal-300/40 shadow-lg transition-all"
                    >
                      Buka Arsip Forensik &amp; Log Perbaikan
                    </button>
                  </form>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* TABEL 1: LOG PERBAIKAN RUANG SERVER (MAINTENANCE LOGS) */}
                  <div className="frosted-card rounded-2xl overflow-hidden">
                    <div className="px-5 py-4 border-b border-white/15 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-base font-medium text-white">Log Perbaikan Ruang Server (Maintenance Audit)</h2>
                        <p className="text-xs text-slate-300/80 mt-0.5">Rekam jejak teknisi yang mengaktifkan/menonaktifkan bypass sensor gerak PIR</p>
                      </div>
                      <button
                        onClick={() => {
                          setLogsUnlocked(false);
                          setLogsPasswordInput('');
                        }}
                        className="frosted-pill hover:bg-white/15 text-xs text-slate-200 px-3 py-1.5 rounded-xl flex items-center gap-1.5"
                      >
                        <span className="material-symbols-outlined text-sm">lock</span>
                        Kunci Kembali Log
                      </button>
                    </div>
                    <div className="overflow-x-auto max-h-60 overflow-y-auto custom-scrollbar">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-white/15 text-slate-200 text-[11px] font-medium bg-white/[0.03]">
                            <th className="py-2.5 px-4">ID</th>
                            <th className="py-2.5 px-4">Waktu (WIB)</th>
                            <th className="py-2.5 px-4">Username Teknisi</th>
                            <th className="py-2.5 px-4">Aksi Perbaikan</th>
                            <th className="py-2.5 px-4">Catatan</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10 font-code-sm text-xs tabular-nums">
                          {maintenanceLogs.length === 0 ? (
                            <tr><td colSpan={5} className="p-6 text-center text-slate-300/70">Belum ada riwayat perbaikan ruang server.</td></tr>
                          ) : (
                            maintenanceLogs.map((ml) => (
                              <tr key={ml.id} className="hover:bg-white/[0.06]">
                                <td className="py-2.5 px-4 text-slate-300/80">#{ml.id}</td>
                                <td className="py-2.5 px-4 text-slate-200">
                                  {new Date(ml.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false })}
                                </td>
                                <td className="py-2.5 px-4 text-white font-semibold">{ml.username}</td>
                                <td className="py-2.5 px-4">
                                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] border ${
                                    ml.action === 'START_MAINTENANCE'
                                      ? 'bg-sky-500/20 text-sky-200 border-sky-300/35'
                                      : 'bg-teal-500/20 text-teal-200 border-teal-300/35'
                                  }`}>
                                    {ml.action === 'START_MAINTENANCE' ? 'MULAI PERBAIKAN (PIR OFF)' : 'SELESAI PERBAIKAN (PIR ON)'}
                                  </span>
                                </td>
                                <td className="py-2.5 px-4 text-slate-200">{ml.notes || '—'}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* TABEL 2: ARSIP FORENSIK SEMUA SERANGAN HONEYPOT & FISIK */}
                  <div className="frosted-card rounded-2xl flex flex-col min-h-[55vh] overflow-hidden">
                    <div className="px-5 py-4 border-b border-white/15 flex items-center justify-between">
                      <div>
                        <h2 className="text-base font-medium text-white">Forensic Archive (Cyber Honeypot &amp; Physical PIR Intrusions)</h2>
                        <p className="text-xs text-slate-300/80 mt-0.5">Seluruh rekaman serangan siber (Port 21, 22, 23, 80) dan penyusupan fisik (PIR 999)</p>
                      </div>
                      <span className="text-xs font-code-sm text-slate-200 tabular-nums">{filteredIntrusions.length} matching records</span>
                    </div>
                    
                    <div className="p-4 border-b border-white/15 bg-white/[0.03] flex gap-3 items-end flex-wrap">
                      <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
                        <label className="text-xs text-slate-200">Date</label>
                        <input
                          type="date"
                          value={filterDate}
                          onChange={(e) => setFilterDate(e.target.value)}
                          className="rounded-xl px-3 py-1.5 frosted-well text-white focus:outline-none focus:border-white/35 font-code-sm text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
                        <label className="text-xs text-slate-200">Target port / Sensor</label>
                        <select
                          value={filterPort}
                          onChange={(e) => setFilterPort(e.target.value)}
                          className="rounded-xl px-3 py-1.5 frosted-well text-white focus:outline-none focus:border-white/35 text-xs"
                        >
                          <option value="ALL" className="bg-slate-900">All ports &amp; sensors</option>
                          <option value="999" className="bg-slate-900">999 (Physical PIR Motion)</option>
                          <option value="998" className="bg-slate-900">998 (DHT Thermal Alert)</option>
                          <option value="22" className="bg-slate-900">22 (SSH)</option>
                          <option value="80" className="bg-slate-900">80 (HTTP)</option>
                          <option value="443" className="bg-slate-900">443 (HTTPS)</option>
                          <option value="23" className="bg-slate-900">23 (Telnet)</option>
                          <option value="21" className="bg-slate-900">21 (FTP)</option>
                        </select>
                      </div>
                      <div className="flex flex-col gap-1 flex-[2] min-w-[240px]">
                        <label className="text-xs text-slate-200">Search IP or payload</label>
                        <div className="relative">
                          <span className="material-symbols-outlined absolute left-3 top-2 text-slate-300/80 text-sm">search</span>
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="e.g. PHYSICAL-PIR, 192.168..., or root"
                            className="w-full pl-8 pr-3 py-1.5 rounded-xl frosted-well text-white placeholder-slate-300/60 focus:outline-none focus:border-white/35 font-code-sm text-xs"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto flex-1">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-white/15 text-slate-200 text-[11px] font-medium bg-white/[0.03]">
                            <th className="py-3 px-4 font-medium">ID</th>
                            <th className="py-3 px-4 font-medium">Timestamp (WIB)</th>
                            <th className="py-3 px-4 font-medium">Source IP / Sensor</th>
                            <th className="py-3 px-4 font-medium">Port / Type</th>
                            <th className="py-3 px-4 font-medium">Payload</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10 font-code-sm text-xs tabular-nums">
                          {filteredIntrusions.length === 0 ? (
                            <tr><td colSpan={5} className="p-8 text-center text-slate-300/70">No matching records found.</td></tr>
                          ) : (
                            filteredIntrusions.map((item) => (
                              <tr key={item.id} className="hover:bg-white/[0.07] transition-colors">
                                <td className="py-3 px-4 text-slate-300/80">#{item.id}</td>
                                <td className="py-3 px-4 text-slate-200">{new Date(item.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false })}</td>
                                <td className="py-3 px-4 text-white font-medium">{item.attacker_ip}</td>
                                <td className="py-3 px-4 text-slate-200">:{item.target_port} ({getPortName(item.target_port)})</td>
                                <td className="py-3 px-4 text-slate-100 break-all">{item.raw_payload || '—'}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )
            ) : activeTab === 'settings' ? (
              <div className="frosted-card rounded-2xl p-6 space-y-5">
                <div className="border-b border-white/15 pb-4">
                  <h2 className="text-base font-medium text-white">Node configuration</h2>
                  <p className="text-xs text-slate-300/80 mt-0.5">Manage ESP32 decoy listeners and alert dispatch rules</p>
                </div>
                <div className="space-y-3">
                  <div className="p-4 rounded-xl frosted-well flex flex-wrap justify-between items-center gap-4">
                    <div>
                      <h3 className="text-sm font-medium text-white">Decoy TCP listeners</h3>
                      <p className="text-slate-300/80 text-xs mt-0.5">Active ports emulated on the sensor node (21, 22, 23, 80).</p>
                    </div>
                    <button className="frosted-pill hover:bg-white/15 text-white px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors">
                      Configure ports
                    </button>
                  </div>
                  <div className="p-4 rounded-xl frosted-well flex flex-wrap justify-between items-center gap-4">
                    <div>
                      <h3 className="text-sm font-medium text-white">Webhook &amp; Telegram dispatch</h3>
                      <p className="text-slate-300/80 text-xs mt-0.5">Forward critical port 22/80 events to external incident channels.</p>
                    </div>
                    <button className="frosted-pill hover:bg-white/15 text-white px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors">
                      Edit webhook
                    </button>
                  </div>
                  <div className="p-4 rounded-xl frosted-well flex flex-wrap justify-between items-center gap-4">
                    <div>
                      <h3 className="text-sm font-medium text-white">Alarm classification</h3>
                      <p className="text-slate-300/80 text-xs mt-0.5">Adjust port-to-severity mapping for warning and critical states.</p>
                    </div>
                    <button className="frosted-pill hover:bg-white/15 text-white px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors">
                      Edit rules
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="frosted-card rounded-2xl overflow-hidden flex flex-col h-[75vh]">
                <div className="bg-white/[0.04] border-b border-white/15 px-5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2 h-2 rounded-full bg-teal-300" />
                    <span className="font-code-sm text-xs text-white font-medium">root@honeytrap-soc:~ (live stream)</span>
                  </div>
                  <span className="font-code-sm text-xs text-slate-300/80">GET /api/honeypot/history</span>
                </div>
                <div className="p-5 bg-slate-950/50 font-code-sm text-xs text-slate-200 space-y-2 flex-1 overflow-y-auto custom-scrollbar leading-relaxed tabular-nums">
                  <div className="text-slate-400"># HoneyTrap telemetry stream connected to http://127.0.0.1:8000</div>
                  {intrusions.slice(0, 50).map((item) => {
                    const { level } = getSeverity(item.target_port);
                    return (
                      <div key={item.id} className="flex flex-wrap items-start gap-2 border-b border-white/10 pb-1.5">
                        <span className="text-slate-400">{new Date(item.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false })}</span>
                        <span className={level === 'CRITICAL' ? 'text-rose-300 font-medium' : level === 'WARNING' ? 'text-amber-300' : 'text-teal-200'}>
                          [{level}]
                        </span>
                        <span className="text-white">{item.attacker_ip}</span>
                        <span className="text-slate-400">-&gt;</span>
                        <span className="text-slate-200">:{item.target_port}</span>
                        <span className="text-slate-300">{item.raw_payload}</span>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-2 pt-2">
                    <span className="text-teal-200">root@honeytrap-soc:~#</span>
                    <span className="inline-block w-2 h-4 bg-teal-200 blinking-cursor" />
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>

        {/* MODAL AUTENTIKASI MODE PERBAIKAN RUANG SERVER */}
        {showMaintModal && (
          <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-4">
            <form
              onSubmit={handleToggleMaintenance}
              className="w-full max-w-md frosted-card rounded-2xl p-6 space-y-4 border border-white/20"
            >
              <div className="flex items-center justify-between border-b border-white/15 pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-sky-300">build_circle</span>
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      {maintenanceMode ? 'Selesaikan Mode Perbaikan Ruang Server' : 'Aktifkan Mode Perbaikan Ruang Server'}
                    </h3>
                    <p className="text-[11px] text-slate-300/80">
                      {maintenanceMode
                        ? 'Sensor Gerak PIR akan diaktifkan kembali setelah konfirmasi'
                        : 'Sensor Gerak PIR akan di-bypass agar teknisi tidak memicu alarm'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMaintModal(false)}
                  className="text-slate-300 hover:text-white text-sm"
                >
                  ✕
                </button>
              </div>

              {maintError && (
                <div className="p-2.5 rounded-xl bg-rose-500/20 border border-rose-400/40 text-xs text-rose-200">
                  {maintError}
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs text-slate-200">Username Teknisi</label>
                <input
                  type="text"
                  value={maintUsername}
                  onChange={(e) => setMaintUsername(e.target.value)}
                  placeholder="admin / teknisi / gopi"
                  className="w-full px-3.5 py-2 rounded-xl frosted-well text-xs text-white focus:outline-none focus:border-sky-300/60"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-200">Password</label>
                <input
                  type="password"
                  value={maintPassword}
                  onChange={(e) => setMaintPassword(e.target.value)}
                  placeholder="Masukkan password teknisi..."
                  className="w-full px-3.5 py-2 rounded-xl frosted-well text-xs text-white focus:outline-none focus:border-sky-300/60"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-200">Catatan Perbaikan (Disimpan ke Database)</label>
                <input
                  type="text"
                  value={maintNotes}
                  onChange={(e) => setMaintNotes(e.target.value)}
                  placeholder="Contoh: Perbaikan kabel rak server & kalibrasi sensor"
                  className="w-full px-3.5 py-2 rounded-xl frosted-well text-xs text-white focus:outline-none focus:border-sky-300/60"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowMaintModal(false)}
                  className="px-4 py-2 rounded-xl frosted-pill text-xs text-slate-200 hover:bg-white/15"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={maintSubmitting}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold text-white border transition-all ${
                    maintenanceMode
                      ? 'bg-teal-500/80 hover:bg-teal-500 border-teal-300/40'
                      : 'bg-sky-500/80 hover:bg-sky-500 border-sky-300/40'
                  }`}
                >
                  {maintSubmitting
                    ? 'Memverifikasi...'
                    : maintenanceMode
                    ? 'Selesai Perbaikan & Aktifkan PIR'
                    : 'Mulai Perbaikan (Nonaktifkan PIR)'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </>
  );
}
