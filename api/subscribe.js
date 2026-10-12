/**
 * /api/subscribe.js
 * Vercel serverless function — sends quiz results to GoHighLevel (GHL).
 *
 * Environment variables (Vercel → Settings → Environment Variables):
 *   GHL_API_TOKEN     Private Integration token from GHL
 *                     (Settings → Private Integrations; scopes: contacts.write + contacts.readonly)
 *   GHL_LOCATION_ID   GHL sub-account ID (defaults to Flourish Online's location)
 *
 * Fallback: if GHL_API_TOKEN is not set yet, the old ActiveCampaign path runs
 * (AC_API_URL + AC_API_KEY), so deploying this before the token is added
 * doesn't drop any quiz leads. Remove the AC env vars once GHL is live.
 *
 * Tags applied per submission (GHL stores tags lowercase):
 *   BAQ_Main_[Archetype]       → baq_main_nurturer   (triggers the "FO | Quiz - <Archetype>" workflow)
 *   BAQ_Secondary_[Archetype]  → baq_secondary_alchemist
 *   BAQ_Shadow_[Archetype]     → baq_shadow_queen
 *   quiz-baq-taken             (GHL's name for AC's BAQ_QuizComplete / BAQuiz tags)
 */

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const DEFAULT_LOCATION_ID = '2lfc6CZkPM6jspSHFXiN';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { firstName, email, mainArchetype, secondaryArchetype, shadowArchetype } = req.body || {};

  if (!email || !firstName) {
    return res.status(400).json({ error: 'firstName and email are required' });
  }

  const tags = buildTags(mainArchetype, secondaryArchetype, shadowArchetype);

  try {
    if (process.env.GHL_API_TOKEN) {
      const contactId = await sendToGHL({ firstName, email, tags });
      return res.status(200).json({ success: true, crm: 'ghl', contactId, tags });
    }

    if (process.env.AC_API_URL && process.env.AC_API_KEY) {
      const contactId = await sendToAC({ firstName, email, tags });
      return res.status(200).json({ success: true, crm: 'activecampaign', contactId, tags });
    }

    console.error('No CRM configured: set GHL_API_TOKEN (or AC_API_URL + AC_API_KEY)');
    return res.status(500).json({ error: 'Server configuration error' });
  } catch (err) {
    console.error('subscribe error:', err.message);
    return res.status(500).json({ error: 'Failed to save quiz result' });
  }
};

function buildTags(main, secondary, shadow) {
  const slug = (s) => (s || '').trim().replace(/\s+/g, '_');
  return [
    main && `BAQ_Main_${slug(main)}`,
    secondary && `BAQ_Secondary_${slug(secondary)}`,
    shadow && `BAQ_Shadow_${slug(shadow)}`,
    'BAQ_QuizComplete',
  ].filter(Boolean);
}

/* ---------- GoHighLevel ---------- */

async function sendToGHL({ firstName, email, tags }) {
  const headers = {
    Authorization: `Bearer ${process.env.GHL_API_TOKEN}`,
    Version: GHL_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const locationId = process.env.GHL_LOCATION_ID || DEFAULT_LOCATION_ID;

  // 1. Create or update the contact (matched on email). Tags are added in a
  //    separate call so existing tags on a returning contact are never replaced.
  const upsertRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ locationId, email, firstName, source: 'Brand Archetype Quiz' }),
  });
  if (!upsertRes.ok) {
    throw new Error(`GHL upsert failed: ${upsertRes.status} ${await upsertRes.text()}`);
  }
  const upsertData = await upsertRes.json();
  const contactId = upsertData.contact?.id;
  if (!contactId) throw new Error('GHL upsert returned no contact id');

  // 2. Add the quiz tags (this fires the "Contact tag added" workflow triggers).
  //    BAQ_QuizComplete was merged into quiz-baq-taken during the migration.
  const ghlTags = tags.map((t) => (t === 'BAQ_QuizComplete' ? 'quiz-baq-taken' : t));
  const tagRes = await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tags: ghlTags }),
  });
  if (!tagRes.ok) {
    throw new Error(`GHL add tags failed: ${tagRes.status} ${await tagRes.text()}`);
  }

  return contactId;
}

/* ---------- ActiveCampaign (fallback until GHL is live) ---------- */

async function sendToAC({ firstName, email, tags }) {
  const headers = { 'Content-Type': 'application/json', 'Api-Token': process.env.AC_API_KEY };
  const base = process.env.AC_API_URL.replace(/\/$/, '');

  const syncRes = await fetch(`${base}/api/3/contact/sync`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ contact: { email, firstName } }),
  });
  if (!syncRes.ok) throw new Error(`AC sync failed: ${syncRes.status} ${await syncRes.text()}`);
  const contactId = (await syncRes.json()).contact?.id;
  if (!contactId) throw new Error('AC sync returned no contact id');

  for (const tagName of tags) {
    const tagId = await getOrCreateACTag(base, headers, tagName);
    if (!tagId) continue;
    const r = await fetch(`${base}/api/3/contactTags`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ contactTag: { contact: contactId, tag: tagId } }),
    });
    if (!r.ok && r.status !== 422) console.error(`AC tag ${tagName} failed:`, r.status);
  }
  return contactId;
}

async function getOrCreateACTag(base, headers, tagName) {
  const search = await fetch(`${base}/api/3/tags?search=${encodeURIComponent(tagName)}`, { headers });
  if (search.ok) {
    const found = ((await search.json()).tags || []).find((t) => t.tag === tagName);
    if (found) return found.id;
  }
  const create = await fetch(`${base}/api/3/tags`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tag: { tag: tagName, tagType: 'contact', description: `Flourish Brand Archetype Quiz — ${tagName}` } }),
  });
  if (create.ok) return (await create.json()).tag?.id || null;
  console.error('AC tag create failed:', tagName);
  return null;
}
