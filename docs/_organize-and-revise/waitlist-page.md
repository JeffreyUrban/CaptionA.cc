# CaptionA.cc Waitlist Page - Technical Reference

**URL**: `/waitlist`
**Status**: Implemented (2026-01-06)

---

## Stack

### UI Components: Oatmeal Kit (Tailwind Plus)

**Oatmeal Kit** - Mist Instrument theme from [Tailwind Plus](https://tailwindcss.com/plus/kits/oatmeal)

Provides 166+ components organized in:
- `elements/` - Base components (Button, Container, etc.)
- `icons/` - Icon components
- `sections/` - Composed sections (Hero, Features, Footer, etc.)

### Styling: Tailwind CSS v4

Uses CSS `@theme` directive in `/apps/captionacc-web/app/styles/tailwind.css`:

```css
@theme {
  --font-display: 'Instrument Serif', serif;
  --font-sans: 'Inter', system-ui, sans-serif;
  --color-olive-50: oklch(98.8% 0.003 106.5);
  /* ... full olive color scale */
}
```

Colors use oklch() format from the Mist theme.

### Forms: Web3Forms + React Hook Form

**Web3Forms**: Backend-less form submission (sends to email), includes honeypot spam protection
**React Hook Form**: Client-side validation and form state

### Analytics: Self-Hosted Umami

Deployed to Fly.io using Supabase database (`umami` schema).

Setup guide: `/infrastructure/umami/SETUP.md`

---

## Design Decisions

### Branding: CaptionA.cc

The name preserves the "A.cc" wordplay (suggesting "accuracy"):

```tsx
Caption<span className="font-semibold">A.cc</span>
```

Display font with semibold weight on "A.cc" to emphasize the wordplay.

### Form Data Collection

Designed to segment early users and understand diverse use cases. Includes optional fields for persona identification, character set requirements, usage patterns, and qualitative insights.

---

## Configuration

### Environment Variables

Required in `.env` (apps/captionacc-web):

```env
VITE_WEB3FORMS_ACCESS_KEY=your_web3forms_key
VITE_UMAMI_WEBSITE_ID=your_umami_website_id
VITE_UMAMI_SRC=https://captionacc-umami.fly.dev/script.js
```

### Web3Forms Setup

1. Create account at https://web3forms.com
2. Create new form and copy Access Key
3. Add to `.env` as `VITE_WEB3FORMS_ACCESS_KEY`

### Umami Analytics Setup

See `/infrastructure/umami/SETUP.md` for complete deployment.

Summary:
1. Deploy to Fly.io
2. Connect to Supabase `umami` schema
3. Add website in Umami dashboard
4. Copy Website ID and script URL to `.env`

---

## File Structure

```
apps/captionacc-web/
├── app/
│   ├── components/
│   │   ├── WaitlistForm.tsx          # Form with React Hook Form + Web3Forms
│   │   └── oatmeal/                   # Oatmeal Kit components
│   │       ├── elements/
│   │       ├── icons/
│   │       └── sections/
│   ├── routes/
│   │   └── waitlist.tsx               # Landing page route
│   ├── root.tsx                       # Root layout (includes analytics script)
│   └── styles/
│       └── tailwind.css               # @theme configuration
├── .env.example
└── package.json
```

---

## Deployment

### Fly.io Secrets

```bash
fly secrets set VITE_WEB3FORMS_ACCESS_KEY=your_key
fly secrets set VITE_UMAMI_WEBSITE_ID=your_umami_id
fly secrets set VITE_UMAMI_SRC=https://captionacc-umami.fly.dev/script.js
```

### Pre-Deployment Checklist

- [ ] Web3Forms access key configured
- [ ] Umami analytics deployed and configured
- [ ] Environment variables set in Fly.io secrets
- [ ] Form submissions tested
- [ ] Analytics tracking verified
- [ ] Dark mode tested
- [ ] Mobile/responsive layout tested
- [ ] All links verified

---

## Troubleshooting

### Form Won't Submit
- Verify `VITE_WEB3FORMS_ACCESS_KEY` is set and valid
- Check browser console for errors
- Confirm email field has valid format

### Analytics Not Working
- Verify `VITE_UMAMI_WEBSITE_ID` and `VITE_UMAMI_SRC` are set
- Check Umami deployment: `fly status -a captionacc-umami`
- Check browser console for blocked scripts (ad blockers)
- View logs: `fly logs -a captionacc-umami`

### Dark Mode Issues
- Ensure all color classes have `dark:` variants
- Verify `/public/set-theme.js` loads
- Check `suppressHydrationWarning` on `<html>` tag in root.tsx:22
