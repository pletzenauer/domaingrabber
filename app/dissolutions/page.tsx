'use client';

import { useState, useEffect, useCallback } from 'react';

interface Dissolution {
  id: number;
  company_name: string;
  proceeding_type: string;
  court: string;
  source: string;
  published_date: string;
  website?: string;
  details?: string;
}

interface PaginatedResponse {
  data: Dissolution[];
  total: number;
  page: number;
  limit: number;
}

function ProceedingBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    dissolution: 'bg-red-500/20 text-red-400 border-red-500/30',
    liquidation: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    insolvency: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    bankruptcy: 'bg-red-500/20 text-red-400 border-red-500/30',
    deletion: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };
  const colorClass = colors[type?.toLowerCase()] || 'bg-accent/10 text-accent border-accent/30';
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-mono rounded border ${colorClass}`}>
      {type}
    </span>
  );
}

export default function DissolutionsPage() {
  const [data, setData] = useState<Dissolution[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (search) params.set('search', search);
      if (sourceFilter) params.set('source', sourceFilter);
      if (typeFilter) params.set('type', typeFilter);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);

      const res = await fetch(`/api/dissolutions?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: PaginatedResponse = await res.json();
      setData(json.data || []);
      setTotal(json.total || 0);
      setError(null);
    } catch (err) {
      setError('Failed to load dissolutions. API may not be available.');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, sourceFilter, typeFilter, dateFrom, dateTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalPages = Math.ceil(total / limit) || 1;

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    fetchData();
  }

  function resetFilters() {
    setSearch('');
    setSourceFilter('');
    setTypeFilter('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-sans font-bold">Dissolutions</h1>
        <p className="text-dark-muted text-sm mt-1">Austrian company dissolution and insolvency proceedings</p>
      </div>

      {error && (
        <div className="mb-4 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="bg-dark-card border border-dark-border rounded-lg p-4 mb-6">
        <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-dark-muted mb-1">Search</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Company name..."
              className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded text-sm text-dark-text placeholder-dark-muted focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-dark-muted mb-1">Source</label>
            <select
              value={sourceFilter}
              onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
              className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded text-sm text-dark-text"
            >
              <option value="">All Sources</option>
              <option value="ediktsdatei">Ediktsdatei</option>
              <option value="firmenbuch">Firmenbuch</option>
              <option value="wko">WKO</option>
              <option value="jusline">Jusline</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-dark-muted mb-1">Type</label>
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
              className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded text-sm text-dark-text"
            >
              <option value="">All Types</option>
              <option value="dissolution">Dissolution</option>
              <option value="liquidation">Liquidation</option>
              <option value="insolvency">Insolvency</option>
              <option value="bankruptcy">Bankruptcy</option>
              <option value="deletion">Deletion</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-dark-muted mb-1">Date From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded text-sm text-dark-text"
            />
          </div>
          <div>
            <label className="block text-xs text-dark-muted mb-1">Date To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded text-sm text-dark-text"
            />
          </div>
        </form>
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-dark-muted font-mono">{total} result{total !== 1 ? 's' : ''}</p>
          <button
            onClick={resetFilters}
            className="text-xs text-dark-muted hover:text-accent transition-colors"
          >
            Reset filters
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-dark-card border border-dark-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-border bg-dark-bg/50">
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider">Company Name</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider">Type</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider hidden md:table-cell">Court</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider hidden lg:table-cell">Source</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider">Date</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider hidden xl:table-cell">Website</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(10)].map((_, i) => (
                  <tr key={i} className="border-b border-dark-border/50">
                    <td colSpan={7} className="p-3">
                      <div className="h-6 bg-dark-bg rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-dark-muted">
                    No dissolutions found matching your filters.
                  </td>
                </tr>
              ) : (
                data.map((d) => (
                  <tr key={d.id} className="border-b border-dark-border/50 hover:bg-dark-bg/30 transition-colors">
                    <td className="p-3 font-medium max-w-xs truncate">{d.company_name}</td>
                    <td className="p-3"><ProceedingBadge type={d.proceeding_type} /></td>
                    <td className="p-3 text-dark-muted font-mono text-xs hidden md:table-cell">{d.court}</td>
                    <td className="p-3 text-dark-muted text-xs hidden lg:table-cell">{d.source}</td>
                    <td className="p-3 font-mono text-xs">
                      {d.published_date ? new Date(d.published_date).toLocaleDateString('de-AT') : '-'}
                    </td>
                    <td className="p-3 hidden xl:table-cell">
                      {d.website ? (
                        <a
                          href={d.website.startsWith('http') ? d.website : `https://${d.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent hover:text-accent-hover text-xs font-mono truncate block max-w-[200px]"
                        >
                          {d.website}
                        </a>
                      ) : (
                        <span className="text-dark-muted text-xs">-</span>
                      )}
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => {
                          const detail = JSON.stringify(d, null, 2);
                          alert(detail);
                        }}
                        className="text-xs text-accent hover:text-accent-hover transition-colors"
                      >
                        Details
                      </button>
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
