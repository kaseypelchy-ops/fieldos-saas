// /api/disposition.js
const { createClient } = require('@supabase/supabase-js');

function bad(res, code, message) {
  return res.status(code).json({ status: 'error', message });
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return bad(res, 405, 'Use POST');
    }

    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return bad(res, 500, 'Missing Supabase env vars.');

    const supabase = createClient(url, serviceKey);

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const slug = String(body.slug || 'zito').trim().toLowerCase();

    const address_id = String(body.address_id || '').trim();
    const rep_id = body.rep_id ? String(body.rep_id).trim() : null;

    // outcome examples: sold | not_home | not_interested | go_back
    const outcome = String(body.outcome || '').trim();
    const note = body.note != null ? String(body.note).trim() : null;
    const sold_package = body.sold_package != null ? String(body.sold_package).trim() : null;

    if (!address_id) return bad(res, 400, 'address_id is required');
    if (!outcome) return bad(res, 400, 'outcome is required');

    // Lookup tenant
    const { data: company, error: cErr } = await supabase
      .from('companies')
      .select('id, subscription_status')
      .eq('slug', slug)
      .maybeSingle();

    if (cErr) return bad(res, 500, cErr.message);
    if (!company) return bad(res, 404, 'Company not found');
    if (String(company.subscription_status).toLowerCase() === 'canceled') {
      return res.status(402).json({ status: 'payment_required', message: 'Subscription canceled.' });
    }

    // Ensure address belongs to tenant
    const { data: addr, error: aErr } = await supabase
      .from('addresses')
      .select('id, company_id, status')
      .eq('id', address_id)
      .maybeSingle();

    if (aErr) return bad(res, 500, aErr.message);
    if (!addr) return bad(res, 404, 'Address not found');
    if (String(addr.company_id) !== String(company.id)) return bad(res, 403, 'Address is not in this tenant');

    // 1) Insert disposition
    const { data: disp, error: dErr } = await supabase
      .from('dispositions')
      .insert([{
        company_id: company.id,
        address_id,
        rep_id,
        outcome,
        note,
        sold_package
      }])
      .select('id, company_id, address_id, rep_id, outcome, note, sold_package, knocked_at')
      .single();

    if (dErr) return bad(res, 500, dErr.message);

    // 2) Update address status (+ optionally assign rep)
    // Map outcome -> address.status
    const statusMap = {
      sold: 'sold',
      not_home: 'not_home',
      not_interested: 'not_interested',
      go_back: 'go_back'
    };
    const newStatus = statusMap[outcome] || outcome; // allow custom outcomes too

    const patch = { status: newStatus };
    if (rep_id) patch.assigned_rep_id = rep_id;

    const { data: updatedAddr, error: uErr } = await supabase
      .from('addresses')
      .update(patch)
      .eq('id', address_id)
      .select('id, status, assigned_rep_id, updated_at')
      .single();

    if (uErr) return bad(res, 500, uErr.message);

    return res.status(200).json({
      status: 'ok',
      disposition: disp,
      address: updatedAddr
    });
  } catch (e) {
    return bad(res, 500, e.message || String(e));
  }
};