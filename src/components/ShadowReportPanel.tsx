import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert, BarChart3 } from 'lucide-react';
import { fetchWithAuth } from '../lib/api.ts';

type Props = { isAr: boolean };
type Report = { total: number; verdictMatches: number; actionMatches: number; vetoCount: number; averageConfidence: number; executionEnabled: boolean };

export const ShadowReportPanel: React.FC<Props> = ({ isAr }) => {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const body = await fetchWithAuth('/api/council/shadow-report?limit=100');
      if (!body?.success) throw new Error(body?.error || 'Shadow report request failed');
      setReport(body.report);
    } catch (e) { setError(e instanceof Error ? e.message : 'Load failed'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const pct = (n: number) => report?.total ? `${((n / report.total) * 100).toFixed(1)}%` : '0%';
  const cards = report ? [
    [isAr ? 'إجمالي المقارنات' : 'Comparisons', report.total],
    [isAr ? 'تطابق القرار' : 'Verdict match', `${report.verdictMatches} (${pct(report.verdictMatches)})`],
    [isAr ? 'تطابق الإجراء' : 'Action match', `${report.actionMatches} (${pct(report.actionMatches)})`],
    [isAr ? 'حالات VETO' : 'VETO count', report.vetoCount],
    [isAr ? 'متوسط الثقة' : 'Avg confidence', `${(report.averageConfidence * 100).toFixed(1)}%`],
  ] : [];

  return <section className="quant-card p-5 space-y-4 border border-cyan-500/20" dir={isAr ? 'rtl' : 'ltr'}>
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2"><BarChart3 className="w-5 h-5 text-cyan-400" /><h2 className="font-mono font-bold text-cyan-300">{isAr ? 'تقرير Shadow Mode' : 'Shadow Mode Report'}</h2></div>
      <button onClick={() => void load()} disabled={loading} className="px-3 py-2 rounded-lg border border-cyan-500/30 text-cyan-300 text-xs flex items-center gap-2"><RefreshCw className={loading ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />{isAr ? 'تحديث' : 'Refresh'}</button>
    </div>
    {error && <p className="text-rose-400 text-xs font-mono">{error}</p>}
    {!report && !error && <p className="text-slate-400 text-sm">{isAr ? 'جارٍ التحميل...' : 'Loading...'}</p>}
    {report && <><div className="grid grid-cols-2 md:grid-cols-5 gap-3">{cards.map(([label, value]) => <div key={String(label)} className="rounded-lg bg-slate-950/50 border border-white/5 p-3"><span className="block text-[10px] text-slate-400">{label}</span><strong className="text-lg text-white font-mono">{value}</strong></div>)}</div><div className="flex items-center gap-2 text-xs font-mono text-amber-300"><ShieldAlert className="w-4 h-4" />{isAr ? 'التنفيذ معطل: Shadow للمراقبة فقط' : `Execution enabled: ${report.executionEnabled}`}</div></>}
  </section>;
};
