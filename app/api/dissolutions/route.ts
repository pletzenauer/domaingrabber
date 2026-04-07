import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '25', 10)));
    const offset = (page - 1) * limit;

    const source = searchParams.get('source');
    const proceedingType = searchParams.get('proceeding_type');
    const search = searchParams.get('search');
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

    // Build WHERE clauses dynamically
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (source) {
      conditions.push(`source = $${paramIndex++}`);
      params.push(source);
    }

    if (proceedingType) {
      conditions.push(`proceeding_type = $${paramIndex++}`);
      params.push(proceedingType);
    }

    if (search) {
      conditions.push(`company_name ILIKE $${paramIndex++}`);
      params.push(`%${search}%`);
    }

    if (dateFrom) {
      conditions.push(`gazette_date >= $${paramIndex++}`);
      params.push(dateFrom);
    }

    if (dateTo) {
      conditions.push(`gazette_date <= $${paramIndex++}`);
      params.push(dateTo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countResult = await query(
      `SELECT COUNT(*) as total FROM dissolutions ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // Fetch page
    const dataResult = await query(
      `SELECT id, company_name, company_slug, court, proceeding_type, gazette_date,
              source, source_url, source_ref, existing_website, enriched_at, created_at
       FROM dissolutions
       ${whereClause}
       ORDER BY gazette_date DESC, id DESC
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
    console.error('[API] GET /api/dissolutions error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
