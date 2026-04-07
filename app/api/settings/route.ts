import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const result = await query(`SELECT key, value FROM settings ORDER BY key`);

    const settings: Record<string, string> = {};
    for (const row of result.rows) {
      settings[row.key] = row.value;
    }

    return NextResponse.json(settings);
  } catch (err) {
    console.error('[API] GET /api/settings error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    // Support single key/value: { key: "foo", value: "bar" }
    if (body.key && typeof body.key === 'string' && body.value !== undefined) {
      const value = String(body.value);
      await query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [body.key, value]
      );
      return NextResponse.json({ success: true, key: body.key, value });
    }

    // Support bulk save: { telegram_enabled: true, ntfy_topic: "foo", ... }
    const entries = Object.entries(body).filter(
      ([, v]) => v !== undefined && v !== null
    );

    if (entries.length === 0) {
      return NextResponse.json(
        { error: 'No settings provided' },
        { status: 400 }
      );
    }

    for (const [key, val] of entries) {
      const value = String(val);
      await query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value]
      );
    }

    return NextResponse.json({ success: true, count: entries.length });
  } catch (err) {
    console.error('[API] PUT /api/settings error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
