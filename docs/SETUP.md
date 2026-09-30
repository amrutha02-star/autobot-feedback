# Setting it up

You need free accounts on Supabase and Cloudflare (or any static host), and optionally Google Workspace and Composio.

1. **Database.** Create a Supabase project. In the SQL Editor, run the files in `supabase/` **in order**:
   `schema.sql` → `002_…` → `003_…` → `004_…` → `005_…` → `006_…` → `007_…`.
   Before running them, change the two example emails in `schema.sql` and `002_…` to your own team.
2. **Keys.** Copy `.env.example` to `.env` and add your project URL and anon (public) key.
3. **Run it:**
   ```bash
   npm install
   npm run dev      # real database
   npm run demo     # sample data, no database needed
   ```
4. **Screenshot drop-box (for the AI):** create an edge function from `supabase/functions/attach-screenshot/index.ts`.
5. **Autobot's instructions:** run `node scripts/gen-instruction-sql.mjs` and paste the generated `supabase/instruction.sql` into the SQL Editor. Then give your assistant the one-line instruction shown in **Settings → Autobot connection**.
6. **Deploy:** `npm run build` and upload the `dist` folder to your static host. In Supabase → Authentication → URL Configuration, add the site's address.
7. **Recordings (optional):** follow **Settings → Google Drive for recordings** (about 3 minutes, no Google Cloud project needed).

## Project layout

```
src/
  pages/          Reports (dashboard + table), ReportDetail, NewReport, Settings, Login
  components.tsx  Pills, galleries, screenshot picker, notification bell, account menu
  lib.ts          Supabase client, types, uploads, live updates, theme
  compress.ts     In-browser image/video compression
  drive.ts        Google Drive drop-box (Apps Script) client + the script itself
  instruction.ts  Autobot's logging instructions (stored in the database)
  notifications.ts
  demo.ts         In-memory stand-in for Supabase used by `npm run demo`
supabase/         Numbered SQL setup files + the screenshot edge function
scripts/          Generates the instruction SQL
```
