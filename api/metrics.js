// /api/metrics.js
const { createClient } = require('@supabase/supabase-js');

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

module.exports = async (req, res) => {
  try {
    // Always fresh (no CDN caching for metrics)
    res.setHeader('Cache-Control', 'no-store');

    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return res.status(500).json({ status: 'error', message: 'Missing Supabase env vars.' });
    }

    const supabase = createClient(url, serviceKey);

    const slug = String(req.query.slug || 'zito').trim().toLowerCase();
    const rep_id = String(req.query.rep_id || '').trim();        // optional
    const territory = String(req.query.territory || '').trim();  // optional

    // Tenant lookup
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

    // ---------- Assigned count (addresses) ----------
    let addrQ = supabase
      .from('addresses')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company.id);

    if (territory) addrQ = addrQ.eq('territory', territory);
    if (rep_id) addrQ = addrQ.eq('assigned_rep_id', rep_id);

    const { count: assignedCount, error: addrErr } = await addrQ;
    if (addrErr) return res.status(500).json({ status: 'error', message: addrErr.message });

    // ---------- Dispositions breakdown ----------
    const counts = { sold: 0, not_home: 0, not_interested: 0, go_back: 0, other: 0 };
    let totalDisp = 0;

    // Base query builder for dispositions
    function baseDispQ() {
      let q = supabase
        .from('dispositions')
        .select('outcome')
        .eq('company_id', company.id);

      if (rep_id) q = q.eq('rep_id', rep_id);
      return q;
    }

    // If no territory filter: simple read
    if (!territory) {
      const { data: dispRows, error: dispErr } = await baseDispQ().limit(20000);
      if (dispErr) return res.status(500).json({ status: 'error', message: dispErr.message });

      (dispRows || []).forEach(r => {
        const o = String(r.outcome || '').toLowerCase();
        if (o in counts) counts[o] += 1;
        else counts.other += 1;
      });

      totalDisp = (dispRows || []).length;
    } else {
      // Territory filter: find address ids first, then chunk "IN" queries
      const { data: addrRows, error: tErr } = await supabase
        .from('addresses')
        .select('id')
        .eq('company_id', company.id)
        .eq('territory', territory)
        .limit(10000);

      if (tErr) return res.status(500).json({ status: 'error', message: tErr.message });

      const ids = (addrRows || []).map(r => r.id);
      if (ids.length === 0) {
        return res.status(200).json({
          status: 'ok',
          metrics: {
            assigned: assignedCount || 0,
            dispositions: 0,
            sold: 0,
            not_home: 0,
            not_interested: 0,
            go_back: 0,
            other: 0,
            close_rate: 0
          }
        });
      }

      // Chunk to avoid huge IN lists (safe as you scale)
      const chunks = chunk(ids, 1000);

      for (const idsChunk of chunks) {
        const { data: dispRows, error: dispErr } = await baseDispQ()
          .in('address_id', idsChunk)
          .limit(20000);

        if (dispErr) return res.status(500).json({ status: 'error', message: dispErr.message });

        (dispRows || []).forEach(r => {
          const o = String(r.outcome || '').toLowerCase();
          if (o in counts) counts[o] += 1;
          else counts.other += 1;
        });

        totalDisp += (dispRows || []).length;
      }
    }

    const closeRate = totalDisp > 0 ? (counts.sold / totalDisp) : 0;

    return res.status(200).json({
      status: 'ok',
      metrics: {
        assigned: assignedCount || 0,
        dispositions: totalDisp,
        sold: counts.sold,
        not_home: counts.not_home,
        not_interested: counts.not_interested,
        go_back: counts.go_back,
        other: counts.other,
        close_rate: Number((closeRate * 100).toFixed(1))
      }
    });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: e.message || String(e) });
  }
};