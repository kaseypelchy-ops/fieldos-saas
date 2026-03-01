// api/tenant-config.js
const { supabaseAnonWithToken, requireUser, getContext } = require('./_auth');

module.exports = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');

    const token = (req.headers.authorization || '').startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null;

    const supabase = supabaseAnonWithToken(token || ''); // requires token below anyway
    const auth = await requireUser(req, supabase);
    if (auth.error) return res.status(auth.error.status).json({ status: 'error', message: auth.error.message });

    const ctx = await getContext(supabase, auth.user);
    if (ctx.error) return res.status(ctx.error.status).json({ status: 'error', message: ctx.error.message });

    return res.status(200).json({ status: 'ok', tenant: ctx.company, role: ctx.role });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: e.message || String(e) });
  }
};