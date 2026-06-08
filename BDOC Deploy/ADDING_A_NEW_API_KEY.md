# Adding a new API key — the 30-second version

**You never give the key to Claude. The key only ever goes into Netlify.**
Claude writes code that points at the key's *name*; you put the *value* in Netlify.

---

## The one place keys live (your "door")

**Netlify → your site → Site configuration → Environment variables → Add a variable**

- Name = the variable name (e.g. `MYFEED_API_KEY`)
- Value = paste the actual key
- Save → **Trigger redeploy** (Deploys tab → Trigger deploy)

That's it. The key is now encrypted in Netlify and readable only by the server-side
functions. It is *not* in the code, *not* in the repo, *not* downloadable.

---

## Two kinds of "new key"

### A) New key for a feed that already exists in `.env.example`
Just do the step above with the name from `.env.example`. **Done.** No code change.

### B) Brand-new feed Claude hasn't wired yet
1. **You:** add the key in Netlify (step above), and tell Claude the variable name +
   the API's docs URL. *(Name only — never the value.)*
2. **Claude:** adds a few lines so the app can call it — usually just one entry in
   `netlify/functions/proxy-feed.js` (the generic proxy), no new file.
3. Redeploy. It's live.

For simple keyed GET APIs you can even do step 2 yourself — copy the `example`
block in `proxy-feed.js`, change `url` / `keyEnv` / `keyName`, and call
`/api/proxy-feed?feed=NAME`.

---

## Why not just drop the key in a file here?
Because `publish = "."` — every file in this folder is a public download on the live
site. A key in a file = a key anyone can steal. And Netlify functions read keys from
the dashboard at runtime anyway, so a file wouldn't even work. The dashboard *is* the
mechanism, not a workaround.

## The rule of thumb
- **Key value** → Netlify dashboard (you, 30s, I never see it)
- **Key name + what the API does** → fine to tell me in chat
- **Wiring** → me, or you via `proxy-feed.js`
