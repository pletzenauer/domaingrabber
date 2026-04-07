import axios from 'axios';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function sendTelegramMessage(html: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('Telegram credentials not configured, skipping notification');
    return;
  }

  await axios.post(
    `${API_BASE}/sendMessage`,
    {
      chat_id: CHAT_ID,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    },
    { timeout: 10000 }
  );
}

/**
 * Send a plain text/HTML alert message.
 */
export async function sendAlert(message: string): Promise<void> {
  await sendTelegramMessage(message);
}

/**
 * Send a formatted alert for a single domain status change.
 */
export async function sendDomainAlert(domain: {
  domain: string;
  status: string;
  expiry_date?: string | null;
}): Promise<void> {
  const emoji =
    domain.status === 'available'
      ? '\u2705'
      : domain.status === 'expiring'
        ? '\u26a0\ufe0f'
        : domain.status === 'redemption'
          ? '\ud83d\udd34'
          : '\u2139\ufe0f';

  let msg = `${emoji} <b>Domain Alert</b>\n\n`;
  msg += `<b>Domain:</b> <code>${domain.domain}</code>\n`;
  msg += `<b>Status:</b> ${domain.status.toUpperCase()}\n`;

  if (domain.expiry_date) {
    const expiry = new Date(domain.expiry_date);
    msg += `<b>Expiry:</b> ${expiry.toISOString().split('T')[0]}\n`;
  }

  msg += `\n<i>AustrianDomainWatch</i>`;

  await sendTelegramMessage(msg);
}

/**
 * Send a summary alert for a batch of domain status changes.
 */
export async function sendBatchAlert(
  domains: Array<{ domain: string; status: string }>
): Promise<void> {
  if (domains.length === 0) return;

  let msg = `\ud83d\udcca <b>Domain Watch Report</b>\n`;
  msg += `<b>${domains.length}</b> domain(s) with updates:\n\n`;

  const grouped: Record<string, string[]> = {};
  for (const d of domains) {
    if (!grouped[d.status]) grouped[d.status] = [];
    grouped[d.status].push(d.domain);
  }

  const statusLabels: Record<string, string> = {
    available: '\u2705 Available',
    expiring: '\u26a0\ufe0f Expiring Soon',
    redemption: '\ud83d\udd34 Redemption Period',
    registered: '\u2139\ufe0f Registered',
    error: '\u274c Error',
  };

  for (const [status, domainList] of Object.entries(grouped)) {
    const label = statusLabels[status] ?? status;
    msg += `<b>${label}</b>\n`;
    for (const d of domainList) {
      msg += `  \u2022 <code>${d}</code>\n`;
    }
    msg += '\n';
  }

  msg += `<i>AustrianDomainWatch</i>`;

  // Telegram messages have a 4096 char limit; split if needed
  if (msg.length > 4000) {
    const chunks: string[] = [];
    let current = '';
    const lines = msg.split('\n');
    for (const line of lines) {
      if (current.length + line.length + 1 > 3900) {
        chunks.push(current);
        current = '';
      }
      current += line + '\n';
    }
    if (current.trim()) chunks.push(current);

    for (const chunk of chunks) {
      await sendTelegramMessage(chunk);
    }
  } else {
    await sendTelegramMessage(msg);
  }
}
