'use client';

import { useState, useEffect } from 'react';

interface Dissolution {
  id: number;
  company_name: string;
  proceeding_type: string;
  court: string;
  source: string;
  published_date: string;
  website?: string;
}

interface Domain {
  id: number;
  domain_name: string;
  tld: string;
  status: string;
  expiry_date?: string;
  registrar?: string;
  last_checked?: string;
  company_name?: string;
}

interface Stats {
  newToday: number;
  expiringSoon: number;
  availableNow: number;
  totalTracked: number;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    available: 'bg-green-500/20 text-green-400 border-green-500/30',
    expiring: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    registered: 'bg-red-500/20 text-red-400 border-red-500/30',
    redemption: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    unknown: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };
  const colorClass = colors[status?.toLowerCase()] || colors.unknown;
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-mono rounded border ${colorClass}`}>
      {status || 'unknown'}
    </span>
  );
}

function ProceedingBadge({ type }: { type: string }) {
  return (
    <span className="inline-block px-2 py-0.5 text-xs font-mono rounded border bg-accent/10 text-accent border-accent/30">
      {type}
    </span>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({ newToday: 0, expiringSoon: 0, availableNow: 0, totalTracked: 0 });
  const [dissolutions, setDissolutions] = useState<Dissolution[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const [dissRes, domRes] = await Promise.allSettled([
          fetch('/api/dissolutions?limit=10'),
          fetch('/api/domains?limit=10'),
        ]);

        let dissData: Dissolution[] = [];
        let domData: Domain[] = [];
        let totalDissolutions = 0;

        if (dissRes.status === 'fulfilled' && dissRes.value.ok) {
          const json = await dissRes.value.json();
          dissData = json.data || json.dissolutions || json || [];
          totalDissolutions = json.total || dissData.length;
        }

        if (domRes.status === 'fulfilled' && domRes.value.ok) {
          const json = await domRes.value.json();
          domData = json.data || json.domains || json || [];
        }

        if (!Array.isArray(dissData)) dissData = [];
        if (!Array.isArray(domData)) domData = [];

        const today = new Date().toISOString().split('T')[0];
        const newToday = dissData.filter(d => d.published_date?.startsWith(today)).length;
        const expiringSoon = domData.filter(d => {
          if (!d.expiry_date) return false;
          const diff = (new Date(d.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
          return diff >= 0 && diff <= 30;
        }).length;
        const availableNow = domData.filter(d => d.status?.toLowerCase() === 'available').length;

        setStats({
          newToday,
          expiringSoon,
          availableNow,
          totalTracked: totalDissolutions || dissData.length,
        });
        setDissolutions(dissData);
        setDomains(domData);
        setError(null);
      } catch (err) {
        setError('Failed to load dashboard data. API may not be running.');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const statCards = [
    { label: 'New Today', value: stats.newToday, color: 'text-accent' },
    { label: 'Expiring Soon', value: stats.expiringSoon, color: 'text-orange-400' },
    { label: 'Available Now', value: stats.availableNow, color: 'text-green-400' },
    { label: 'Total Tracked', value: stats.totalTracked, color: 'text-dark-text' },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-sans font-bold">Dashboard</h1>
        <p className="text-dark-muted text-sm mt-1">Overview of Austrian domain monitoring activity</p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((card) => (
          <div key={card.label} className="bg-dark-card border border-dark-border rounded-lg p-5">
            <p className="text-dark-muted text-xs font-medium uppercase tracking-wider">{card.label}</p>
            <p className={`text-3xl font-mono font-bold mt-2 ${card.color}`}>
              {loading ? '-' : card.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Dissolutions */}
        <div className="bg-dark-card border border-dark-border rounded-lg">
          <div className="p-4 border-b border-dark-border flex items-center justify-between">
            <h2 className="font-sans font-semibold text-sm">Recent Dissolutions</h2>
            <a href="/dissolutions" className="text-accent text-xs hover:text-accent-hover transition-colors">
              View all &rarr;
            </a>
          </div>
          <div className="p-4">
            {loading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-10 bg-dark-bg rounded animate-pulse" />
                ))}
              </div>
            ) : dissolutions.length === 0 ? (
              <p className="text-dark-muted text-sm py-8 text-center">No dissolutions found</p>
            ) : (
              <div className="space-y-2">
                {dissolutions.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-dark-bg hover:bg-dark-border/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{d.company_name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <ProceedingBadge type={d.proceeding_type} />
                        <span className="text-dark-muted text-xs font-mono">{d.court}</span>
                      </div>
                    </div>
                    <span className="text-dark-muted text-xs font-mono ml-4 shrink-0">
                      {d.published_date ? new Date(d.published_date).toLocaleDateString('de-AT') : '-'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Domain Changes */}
        <div className="bg-dark-card border border-dark-border rounded-lg">
          <div className="p-4 border-b border-dark-border flex items-center justify-between">
            <h2 className="font-sans font-semibold text-sm">Recent Domain Changes</h2>
            <a href="/domains" className="text-accent text-xs hover:text-accent-hover transition-colors">
              View all &rarr;
            </a>
          </div>
          <div className="p-4">
            {loading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-10 bg-dark-bg rounded animate-pulse" />
                ))}
              </div>
            ) : domains.length === 0 ? (
              <p className="text-dark-muted text-sm py-8 text-center">No domains tracked yet</p>
            ) : (
              <div className="space-y-2">
                {domains.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-dark-bg hover:bg-dark-border/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-mono font-medium truncate">{d.domain_name}.{d.tld}</p>
                      <p className="text-dark-muted text-xs mt-0.5 truncate">{d.company_name || '-'}</p>
                    </div>
                    <div className="ml-4 shrink-0 flex items-center gap-3">
                      <StatusBadge status={d.status} />
                      <span className="text-dark-muted text-xs font-mono">
                        {d.expiry_date ? new Date(d.expiry_date).toLocaleDateString('de-AT') : '-'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
