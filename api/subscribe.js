/**
 * /api/subscribe.js
 * Vercel serverless function — GoHighLevel (LeadConnector API v2) integration
 *
 * Required environment variables (Vercel → Settings → Environment Variables):
 *   GHL_API_KEY      Private Integration token from GHL
 *                    (Settings → Private Integrations; scopes: contacts.write, contacts.readonly)
 *   GHL_LOCATION_ID  The Flourish Online sub-account ID (2lfc6CZkPM6jspSHFXiN)
 *
 * Tags applied per submission (GHL stores tags lowercase):
 *   baq_main_<archetype>       e.g. baq_main_nurturer   ← triggers "FO | Quiz - <Archetype>" workflow
 *   baq_secondary_<archetype>  e.g. baq_secondary_alchemist
 *   baq_shadow_<archetype>     e.g. baq_shadow_queen
 *   quiz-baq-taken             always applied
 *
 * Retakes: any older baq_main_/baq_secondary_/baq_shadow_ tags are removed first,
 * so a contact only ever holds their latest result.
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const QUIZ_TAG_PREFIXES = ['baq_main_', 'baq_secondary_', 'baq_shadow_'];

const toTag = (prefix, archetype) =>
  archetype ? `${prefix}${String(archetype).trim().toLowerCase().replace(/\s+/g, '_')}` : null;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { GHL_API_KEY, GHL_LOCATION_ID } = process.env;
  if (!GHL_API_KEY || !GHL_LOCATION_ID) {
    console.error('Missing GHL_API_KEY or GHL_LOCATION_ID env vars');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const { firstName, email, mainArchetype, secondaryArchetype, shadowArchetype } = req.body || {};
  if (!email || !firstName) {
    return res.status(400).json({ error: 'firstName and email are required' });
  }

  const headers = {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Version': GHL_VERSION,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  try {
    // 1. Create or update the contact (matched on email)
    const upsertRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        email: String(email).trim().toLowerCase(),
        firstName: String(firstName).trim(),
        source: 'Brand Archetype Quiz',
      }),
    });
    if (!upsertRes.ok) {
      console.error('GHL upsert failed:', upsertRes.status, await upsertRes.text());
      return res.status(500).json({ error: 'Failed to sync contact' });
    }
    const upsertData = await upsertRes.json();
    const contact = upsertData.contact || {};
    const contactId = contact.id;
    if (!contactId) return res.status(500).json({ error: 'No contact ID returned' });

    // 2. New result tags
    const newTags = [
      toTag('baq_main_', mainArchetype),
      toTag('baq_secondary_', secondaryArchetype),
      toTag('baq_shadow_', shadowArchetype),
      'quiz-baq-taken',
    ].filter(Boolean);

    // 3. Retake: remove earlier quiz results that differ from this one
    let existing = Array.isArray(contact.tags) ? contact.tags : null;
    if (!existing && !upsertData.new) {
      const getRes = await fetch(`${GHL_BASE}/contacts/${contactId}`, { headers });
      if (getRes.ok) existing = ((await getRes.json()).contact || {}).tags || [];
    }
    const stale = (existing || [])
      .map(t => String(t).toLowerCase())
      .filter(t => QUIZ_TAG_PREFIXES.some(p => t.startsWith(p)) && !newTags.includes(t));
    if (stale.length) {
      const delRes = await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ tags: stale }),
      });
      if (!delRes.ok) console.error('GHL tag removal failed:', delRes.status, await delRes.text());
    }

    // 4. Add the new tags (this fires the "FO | Quiz - <Archetype>" workflow)
    const addRes = await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tags: newTags }),
    });
    if (!addRes.ok) {
      console.error('GHL add tags failed:', addRes.status, await addRes.text());
      return res.status(500).json({ error: 'Failed to tag contact' });
    }

    return res.status(200).json({ success: true, contactId, tags: newTags, removed: stale });
  } catch (err) {
    console.error('subscribe error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
