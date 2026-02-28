// /api/addresses.js
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  try {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return res.status(500).json({ status: 'error', message: 'Missing Supabase env vars.' });
    }

    const supabase = createClient(url, serviceKey);

    const slug = String((req.query.slug || 'zito')).trim().toLowerCase();
    const territory = String((req.query.territory || '')).trim();
    const status = String((req.query.status || '')).trim();

    // Lookup tenant
    const { data: company, error: cErr } = await supabase
      .from('companies')
      .select('id, slug, subscription_status')
      .eq('slug', slug)
      .maybeSingle();

    if (cErr) return res.status(500).json({ status: 'error', message: cErr.message });
    if (!company) return res.status(404).json({ status: 'error', message: 'Company not found' });
    if (String(company.subscription_status).toLowerCase() === 'canceled') {
      return res.status(402).json({ status: 'payment_required', message: 'Subscription canceled.' });
    }

    // Build query
    let q = supabase
      .from('addresses')
      .select('id, address, city, state, zip, lat, lng, status, territory, assigned_rep_id, created_source, created_at, updated_at, reps:assigned_rep_id(full_name)')      .eq('company_id', company.id)
      .order('updated_at', { ascending: false })
      .limit(2000);

    if (territory) q = q.eq('territory', territory);
    if (status) q = q.eq('status', status);

    const { data: rows, error: aErr } = await q;
    if (aErr) return res.status(500).json({ status: 'error', message: aErr.message });

    return res.status(200).json({
      status: 'ok',
      company_id: company.id,
      slug: company.slug,
      count: rows.length,
      rows
    });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: e.message || String(e) });
  }
};