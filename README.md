# Flourish Brand Archetype Quiz

A fully self-contained quiz app with:
- Landing page 
- 12-question quiz
- ActiveCampaign opt-in with archetype tagging
- Results page with percentage breakdown + links to archetype pages

---

## File structure

```
flourish-quiz/
├── public/
│   └── index.html        ← The full quiz SPA (all screens)
├── api/
│   └── subscribe.js      ← Vercel serverless function (AC integration)
├── vercel.json           ← Vercel routing config
├── package.json
└── README.md
```

---

## Setup & deployment

### 1. Push to GitHub

Create a new GitHub repo and push this folder to it.

```bash
cd flourish-quiz
git init
git add .
git commit -m "Initial quiz build"
git remote add origin https://github.com/YOUR_USERNAME/flourish-quiz.git
git push -u origin main
```

### 2. Connect to Vercel

1. Go to [vercel.com](https://vercel.com) and log in
2. Click **Add New → Project**
3. Import your GitHub repo
4. Framework preset: **Other** (not a framework)
5. Root directory: leave as `/` (the flourish-quiz folder)
6. Click **Deploy**

### 3. Add environment variables

In your Vercel project → **Settings → Environment Variables**, add:

| Variable       | Value                                                  |
|----------------|--------------------------------------------------------|
| `AC_API_URL`   | `https://YOURACCOUNTNAME.api-activecampaign.com`      |
| `AC_API_KEY`   | Your AC API key (AC → Settings → Developer)           |

Then **redeploy** (Vercel → Deployments → ⋯ → Redeploy).

### 4. (Optional) Custom domain

In Vercel → Settings → Domains, add your custom domain (e.g. `quiz.flourishonline.com.au`).

---

## ActiveCampaign tags applied

For each quiz completion, the contact receives four tags:

| Tag                              | Example                        |
|----------------------------------|--------------------------------|
| `BAQ_Main_[Archetype]`           | `BAQ_Main_Nurturer`           |
| `BAQ_Secondary_[Archetype]`      | `BAQ_Secondary_Alchemist`     |
| `BAQ_Shadow_[Archetype]`         | `BAQ_Shadow_Queen`            |
| `BAQ_QuizComplete`               | Always applied                |

Spaces in archetype names are replaced with underscores (e.g. `BAQ_Main_Girl_Next_Door`).

Tags are created automatically in AC if they don't already exist.

### Using tags for automations

You can use `BAQ_QuizComplete` as the trigger for a welcome automation, then branch on `BAQ_Main_*` to send archetype-specific nurture sequences.

---

## Customisation notes

- **Flourish logo link** — update the `href` in `.logo` anchors to point to your live domain
- **Services CTA link** — update `https://flourishonline.com.au/services` in the results CTA
- **Archetype result page URLs** — already pointing to the live flourishonline.com quiz pages
- **AC custom fields** — optional section in `subscribe.js` to store archetype percentage scores as contact field values (requires creating custom fields in AC first)

---

## Local development

```bash
npm install
npm run dev   # starts vercel dev server at localhost:3000
```

You'll need the Vercel CLI and your environment variables set in a `.env.local` file:

```
AC_API_URL=https://youraccountname.api-activecampaign.com
AC_API_KEY=your_api_key_here
```
