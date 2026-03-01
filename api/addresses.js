// api/addresses.js
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

    const territory    = String(req.query.territory || '').trim();
    const status       = String(req.query.status || '').trim();
    const rep_id_param = String(req.query.rep_id || '').trim();

    // Resolve "my rep id" if role = rep
    let myRepId = '';
    if (String(ctx.role).toLowerCase() === 'rep') {
      myRepId = await getMyRepId(supabase, ctx.company.id, auth.user.id);
      if (!myRepId) {
        return res.status(403).json({
          status: 'error',
          message: 'Rep is not linked to an auth user (reps.user_id missing)'
        });
      }
    }

    let q = supabase
      .from('addresses')
      .select('id, address, city, state, zip, lat, lng, status, territory, assigned_rep_id, created_source, created_at, updated_at, reps:assigned_rep_id(full_name)')
      .eq('company_id', ctx.company.id) // ✅ explicit company scope (recommended)
      .order('updated_at', { ascending: false })
      .limit(2000);

    // Filters
    if (territory) q = q.eq('territory', territory);
    if (status) q = q.eq('status', status);

    if (String(ctx.role).toLowerCase() === 'rep') {
      // ✅ REP RULE:
      // show addresses assigned to me OR unassigned
      // Supabase "or" syntax: column.eq.value,column.is.null
      q = q.or(`assigned_rep_id.eq.${myRepId},assigned_rep_id.is.null`);
    } else {
      // Manager/Admin optional filter by rep_id (only if provided)
      if (rep_id_param) q = q.eq('assigned_rep_id', rep_id_param);
    }

    const { data: rows, error } = await q;
    if (error) return res.status(500).json({ status: 'error', message: error.message });

    return res.status(200).json({
      status: 'ok',
      company_id: ctx.company.id,
      role: ctx.role,
      count: (rows || []).length,
      rows: rows || []
    });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: e.message || String(e) });
  }
};