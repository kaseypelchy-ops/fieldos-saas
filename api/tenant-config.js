// /api/tenant-config.js
const { createClient } = require('@supabase/supabase-js');

function getSlugFromHost(req) {
  const host = (req.headers.host || '').toLowerCase();
  const parts = host.split('.');
  if (parts.length >= 3) {
    const sub = parts[0];
    if (sub && sub !== 'www' && sub !== 'app') return sub;
  }
  return null;
}

module.exports = async (req, res) => {
  try {
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      return res.status(500).json({
        status: 'error',
        message: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables.'
      });
    }

    const supabase = createClient(url, serviceKey);

    const slug =
      (req.query && String(req.query.slug || '').trim().toLowerCase()) ||
      getSlugFromHost(req) ||
      'zito';

    const { data, error } = await supabase
      .from('companies')
      .select('id, slug, name, logo_url, primary_color, config_json, subscription_status, seats')
      .eq('slug', slug)
      .maybeSingle();

    if (error) return res.status(500).json({ status: 'error', message: error.message });
    if (!data) return res.status(404).json({ status: 'error', message: `Tenant not found for slug: ${slug}` });

    if (String(data.subscription_status).toLowerCase() === 'canceled') {
      return res.status(402).json({ status: 'payment_required', message: 'Subscription canceled.' });
    }

    return res.status(200).json({
      status: 'ok',
      tenant: {
        id: data.id,
        slug: data.slug,
        name: data.name,
        logo_url: data.logo_url,
        primary_color: data.primary_color,
        config: data.config_json || {},
        subscription_status: data.subscription_status,
        seats: data.seats
      }
    });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: e.message || String(e) });
  }
};