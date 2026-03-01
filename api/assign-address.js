// api/assign-address.js
const { supabaseAnonWithToken, requireUser, getContext, getMyRepId } = require('./_auth');

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
      return res.status(405).json({ status: 'error', message: 'Method not allowed. Use POST.' });
    }

    // --- Auth ---
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    const supabase = supabaseAnonWithToken(token);

    const auth = await requireUser(req, supabase);
    if (auth.error) return res.status(auth.error.status).json({ status: 'error', message: auth.error.message });

    const ctx = await getContext(supabase, auth.user);
    if (ctx.error) return res.status(ctx.error.status).json({ status: 'error', message: ctx.error.message });

    // --- Input ---
    const body = req.body || {};
    const address_id = String(body.address_id || '').trim();
    const rep_id_param = String(body.rep_id || '').trim(); // manager/admin can send this

    if (!address_id) {
      return res.status(400).json({ status: 'error', message: 'Missing address_id' });
    }

    const role = String(ctx.role || 'rep').toLowerCase();

    // Resolve the rep_id we will assign to
    let targetRepId = '';

    if (role === 'rep') {
      // Rep can only assign to themselves
      const myRepId = await getMyRepId(supabase, ctx.company.id, auth.user.id);
      if (!myRepId) {
        return res.status(403).json({
          status: 'error',
          message: 'Rep is not linked to an auth user (reps.user_id missing)'
        });
      }
      targetRepId = myRepId;
    } else {
      // Manager/Admin must specify who to assign to
      if (!rep_id_param) {
        return res.status(400).json({ status: 'error', message: 'Missing rep_id (manager/admin must provide rep_id)' });
      }
      targetRepId = rep_id_param;
    }

    // --- Load address (need to know current assignment + territory if you enforce later) ---
    const { data: addr, error: addrErr } = await supabase
      .from('addresses')
      .select('id, company_id, territory, assigned_rep_id')
      .eq('id', address_id)
      .maybeSingle();

    if (addrErr) return res.status(500).json({ status: 'error', message: addrErr.message });
    if (!addr) return res.status(404).json({ status: 'error', message: 'Address not found' });

    // --- Rep Claim rules ---
    // Rep can only claim if currently unassigned
    if (role === 'rep') {
      if (addr.assigned_rep_id) {
        return res.status(403).json({
          status: 'error',
          message: 'This address is already assigned. Reps can only claim unassigned addresses.'
        });
      }
    }

    // --- Update assignment ---
    const nowIso = new Date().toISOString();

    // Assign + set claim intelligence if first time touched/claimed
    // (We won't overwrite first_touched fields if they already exist.)
    const { data: existing, error: exErr } = await supabase
      .from('addresses')
      .select('first_touched_at, touch_count')
      .eq('id', address_id)
      .maybeSingle();

    if (exErr) return res.status(500).json({ status: 'error', message: exErr.message });

    const updateObj = {
      assigned_rep_id: targetRepId,
      last_touched_at: nowIso,
      last_touched_by_rep_id: targetRepId,
      touch_count: Number(existing?.touch_count || 0) + 1
    };

    if (!existing?.first_touched_at) {
      updateObj.first_touched_at = nowIso;
      updateObj.first_touched_by_rep_id = targetRepId;
    }

    const { error: updErr } = await supabase
      .from('addresses')
      .update(updateObj)
      .eq('id', address_id);

    if (updErr) {
      // If RLS blocks this, you'll see it here.
      return res.status(403).json({ status: 'error', message: updErr.message });
    }

    return res.status(200).json({
      status: 'ok',
      address_id,
      assigned_rep_id: targetRepId,
      claimed: role === 'rep',
      touched: true
    });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: e.message || String(e) });
  }
};