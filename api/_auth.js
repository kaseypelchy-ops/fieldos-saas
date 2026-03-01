// api/_auth.js
const { createClient } = require('@supabase/supabase-js');

function getBearerToken(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function supabaseAnonWithToken(token) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');

  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function requireUser(req, supabase) {
  const token = getBearerToken(req);
  if (!token) return { error: { status: 401, message: 'Missing Authorization: Bearer <token>' } };

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { error: { status: 401, message: 'Invalid or expired session' } };

  return { user: data.user, token };
}

async function getContext(supabase, user) {
  // membership (RLS allows user to read own membership)
  const { data: m, error: mErr } = await supabase
    .from('company_memberships')
    .select('company_id, role, is_active')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (mErr) throw new Error(mErr.message);
  if (!m) return { error: { status: 403, message: 'No active company membership for this user' } };

  // company (RLS allows members to read company)
  const { data: company, error: cErr } = await supabase
    .from('companies')
    .select('id, slug, name, logo_url, primary_color, config, subscription_status, seats')
    .eq('id', m.company_id)
    .maybeSingle();

  if (cErr) throw new Error(cErr.message);
  if (!company) return { error: { status: 404, message: 'Company not found' } };

  if (String(company.subscription_status || '').toLowerCase() === 'canceled') {
    return { error: { status: 402, message: 'Subscription canceled' } };
  }

  return { company, role: String(m.role || 'rep').toLowerCase() };
}

async function getMyRepId(supabase, companyId, userId) {
  const { data: rep, error } = await supabase
    .from('reps')
    .select('id')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return rep ? rep.id : null;
}

module.exports = { supabaseAnonWithToken, requireUser, getContext, getMyRepId };