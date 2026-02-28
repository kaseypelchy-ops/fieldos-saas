// /api/reps.js
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  try {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return res.status(500).json({ status: 'error', message: 'Missing Supabase env vars.' });
    }

    const supabase = createClient(url, serviceKey);

    const slug = String(req.query.slug || 'zito').trim().toLowerCase();

    const { data: company, error: cErr } = await supabase
      .from('companies')
      .select('id, subscription_status')
      .eq('slug', slug)
      .maybeSingle();

    if (cErr) return res.status(500).json({ status: 'error', message: cErr.message });
    if (!company) return res.status(404).json({ status: 'error', message: 'Company not found' });
    if (String(company.subscription_status).toLowerCase() === 'canceled') {
      return res.status(402).json({ status: 'payment_required', message: 'Subscription canceled.' });
    }

    const { data: reps, error: rErr } = await supabase
      .from('reps')
      .select('id, full_name, role, is_active')
      .eq('company_id', company.id)
      .eq('is_active', true)
      .order('role', { ascending: false })
      .order('full_name', { ascending: true });

    if (rErr) return res.status(500).json({ status: 'error', message: rErr.message });

    return res.status(200).json({ status: 'ok', company_id: company.id, reps });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: e.message || String(e) });
  }
};