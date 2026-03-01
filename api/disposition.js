// api/disposition.js
const { supabaseAnonWithToken, requireUser, getContext, getMyRepId } = require('./_auth');

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    const supabase = supabaseAnonWithToken(token);

    const auth = await requireUser(req, supabase);
    if (auth.error) return res.status(auth.error.status).json({ status: 'error', message: auth.error.message });

    const ctx = await getContext(supabase, auth.user);
    if (ctx.error) return res.status(ctx.error.status).json({ status: 'error', message: ctx.error.message });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const address_id = String(body.address_id || '').trim();
    const outcome = String(body.outcome || '').trim();
    const note = String(body.note || '').trim();
    const sold_package = String(body.sold_package || '').trim();

    if (!address_id || !outcome) {
      return res.status(400).json({ status: 'error', message: 'Missing address_id or outcome' });
    }

    let rep_id = String(body.rep_id || '').trim();

    if (ctx.role === 'rep') {
      const myRepId = await getMyRepId(supabase, ctx.company.id, auth.user.id);
      if (!myRepId) return res.status(403).json({ status: 'error', message: 'Rep is not linked to an auth user (reps.user_id missing)' });
      rep_id = myRepId;
    } else {
      if (!rep_id) return res.status(400).json({ status: 'error', message: 'Manager must provide rep_id' });
    }

    // Insert disposition (RLS ensures company_id must match membership)
    const { data: disp, error: dErr } = await supabase
      .from('dispositions')
      .insert([{
        company_id: ctx.company.id,
        address_id,
        rep_id,
        outcome,
        note,
        sold_package: outcome === 'sold' ? sold_package : null
      }])
      .select('*')
      .single();

    if (dErr) return res.status(500).json({ status: 'error', message: dErr.message });

    // Update address status + assignment
    const { error: aErr } = await supabase
      .from('addresses')
      .update({
        status: outcome,
        assigned_rep_id: rep_id,
        updated_at: new Date().toISOString()
      })
      .eq('id', address_id);

    if (aErr) return res.status(500).json({ status: 'error', message: aErr.message });

    return res.status(200).json({ status: 'ok', disposition: disp });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: e.message || String(e) });
  }
};