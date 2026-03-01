// api/disposition.js
const { supabaseAnonWithToken, requireUser, getContext, getMyRepId } = require('./_auth');

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    const supabase = supabaseAnonWithToken(token);

    const auth = await requireUser(req, supabase);
    if (auth.error) {
      return res.status(auth.error.status).json({ status: 'error', message: auth.error.message });
    }

    const ctx = await getContext(supabase, auth.user);
    if (ctx.error) {
      return res.status(ctx.error.status).json({ status: 'error', message: ctx.error.message });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    const address_id    = String(body.address_id || '').trim();
    const outcome       = String(body.outcome || '').trim().toLowerCase();
    const note          = String(body.note || '').trim();
    const sold_package  = String(body.sold_package || '').trim();

    if (!address_id || !outcome) {
      return res.status(400).json({ status: 'error', message: 'Missing address_id or outcome' });
    }

    // ✅ Basic outcome validation (keeps data clean)
    const allowed = new Set(['not_home', 'not_interested', 'go_back', 'sold']);
    if (!allowed.has(outcome)) {
      return res.status(400).json({ status: 'error', message: `Invalid outcome: ${outcome}` });
    }

    // Determine rep_id
    let rep_id = String(body.rep_id || '').trim();

    if (ctx.role === 'rep') {
      const myRepId = await getMyRepId(supabase, ctx.company.id, auth.user.id);
      if (!myRepId) {
        return res.status(403).json({
          status: 'error',
          message: 'Rep is not linked to an auth user (reps.user_id missing)'
        });
      }
      rep_id = myRepId; // ✅ forced
    } else {
      if (!rep_id) return res.status(400).json({ status: 'error', message: 'Manager must provide rep_id' });
    }

    // ✅ Load the address and validate it belongs to this company
    const { data: addr, error: addrErr } = await supabase
      .from('addresses')
      .select('id, company_id, territory, assigned_rep_id, status')
      .eq('id', address_id)
      .maybeSingle();

    if (addrErr) return res.status(500).json({ status: 'error', message: addrErr.message });
    if (!addr) return res.status(404).json({ status: 'error', message: 'Address not found' });

    if (String(addr.company_id) !== String(ctx.company.id)) {
      return res.status(403).json({ status: 'error', message: 'Address is not in your company' });
    }

    // ✅ Rep rule: can work their own addresses OR pick up unassigned
    // (Territory restriction is handled by how you load addresses for reps)
    if (ctx.role === 'rep') {
      const assigned = addr.assigned_rep_id ? String(addr.assigned_rep_id) : '';
      if (assigned && assigned !== String(rep_id)) {
        return res.status(403).json({
          status: 'error',
          message: 'This address is assigned to another rep'
        });
      }
    }

    // Insert disposition
    const { data: disp, error: dErr } = await supabase
      .from('dispositions')
      .insert([{
        company_id: ctx.company.id,
        address_id,
        rep_id,
        outcome,
        note,
        sold_package: outcome === 'sold' ? (sold_package || null) : null
      }])
      .select('*')
      .single();

    if (dErr) return res.status(500).json({ status: 'error', message: dErr.message });

    // Update address status + assignment (rep “claims” if it was unassigned)
    const { error: aErr } = await supabase
      .from('addresses')
      .update({
        status: outcome,
        assigned_rep_id: rep_id,               // ✅ claim / keep assignment
        updated_at: new Date().toISOString()
      })
      .eq('id', address_id)
      .eq('company_id', ctx.company.id);       // ✅ prevents cross-company update

    if (aErr) return res.status(500).json({ status: 'error', message: aErr.message });

    return res.status(200).json({ status: 'ok', disposition: disp });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: e.message || String(e) });
  }
};