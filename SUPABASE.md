# Supabase setup (TS Auto Trader)

Supabase is a free online database. With it, the shop's data is kept in your own Supabase project,
and the app talks to it directly. You do not need your own server for data. The app still saves
everything on the device first, so billing works with no internet and syncs when it is back.

Button names below are in English because that is how Supabase shows them. Names can change a little over time.

## Qadam (steps)

1. **Project banayein.** supabase.com par sign up karein, **New project** dabayen. Naam likhein (masalan `ts-auto-trader`),
   aik **Database password** rakhein (kahin likh lein), aur sab se qareebi **Region** chunein. 1 se 2 minute intezar karein.
2. **Tables banayein.** Left menu mein **SQL Editor** → **New query**. File `supabase/schema.sql` poori copy karke paste karein, **Run** dabayen.
   "Success" aana chahiye. Dobara chalane se koi nuqsan nahi.
3. **Login banayein.** **Authentication** → **Users** → **Add user** → **Create new user**. Email aur password likhein
   (ye wohi email hai jo app mein dalni hai) aur **Auto Confirm User** ka nishan lagayen.
4. **Is email ko ijazat dein.** **SQL Editor** mein naya query kholein, apni email ke saath ye chalayen:
   ```sql
   insert into public.allowed_users (email) values ('owner@example.com') on conflict do nothing;
   ```
   Sirf jin emails ko yahan likha jaye, wohi shop ka data dekh sakte hain. Doosre staff ke liye bhi isi tarah email jodein.
5. **Naye sign-up band karein.** **Authentication** → **Sign In / Providers** (ya **Settings**) mein
   **Allow new users to sign up** band (off) karein. Is se koi bahar wala account nahi bana sakta.
6. **Do cheezein copy karein.** **Project Settings** → **API**: **Project URL** (`https://xxxx.supabase.co`)
   aur **anon public** key. (`service_role` key kabhi app mein na dalein.)
7. **App mein jorein.** App → **Settings** → **Sync between devices** → *Keep the online copy in* → **Supabase**.
   URL, anon key, email aur password likhein → **Save and sync now**.
   Pehli dafa app apna sara purana data khud upload kar deti hai.

Doosri device par: **Connect another device** → Supabase chunein → wohi URL, key, email, password → alag **invoice prefix** (jaise `B-`).

## Zaroori baatein

- **anon key chhupana zaroori nahi** (ye public hoti hai). Hifazat Row Level Security aur `allowed_users` se hai.
  Phir bhi email/password lambi rakhein aur sign-up band rakhein (qadam 5).
- **Backup:** Supabase ke free plan mein khud-ba-khud backup ki zimmedari mere paas pakki nahi, plan ki shart dekh lein.
  Isi liye app ke **Settings → Backup** se hafte mein aik dafa backup file download kar ke rakhein. Supabase mein
  **Table Editor** se `records` ko CSV mein bhi nikala ja sakta hai.
- **Free project pause ho sakta hai** agar kai din tak koi istemal na ho. App is dauran bhi offline chalti hai; data wapas
  aane par sync ho jata hai. Supabase dashboard se **Restore** kar lein. Pricing page par taaza shartein dekh lein.
- Supabase par jane ke baad purane server ki SQLite istemal nahi hoti. Server sirf app ki files dene ke kaam aata hai
  (ya `client/dist` ko Netlify/Vercel jaisi static hosting par rakh dein).
- Sync ke qaide wohi hain: naya badlav jeet jata hai, dobara bhejna nuqsan nahi karta, stock aur invoice sirf jurte hain.

## Masle

| App kya kehti hai | Wajah |
|---|---|
| Wrong Supabase email or password | Qadam 3 ka email/password dobara dekhein |
| This Supabase login is not allowed for this shop | Qadam 4 nahi hua ya email ka hijje alag hai |
| The Supabase tables are not set up yet | Qadam 2 dobara chalayen |
| Sign in to Supabase again in Settings | Login khatam ho gaya; Settings mein password dalein, Save dabayen |
