'use client';

import { useState, useEffect, useCallback } from 'react';

interface Settings {
  telegram_bot_token: string;
  telegram_chat_id: string;
  telegram_enabled: boolean;
  ntfy_url: string;
  ntfy_topic: string;
  ntfy_enabled: boolean;
  scraper_ediktsdatei_enabled: boolean;
  scraper_firmenbuch_enabled: boolean;
  scraper_wko_enabled: boolean;
  whois_check_enabled: boolean;
  alert_on_available: boolean;
  alert_on_expiring: boolean;
  alert_expiry_days_threshold: number;
}

interface ScraperJob {
  name: string;
  label: string;
  description: string;
  settingKey: keyof Settings;
  lastRun?: string;
  lastStatus?: string;
}

const defaultSettings: Settings = {
  telegram_bot_token: '',
  telegram_chat_id: '',
  telegram_enabled: false,
  ntfy_url: 'https://ntfy.sh',
  ntfy_topic: '',
  ntfy_enabled: false,
  scraper_ediktsdatei_enabled: true,
  scraper_firmenbuch_enabled: true,
  scraper_wko_enabled: true,
  whois_check_enabled: true,
  alert_on_available: true,
  alert_on_expiring: true,
  alert_expiry_days_threshold: 30,
};

const scraperJobs: ScraperJob[] = [
  {
    name: 'scrapeEdiktsdatei',
    label: 'Ediktsdatei Scraper',
    description: 'Scrape Austrian court edicts for company dissolutions',
    settingKey: 'scraper_ediktsdatei_enabled',
  },
  {
    name: 'scrapeGISA',
    label: 'GISA Gewerberegister',
    description: 'Scrape GISA open data for expired/dormant trade licenses',
    settingKey: 'scraper_firmenbuch_enabled',
  },
  {
    name: 'checkWhois',
    label: 'WHOIS Checker',
    description: 'Check domain WHOIS/RDAP data for expiry and availability',
    settingKey: 'whois_check_enabled',
  },
  {
    name: 'scoreDomain',
    label: 'SEO Scorer',
    description: 'Score domains for backlinks, authority, and SEO value',
    settingKey: 'scraper_wko_enabled',
  },
  {
    name: 'sendAlerts',
    label: 'Send Alerts',
    description: 'Send alerts (Telegram + ntfy) for available/expiring domains',
    settingKey: 'whois_check_enabled',
  },
];

function Toggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      className={`
        relative inline-flex h-6 w-11 items-center rounded-full transition-colors
        ${enabled ? 'bg-accent' : 'bg-dark-border'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <span
        className={`
          inline-block h-4 w-4 rounded-full bg-white transition-transform
          ${enabled ? 'translate-x-6' : 'translate-x-1'}
        `}
      />
    </button>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [triggeringJob, setTriggeringJob] = useState<string | null>(null);
  const [jobStatuses, setJobStatuses] = useState<Record<string, { lastRun?: string; lastStatus?: string }>>({});

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setSettings({ ...defaultSettings, ...json });
      setError(null);
    } catch {
      setError('Failed to load settings. API may not be available.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchJobStatuses = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs/status');
      if (!res.ok) return;
      const json = await res.json();
      const statuses: Record<string, { lastRun?: string; lastStatus?: string }> = {};
      if (json.jobs) {
        for (const job of json.jobs) {
          statuses[job.name] = { lastRun: job.last_run, lastStatus: job.status };
        }
      }
      setJobStatuses(statuses);
    } catch {
      // Job status API might not exist yet
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchJobStatuses();
  }, [fetchSettings, fetchJobStatuses]);

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSuccess('Settings saved successfully.');
      setTimeout(() => setSuccess(null), 3000);
    } catch {
      setError('Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  async function triggerJob(jobName: string) {
    try {
      setTriggeringJob(jobName);
      const res = await fetch('/api/jobs/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job: jobName }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSuccess(`Job "${jobName}" triggered successfully.`);
      setTimeout(() => setSuccess(null), 3000);
      // Refresh statuses after a brief delay
      setTimeout(() => fetchJobStatuses(), 2000);
    } catch {
      setError(`Failed to trigger job "${jobName}".`);
    } finally {
      setTriggeringJob(null);
    }
  }

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-sans font-bold mb-6">Settings</h1>
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-dark-card border border-dark-border rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-sans font-bold">Settings</h1>
        <p className="text-dark-muted text-sm mt-1">Configure scrapers, alerts, and integrations</p>
      </div>

      {error && (
        <div className="mb-4 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">
          {success}
        </div>
      )}

      {/* Telegram Configuration */}
      <div className="bg-dark-card border border-dark-border rounded-lg p-5 mb-6">
        <h2 className="font-sans font-semibold text-sm mb-4">Telegram Notifications</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable Telegram</p>
              <p className="text-xs text-dark-muted">Send alerts via Telegram bot</p>
            </div>
            <Toggle
              enabled={settings.telegram_enabled}
              onChange={(val) => updateSetting('telegram_enabled', val)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-dark-muted mb-1">Bot Token</label>
              <input
                type="password"
                value={settings.telegram_bot_token}
                onChange={(e) => updateSetting('telegram_bot_token', e.target.value)}
                placeholder="123456:ABC-DEF..."
                className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded text-sm text-dark-text font-mono placeholder-dark-muted focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-dark-muted mb-1">Chat ID</label>
              <input
                type="text"
                value={settings.telegram_chat_id}
                onChange={(e) => updateSetting('telegram_chat_id', e.target.value)}
                placeholder="-1001234567890"
                className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded text-sm text-dark-text font-mono placeholder-dark-muted focus:border-accent"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ntfy Configuration */}
      <div className="bg-dark-card border border-dark-border rounded-lg p-5 mb-6">
        <h2 className="font-sans font-semibold text-sm mb-4">ntfy Push Notifications</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable ntfy</p>
              <p className="text-xs text-dark-muted">Send push notifications via ntfy.sh or self-hosted ntfy</p>
            </div>
            <Toggle
              enabled={settings.ntfy_enabled}
              onChange={(val) => updateSetting('ntfy_enabled', val)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-dark-muted mb-1">Server URL</label>
              <input
                type="text"
                value={settings.ntfy_url}
                onChange={(e) => updateSetting('ntfy_url', e.target.value)}
                placeholder="https://ntfy.sh"
                className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded text-sm text-dark-text font-mono placeholder-dark-muted focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-dark-muted mb-1">Topic</label>
              <input
                type="text"
                value={settings.ntfy_topic}
                onChange={(e) => updateSetting('ntfy_topic', e.target.value)}
                placeholder="domainwatch-alerts"
                className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded text-sm text-dark-text font-mono placeholder-dark-muted focus:border-accent"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Alert Settings */}
      <div className="bg-dark-card border border-dark-border rounded-lg p-5 mb-6">
        <h2 className="font-sans font-semibold text-sm mb-4">Alert Settings</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Alert on Domain Available</p>
              <p className="text-xs text-dark-muted">Notify when a tracked domain becomes available</p>
            </div>
            <Toggle
              enabled={settings.alert_on_available}
              onChange={(val) => updateSetting('alert_on_available', val)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Alert on Domain Expiring</p>
              <p className="text-xs text-dark-muted">Notify when a domain is about to expire</p>
            </div>
            <Toggle
              enabled={settings.alert_on_expiring}
              onChange={(val) => updateSetting('alert_on_expiring', val)}
            />
          </div>
          <div>
            <label className="block text-xs text-dark-muted mb-1">Expiry Alert Threshold (days)</label>
            <input
              type="number"
              value={settings.alert_expiry_days_threshold}
              onChange={(e) => updateSetting('alert_expiry_days_threshold', parseInt(e.target.value) || 30)}
              min={1}
              max={365}
              className="w-32 px-3 py-2 bg-dark-bg border border-dark-border rounded text-sm text-dark-text font-mono focus:border-accent"
            />
          </div>
        </div>
      </div>

      {/* Scraper Jobs */}
      <div className="bg-dark-card border border-dark-border rounded-lg p-5 mb-6">
        <h2 className="font-sans font-semibold text-sm mb-4">Scraper Jobs</h2>
        <div className="space-y-4">
          {scraperJobs.map((job) => {
            const status = jobStatuses[job.name];
            return (
              <div
                key={job.name}
                className="flex items-center justify-between p-4 rounded-lg bg-dark-bg border border-dark-border/50"
              >
                <div className="flex-1 min-w-0 mr-4">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium">{job.label}</p>
                    <Toggle
                      enabled={settings[job.settingKey] as boolean}
                      onChange={(val) => updateSetting(job.settingKey, val as never)}
                    />
                  </div>
                  <p className="text-xs text-dark-muted mt-1">{job.description}</p>
                  {status && (
                    <div className="flex items-center gap-3 mt-2">
                      {status.lastRun && (
                        <span className="text-xs font-mono text-dark-muted">
                          Last run: {new Date(status.lastRun).toLocaleString('de-AT')}
                        </span>
                      )}
                      {status.lastStatus && (
                        <span className={`text-xs font-mono ${
                          status.lastStatus === 'success' ? 'text-green-400' :
                          status.lastStatus === 'running' ? 'text-yellow-400' :
                          status.lastStatus === 'error' ? 'text-red-400' : 'text-dark-muted'
                        }`}>
                          {status.lastStatus}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => triggerJob(job.name)}
                  disabled={triggeringJob === job.name}
                  className={`
                    shrink-0 px-4 py-2 text-xs font-medium rounded transition-colors
                    ${triggeringJob === job.name
                      ? 'bg-dark-border text-dark-muted cursor-not-allowed'
                      : 'bg-accent hover:bg-accent-hover text-white'
                    }
                  `}
                >
                  {triggeringJob === job.name ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Running...
                    </span>
                  ) : (
                    'Run Now'
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center justify-end gap-4">
        <button
          onClick={fetchSettings}
          className="px-6 py-2.5 text-sm font-medium rounded bg-dark-bg border border-dark-border text-dark-muted hover:text-dark-text transition-colors"
        >
          Discard Changes
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`
            px-6 py-2.5 text-sm font-medium rounded transition-colors
            ${saving
              ? 'bg-dark-border text-dark-muted cursor-not-allowed'
              : 'bg-accent hover:bg-accent-hover text-white'
            }
          `}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
