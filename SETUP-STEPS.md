# Supabase Setup - Next Steps

## ✅ What's Been Completed

1. ✓ Supabase credentials added to `.env.local`
2. ✓ Supabase client library installed
3. ✓ Database schema SQL file created (`supabase-schema.sql`)
4. ✓ Upload script created (`scripts/upload-policies.js`)
5. ✓ Code updated to use Supabase instead of local files

## 🎯 What You Need to Do Next

### Step 1: Run the Database Schema

1. Go to your Supabase dashboard: https://supabase.com/dashboard/project/ljhfhhvaxklmkotzwsmz
2. Click on **SQL Editor** in the left sidebar
3. Click **+ New Query**
4. Open the file `supabase-schema.sql` in this project
5. Copy all the SQL and paste it into the Supabase SQL Editor
6. Click **Run** (or press Cmd+Enter)

You should see a success message confirming the table was created.

### Step 2: Upload Policies to Supabase

Run the upload script from the project directory:

```bash
cd "/Users/quinngodfredsen/Projects/Healthcare regulatory compliance/compliance-app"
node scripts/upload-policies.js
```

This will:
- Read all 373 PDFs from `/public/policies/`
- Extract text from each PDF
- Upload to Supabase `policy_documents` table
- Show progress as it goes

**Expected time:** 10-20 minutes (depending on your connection)

### Step 3: Verify Upload

Check that policies were uploaded:

1. Go to Supabase dashboard
2. Click **Table Editor** in the left sidebar
3. Select **policy_documents** table
4. You should see 373 rows of policy data

### Step 4: Test Locally

```bash
npm run dev
```

Open http://localhost:3002 and try uploading the test file:
- `/googledrive/Audit Questions.pdf`

It should now search through Supabase instead of local files.

### Step 5: Deploy to Vercel

Once local testing works:

1. Go to Vercel dashboard: https://vercel.com
2. Find your project
3. Go to **Settings** → **Environment Variables**
4. Add these three variables:
   - `DEEPSEEK_API_KEY`: `<your-deepseek-api-key>`
   - `NEXT_PUBLIC_SUPABASE_URL`: `https://ljhfhhvaxklmkotzwsmz.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: `<your-supabase-anon-key>`
5. Select: **Production**, **Preview**, **Development**
6. Click **Save**
7. Go to **Deployments** → **Redeploy** latest deployment

### Step 6: Clean Up (Optional)

Once everything works, you can:

1. Delete `/public/policies/` folder (no longer needed - policies are in Supabase)
2. Remove the old `unpdf` dependency if not used elsewhere

## 📊 Expected Results

After setup:
- **Local**: Works with Supabase database (no more local PDFs)
- **Performance**: Similar speed to before
- **Deployment**: Will work on Vercel (no 62MB file size issue)
- **Scalability**: Can add more policies without code changes

## 🔧 Troubleshooting

### If upload script fails:

**Error: "Cannot find module 'unpdf'"**
```bash
npm install unpdf
```

**Error: "ENOENT: no such file or directory"**
- Check that `/public/policies/` folder exists
- Verify it contains the policy PDFs in category folders

**Error: "relation 'policy_documents' does not exist"**
- Run the schema SQL in Supabase (Step 1)

### If Supabase queries fail:

**Error: "Invalid API key"**
- Double-check the credentials in `.env.local`
- Make sure there are no extra spaces

**No policies returned:**
- Verify the upload completed successfully (check Table Editor)
- Check browser console for Supabase errors

## 📝 Files Changed

- ✓ `.env.local` - Added Supabase credentials
- ✓ `lib/policySearch.ts` - Updated to use Supabase
- ✓ `supabase-schema.sql` - Database schema (new)
- ✓ `scripts/upload-policies.js` - Upload script (new)
- ✓ `package.json` - Added @supabase/supabase-js

## ❓ Questions?

If anything isn't working, check:
1. Supabase dashboard for errors
2. Browser console for client-side errors
3. Terminal output for server-side errors
