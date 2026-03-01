// api/metrics.js
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

    const territory = String(req.query.territory || '').trim();
    const rep_id_param = String(req.query.rep_id || '').trim();

    // Optional date window (filters dispositions.created_at)
    // Accepts YYYY-MM-DD or ISO; we convert YYYY-MM-DD to range edges.
    const fromRaw = String(req.query.from || '').trim(); // e.g. 2026-02-01
    const toRaw   = String(req.query.to || '').trim();   // e.g. 2026-02-28

    let fromIso = '';
    let toIso = '';

    if (fromRaw) {
      fromIso = fromRaw.length === 10 ? `${fromRaw}T00:00:00.000Z` : fromRaw;
    }
    if (toRaw) {
      // inclusive end-of-day if YYYY-MM-DD
      toIso = toRaw.length === 10 ? `${toRaw}T23:59:59.999Z` : toRaw;
    }

    // Resolve rep filter
    let repId = '';
    if (String(ctx.role).toLowerCase() === 'rep') {
      const myRepId = await getMyRepId(supabase, ctx.company.id, auth.user.id);
      if (!myRepId) return res.status(403).json({ status: 'error', message: 'Rep is not linked to an auth user (reps.user_id missing)' });
      repId = myRepId;
    } else {
      repId = rep_id_param || '';
    }

    // -----------------------------
    // Addresses counts
    // -----------------------------
    // "assigned": count addresses assigned to rep (or all assigned if no rep filter)
    // "unassigned_visible": addresses unassigned (scoped by territory)
    let addrBase = supabase
      .from('addresses')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', ctx.company.id);

    if (territory) addrBase = addrBase.eq('territory', territory);

    // assigned count
    let assignedQ = addrBase;
    if (repId) assignedQ = assignedQ.eq('assigned_rep_id', repId);
    else assignedQ = assignedQ.not('assigned_rep_id', 'is', null);

    const { count: assignedCount, error: assignedErr } = await assignedQ;
    if (assignedErr) return res.status(500).json({ status: 'error', message: assignedErr.message });

    // unassigned visible (for rep or manager)
    let unassignedQ = addrBase.is('assigned_rep_id', null);
    const { count: unassignedCount, error: unassignedErr } = await unassignedQ;
    if (unassignedErr) return res.status(500).json({ status: 'error', message: unassignedErr.message });

    // touches sum (optional, lightweight)
    // NOTE: Supabase cannot sum with head:true easily, so we fetch small set of touch_count only when filtered.
    // For big datasets you can remove this or move to RPC later.
    let touches = null;
    try {
      let tQ = supabase
        .from('addresses')
        .select('touch_count')
        .eq('company_id', ctx.company.id);

      if (territory) tQ = tQ.eq('territory', territory);
      if (repId) {
        // touches for addresses assigned to rep OR unassigned (rep can work both)
        tQ = tQ.or(`assigned_rep_id.eq.${repId},assigned_rep_id.is.null`);
      }

      const { data: tRows } = await tQ.limit(5000);
      if (Array.isArray(tRows)) {
        touches = tRows.reduce((s, r) => s + Number(r.touch_count || 0), 0);
      }
    } catch (_) {
      touches = null;
    }

    // -----------------------------
    // Dispositions breakdown
    // -----------------------------
    let dispQ = supabase
      .from('dispositions')
      .select('outcome, address_id')
      .eq('company_id', ctx.company.id);

    if (repId) dispQ = dispQ.eq('rep_id', repId);
    if (territory) dispQ = dispQ.eq('territory', territory);
    if (fromIso) dispQ = dispQ.gte('created_at', fromIso);
    if (toIso) dispQ = dispQ.lte('created_at', toIso);

    const { data: dispRows, error: dispErr } = await dispQ.limit(20000);
    if (dispErr) return res.status(500).json({ status: 'error', message: dispErr.message });

    const counts = { sold: 0, not_home: 0, not_interested: 0, go_back: 0, other: 0 };
    const workedSet = new Set();

    (dispRows || []).forEach(r => {
      const o = String(r.outcome || '').toLowerCase();
      if (o in counts) counts[o] += 1;
      else counts.other += 1;
      if (r.address_id) workedSet.add(String(r.address_id));
    });

    const dispositions = (dispRows || []).length;
    const worked_addresses = workedSet.size;

    const contacted = counts.sold + counts.not_home + counts.not_interested + counts.go_back;
    const close_rate = contacted > 0 ? Number(((counts.sold / contacted) * 100).toFixed(1)) : 0;

    return res.status(200).json({
      status: 'ok',
      metrics: {
        assigned: assignedCount || 0,
        unassigned_visible: unassignedCount || 0,
        dispositions,
        worked_addresses,
        sold: counts.sold,
        not_home: counts.not_home,
        not_interested: counts.not_interested,
        go_back: counts.go_back,
        contacted,
        close_rate,
        touches
      }
    });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: e.message || String(e) });
  }
};