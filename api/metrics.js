// /api/metrics.js
const { supabaseAnonWithToken, requireUser, getContext, getMyRepId } = require('./_auth');

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    const supabase = supabaseAnonWithToken(token);

    // 1) Require signed-in user
    const auth = await requireUser(req, supabase);
    if (auth.error) {
      return res.status(auth.error.status).json({ status: 'error', message: auth.error.message });
    }

    // 2) Resolve company + role from membership (RLS enforced)
    const ctx = await getContext(supabase, auth.user);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ status: 'error', message: ctx.error.message });
    }

    const territory = String(req.query.territory || '').trim();
    const rep_id_param = String(req.query.rep_id || '').trim();

    // 3) Role rules: reps can only see their own metrics
    let repId = '';
    if (ctx.role === 'rep') {
      const myRepId = await getMyRepId(supabase, ctx.company.id, auth.user.id);
      if (!myRepId) {
        return res.status(403).json({
          status: 'error',
          message: 'Rep is not linked to an auth user (reps.user_id missing).'
        });
      }
      repId = myRepId;
    } else {
      // manager/admin can optionally filter to a rep
      repId = rep_id_param || '';
    }

    // 4) Assigned count (addresses)
    let addrQ = supabase
      .from('addresses')
      .select('id', { count: 'exact', head: true });

    // RLS already scopes to company; optional filters:
    if (territory) addrQ = addrQ.eq('territory', territory);
    if (repId) addrQ = addrQ.eq('assigned_rep_id', repId);

    const { count: assignedCount, error: addrErr } = await addrQ;
    if (addrErr) {
      return res.status(500).json({ status: 'error', message: addrErr.message });
    }

    // 5) Disposition aggregation
    const counts = { sold: 0, not_home: 0, not_interested: 0, go_back: 0, other: 0 };
    let totalDisp = 0;

    function baseDispQ() {
      let q = supabase
        .from('dispositions')
        .select('outcome');

      // RLS scopes to company; optional rep filter
      if (repId) q = q.eq('rep_id', repId);
      return q;
    }

    if (!territory) {
      const { data: dispRows, error: dispErr } = await baseDispQ().limit(20000);
      if (dispErr) {
        return res.status(500).json({ status: 'error', message: dispErr.message });
      }

      (dispRows || []).forEach(r => {
        const o = String(r.outcome || '').toLowerCase();
        if (o in counts) counts[o] += 1;
        else counts.other += 1;
      });

      totalDisp = (dispRows || []).length;
    } else {
      // Territory filter: find address ids in territory (RLS scopes to company)
      const { data: addrRows, error: tErr } = await supabase
        .from('addresses')
        .select('id')
        .eq('territory', territory)
        .limit(10000);

      if (tErr) {
        return res.status(500).json({ status: 'error', message: tErr.message });
      }

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

      // Chunk IN lists so it scales
      for (const idsChunk of chunk(ids, 1000)) {
        const { data: dispRows, error: dispErr } = await baseDispQ()
          .in('address_id', idsChunk)
          .limit(20000);

        if (dispErr) {
          return res.status(500).json({ status: 'error', message: dispErr.message });
        }

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