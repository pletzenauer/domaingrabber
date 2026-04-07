import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '25', 10)));
    const offset = (page - 1) * limit;

    const alertType = searchParams.get('alert_type');

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (alertType) {
      conditions.push(`al.alert_type = $${paramIndex++}`);
      params.push(alertType);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countResult = await query(
      `SELECT COUNT(*) as total FROM alert_log al ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // Fetch page with domain info
    const dataResult = await query(
      `SELECT al.id, al.domain_id, al.alert_type, al.sent_at, al.payload,
              d.domain, d.status as domain_status
       FROM alert_log al
       LEFT JOIN domains d ON d.id = al.domain_id
       ${whereClause}
       ORDER BY al.sent_at DESC, al.id DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset]
    );

    return NextResponse.json({
      data: dataResult.rows,
      total,
      page,
      limit,
    });
  } catch (err) {
    console.error('[API] GET /api/alerts error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
