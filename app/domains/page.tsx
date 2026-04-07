'use client';

import { useState, useEffect, useCallback } from 'react';

interface Domain {
  id: number;
  domain: string;
  tld: string;
  status: string;
  expiry_date?: string;
  registrar?: string;
  last_checked?: string;
  company_name?: string;
  backlink_count?: number;
  domain_authority?: number;
  page_rank?: number;
  seo_score?: number;
  scored_at?: string;
  is_online?: boolean;
  http_status?: number;
  redirect_url?: string;
}

interface PaginatedResponse {
  data: Domain[];
  total: number;
  page: number;
  limit: number;
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

export default function DomainsPage() {
  const [data, setData] = useState<Domain[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expiringWithin, setExpiringWithin] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (expiringWithin) params.set('expiring_within_days', expiringWithin);

      const res = await fetch(`/api/domains?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: PaginatedResponse = await res.json();
      setData(json.data || []);
      setTotal(json.total || 0);
      setError(null);
    } catch (err) {
      setError('Failed to load domains. API may not be available.');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, statusFilter, expiringWithin]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalPages = Math.ceil(total / limit) || 1;

  function resetFilters() {
    setSearch('');
    setStatusFilter('');
    setExpiringWithin('');
    setPage(1);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-sans font-bold">Domains</h1>
        <p className="text-dark-muted text-sm mt-1">Tracked .at domains and their current status</p>
      </div>

      {error && (
        <div className="mb-4 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="bg-dark-card border border-dark-border rounded-lg p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-dark-muted mb-1">Search</label>
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Domain name..."
              className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded text-sm text-dark-text placeholder-dark-muted focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-dark-muted mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded text-sm text-dark-text"
            >
              <option value="">All Statuses</option>
              <option value="available">Available</option>
              <option value="registered">Registered</option>
              <option value="expiring">Expiring</option>
              <option value="redemption">Redemption</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-dark-muted mb-1">Expiring Within (days)</label>
            <input
              type="number"
              value={expiringWithin}
              onChange={(e) => { setExpiringWithin(e.target.value); setPage(1); }}
              placeholder="e.g. 30"
              min="1"
              className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded text-sm text-dark-text placeholder-dark-muted focus:border-accent"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={resetFilters}
              className="w-full px-3 py-2 text-xs text-dark-muted hover:text-accent border border-dark-border rounded bg-dark-bg transition-colors"
            >
              Reset Filters
            </button>
          </div>
        </div>
        <p className="text-xs text-dark-muted font-mono mt-3">{total} result{total !== 1 ? 's' : ''}</p>
      </div>

      {/* Table */}
      <div className="bg-dark-card border border-dark-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-border bg-dark-bg/50">
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider">Domain</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider hidden sm:table-cell">TLD</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider">Status</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider hidden sm:table-cell">Online</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider hidden md:table-cell">Expiry Date</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider hidden lg:table-cell">Registrar</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider hidden lg:table-cell">SEO Score</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider hidden xl:table-cell">Backlinks</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider hidden xl:table-cell">DA</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider hidden xl:table-cell">Last Checked</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider hidden xl:table-cell">Company</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(10)].map((_, i) => (
                  <tr key={i} className="border-b border-dark-border/50">
                    <td colSpan={11} className="p-3">
                      <div className="h-6 bg-dark-bg rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-dark-muted">
                    No domains found matching your filters.
                  </td>
                </tr>
              ) : (
                data.map((d) => (
                  <tr key={d.id} className="border-b border-dark-border/50 hover:bg-dark-bg/30 transition-colors">
                    <td className="p-3 font-mono font-medium">
                      <span className="text-dark-text">{d.domain}</span>
                    </td>
                    <td className="p-3 font-mono text-dark-muted text-xs hidden sm:table-cell">{d.tld}</td>
                    <td className="p-3"><StatusBadge status={d.status} /></td>
                    <td className="p-3 hidden sm:table-cell">
                      {d.is_online == null ? (
                        <span className="text-dark-muted text-xs">-</span>
                      ) : d.is_online ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-400">
                          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                          Live{d.http_status ? ` (${d.http_status})` : ''}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-red-400">
                          <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                          Offline
                        </span>
                      )}
                      {d.redirect_url && (
                        <div className="text-[10px] text-dark-muted truncate max-w-[120px]" title={d.redirect_url}>
                          {d.redirect_url}
                        </div>
                      )}
                    </td>
                    <td className="p-3 font-mono text-xs hidden md:table-cell">
                      {d.expiry_date ? (
                        <span className={
                          (() => {
                            const days = (new Date(d.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
                            if (days < 0) return 'text-red-400';
                            if (days < 7) return 'text-orange-400';
                            if (days < 30) return 'text-yellow-400';
                            return 'text-dark-muted';
                          })()
                        }>
                          {new Date(d.expiry_date).toLocaleDateString('de-AT')}
                        </span>
                      ) : (
                        <span className="text-dark-muted">-</span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-dark-muted hidden lg:table-cell truncate max-w-[150px]">
                      {d.registrar || '-'}
                    </td>
                    <td className="p-3 hidden lg:table-cell">
                      {d.seo_score != null ? (
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-dark-bg rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                d.seo_score >= 70 ? 'bg-green-500' :
                                d.seo_score >= 40 ? 'bg-yellow-500' :
                                d.seo_score >= 20 ? 'bg-orange-500' : 'bg-red-500'
                              }`}
                              style={{ width: `${d.seo_score}%` }}
                            />
                          </div>
                          <span className={`font-mono text-xs font-bold ${
                            d.seo_score >= 70 ? 'text-green-400' :
                            d.seo_score >= 40 ? 'text-yellow-400' :
                            d.seo_score >= 20 ? 'text-orange-400' : 'text-red-400'
                          }`}>{d.seo_score}</span>
                        </div>
                      ) : (
                        <span className="text-dark-muted text-xs">-</span>
                      )}
                    </td>
                    <td className="p-3 font-mono text-xs text-dark-muted hidden xl:table-cell">
                      {d.backlink_count != null ? d.backlink_count.toLocaleString() : '-'}
                    </td>
                    <td className="p-3 font-mono text-xs text-dark-muted hidden xl:table-cell">
                      {d.domain_authority != null ? d.domain_authority.toFixed(1) : '-'}
                    </td>
                    <td className="p-3 font-mono text-xs text-dark-muted hidden xl:table-cell">
                      {d.last_checked ? new Date(d.last_checked).toLocaleString('de-AT') : '-'}
                    </td>
                    <td className="p-3 text-xs text-dark-muted hidden xl:table-cell truncate max-w-[200px]">
                      {d.company_name || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between p-4 border-t border-dark-border">
          <p className="text-xs text-dark-muted font-mono">
            Page {page} of {totalPages} ({total} total)
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="px-3 py-1.5 text-xs rounded bg-dark-bg border border-dark-border text-dark-muted hover:text-dark-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              First
            </button>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-xs rounded bg-dark-bg border border-dark-border text-dark-muted hover:text-dark-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Prev
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-xs rounded bg-dark-bg border border-dark-border text-dark-muted hover:text-dark-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-xs rounded bg-dark-bg border border-dark-border text-dark-muted hover:text-dark-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Last
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
