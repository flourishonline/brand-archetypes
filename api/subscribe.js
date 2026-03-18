/**
 * /api/subscribe.js
 * Vercel serverless function — ActiveCampaign integration
 *
 * Required environment variables (Vercel → Settings → Environment Variables):
 *   AC_API_URL   e.g. https://youraccountname.api-activecampaign.com
 *   AC_API_KEY   your AC API key (AC → Settings → Developer)
 *
 * Tags applied per submission:
 *   BAQ_Main_[Archetype]       e.g. BAQ_Main_Nurturer
 *   BAQ_Secondary_[Archetype]  e.g. BAQ_Secondary_Alchemist
 *   BAQ_Shadow_[Archetype]     e.g. BAQ_Shadow_Queen
 *   BAQ_QuizComplete           always applied — use as automation trigger
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { AC_API_URL, AC_API_KEY } = process.env;

  if (!AC_API_URL || !AC_API_KEY) {
    console.error('Missing AC_API_URL or AC_API_KEY env vars');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const { firstName, email, mainArchetype, secondaryArchetype, shadowArchetype } = req.body || {};

  if (!email || !firstName) {
    return res.status(400).json({ error: 'firstName and email are required' });
  }

  const headers = {
    'Content-Type': 'application/json',
    'Api-Token': AC_API_KEY,
  };
  const base = AC_API_URL.replace(/\/$/, '');

  try {
    // 1. Create or update contact
    const syncRes = await fetch(`${base}/api/3/contact/sync`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ contact: { email, firstName } })
    });

    if (!syncRes.ok) {
      const text = await syncRes.text();
      console.error('AC sync failed:', syncRes.status, text);
      return res.status(500).json({ error: 'Failed to sync contact' });
    }

    const syncData = await syncRes.json();
    const contactId = syncData.contact?.id;
    if (!contactId) return res.status(500).json({ error: 'No contact ID returned' });

    // 2. Build tag list
    const tags = [
      `BAQ_Main_${(mainArchetype || '').replace(/\s+/g, '_')}`,
      `BAQ_Secondary_${(secondaryArchetype || '').replace(/\s+/g, '_')}`,
      `BAQ_Shadow_${(shadowArchetype || '').replace(/\s+/g, '_')}`,
      'BAQ_QuizComplete',
    ].filter(t => t.length > 4);

    // 3. Apply each tag (create if needed)
    for (const tagName of tags) {
      const tagId = await getOrCreateTag(base, headers, tagName);
      if (tagId) await applyTag(base, headers, contactId, tagId);
    }

    return res.status(200).json({ success: true, contactId, tags });

  } catch (err) {
    console.error('subscribe error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function getOrCreateTag(base, headers, tagName) {
  const search = await fetch(`${base}/api/3/tags?search=${encodeURIComponent(tagName)}`, { headers });
  if (search.ok) {
    const data = await search.json();
    const found = (data.tags || []).find(t => t.tag === tagName);
    if (found) return found.id;
  }
  const create = await fetch(`${base}/api/3/tags`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tag: { tag: tagName, tagType: 'contact', description: `Flourish Brand Archetype Quiz — ${tagName}` } })
  });
  if (create.ok) {
    const data = await create.json();
    return data.tag?.id || null;
  }
  console.error('Failed to create tag:', tagName);
  return null;
}

async function applyTag(base, headers, contactId, tagId) {
  const res = await fetch(`${base}/api/3/contactTags`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ contactTag: { contact: contactId, tag: tagId } })
  });
  if (!res.ok && res.status !== 422) {
    console.error(`Failed to apply tag ${tagId} to contact ${contactId}:`, res.status);
  }
}
