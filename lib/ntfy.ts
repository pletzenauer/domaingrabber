import axios from 'axios';

const NTFY_URL = process.env.NTFY_URL ?? 'https://ntfy.sh';
const NTFY_TOPIC = process.env.NTFY_TOPIC;

async function sendNtfyMessage(title: string, message: string, priority?: number, tags?: string[]): Promise<void> {
  if (!NTFY_TOPIC) {
    console.warn('ntfy topic not configured, skipping notification');
    return;
  }

  await axios.post(
    `${NTFY_URL}/${NTFY_TOPIC}`,
    message,
    {
      headers: {
        Title: title,
        Priority: String(priority ?? 3),
        ...(tags?.length ? { Tags: tags.join(',') } : {}),
      },
      timeout: 10000,
    }
  );
}

export async function sendNtfyAlert(message: string): Promise<void> {
  await sendNtfyMessage('Domain Alert', message);
}

export async function sendNtfyDomainAlert(domain: {
  domain: string;
  status: string;
  expiry_date?: string | null;
}): Promise<void> {
  const priority = domain.status === 'available' ? 5 : domain.status === 'expiring' ? 4 : 3;
  const tags = domain.status === 'available' ? ['white_check_mark'] : domain.status === 'expiring' ? ['warning'] : ['red_circle'];

  let msg = `Domain: ${domain.domain}\nStatus: ${domain.status.toUpperCase()}`;
  if (domain.expiry_date) {
    const expiry = new Date(domain.expiry_date);
    msg += `\nExpiry: ${expiry.toISOString().split('T')[0]}`;
  }

  await sendNtfyMessage('Domain Alert', msg, priority, tags);
}

export async function sendNtfyBatchAlert(
  domains: Array<{ domain: string; status: string }>
): Promise<void> {
  if (domains.length === 0) return;

  const grouped: Record<string, string[]> = {};
  for (const d of domains) {
    if (!grouped[d.status]) grouped[d.status] = [];
    grouped[d.status].push(d.domain);
  }

  const statusLabels: Record<string, string> = {
    available: 'Available',
    expiring: 'Expiring Soon',
    redemption: 'Redemption Period',
    registered: 'Registered',
    error: 'Error',
  };

  let msg = `${domains.length} domain(s) with updates:\n`;

  for (const [status, domainList] of Object.entries(grouped)) {
    const label = statusLabels[status] ?? status;
    msg += `\n${label}:\n`;
    for (const d of domainList) {
      msg += `  - ${d}\n`;
    }
  }

  const hasAvailable = grouped['available']?.length > 0;
  const priority = hasAvailable ? 5 : 4;
  const tags = hasAvailable ? ['white_check_mark', 'loudspeaker'] : ['loudspeaker'];

  await sendNtfyMessage('Domain Watch Report', msg.trim(), priority, tags);
}
