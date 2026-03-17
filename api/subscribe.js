/**
 * /api/subscribe.js
 * Vercel serverless function — ActiveCampaign integration
 *
 * Required environment variables (set in Vercel dashboard):
 *   AC_API_URL   — e.g. https://youraccountname.api-activecampaign.com
 *   AC_API_KEY   — your ActiveCampaign API key (Settings → Developer)
 *
 * Tags applied to contact:
 *   BAQ_Main_[Archetype]        e.g. BAQ_Main_Nurturer
 *   BAQ_Secondary_[Archetype]   e.g. BAQ_Secondary_Alchemist
 *   BAQ_Shadow_[Archetype]      e.g. BAQ_Shadow_Queen
 *   BAQ_QuizComplete            (always applied — useful for automation triggers)
 */

export default async function handler(req, res) {
  // CORS — adjust origin to your actual domain in production
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { AC_API_URL, AC_API_KEY } = process.env;

  if (!AC_API_URL || !AC_API_KEY) {
    console.error('Missing AC_API_URL or AC_API_KEY environment variables');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const { firstName, email, mainArchetype, secondaryArchetype, shadowArchetype, scores } = req.body;

  if (!email || !firstName) {
    return res.status(400).json({ error: 'firstName and email are required' });
  }

  const acHeaders = {
    'Content-Type': 'application/json',
    'Api-Token': AC_API_KEY,
  };

  const acBase = AC_API_URL.replace(/\/$/, '');

  try {
    // ── 1. Create or update contact ──────────────────────────────
    const syncRes = await fetch(`${acBase}/api/3/contact/sync`, {
      method: 'POST',
      headers: acHeaders,
      body: JSON.stringify({
        contact: {
          email,
          firstName,
        }
      })
    });

    if (!syncRes.ok) {
      const body = await syncRes.text();
      console.error('AC contact sync failed:', syncRes.status, body);
      return res.status(500).json({ error: 'Failed to create contact in ActiveCampaign' });
    }

    const syncData = await syncRes.json();
    const contactId = syncData.contact?.id;

    if (!contactId) {
      console.error('No contact ID returned from AC sync');
      return res.status(500).json({ error: 'No contact ID returned' });
    }

    // ── 2. Define tags to apply ──────────────────────────────────
    const tagsToApply = [
      `BAQ_Main_${mainArchetype.replace(/\s+/g, '_')}`,
      `BAQ_Secondary_${secondaryArchetype.replace(/\s+/g, '_')}`,
      `BAQ_Shadow_${shadowArchetype.replace(/\s+/g, '_')}`,
      'BAQ_QuizComplete',
    ];

    // ── 3. Get or create each tag, then apply to contact ─────────
    for (const tagName of tagsToApply) {
      const tagId = await getOrCreateTag(acBase, acHeaders, tagName);
      if (tagId) {
        await applyTagToContact(acBase, acHeaders, contactId, tagId);
      }
    }

    // ── 4. Optional: store archetype scores as custom fields ──────
    // Uncomment and configure field IDs if you've created custom fields in AC
    // await updateCustomFields(acBase, acHeaders, contactId, scores);

    return res.status(200).json({
      success: true,
      contactId,
      tags: tagsToApply
    });

  } catch (err) {
    console.error('Subscription error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Helper: get tag ID by name, or create if it doesn't exist ───
async function getOrCreateTag(acBase, headers, tagName) {
  // Search for existing tag
  const searchRes = await fetch(
    `${acBase}/api/3/tags?search=${encodeURIComponent(tagName)}`,
    { headers }
  );

  if (searchRes.ok) {
    const data = await searchRes.json();
    const existing = data.tags?.find(t => t.tag === tagName);
    if (existing) return existing.id;
  }

  // Create tag if not found
  const createRes = await fetch(`${acBase}/api/3/tags`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tag: {
        tag: tagName,
        tagType: 'contact',
        description: `Brand Archetype Quiz — ${tagName}`
      }
    })
  });

  if (createRes.ok) {
    const data = await createRes.json();
    return data.tag?.id;
  }

  console.error(`Failed to create tag: ${tagName}`);
  return null;
}

// ── Helper: apply a tag to a contact ────────────────────────────
async function applyTagToContact(acBase, headers, contactId, tagId) {
  const res = await fetch(`${acBase}/api/3/contactTags`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contactTag: {
        contact: contactId,
        tag: tagId
      }
    })
  });

  // 422 means tag is already applied — that's fine
  if (!res.ok && res.status !== 422) {
    const body = await res.text();
    console.error(`Failed to apply tag ${tagId} to contact ${contactId}:`, body);
  }
}

/*
// ── Optional: update AC custom fields with archetype scores ─────
// Create these fields in AC first: AC > Settings > Custom Fields
// Then replace the field IDs below.
async function updateCustomFields(acBase, headers, contactId, scores) {
  const fieldMap = {
    // 'Adventuress': 'FIELD_ID_1',
    // 'Alchemist':   'FIELD_ID_2',
    // ... etc
  };

  const fieldValues = Object.entries(fieldMap)
    .filter(([archetype]) => scores[archetype] !== undefined)
    .map(([archetype, fieldId]) => ({
      field: fieldId,
      value: String(Math.round((scores[archetype] / 4) * 100))
    }));

  if (fieldValues.length === 0) return;

  await fetch(`${acBase}/api/3/contacts/${contactId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ contact: { fieldValues } })
  });
}
*/
