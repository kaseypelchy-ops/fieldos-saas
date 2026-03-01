// api/reps.js
const { supabaseAnonWithToken, requireUser, getContext } = require('./_auth');

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    const supabase = supabaseAnonWithToken(token);

    const auth = await requireUser(req, supabase);
    if (auth.error) return res.status(auth.error.status).json({ status: 'error', message: auth.error.message });

    const ctx = await getContext(supabase, auth.user);
    if (ctx.error) return res.status(ctx.error.status).json({ status: 'error', message: ctx.error.message });

    const { data: reps, error } = await supabase
      .from('reps')
      .select('id, full_name, role, is_active, user_id')
      .eq('is_active', true)
      .order('role', { ascending: false })
      .order('full_name', { ascending: true });

    if (error) return res.status(500).json({ status: 'error', message: error.message });

    return res.status(200).json({ status: 'ok', role: ctx.role, reps: reps || [] });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: e.message || String(e) });
  }
};