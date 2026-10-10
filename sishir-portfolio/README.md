# Sishir Portfolio Website

A responsive portfolio with a **visitor login** and an **admin panel** that
controls who can view the projects. Data is stored in **MongoDB** (Vercel's
MongoDB Atlas integration) and the site runs on **Vercel**.

## Folder structure

```
sishir-portfolio/
├── public/               # Static site - the only folder Vercel serves directly
│   ├── index.html        # Main page (needs sign-in)
│   ├── login.html        # Visitor + Admin login page
│   ├── css/style.css
│   ├── js/               # api.js, login.js, app.js
│   └── merophoto.jpg
├── api/[...path].js      # Vercel serverless function for every /api/* request
├── lib/
│   ├── handleApi.js      # All API routes
│   └── database.js       # Data layer - the ONLY file that talks to MongoDB
├── data/projects.json    # Seed data: copied into MongoDB the first time only
├── server.js             # Local dev server (not used on Vercel)
├── scripts/migrate-json-to-mongo.js   # Optional: import the old data/db.json
└── package.json
```

## Deploy on Vercel

1. Push this folder to GitHub and import it in Vercel (Framework preset: **Other**).
2. In the Vercel project open **Storage** (or Marketplace) -> **MongoDB Atlas** ->
   create/connect a database. Vercel adds `MONGODB_URI` to your environment variables.
   (If your integration uses a different variable name, add `MONGODB_URI` yourself
   with the same connection string.)
3. Add these **Environment Variables** (Production + Preview) *before* the first visit:
   - `ADMIN_USERNAME` = `sishir`
   - `ADMIN_PASSWORD` = a strong password of your choice
   - optional `MONGODB_DB` = `portfolio`
4. Deploy. On the first request the app creates the admin account, the indexes and
   the projects collection automatically.

> The admin account is created only once. If you forget to set `ADMIN_PASSWORD`
> first, the default login is `sishir` / `admin123` - change it right away in
> Admin Panel -> *Change admin password*.

## Run locally

```
npm install
vercel env pull .env.local     # downloads MONGODB_URI (needs the Vercel CLI)
npm run dev                    # http://localhost:3000
```

Or create `.env.local` by hand from `.env.example`. Needs Node.js 20 or newer.

Tip: use a separate database for local work (e.g. `MONGODB_DB=portfolio_dev`).

## Moving your old visitors over (optional)

If you have an old `data/db.json` from the previous version, put it back in `data/`
and run `npm run migrate`. The admin account (same password) and all visitors are copied.

## What the admin can do (button in the top-right)

- **Give project access** - choose a person from the dropdown and press *Add*
- **Add a new person** - type name, school, age; they get access immediately
- See everyone who signed in, switch their access on/off, or remove them
- Change the admin password

Visitors without access see the whole site, but the **Projects** section is
locked. Project details live in MongoDB and are only sent to approved people,
so they cannot be read from the page source.

## Editing projects

Projects are stored in the `projects` collection. Edit them in the Atlas UI
(or MongoDB Compass). Each document keeps the same fields as `data/projects.json`
(`id`, `title`, `description`, `icon`, `banner`, `tech`). `data/projects.json` is
only used to fill an *empty* collection.

## Notes

- Sessions and admin-login rate limits are also stored in MongoDB and expire
  automatically (TTL indexes), so everything works across serverless instances.
- The contact form still sends through Web3Forms (same access key as before).
