'use client';

import { useState, useEffect, useCallback } from 'react';

interface Alert {
  id: number;
  domain_name?: string;
  alert_type: string;
  sent_at: string;
  details?: string;
  channel?: string;
}

interface PaginatedResponse {
  data: Alert[];
  total: number;
  page: number;
  limit: number;
}

interface TelegramConfig {
  bot_token: string;
  chat_id: string;
  enabled: boolean;
}

function AlertTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    domain_available: 'bg-green-500/20 text-green-400 border-green-500/30',
    domain_expiring: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    new_dissolution: 'bg-red-500/20 text-red-400 border-red-500/30',
    status_change: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    error: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  const colorClass = colors[type?.toLowerCase()] || 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-mono rounded border ${colorClass}`}>
      {type}
    </span>
  );
}

function maskToken(token: string): string {
  if (!token || token.length < 10) return '***';
  return token.substring(0, 4) + '...' + token.substring(token.length - 4);
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState('');

  // Telegram config
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig>({
    bot_token: '',
    chat_id: '',
    enabled: false,
  });
  const [telegramLoading, setTelegramLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (typeFilter) params.set('alert_type', typeFilter);

      const res = await fetch(`/api/alerts?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: PaginatedResponse = await res.json();
      setAlerts(json.data || []);
      setTotal(json.total || 0);
      setError(null);
    } catch (err) {
      setError('Failed to load alerts. API may not be available.');
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [page, limit, typeFilter]);

  const fetchTelegramConfig = useCallback(async () => {
    try {
      setTelegramLoading(true);
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setTelegramConfig({
        bot_token: json.telegram_bot_token || '',
        chat_id: json.telegram_chat_id || '',
        enabled: json.telegram_enabled ?? false,
      });
    } catch {
      // Settings API not available yet
    } finally {
      setTelegramLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  useEffect(() => {
    fetchTelegramConfig();
  }, [fetchTelegramConfig]);

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-sans font-bold">Alerts</h1>
        <p className="text-dark-muted text-sm mt-1">History of sent notifications and Telegram configuration</p>
      </div>

      {error && (
        <div className="mb-4 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Telegram Config Panel */}
      <div className="bg-dark-card border border-dark-border rounded-lg p-5 mb-6">
        <h2 className="font-sans font-semibold text-sm mb-4">Telegram Configuration</h2>
        {telegramLoading ? (
          <div className="space-y-3">
            <div className="h-6 bg-dark-bg rounded animate-pulse w-64" />
            <div className="h-6 bg-dark-bg rounded animate-pulse w-48" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-dark-muted mb-1">Status</p>
              <span className={`inline-block px-2 py-1 text-xs font-mono rounded border ${
                telegramConfig.enabled
                  ? 'bg-green-500/20 text-green-400 border-green-500/30'
                  : 'bg-gray-500/20 text-gray-400 border-gray-500/30'
              }`}>
                {telegramConfig.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div>
              <p className="text-xs text-dark-muted mb-1">Bot Token</p>
              <p className="font-mono text-sm">
                {telegramConfig.bot_token ? maskToken(telegramConfig.bot_token) : 'Not configured'}
              </p>
            </div>
            <div>
              <p className="text-xs text-dark-muted mb-1">Chat ID</p>
              <p className="font-mono text-sm">
                {telegramConfig.chat_id || 'Not configured'}
              </p>
            </div>
          </div>
        )}
        <p className="text-xs text-dark-muted mt-3">
          Configure Telegram settings in the <a href="/settings" className="text-accent hover:text-accent-hover">Settings</a> page.
        </p>
      </div>

      {/* Filter */}
      <div className="bg-dark-card border border-dark-border rounded-lg p-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="flex-1 max-w-xs">
            <label className="block text-xs text-dark-muted mb-1">Alert Type</label>
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
              className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded text-sm text-dark-text"
            >
              <option value="">All Types</option>
              <option value="domain_available">Domain Available</option>
              <option value="domain_expiring">Domain Expiring</option>
              <option value="new_dissolution">New Dissolution</option>
              <option value="status_change">Status Change</option>
              <option value="error">Error</option>
            </select>
          </div>
          <p className="text-xs text-dark-muted font-mono self-end pb-2">{total} alert{total !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-dark-card border border-dark-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-border bg-dark-bg/50">
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider">Domain</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider">Alert Type</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider">Sent At</th>
                <th className="text-left p-3 text-xs font-medium text-dark-muted uppercase tracking-wider hidden md:table-cell">Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(10)].map((_, i) => (
                  <tr key={i} className="border-b border-dark-border/50">
                    <td colSpan={4} className="p-3">
                      <div className="h-6 bg-dark-bg rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : alerts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-dark-muted">
                    No alerts have been sent yet.
                  </td>
                </tr>
              ) : (
                alerts.map((a) => (
                  <tr key={a.id} className="border-b border-dark-border/50 hover:bg-dark-bg/30 transition-colors">
                    <td className="p-3 font-mono text-sm">{a.domain_name || '-'}</td>
                    <td className="p-3"><AlertTypeBadge type={a.alert_type} /></td>
                    <td className="p-3 font-mono text-xs text-dark-muted">
                      {a.sent_at ? new Date(a.sent_at).toLocaleString('de-AT') : '-'}
                    </td>
                    <td className="p-3 text-xs text-dark-muted hidden md:table-cell max-w-xs truncate">
                      {a.details || '-'}
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
