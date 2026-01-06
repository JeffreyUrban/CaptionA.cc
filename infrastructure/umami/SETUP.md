# Umami Analytics Setup Guide

## Overview

Umami is deployed on Fly.io and uses your existing Supabase database with a dedicated `umami` schema.

## Prerequisites

1. Supabase database connection string
2. Fly.io CLI installed and authenticated

## Setup Steps

### 1. Get Your Supabase Connection String

1. Go to your Supabase project dashboard
2. Navigate to **Settings** > **Database**
3. Find the **Connection string** section
4. Copy the **Connection string** (URI format)
5. It looks like: `postgresql://postgres:[YOUR-PASSWORD]@db.xxx.supabase.co:5432/postgres`

### 2. Modify Connection String for Umami Schema

Add `?search_path=umami` to the end:

```
postgresql://postgres:[YOUR-PASSWORD]@db.xxx.supabase.co:5432/postgres?search_path=umami
```

This tells Postgres to use the `umami` schema for all operations.

### 3. Generate Secrets

Generate a random HASH_SALT and APP_SECRET:

```bash
# Generate HASH_SALT (32+ characters)
openssl rand -hex 32

# Generate APP_SECRET (32+ characters)
openssl rand -hex 32
```

Save these values - you'll need them for the next step.

### 4. Create Fly.io App

From the `infrastructure/umami` directory:

```bash
cd infrastructure/umami

# Create the app (don't deploy yet)
fly apps create captionacc-umami --org personal
```

### 5. Set Secrets

```bash
# Set DATABASE_URL (with umami schema)
fly secrets set DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.xxx.supabase.co:5432/postgres?search_path=umami" -a captionacc-umami

# Set HASH_SALT (use the value you generated)
fly secrets set HASH_SALT="your_generated_hash_salt_here" -a captionacc-umami

# Set APP_SECRET (use the value you generated)
fly secrets set APP_SECRET="your_generated_app_secret_here" -a captionacc-umami
```

### 6. Deploy Umami

```bash
fly deploy -a captionacc-umami
```

This will:
- Pull the Umami Docker image
- Connect to your Supabase database
- Create tables in the `umami` schema
- Start the Umami service

### 7. Access Umami Dashboard

```bash
# Get the app URL
fly status -a captionacc-umami
```

Or visit: `https://captionacc-umami.fly.dev`

### 8. Initial Login

**Default credentials:**
- Username: `admin`
- Password: `umami`

**IMPORTANT:** Change the password immediately after first login!

1. Log in with default credentials
2. Go to **Settings** > **Profile**
3. Change your password
4. Update your username if desired

### 9. Add Your Website

1. In Umami dashboard, go to **Settings** > **Websites**
2. Click **Add website**
3. Fill in:
   - **Name**: CaptionA.cc
   - **Domain**: captiona.cc (or localhost for testing)
   - **Enable Share URL**: Optional
4. Click **Save**
5. You'll get a **Website ID** (looks like: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`)

### 10. Get Tracking Script

After adding the website:

1. Click on the website in the list
2. Click **Tracking Code** button
3. Copy the script tag

It will look like:
```html
<script
  defer
  src="https://captionacc-umami.fly.dev/script.js"
  data-website-id="your-website-id-here"
></script>
```

### 11. Add Tracking to CaptionA.cc

The tracking script is already set up to use environment variables. Just add to your `.env`:

```env
VITE_UMAMI_WEBSITE_ID=your-website-id-here
VITE_UMAMI_SRC=https://captionacc-umami.fly.dev/script.js
```

Restart your dev server and Umami will start tracking.

## Verify Setup

### Check Database Schema

Connect to Supabase and verify the `umami` schema was created:

```sql
-- List all schemas
SELECT schema_name FROM information_schema.schemata;

-- Should see: public, auth, umami (and others)

-- List Umami tables
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'umami';

-- Should see: website, pageview, session, event, etc.
```

### Check Tracking

1. Visit your website (http://localhost:5174/waitlist)
2. Open Umami dashboard
3. Click on **CaptionA.cc** website
4. You should see real-time pageviews appearing

## Managing Multiple Websites

To track multiple websites with one Umami instance:

1. Go to **Settings** > **Websites**
2. Click **Add website** for each site
3. Each gets a unique tracking script/website ID
4. Add the appropriate website ID to each site's `.env`

## Troubleshooting

### Umami won't start / Database errors

Check the logs:
```bash
fly logs -a captionacc-umami
```

Common issues:
- Wrong DATABASE_URL format
- Schema doesn't exist (Umami creates it on first run)
- Network connectivity to Supabase

### No tracking data showing

1. Check browser console for JavaScript errors
2. Verify website ID matches the one in Umami dashboard
3. Check that script loads: View source → look for Umami script tag
4. Ad blockers may block the script (test in incognito)
5. Check Umami logs for incoming requests

### Performance / Cost

**Fly.io costs:**
- Umami auto-stops when idle (0 requests)
- Auto-starts on first request (~2 second cold start)
- **Free tier**: Should stay within free allowance for low traffic
- **Paid**: ~$2-5/month if you exceed free tier

**Supabase storage:**
- Umami is very lightweight
- ~1-2 MB per 10,000 pageviews
- Won't significantly impact your 500 MB limit

## Upgrading Umami

```bash
# Pull latest image and deploy
fly deploy -a captionacc-umami --image ghcr.io/umami-software/umami:postgresql-latest
```

Database migrations run automatically on startup.

## Backup Considerations

Umami data is in your Supabase database (`umami` schema), so:
- Included in Supabase automatic backups
- Export separately if needed:
  ```bash
  pg_dump $DATABASE_URL -n umami > umami_backup.sql
  ```

## Alternative: Add More Websites

Remember: One Umami instance can track **unlimited websites**. Just:
1. Add each website in Umami dashboard
2. Get unique tracking code for each
3. Add to each website

No need to deploy multiple Umami instances.

## Resources

- Umami Docs: https://umami.is/docs
- GitHub: https://github.com/umami-software/umami
- Fly.io Docs: https://fly.io/docs
