import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '25', 10)));
    const offset = (page - 1) * limit;

    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const expiringWithinDays = searchParams.get('expiring_within_days');

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`d.status = $${paramIndex++}`);
      params.push(status);
    }

    if (search) {
      conditions.push(`d.domain ILIKE $${paramIndex++}`);
      params.push(`%${search}%`);
    }

    if (expiringWithinDays) {
      const days = parseInt(expiringWithinDays, 10);
      if (!isNaN(days) && days > 0) {
        conditions.push(`d.expiry_date IS NOT NULL AND d.expiry_date <= NOW() + INTERVAL '${days} days'`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countResult = await query(
      `SELECT COUNT(*) as total FROM domains d ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // Fetch page with company name join
    const dataResult = await query(
      `SELECT d.id, d.dissolution_id, d.domain, d.tld, d.status, d.expiry_date,
              d.registrar, d.last_checked, d.alert_sent, d.created_at,
              d.is_online, d.http_status, d.redirect_url,
              d.backlink_count, d.referring_domains, d.domain_authority,
              d.page_rank, d.seo_score, d.scored_at,
              dis.company_name
       FROM domains d
       LEFT JOIN dissolutions dis ON dis.id = d.dissolution_id
       ${whereClause}
       ORDER BY d.created_at DESC, d.id DESC
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
    console.error('[API] GET /api/domains error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
