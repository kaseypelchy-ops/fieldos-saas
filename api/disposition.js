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

    const body = req.body || {};
    const address_id = String(body.address_id || '').trim();
    const outcome = String(body.outcome || '').trim();
    const note = String(body.note || '').trim();
    const sold_package = String(body.sold_package || '').trim();
    const rep_id_param = String(body.rep_id || '').trim(); // manager can pass, rep cannot

    if (!address_id) return res.status(400).json({ status: 'error', message: 'Missing address_id' });
    if (!outcome) return res.status(400).json({ status: 'error', message: 'Missing outcome' });

    // Determine rep_id based on role
    let rep_id = '';
    if (String(ctx.role).toLowerCase() === 'rep') {
      const myRepId = await getMyRepId(supabase, ctx.company.id, auth.user.id);
      if (!myRepId) return res.status(403).json({ status: 'error', message: 'Rep is not linked to an auth user (reps.user_id missing)' });
      rep_id = myRepId;
    } else {
      // manager/admin must attribute disposition to a rep
      if (!rep_id_param) return res.status(400).json({ status: 'error', message: 'Missing rep_id (manager must select a rep)' });
      rep_id = rep_id_param;
    }

    // Load address (needed for territory + claim logic)
    const { data: addr, error: addrErr } = await supabase
      .from('addresses')
      .select('id, territory, assigned_rep_id, company_id')
      .eq('id', address_id)
      .maybeSingle();

    if (addrErr) return res.status(500).json({ status: 'error', message: addrErr.message });
    if (!addr) return res.status(404).json({ status: 'error', message: 'Address not found' });

    // Insert disposition (RLS enforced)
    const dispInsert = {
      company_id: ctx.company.id,
      address_id,
      rep_id,
      outcome,
      note: note || null,
      sold_package: outcome === 'sold' ? (sold_package || null) : null,
      territory: addr.territory || null
    };

    const { data: disp, error: dispErr } = await supabase
      .from('dispositions')
      .insert(dispInsert)
      .select('id, created_at')
      .maybeSingle();

    if (dispErr) return res.status(403).json({ status: 'error', message: dispErr.message });

    // Address Claim + Intelligence update:
    // - if unassigned, assign to rep
    // - always update last touch/outcome/note/touch_count
    // - set first touch only if missing
    const nowIso = new Date().toISOString();

    // Build update object
    const addrUpdate = {
      status: outcome,
      last_touched_at: nowIso,
      last_touched_by_rep_id: rep_id,
      last_outcome: outcome,
      last_note: note || null
    };

    // claim if unassigned
    if (!addr.assigned_rep_id) {
      addrUpdate.assigned_rep_id = rep_id;
    }

    // Set first touch if empty
    // (We can’t “conditionally set only if null” in one update reliably via supabase,
    // so we do a tiny second read to avoid overwriting.)
    const { data: addrCheck, error: addrCheckErr } = await supabase
      .from('addresses')
      .select('first_touched_at, touch_count')
      .eq('id', address_id)
      .maybeSingle();

    if (addrCheckErr) return res.status(500).json({ status: 'error', message: addrCheckErr.message });

    if (!addrCheck.first_touched_at) {
      addrUpdate.first_touched_at = nowIso;
      addrUpdate.first_touched_by_rep_id = rep_id;
    }

    // increment touch_count
    addrUpdate.touch_count = (Number(addrCheck.touch_count || 0) + 1);

    const { error: updErr } = await supabase
      .from('addresses')
      .update(addrUpdate)
      .eq('id', address_id);

    if (updErr) return res.status(403).json({ status: 'error', message: updErr.message });

    return res.status(200).json({
      status: 'ok',
      disposition_id: disp?.id || null,
      claimed: !addr.assigned_rep_id, // true if it was unassigned and we assigned it
      address_id
    });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: e.message || String(e) });
  }
};