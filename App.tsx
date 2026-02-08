
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Save, 
  LayoutTemplate, 
  FileText, 
  Edit3, 
  Tag, 
  Send, 
  PhoneCall, 
  Circle,
  Clock,
  ChevronLeft,
  Phone,
  BarChart3,
  Download,
  Share2
} from 'lucide-react';
import { AppState, ModalType, ViewType, CallLog, CallStatus } from './types';

// Helper Components
const Card: React.FC<{ children: React.ReactNode; className?: string; onClick?: () => void }> = ({ children, className = "", onClick }) => (
  <div 
    onClick={onClick}
    className={`bg-[#1c1f2e] border border-[#2d3142] rounded-2xl p-4 shadow-xl transition-all ${onClick ? 'cursor-pointer active:scale-95 hover:border-purple-500/50' : ''} ${className}`}
  >
    {children}
  </div>
);

const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    {...props}
    className={`bg-[#2d3142] border border-[#3e445a] text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 w-full transition-all ${props.className}`}
  />
);

const Toggle: React.FC<{ enabled: boolean; onChange: (v: boolean) => void }> = ({ enabled, onChange }) => (
  <button
    onClick={() => onChange(!enabled)}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
      enabled ? 'bg-emerald-500' : 'bg-gray-600'
    }`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
        enabled ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);

// Generate a dialing queue based on base 7-digit series, starting last4, and number of attempts
function generateQueue(base: string, last4: string, attempts: number, shuffle: boolean): string[] {
  const start = Math.max(0, Math.min(9999, parseInt((last4 || '0').replace(/\D/g, '') || '0', 10)));
  const count = Math.max(0, Math.min(10000, attempts | 0));
  const arr: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = (start + i) % 10000;
    const sfx = n.toString().padStart(4, '0');
    arr.push(`${base}${sfx}`);
  }
  if (shuffle) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
  return arr;
}

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<ViewType>('dialer');
  const [exporting, setExporting] = useState<string | null>(null);
  
  const [state, setState] = useState<AppState>({
    agentName: '',
    branchName: '',
    baseNumber: '0000000',
    last4: '0000',
    attempts: 5,
    isShuffle: false,
    interval: 5,
    autoSmsEnabled: true,
    autoSmsAnsweredEnabled: false,
    adminPhone: '',
    isSystemActive: true,
    isDialerActive: true,
    callLogs: [],
    smsTemplateAnswered: 'Thank you for answering! We appreciate your time.',
    smsTemplateUnanswered: 'Thank you! We tried reaching you. Please call us back.',
    isCallActive: false
  });
  const DEFAULT_SHEET = '1UuE_F_zRG2SbHqJL5EZz9g8-9Rr75gUCEBwhLn3jtTg';

  const [activeModal, setActiveModal] = useState<ModalType>(null);

  // New state for updating modal
  const [showUpdatingModal, setShowUpdatingModal] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0); // 0-100
  const [smsTemplateBeingEdited, setSmsTemplateBeingEdited] = useState<'answered' | 'unanswered' | null>(null);
  const [lastCallStatus, setLastCallStatus] = useState<CallStatus | null>(null);
  const [lastCalledNumber, setLastCalledNumber] = useState<string | null>(null);
  const [dncNumbers, setDncNumbers] = useState<Set<string>>(new Set());
  const [dncCount, setDncCount] = useState<number>(0);
  const [skippedDueToDnc, setSkippedDueToDnc] = useState<boolean>(false);
  const [dncCountdownSeconds, setDncCountdownSeconds] = useState<number | null>(null);
  const [awaitingUserFormSubmit, setAwaitingUserFormSubmit] = useState<boolean>(false);
  const [partialCallData, setPartialCallData] = useState<{ number: string; callStatus: CallStatus } | null>(null);

  // computed dialing queue preview
  const queue = useMemo(
    () => generateQueue(state.baseNumber, state.last4, state.attempts, state.isShuffle),
    [state.baseNumber, state.last4, state.attempts, state.isShuffle]
  );

  const handleSave = () => {
    // persist full admin details
    saveAdmin({
      agentName: state.agentName,
      branchName: state.branchName,
      series: state.series ?? state.baseNumber,
      googleSheetId: state.googleSheetId || DEFAULT_SHEET
    });
    setSuccessModal('Settings saved');
  };
  const closeModal = () => setActiveModal(null);

  // Admin + reports state
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState<null | { range: string }>(null);
  const [editingLog, setEditingLog] = useState<null | CallLog>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [successModal, setSuccessModal] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [postCallInterval, setPostCallInterval] = useState<number>(12);

  const showToast = (msg: string, ms = 2000) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  };

  useEffect(() => {
    // load saved admin settings from localStorage
    const saved = localStorage.getItem('accm_admin');
    if (saved) {
      try { const parsed = JSON.parse(saved); setState(prev => ({ ...prev, ...parsed })); } catch(e){}
    }

    // Initialize DNC on app start
    const initializeDnc = async () => {
      try {
        const dncSet = await fetchDnc();
        setDncNumbers(dncSet);
        setDncCount(dncSet.size);
        // Save count to localStorage
        localStorage.setItem('accm_dnc_count', dncSet.size.toString());
        showToast(`DNC loaded: ${dncSet.size} numbers`);
      } catch (e) {
        console.error('Failed to load DNC:', e);
      }
    };

    // Load DNC if not already cached
    const cachedDnc = localStorage.getItem('accm_dnc');
    if (cachedDnc) {
      try {
        const parsed = JSON.parse(cachedDnc);
        setDncNumbers(new Set(parsed));
        setDncCount(parsed.length);
      } catch (e) {
        initializeDnc();
      }
    } else {
      initializeDnc();
    }

    // try loading admin from Android bridge if present
    try {
      const sa: any = (window as any).AndroidApp;
      if (sa && typeof sa.loadAdmin === 'function') {
        const raw = sa.loadAdmin();
        try {
          const parsed = JSON.parse(raw || '{}');
          setState(prev => ({
            ...prev,
            agentName: parsed.agentName || prev.agentName,
            branchName: parsed.branchName || prev.branchName,
            series: parsed.series || prev.series,
            googleSheetId: parsed.googleSheetId || prev.googleSheetId || DEFAULT_SHEET
          }));
        } catch (e) {
          setErrorModal(`Failed to parse native admin data: ${String(e)}`);
        }
      }
      // register a global error hook for native to call
      ;(window as any).ACCM_onError = (msg: string) => {
        setErrorModal(String(msg || 'Unknown error'));
      };
      ;(window as any).ACCM_onInfo = (msg: string) => {
        setSuccessModal(String(msg || 'Success'));
      };
      // native can notify upload progress and countdown
      ;(window as any).ACCM_onUploadStart = () => setSuccessModal('Uploading Record...');
      ;(window as any).ACCM_onUploadDone = (ok: boolean, message?: string) => {
        if (ok) setSuccessModal('Record uploaded. Preparing next call...'); else setErrorModal(message || 'Upload failed');
      };
      ;(window as any).ACCM_onCountdown = (sec: number) => {
        // if countdown hits 0 and there is no next number in queue, clear it to avoid being stuck
        if (sec <= 0) {
          setTimeout(() => setCountdown(null), 800);
        }
        setCountdown(sec);
      };
      // Callback for when a call is completed
      ;(window as any).ACCM_onCallCompleted = (phoneNumber: string, callStatus: string) => {
        setLastCalledNumber(phoneNumber);
        setLastCallStatus(callStatus as CallStatus);
        setState(p => ({ ...p, isCallActive: false }));
        
        // Check if this was a DNC number that should have been filtered
        // Skip logging if it's in DNC
        if (isNumberInDnc(phoneNumber)) {
          // Show DNC skip notification with countdown, but don't show form
          setSkippedDueToDnc(true);
          setDncCountdownSeconds(3);
          const dncCountdown = setInterval(() => {
            setDncCountdownSeconds(prev => {
              if (prev === null || prev <= 1) {
                clearInterval(dncCountdown);
                setDncCountdownSeconds(null);
                setSkippedDueToDnc(false);
                // Notify native to proceed to next number
                const sa: any = (window as any).AndroidApp;
                if (sa && typeof sa.proceedToNextCall === 'function') {
                  sa.proceedToNextCall();
                }
                return null;
              }
              return prev - 1;
            });
          }, 1000);
          return; // Don't show form for DNC numbers
        }
        
        // Trigger auto-SMS after call (only for non-DNC)
        triggerAutoSms(phoneNumber, callStatus as CallStatus);
        // Set to await user form submission instead of auto-uploading
        setPartialCallData({ number: phoneNumber, callStatus: callStatus as CallStatus });
        setAwaitingUserFormSubmit(true);
        setEditingLog({
          id: `call_${Date.now()}`,
          number: phoneNumber,
          duration: '00:00',
          status: callStatus as CallStatus,
          timestamp: new Date()
        });
      };
    } catch (e) {
      // ignore in browser
    }

    const onlineHandler = () => showToast("You're Online!", 1800);
    const offlineHandler = () => showToast('No internet connection. Exporting will not work.', 4000);
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
    return () => {
      window.removeEventListener('online', onlineHandler);
      window.removeEventListener('offline', offlineHandler);
    };
  }, []);

  const saveAdmin = (payload: Partial<AppState>) => {
    try {
      const toSave = {
        agentName: payload.agentName ?? state.agentName,
        branchName: payload.branchName ?? state.branchName,
        series: payload.series ?? state.series ?? state.baseNumber,
        googleSheetId: payload.googleSheetId ?? state.googleSheetId ?? DEFAULT_SHEET
      };
      localStorage.setItem('accm_admin', JSON.stringify(toSave));
      setState(p => ({ ...p, ...toSave }));
      // also persist to Android if available
      const sa: any = (window as any).AndroidApp;
      if (sa) {
        try {
          if (typeof sa.saveAdminEx === 'function') {
            sa.saveAdminEx(toSave.agentName, toSave.series, toSave.googleSheetId, toSave.branchName);
          } else if (typeof sa.saveAdmin === 'function') {
            sa.saveAdmin(toSave.agentName, toSave.series, toSave.googleSheetId);
          }
        } catch (e) {
          setErrorModal(`Native saveAdmin failed: ${String(e)}`);
        }
      }
      showToast('Settings saved');
    } catch (e) {
      setErrorModal(`Failed to save settings: ${String(e)}`);
    }
  };

  const fetchDnc = async () => {
    // try cache first
    const cached = localStorage.getItem('accm_dnc');
    if (cached) return new Set(JSON.parse(cached) as string[]);
    try {
      const res = await fetch('https://subd.nocollateralloan.org/dnc.txt', { cache: 'force-cache' });
      const txt = await res.text();
      const matches = Array.from(txt.matchAll(/\d{7,}/g)).map(m => m[0]);
      localStorage.setItem('accm_dnc', JSON.stringify(matches));
      localStorage.setItem('accm_dnc_count', matches.length.toString());
      return new Set(matches);
    } catch (e) {
      showToast('Failed to load DNC (offline?)');
      return new Set<string>();
    }
  };

  // Check if number is in DNC list
  const isNumberInDnc = (phoneNumber: string): boolean => {
    for (const dncNum of dncNumbers) {
      // Check if DNC number is contained in the phone number or vice versa
      if (phoneNumber.includes(dncNum) || dncNum.includes(phoneNumber)) {
        return true;
      }
    }
    return false;
  };

  const handleExportRange = async (rangeName: string) => {
    // open modal for reporting inputs
    setShowReportModal({ range: rangeName });
  };

  const uploadCsvToServer = async (filename: string, csv: string) => {
    if (!navigator.onLine) { showToast('Offline — cannot upload now'); return false; }
    try {
      const target = `https://subd.nocollateralloan.org/reports/${encodeURIComponent(filename)}`;
      const res = await fetch(target, { method: 'PUT', headers: { 'Content-Type': 'text/csv' }, body: csv });
      if (!res.ok) throw new Error('Upload failed');
      showToast('Uploaded report');
      return true;
    } catch (e) {
      console.error(e);
      showToast('Upload failed — check server/CORS');
      return false;
    }
  };

  // SMS sending helper function
  const sendSms = async (phoneNumber: string, message: string): Promise<boolean> => {
    if (!phoneNumber || !message) return false;
    
    try {
      // Try to use native Android bridge if available
      const sa: any = (window as any).AndroidApp;
      if (sa && typeof sa.sendSms === 'function') {
        sa.sendSms(phoneNumber, message);
        return true;
      }
      
      // Fallback: Try using Twilio or another SMS API
      // This would require backend setup with API credentials
      const response = await fetch('https://api.sms-service.com/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, message })
      }).catch(() => null);
      
      if (response?.ok) return true;
      
      // If all else fails, log to console
      console.log(`[SMS] To: ${phoneNumber}, Message: ${message}`);
      return false;
    } catch (e) {
      console.warn('SMS sending failed:', e);
      return false;
    }
  };

  // Handle auto-SMS after call completion
  const triggerAutoSms = async (phoneNumber: string, callStatus: CallStatus) => {
    let shouldSendSms = false;
    let template = '';

    if (callStatus === 'ANSWERED' && state.autoSmsAnsweredEnabled) {
      shouldSendSms = true;
      template = state.smsTemplateAnswered || 'Thank you for answering! We appreciate your time.';
    } else if (callStatus === 'UNANSWERED' && state.autoSmsEnabled) {
      shouldSendSms = true;
      template = state.smsTemplateUnanswered || 'Thank you! We tried reaching you. Please call us back.';
    }

    if (shouldSendSms && template) {
      const sent = await sendSms(phoneNumber, template);
      if (sent) {
        showToast(`Auto-SMS sent to ${phoneNumber}`);
      }
    }
  };

  const exportAll = async () => {
    // build CSV from callLogs (skip for now if empty)
    const rows = [['Date','Time Log','Phone Number','Agent Name','Calls','Responses','Texts (Outbound)','Texts (Inbound)','Qualified','Status','Series']];
    state.callLogs.forEach(l => {
      rows.push([
        new Date().toLocaleDateString(),
        l.timestamp.toLocaleTimeString(),
        l.number,
        state.agentName,
        '', '', '', '', '', l.status, ''
      ]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const filename = `${state.agentName || 'Agent'} - ${new Date().toLocaleDateString()}.csv`;
    await uploadCsvToServer(filename, csv);
  };

  // Stats calculation
  const stats = useMemo(() => {
    const today = new Date().toDateString();
    const todayLogs = state.callLogs.filter(log => log.timestamp.toDateString() === today);
    
    const getRangeStats = (startH: number, endH: number) => {
      const logs = todayLogs.filter(log => {
        const h = log.timestamp.getHours();
        return h >= startH && h < endH;
      });
      return {
        total: logs.length,
        ans: logs.filter(l => l.status === 'ANSWERED').length,
        unans: logs.filter(l => l.status === 'UNANSWERED').length
      };
    };

    return {
      global: {
        answered: todayLogs.filter(l => l.status === 'ANSWERED').length,
        unanswered: todayLogs.filter(l => l.status === 'UNANSWERED').length,
        busy: todayLogs.filter(l => l.status === 'BUSY').length,
        total: todayLogs.length
      },
      ranges: {
        r1: getRangeStats(9, 11), // 9am - 11am
        r2: getRangeStats(11, 14), // 11am - 2pm
        r3: getRangeStats(14, 16), // 2pm - 4pm
        r4: getRangeStats(16, 18), // 4pm - 6pm
      }
    };
  }, [state.callLogs]);

  if (currentView === 'history') {
    return (
      <div className="min-h-screen pb-20 max-w-md mx-auto relative px-4 pt-6 bg-[#0f111a] animate-in fade-in slide-in-from-right-4 duration-300 no-scrollbar overflow-y-auto">
        <header className="flex items-center gap-4 mb-6">
          <button 
            onClick={() => setCurrentView('dialer')}
            className="p-2 bg-[#1c1f2e] border border-[#2d3142] rounded-xl text-gray-400 hover:text-white transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          <div className="flex-grow">
            <h1 className="text-xl font-black text-white tracking-tight">Call History</h1>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
          </div>
          {exporting && (
            <div className="bg-purple-600 text-white text-[10px] font-black px-2 py-1 rounded animate-pulse">
              EXPORTING...
            </div>
          )}
        </header>

        {/* Top Summary Cards */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <Card className="flex flex-col items-center justify-center py-6 border-emerald-500/20 bg-emerald-500/5">
            <div className="p-2 bg-emerald-500/20 rounded-lg mb-2 text-emerald-500">
              <Phone size={20} />
            </div>
            <span className="text-2xl font-black text-emerald-500">{stats.global.answered}</span>
            <span className="text-[10px] font-bold text-emerald-500/70 uppercase">Answered</span>
          </Card>
          <Card className="flex flex-col items-center justify-center py-6 border-rose-500/20 bg-rose-500/5">
            <div className="p-2 bg-rose-500/20 rounded-lg mb-2 text-rose-500">
              <Clock size={20} />
            </div>
            <span className="text-2xl font-black text-rose-500">{stats.global.unanswered}</span>
            <span className="text-[10px] font-bold text-rose-500/70 uppercase">Unanswered</span>
          </Card>
        </div>

        {/* Time Frame Export Cards */}
        <div className="mb-6">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 block px-1">Hourly Frames (Click to Export)</span>
          <div className="grid grid-cols-1 gap-2">
            {[
              { label: '9am - 11am', stats: stats.ranges.r1 },
              { label: '11am - 2pm', stats: stats.ranges.r2 },
              { label: '2pm - 4pm', stats: stats.ranges.r3 },
              { label: '4pm - 6pm', stats: stats.ranges.r4 },
            ].map((range, idx) => (
              <Card 
                key={idx} 
                onClick={() => handleExportRange(range.label)}
                className="flex items-center justify-between border-[#2d3142] py-3 group"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-black text-purple-400 group-hover:neon-text-purple transition-all">{range.label}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] font-bold text-gray-400 uppercase">Total: <span className="text-white">{range.stats.total}</span></span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase">Ans: <span className="text-emerald-500">{range.stats.ans}</span></span>
                    <span className="text-[10px] font-bold text-gray-400 uppercase">UnAns: <span className="text-rose-500">{range.stats.unans}</span></span>
                  </div>
                </div>
                <Download size={18} className="text-gray-600 group-hover:text-purple-400" />
              </Card>
            ))}
          </div>
        </div>

        {/* Export All Button */}
        <div className="mb-8">
          <button 
            onClick={() => exportAll()}
            className="w-full h-14 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-2xl flex items-center justify-center gap-3 text-white font-black uppercase tracking-widest shadow-lg shadow-purple-600/20 active:scale-95 transition-transform"
          >
            <Share2 size={20} /> Export All (9am - 6pm)
          </button>
        </div>

        <div className="flex items-center justify-between mb-4 px-1">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
            <BarChart3 size={14} /> Today's Activity
          </span>
          <span className="text-[10px] font-bold text-cyan-400 bg-cyan-400/10 px-2 py-0.5 rounded-full border border-cyan-400/20">All Day: {stats.global.total}</span>
        </div>

        {/* Logs List */}
        <div className="space-y-3">
          {state.callLogs.slice().reverse().map((log) => (
            <div 
              key={log.id} 
              className="bg-[#1c1f2e] border border-[#2d3142] p-4 rounded-2xl group active:scale-[0.98] transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl border ${
                    log.status === 'ANSWERED' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' :
                    log.status === 'UNANSWERED' ? 'bg-rose-500/10 border-rose-500/20 text-rose-500' :
                    'bg-amber-500/10 border-amber-500/20 text-amber-500'
                  }`}>
                    <Phone size={18} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white mb-0.5">{log.number}</div>
                    <div className="text-[10px] text-gray-500 font-medium flex items-center gap-2">
                      <span>{log.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="w-1 h-1 bg-gray-700 rounded-full" />
                      <span>Duration: {log.duration}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className={`text-[10px] font-black px-2 py-1 rounded-lg border ${
                    log.status === 'ANSWERED' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' :
                    log.status === 'UNANSWERED' ? 'bg-rose-500/10 border-rose-500/30 text-rose-500' :
                    'bg-amber-500/10 border-amber-500/30 text-amber-500'
                  }`}>
                    {log.status === 'ANSWERED' ? 'ANS' : log.status === 'UNANSWERED' ? 'UNANS' : 'BUSY'}
                  </div>
                  {log.reportStatus && (
                    <div className="text-[10px] font-bold px-2 py-1 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-400">
                      {log.reportStatus}
                    </div>
                  )}
                  {log.textInbound && (
                    <div className={`text-[10px] font-bold px-2 py-1 rounded-lg ${
                      log.textInbound === 'YES' ? 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400' : 'bg-gray-500/10 border border-gray-500/30 text-gray-400'
                    }`}>
                      SMS: {log.textInbound}
                    </div>
                  )}
                </div>
                <button onClick={() => setEditingLog(log)} className="px-3 py-1 bg-purple-600 hover:bg-purple-700 rounded-lg text-xs font-bold transition-colors">Update</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-32 max-w-md mx-auto relative px-4 pt-4 no-scrollbar overflow-y-auto bg-[#0f111a] animate-in fade-in duration-300">
      
      {/* Header Section */}
      <Card className="mb-4">
        <div className="flex flex-col gap-3">
          <Input 
            placeholder="Agent Name" 
            value={state.agentName} 
            onChange={(e) => setState(prev => ({ ...prev, agentName: e.target.value }))}
            className="text-center"
          />
          <Input 
            placeholder="Branch Name" 
            value={state.branchName} 
            onChange={(e) => setState(prev => ({ ...prev, branchName: e.target.value }))}
            className="text-center"
          />
          <button 
            onClick={handleSave}
            className="w-full bg-[#3482f6] hover:bg-blue-600 text-white font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <Save size={18} /> Save
          </button>
        </div>

        <div className="mt-6">
          <div className="flex flex-col">
            <span className="text-gray-400 text-xs font-bold uppercase tracking-wider">Series</span>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-black text-purple-500 neon-text-purple">{state.series ?? state.baseNumber}</span>
              <span className="text-3xl font-black text-cyan-400 neon-text-cyan">{state.last4}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3 w-full">
            <button onClick={() => setShowAdminModal(true)} className="w-full bg-[#2d3142] hover:bg-[#3e445a] p-3 rounded-xl transition-colors border border-[#3e445a] flex items-center justify-center gap-2 text-sm font-semibold">
              Admin
            </button>
            <button onClick={() => setActiveModal('EDIT_SMS_TEMPLATE')} className="w-full bg-[#2d3142] hover:bg-[#3e445a] p-3 rounded-xl transition-colors border border-[#3e445a] flex items-center justify-center gap-2 text-sm font-semibold">
              <LayoutTemplate size={18} /> Template
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-6">
          <div className="bg-[#12141c] p-3 rounded-xl border border-[#2d3142] flex flex-col items-center">
            <span className="text-gray-500 text-[10px] uppercase font-bold">Last 4</span>
            <span className="text-xl font-bold">{state.last4}</span>
          </div>
          <div className="bg-[#12141c] p-3 rounded-xl border border-[#2d3142] flex flex-col items-center">
            <span className="text-gray-500 text-[10px] uppercase font-bold">Attempts</span>
            <span className="text-xl font-bold">{state.attempts}</span>
          </div>
        </div>
        <div className="mt-3 text-[11px] text-gray-400">
          Queue: {queue.length} {queue.length > 0 ? `· ${queue[0]} → ${queue[queue.length - 1]}` : ''}
          {queue.length === 0 && <span className="text-rose-400"> · No numbers to dial</span>}
        </div>
        {dncCount > 0 && (
          <div className="mt-2 text-[11px] text-amber-400 font-medium">
            🚫 DNC Protection: {dncCount} numbers in list
          </div>
        )}
      </Card>

      {/* Configuration Section */}
      <Card className="mb-4">
        <div className="mb-4">
          <span className="text-gray-500 text-[10px] uppercase font-bold block mb-1">Base Number (7 Digits)</span>
          <span className="text-2xl font-bold tracking-tight">{state.baseNumber}</span>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          <button 
            onClick={() => setActiveModal('EDIT_BASE')}
            className="bg-purple-600/20 text-purple-400 border border-purple-500/30 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1"
          >
            <Edit3 size={16} /> Edit Base
          </button>
          <button 
            onClick={() => setActiveModal('TAG_CALL')}
            className="bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1"
          >
            <Tag size={16} /> Tag Last
          </button>
          <button 
            onClick={() => setActiveModal('SEND_SMS')}
            className="bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 py-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1"
          >
            <Send size={16} /> Send SMS
          </button>
        </div>

        <button 
          onClick={() => setCurrentView('history')}
          className="w-full bg-[#2d3142] hover:bg-[#3e445a] py-2 rounded-lg text-xs font-bold text-gray-300 border border-[#3e445a] mb-6 flex items-center justify-center gap-2 transition-colors"
        >
          <FileText size={16} /> Reports / History
        </button>

        <div className="space-y-4">
          <div>
            <span className="text-gray-500 text-[10px] uppercase font-bold block mb-2">Last 4 (Editable) and Attempts</span>
            <div className="flex gap-2">
              <Input 
                value={state.last4}
                onChange={(e) => {
                  // allow clearing input without auto-padding; pad only when non-empty
                  const raw = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setState(p => ({ ...p, last4: raw }));
                }}
                onBlur={(e) => {
                  const raw = (e.target.value || '').replace(/\D/g, '').slice(0, 4);
                  const padded = raw.length ? raw.padStart(4, '0') : '';
                  setState(p => ({ ...p, last4: padded }));
                }}
                placeholder="0000"
                className="flex-grow"
              />
              <Input 
                value={state.attempts}
                onChange={(e) => {
                  const n = Math.max(0, Math.min(10000, parseInt(e.target.value.replace(/\D/g, '') || '0')));
                  setState(p => ({ ...p, attempts: n }));
                }}
                className="w-20"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-gray-300 text-xs font-bold uppercase">Turn on Shuffle</span>
            <Toggle enabled={state.isShuffle} onChange={(v) => setState(p => ({ ...p, isShuffle: v }))} />
          </div>

          <div>
            <span className="text-gray-500 text-[10px] uppercase font-bold block mb-2">Interval (Seconds)</span>
            <div className="flex gap-2">
              <Input 
                value={state.interval} 
                onChange={(e) => setState(p => ({ ...p, interval: parseInt(e.target.value) || 0 }))}
              />
              <button className="bg-purple-600 hover:bg-purple-700 px-4 rounded-lg font-bold text-xs">Set</button>
            </div>
          </div>

          <div>
            <span className="text-gray-500 text-[10px] uppercase font-bold block mb-2">Post-call Wait (Seconds)</span>
            <div className="flex gap-2">
              <Input 
                value={postCallInterval}
                onChange={(e) => setPostCallInterval(Math.max(0, parseInt(e.target.value.replace(/\D/g, '') || '0')))}
              />
              <button className="bg-purple-600 hover:bg-purple-700 px-4 rounded-lg font-bold text-xs">Set</button>
            </div>
            <p className="text-[10px] text-gray-500 mt-1">Delay before next call after uploading record. Default 12s.</p>
          </div>

          <div className="pt-2 border-t border-[#2d3142] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-300 text-[10px] font-bold uppercase">Auto SMS (Unanswered)</span>
              <Toggle enabled={state.autoSmsEnabled} onChange={(v) => setState(p => ({ ...p, autoSmsEnabled: v }))} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-300 text-[10px] font-bold uppercase">Auto SMS (Answered)</span>
              <Toggle enabled={state.autoSmsAnsweredEnabled} onChange={(v) => setState(p => ({ ...p, autoSmsAnsweredEnabled: v }))} />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <Input 
              value={state.adminPhone} 
              onChange={(e) => setState(p => ({ ...p, adminPhone: e.target.value }))}
              className="flex-grow text-xs"
            />
            <span className="text-[10px] font-bold text-gray-500 uppercase">Admin</span>
            <button className="bg-purple-600/80 hover:bg-purple-600 px-4 py-2 rounded-lg font-bold text-xs">Save</button>
          </div>
        </div>
      </Card>

      {/* Dialer Control Tile */}
      <div className="flex flex-col items-center py-6 gap-6">
        <div className="w-32 h-32 bg-[#1c1f2e] border-2 border-[#2d3142] rounded-3xl flex items-center justify-center shadow-[0_0_30px_rgba(0,0,0,0.5)]">
           <span className="text-4xl font-black text-cyan-400 tracking-widest neon-text-cyan">ACCM</span>
        </div>

        <div className="flex items-center gap-2 bg-[#1c1f2e] px-4 py-1.5 rounded-full border border-[#2d3142]">
          <Circle size={10} className={`animate-pulse ${state.isSystemActive ? 'fill-emerald-500 text-emerald-500' : 'fill-rose-500 text-rose-500'}`} />
          <span className={`text-xs font-bold uppercase tracking-widest ${state.isSystemActive ? 'text-emerald-500' : 'text-rose-500'}`}>
            {state.isSystemActive ? 'Active' : 'Offline'}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-gray-400 text-xs font-bold uppercase tracking-wider">System</span>
          <Toggle enabled={state.isSystemActive} onChange={(v) => setState(p => ({ ...p, isSystemActive: v }))} />
        </div>
      </div>

      {/* Sticky Bottom Action */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto p-4 bg-gradient-to-t from-[#0f111a] via-[#0f111a] to-transparent pointer-events-none">
        <div className="pointer-events-auto flex flex-col items-center">
          {state.isCallActive && (
            <div className="mb-3 w-full bg-emerald-600/20 border border-emerald-500/30 rounded-xl p-3 text-center">
              <p className="text-sm font-bold text-emerald-400 flex items-center justify-center gap-2">
                <Circle size={10} className="fill-emerald-500 text-emerald-500 animate-pulse" />
                CALL IN PROGRESS - Queue paused
              </p>
            </div>
          )}
          <button
            disabled={state.isCallActive}
            onClick={() => {
              try {
                let numbers = queue;
                // Filter out DNC numbers
                const dncFilteredNumbers = numbers.filter(num => !isNumberInDnc(num));
                const dncSkippedCount = numbers.length - dncFilteredNumbers.length;

                if (!dncFilteredNumbers.length) {
                  setCountdown(null);
                  setErrorModal(`Queue is empty after DNC filtering. ${dncSkippedCount} numbers were in DNC list.`);
                  return;
                }

                if (dncSkippedCount > 0) {
                  showToast(`Starting with ${dncFilteredNumbers.length} numbers (${dncSkippedCount} in DNC)`);
                } else {
                  showToast(`Starting auto-dial of ${dncFilteredNumbers.length} numbers`);
                }

                numbers = dncFilteredNumbers;
                const sa: any = (window as any).AndroidApp;
                const intervalMs = Math.max(1000, (state.interval || 5) * 1000);
                setState(p => ({ ...p, isCallActive: true }));
                if (sa && typeof sa.startDial === 'function') {
                  // pass interval and post-call wait to native
                  // IMPORTANT: Pass filtered numbers without DNC entries
                  sa.startDial(JSON.stringify(numbers), intervalMs);
                  if (typeof sa.setPostCallInterval === 'function') {
                    sa.setPostCallInterval(Math.max(0, postCallInterval) * 1000);
                  }
                  if (typeof sa.setDefaultSheetId === 'function') {
                    sa.setDefaultSheetId(state.googleSheetId || DEFAULT_SHEET);
                  }
                } else {
                  // Browser fallback: attempt to open the first tel link
                  setState(p => ({ ...p, isCallActive: false }));
                  window.location.href = `tel:${numbers[0]}`;
                }
              } catch (e) {
                setState(p => ({ ...p, isCallActive: false }));
                setErrorModal(`Failed to start dialing: ${String(e)}`);
              }
            }}
            className={`w-full gradient-button h-16 rounded-2xl text-white font-black text-xl flex items-center justify-center gap-3 shadow-[0_10px_40px_rgba(168,85,247,0.3)] active:scale-95 transition-transform uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <PhoneCall size={28} /> {state.isCallActive ? 'Call Active...' : 'Call Now'}
          </button>
          <p className="mt-3 text-[10px] text-gray-500 font-medium text-center leading-tight">
            Auto SMS configured · {stats.global.answered} answered today
          </p>
        </div>
      </div>

      {/* Modals */}
      {activeModal === 'EDIT_BASE' && (
        <Modal title="Edit Base Number" onClose={closeModal}>
          <div className="space-y-4">
            <div>
              <span className="text-gray-500 text-[10px] font-bold uppercase block mb-1">Base Number (7 Digits)</span>
              <Input 
                value={state.baseNumber} 
                onChange={(e) => setState(p => ({ ...p, baseNumber: e.target.value }))}
                maxLength={7}
              />
            </div>
            <div>
              <span className="text-gray-500 text-[10px] font-bold uppercase block mb-1">Series Preview</span>
              <span className="text-2xl font-black text-purple-500">{state.baseNumber}</span>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={closeModal} className="flex-1 bg-[#2d3142] py-2 rounded-lg font-bold">Cancel</button>
              <button onClick={closeModal} className="flex-1 bg-purple-600 py-2 rounded-lg font-bold">Save</button>
            </div>
          </div>
        </Modal>
      )}

      {activeModal === 'TAG_CALL' && (
        <Modal title="Tag Call" onClose={closeModal}>
          <div className="space-y-4">
            <div>
              <span className="text-gray-500 text-[10px] font-bold uppercase block mb-1">Number</span>
              <Input value={state.baseNumber + state.last4} readOnly className="bg-[#12141c] border-transparent" />
            </div>
            <span className="text-gray-500 text-[10px] font-bold uppercase block">Choose Status</span>
            <div className="grid grid-cols-2 gap-2">
              <button className="bg-amber-500 text-black font-black py-4 rounded-xl text-sm active:scale-95 transition-transform">BUSY</button>
              <button className="bg-emerald-500 text-black font-black py-4 rounded-xl text-sm active:scale-95 transition-transform">ANSWERED</button>
            </div>
            <button className="w-full bg-rose-500 text-black font-black py-4 rounded-xl text-sm active:scale-95 transition-transform">UNANSWERED</button>
            <button onClick={closeModal} className="w-full bg-[#2d3142] py-3 rounded-lg font-bold mt-4">Close</button>
          </div>
        </Modal>
      )}

      {activeModal === 'EDIT_SMS_TEMPLATE' && (
        <Modal title="SMS Templates" onClose={closeModal}>
          <div className="space-y-4">
            <div>
              <span className="text-gray-500 text-[10px] font-bold uppercase block mb-2">Template for Answered Calls</span>
              <textarea 
                className="w-full bg-[#2d3142] border border-[#3e445a] text-white rounded-lg px-3 py-2 h-24 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm resize-none"
                value={state.smsTemplateAnswered || ''}
                onChange={(e) => setState(p => ({ ...p, smsTemplateAnswered: e.target.value }))}
              />
              <p className="text-[10px] text-gray-500 mt-1">Sent to calls where status is ANSWERED</p>
            </div>
            <div>
              <span className="text-gray-500 text-[10px] font-bold uppercase block mb-2">Template for Unanswered Calls</span>
              <textarea 
                className="w-full bg-[#2d3142] border border-[#3e445a] text-white rounded-lg px-3 py-2 h-24 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm resize-none"
                value={state.smsTemplateUnanswered || ''}
                onChange={(e) => setState(p => ({ ...p, smsTemplateUnanswered: e.target.value }))}
              />
              <p className="text-[10px] text-gray-500 mt-1">Sent to calls where status is UNANSWERED</p>
            </div>
            <div className="flex gap-2 pt-4">
              <button onClick={closeModal} className="flex-1 bg-[#2d3142] py-2 rounded-lg font-bold">Cancel</button>
              <button 
                onClick={() => {
                  // Save to localStorage
                  localStorage.setItem('accm_admin', JSON.stringify({
                    agentName: state.agentName,
                    branchName: state.branchName,
                    series: state.series,
                    googleSheetId: state.googleSheetId,
                    smsTemplateAnswered: state.smsTemplateAnswered,
                    smsTemplateUnanswered: state.smsTemplateUnanswered
                  }));
                  closeModal();
                  showToast('SMS Templates saved');
                }}
                className="flex-1 bg-purple-600 py-2 rounded-lg font-bold"
              >
                Save Templates
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Updating Progress Modal */}
      {showUpdatingModal && (
        <Modal title="Updating" onClose={() => {}}>
          <div className="space-y-6 text-center py-4">
            <p className="text-sm text-gray-300">Updating record in progress...</p>
            <div className="flex justify-center">
              <div className="relative w-24 h-24">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  <circle 
                    cx="50" cy="50" r="45" 
                    fill="none" 
                    stroke="#2d3142" 
                    strokeWidth="4"
                  />
                  <circle 
                    cx="50" cy="50" r="45" 
                    fill="none" 
                    stroke="#10b981" 
                    strokeWidth="4"
                    strokeDasharray={`${282.7 * (updateProgress / 100)} 282.7`}
                    strokeLinecap="round"
                    className="transition-all duration-300"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl font-black text-emerald-500">{updateProgress}%</span>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {activeModal === 'SEND_SMS' && (
        <Modal title="Send SMS" onClose={closeModal}>
          <div className="space-y-4">
            <div>
              <span className="text-gray-500 text-[10px] font-bold uppercase block mb-1">To</span>
              <Input value={state.baseNumber + state.last4} readOnly />
            </div>
            <div>
              <span className="text-gray-500 text-[10px] font-bold uppercase block mb-1">Message Preview</span>
              <textarea 
                className="w-full bg-[#2d3142] border border-[#3e445a] text-white rounded-lg px-3 py-2 h-24 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                defaultValue={`Thank you for your time! Your reference: ${state.last4}`}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={closeModal} className="flex-1 bg-[#2d3142] py-2 rounded-lg font-bold">Cancel</button>
              <button onClick={closeModal} className="flex-1 bg-purple-600 py-2 rounded-lg font-bold">Send</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Admin Modal (local settings) */}
      {showAdminModal && (
        <Modal title="Admin Settings" onClose={() => setShowAdminModal(false)}>
          <div className="space-y-4">
            <div>
              <span className="text-gray-500 text-[10px] font-bold uppercase block mb-1">Agent Name</span>
              <Input value={state.agentName} onChange={(e) => setState(p => ({ ...p, agentName: e.target.value }))} />
            </div>
            <div>
              <span className="text-gray-500 text-[10px] font-bold uppercase block mb-1">Google Sheet ID</span>
              <Input value={state.googleSheetId ?? ''} onChange={(e) => setState(p => ({ ...p, googleSheetId: e.target.value }))} />
            </div>
            <div>
              <span className="text-gray-500 text-[10px] font-bold uppercase block mb-1">Series (for reports)</span>
              <Input value={state.series ?? ''} onChange={(e) => setState(p => ({ ...p, series: e.target.value }))} />
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowAdminModal(false)} className="flex-1 bg-[#2d3142] py-2 rounded-lg font-bold">Cancel</button>
              <button onClick={() => { saveAdmin({ agentName: state.agentName, branchName: state.branchName, googleSheetId: state.googleSheetId, series: state.series }); setShowAdminModal(false); }} className="flex-1 bg-purple-600 py-2 rounded-lg font-bold">Save</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Report Form Modal for hourly ranges */}
      {showReportModal && (
        <Modal title={`Report — ${showReportModal.range}`} onClose={() => setShowReportModal(null)}>
          <ReportForm
            initialSeries={state.series ?? `${state.baseNumber}`}
            agentName={state.agentName}
            onSubmit={async (form) => {
              // create CSV row and upload
              const header = ['Date','Time Log','Phone Number','Agent Name','Calls','Responses','Texts (Outbound)','Texts (Inbound)','Qualified','Status','Series'];
              const row = [
                new Date().toLocaleDateString(),
                new Date().toLocaleTimeString(),
                form.phoneNumber,
                state.agentName,
                '', '',
                form.textsOutbound ? 'Yes' : 'No',
                form.textInbound || 'No',
                form.qualified ? 'Yes' : 'No',
                form.status,
                form.series
              ];
              const csv = [header, row].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
              const filename = `${state.agentName || 'Agent'} - ${new Date().toLocaleDateString()}.csv`;
              
              // Show updating modal
              setShowUpdatingModal(true);
              const updateInterval = setInterval(() => {
                setUpdateProgress(p => Math.min(p + Math.random() * 30, 90));
              }, 200);
              
              await uploadCsvToServer(filename, csv);
              clearInterval(updateInterval);
              setUpdateProgress(100);
              setTimeout(() => {
                setShowUpdatingModal(false);
                setUpdateProgress(0);
                setShowReportModal(null);
                showToast('Updated successfully');
              }, 500);
            }}
            onCancel={() => setShowReportModal(null)}
          />
        </Modal>
      )}

      {/* Edit existing log modal */}
      {editingLog && (
        <Modal title={`Update — ${editingLog.number}`} onClose={() => setEditingLog(null)}>
          <ReportForm
            initialSeries={editingLog.series ?? state.series ?? state.baseNumber}
            agentName={state.agentName}
            onSubmit={async (form) => {
              // Show updating modal
              setShowUpdatingModal(true);
              setUpdateProgress(0);
              const updateInterval = setInterval(() => {
                setUpdateProgress(p => Math.min(p + Math.random() * 30, 90));
              }, 200);

              // update local log
              setState(prev => ({ 
                ...prev, 
                callLogs: prev.callLogs.map(l => l.id === editingLog.id ? ({ 
                  ...l, 
                  reportStatus: form.status as any, 
                  qualified: form.qualified, 
                  textInbound: form.textInbound as any,
                  textOutbound: form.textsOutbound,
                  series: form.series 
                }) : l) 
              }));

              // create CSV row and attempt upload
              const header = ['Date','Time Log','Phone Number','Agent Name','Calls','Responses','Texts (Outbound)','Texts (Inbound)','Qualified','Status','Series'];
              const row = [
                new Date().toLocaleDateString(),
                new Date().toLocaleTimeString(),
                editingLog.number,
                state.agentName,
                '', '',
                form.textsOutbound ? 'Yes' : 'No',
                form.textInbound || 'No',
                form.qualified ? 'Yes' : 'No',
                form.status,
                form.series
              ];
              const csv = [header, row].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
              const filename = `${state.agentName || 'Agent'} - ${new Date().toLocaleDateString()}.csv`;
              await uploadCsvToServer(filename, csv);

              // If running inside Android WebView with bridge, try to call native updater too
              try {
                const sa = (window as any).AndroidApp;
                if (sa && typeof sa.updateQualifiedAndStatus === 'function') {
                  sa.updateQualifiedAndStatus(state.googleSheetId || '', 'Sheet1', editingLog.number, form.qualified ? 'true' : 'false', form.status);
                }
              } catch (e) { console.warn('Android bridge call failed', e); }

              clearInterval(updateInterval);
              setUpdateProgress(100);
              setTimeout(() => {
                setShowUpdatingModal(false);
                setUpdateProgress(0);
                setEditingLog(null);
                showToast('Updated successfully');
              }, 500);
            }}
            onCancel={() => setEditingLog(null)}
          />
        </Modal>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 transform -translate-x-1/2 bottom-28 bg-black/70 text-white px-4 py-2 rounded-md z-50">
          {toast}
        </div>
      )}

      {/* Error Modal */}
      {errorModal && (
        <Modal title="Error" onClose={() => setErrorModal(null)}>
          <div className="space-y-4">
            <p className="text-sm text-rose-300 whitespace-pre-wrap">{errorModal}</p>
            <button onClick={() => setErrorModal(null)} className="w-full bg-rose-600 py-2 rounded-lg font-bold">Close</button>
          </div>
        </Modal>
      )}

      {/* Success/Info Modal */}
      {successModal && (
        <Modal title="Info" onClose={() => setSuccessModal(null)}>
          <div className="space-y-4">
            <p className="text-sm text-emerald-300 whitespace-pre-wrap">{successModal}</p>
            <button onClick={() => setSuccessModal(null)} className="w-full bg-emerald-600 py-2 rounded-lg font-bold">Close</button>
          </div>
        </Modal>
      )}

      {/* Countdown Modal */}
      {typeof countdown === 'number' && countdown >= 0 && (
        <Modal title="Next Call" onClose={() => setCountdown(null)}>
          <div className="space-y-4 text-center">
            <p className="text-sm text-gray-300">Proceeding to next call in</p>
            <div className="text-4xl font-black text-purple-400">{countdown}s</div>
          </div>
        </Modal>
      )}

      {/* DNC Skip Notification Modal */}
      {typeof dncCountdownSeconds === 'number' && dncCountdownSeconds >= 0 && (
        <Modal title="DNC Detection" onClose={() => setDncCountdownSeconds(null)}>
          <div className="space-y-6 text-center">
            <div className="space-y-2">
              <p className="text-base font-bold text-amber-300">Number detected in DNC</p>
              <p className="text-sm text-gray-300">Skipping this number...</p>
            </div>
            <div className="text-5xl font-black text-amber-400">{dncCountdownSeconds}</div>
            <p className="text-xs text-gray-500">Moving to next number</p>
          </div>
        </Modal>
      )}

    </div>
  );
};

// Report form used by the report modal
const ReportForm: React.FC<{
  initialSeries: string;
  agentName: string;
  onSubmit: (data: { phoneNumber: string; qualified: boolean; textsOutbound: boolean; textInbound: string; status: string; series: string }) => void;
  onCancel: () => void;
}> = ({ initialSeries, agentName, onSubmit, onCancel }) => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [qualified, setQualified] = useState(false);
  const [textsOutbound, setTextsOutbound] = useState(false);
  const [textInbound, setTextInbound] = useState('NO');
  const [status, setStatus] = useState('UNDECIDED');
  const [series, setSeries] = useState(initialSeries);

  return (
    <div className="space-y-4 max-h-[80vh] overflow-y-auto">
      <div>
        <span className="text-gray-500 text-[10px] font-bold uppercase block mb-1">Phone Number</span>
        <Input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="09xxxxxxxxx" />
      </div>
      <div>
        <span className="text-gray-500 text-[10px] font-bold uppercase block mb-1">Series</span>
        <Input value={series} onChange={(e) => setSeries(e.target.value)} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-gray-300 text-[10px] font-bold uppercase">Qualified</span>
        <Toggle enabled={qualified} onChange={(v) => setQualified(v)} />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-gray-300 text-[10px] font-bold uppercase">Texts (Outbound)</span>
        <Toggle enabled={textsOutbound} onChange={(v) => setTextsOutbound(v)} />
      </div>
      <div>
        <span className="text-gray-500 text-[10px] font-bold uppercase block mb-2">Text Inbound</span>
        <div className="flex gap-2">
          <button 
            onClick={() => setTextInbound('YES')} 
            className={`flex-1 py-2 rounded-lg font-bold text-xs transition-colors ${textInbound === 'YES' ? 'bg-cyan-500 text-black' : 'bg-[#2d3142] text-gray-300'}`}
          >
            YES
          </button>
          <button 
            onClick={() => setTextInbound('NO')} 
            className={`flex-1 py-2 rounded-lg font-bold text-xs transition-colors ${textInbound === 'NO' ? 'bg-gray-500 text-white' : 'bg-[#2d3142] text-gray-300'}`}
          >
            NO
          </button>
        </div>
      </div>
      <div>
        <span className="text-gray-500 text-[10px] font-bold uppercase block mb-2">Status</span>
        <div className="grid grid-cols-2 gap-2">
          {['UNDECIDED','CALLBACK','NOT INTERESTED','DOCUMENTS SENT'].map(s => (
            <button key={s} onClick={() => setStatus(s)} className={`py-3 rounded-lg font-bold text-xs ${status===s? 'bg-purple-600 text-white':'bg-[#2d3142] text-gray-300'}`}>{s}</button>
          ))}
        </div>
      </div>
      <div className="flex gap-2 pt-4 border-t border-[#2d3142]">
        <button onClick={onCancel} className="flex-1 bg-[#2d3142] py-2 rounded-lg font-bold">Cancel</button>
        <button onClick={() => onSubmit({ phoneNumber, qualified, textsOutbound, textInbound, status, series })} className="flex-1 bg-purple-600 py-2 rounded-lg font-bold">Update</button>
      </div>
    </div>
  );
};

// Internal Modal Component
const Modal: React.FC<{ title: string; children: React.ReactNode; onClose: () => void }> = ({ title, children, onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-[#1c1f2e] border border-[#2d3142] rounded-[32px] p-8 shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-black text-purple-400 neon-text-purple tracking-tight">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
};

export default App;
