# React Router + Tailwind CSS Template

A production-ready template for building modern web applications with React Router 7, Tailwind CSS 4, TypeScript, and a comprehensive development toolchain.

## Features

- **React Router 7** - Latest version with file-based routing and automatic route discovery
- **Tailwind CSS 4** - Modern utility-first CSS framework with custom typography
- **TypeScript** - Full type safety across the application
- **Dark Mode** - Built-in theme support with smooth transitions
- **Image Optimization** - Automatic image processing with vite-imagetools
- **MDX Support** - Write content with markdown and React components
- **Testing** - Vitest setup with React Testing Library
- **Code Quality** - ESLint, Prettier, and pre-commit hooks
- **Responsive Design** - Beautiful layout that works on all devices
- **Deployment Ready** - Includes Dockerfile and Fly.io configuration
- **Dependency Management** - Renovate configuration for automated updates
- **MIT Licensed** - Free to use for any project
- **Template Ready** - Comprehensive customization instructions included

## Using This Template

### Quick Start

1. **Use this template**
   - Click "Use this template" on GitHub, or
   - Clone this repository: `git clone <repo-url>`

2. **Customize your project**
   - Update `package.json`:
     - Change `name` to your project name
     - Update `description`
   - Search and replace "My Site" with your site name in:
     - `app/components/CommonLayout.tsx` (line 12)
   - Update `app/routes/_index.tsx` to replace template content

3. **Install and run**
   ```bash
   npm install
   npm run dev
   ```

4. **Configure repository settings** (see [Repository Configuration](#repository-configuration) below)
   - Set up branch protection rules
   - Configure Renovate for automated dependency updates

## Repository Configuration

### Branch Protection Rules

To ensure code quality and require reviews before merging to main:

1. **Navigate to branch protection settings**
   - Go to your repository on GitHub
   - Settings → Branches → Classic Branch Protection
   - Click "Add classic branch protection rule"

2. **Configure the protection rule**
   - **Branch name pattern:** `main`
   - **Enable these settings:**
     - ✅ Require a pull request before merging
     - ✅ Require status checks to pass before merging
     - ✅ Do not allow bypassing the above settings

   - **Status checks that are required:**
     - `review_app` (PR preview deployment must succeed)
     - `Code Quality Checks` (linting and type checking must pass)

3. **Save changes**

This ensures that all code merged to main has been reviewed and passes all automated checks.

## Getting Started

### Prerequisites

- Node.js >= 24.0.0 (use nvm for version management)

### Installation

1. Clone or copy this template

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The app will be available at `http://localhost:5173`

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Run production server
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Lint code with ESLint
- `npm run typecheck` - Check TypeScript types

### Project Structure

```
.
├── app/
│   ├── assets/         # Static assets (images, etc.)
│   ├── components/     # Reusable React components
│   ├── config/         # Configuration files (feature flags, etc.)
│   ├── lib/            # Utility functions and helpers
│   ├── routes/         # File-based routing (add .tsx or .mdx files here)
│   ├── services/       # Business logic and data fetching (optional)
│   ├── styles/         # Global styles and CSS
│   ├── root.tsx        # Root component with layout
│   └── routes.ts       # Route configuration with auto-discovery
├── public/             # Static files served as-is
└── ...config files
```

### Adding New Pages

#### Option 1: TypeScript/TSX Pages

Create a new file in `app/routes/`:

```tsx
// app/routes/about.tsx
import { Container } from '~/components/Container'

export default function About() {
  return (
    <Container className="mt-9">
      <h1 className="text-4xl font-bold">About Page</h1>
      <p className="mt-6 text-base">Your content here</p>
    </Container>
  )
}
```

The route will automatically be available at `/about`.

#### Option 2: MDX Pages

Create a new MDX file in `app/routes/`:

```mdx
// app/routes/blog.mdx
---
title: My Blog
description: A blog post written in MDX
date: 2024-01-01
---

# My Blog

Content with **markdown** and React components!
```

### Feature Flags

Enable/disable sections using feature flags in `app/config/featureFlags.ts`:

```typescript
const featureFlags = {
    showArticles: true,    // Show articles section
    showProjects: true,    // Show projects section
    // ... add your own flags
};
```

Use them in components:

```tsx
import featureFlags from '~/config/featureFlags'

{featureFlags.showArticles && <ArticlesSection />}
```

### Styling

The template uses Tailwind CSS with custom configurations:

- **Custom Colors** - Zinc color palette with teal accents
- **Typography Plugin** - Beautiful typography for prose content
- **Dark Mode** - Automatic theme switching with ThemeProvider
- **Responsive** - Mobile-first design approach

Edit `tailwind.config.js` to customize colors, fonts, and design tokens.

### Image Optimization

Images are automatically optimized using vite-imagetools:

```typescript
// Import with transformation queries
import image from '~/assets/images/photo.jpg?w=800;1200&format=webp'

// The imported image is an array of optimized versions
// Use in your component with src and srcSet attributes
```

Images are automatically resized, converted to WebP, and optimized.

### Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# With UI
npm run test:ui
```

Write tests next to your components:

```tsx
// app/components/Button.test.tsx
import { render, screen } from '@testing-library/react'
import { Button } from './Button'

test('renders button', () => {
  render(<Button>Click me</Button>)
  expect(screen.getByText('Click me')).toBeInTheDocument()
})
```

## Customization

### Essential Customizations

After creating a project from this template, customize these files:

1. **Project Identity**
   - `package.json` - Update `name`, `description`, and `version`
   - `LICENSE` - Add your copyright holder name and year
   - `README.md` - Replace with your project's README

2. **Site Metadata**
   - `app/components/CommonLayout.tsx` (line 12) - Change "My Site" to your site name
   - Update the `<title>` and meta tags as needed

3. **Branding**
   - `public/favicon.svg` - Replace with your favicon
   - `app/components/Header.tsx` - Update logo and navigation links
   - `app/components/Footer.tsx` - Update footer content and links

4. **Content**
   - `app/routes/_index.tsx` - Replace template home page with your content
   - `app/routes/contact.tsx` - Update Web3Forms key (or remove if not needed)
   - Delete `app/routes/example.mdx` if not needed

5. **Configuration**
   - `app/config/featureFlags.ts` - Adjust feature flags for your needs
   - `tailwind.config.js` - Customize colors, fonts, and design tokens
   - `fly.toml` - Update app name if deploying to Fly.io

### Adding New Content

**New Pages** - Create files in `app/routes/`:
```tsx
// app/routes/about.tsx
import { Container } from '~/components/Container'

export default function About() {
  return (
    <Container className="mt-9">
      <h1 className="text-4xl font-bold">About Page</h1>
      <p className="mt-6 text-base">Your content here</p>
    </Container>
  )
}
```

**New Components** - Create files in `app/components/`:
```tsx
// app/components/MyComponent.tsx
export function MyComponent() {
  return <div>My Component</div>
}
```

**Images** - Add to `app/assets/images/` and import with optimization:
```tsx
import myImage from '~/assets/images/photo.jpg?w=800;1200&format=webp'
```

**MDX Pages** - Create `.mdx` files in `app/routes/`:
```mdx
---
title: My Blog Post
date: 2025-01-01
---

# My Blog Post

Content with **markdown** and React components!
```

*I like and recommend [Tailwind Plus](https://tailwindcss.com/plus) for component libraries.*

## Optional Packages

The following packages were intentionally excluded but can be added when needed:

### Suggested Additions

#### `react-lazy-load-image-component`
```bash
npm install react-lazy-load-image-component
npm install -D @types/react-lazy-load-image-component
```
**When to add:** Building image galleries, photo portfolios, or pages with many images that benefit from lazy loading for performance.

#### `react-swipeable`
```bash
npm install react-swipeable
```
**When to add:** Adding touch/swipe gestures for mobile carousels, image galleries, or interactive slide components.

## Included and Demonstrated

The template includes and actively demonstrates these features on the home page:

### `@tailwindcss/typography`
- **Status:** Actively used with `prose` classes in the Typography Plugin demo section
- **Keep if:** You're building a blog, documentation site, or any content-heavy pages
- **Remove if:** You're building a pure application UI without prose content
- **To remove:** `npm uninstall @tailwindcss/typography` and update `tailwind.config.js`

### `vite-imagetools`
- **Status:** Actively used to optimize and display the placeholder image
- **Keep if:** You plan to use images (recommended - setup is complex)
- **Remove if:** Building a text-only application
- **Size impact:** ~2MB
- **To remove:** `npm uninstall vite-imagetools` and update `vite.config.ts`

### MDX Support (`@mdx-js/rollup`, `remark-*`)
- **Status:** Actively demonstrated with the `/example` page
- **Keep if:** You want to write content in MDX (markdown + React components)
- **Remove if:** Pure TypeScript/TSX workflow preferred
- **Size impact:** ~3MB
- **To remove:** `npm uninstall @mdx-js/rollup remark-frontmatter remark-mdx-frontmatter` and update `vite.config.ts`

### Link Checking (`cheerio`, `linkinator`)
- **Status:** Only used in optional scripts (`check:links`, `check:external-links`)
- **Keep if:** You want automated link validation for production sites
- **Remove if:** Not needed for your workflow
- **Size impact:** ~5MB
- **To remove:** `npm uninstall cheerio linkinator @types/cheerio`

## Deployment

### Fly.io (Recommended)

The template includes a `Dockerfile` and `fly.toml` for easy deployment to Fly.io:

#### Initial Setup

1. **Install Fly CLI**
   ```bash
   # macOS
   brew install flyctl

   # Linux
   curl -L https://fly.io/install.sh | sh

   # Windows
   powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
   ```

2. **Sign up and login**
   ```bash
   fly auth signup  # or fly auth login if you have an account
   ```

3. **Launch your app**
   ```bash
   fly launch
   ```

   This will:
   - Create a new app on Fly.io
   - Set up the configuration
   - Prompt you to deploy

   Answer the prompts:
   - Choose an app name (or let it generate one)
   - Select a region closest to your users
   - Don't create a Postgres database (unless you need one)
   - Don't create a Redis database (unless you need one)

4. **Deploy**
   ```bash
   fly deploy
   ```

#### Subsequent Deployments

After initial setup, just run:
```bash
fly deploy
```

#### Custom Domain

To add a custom domain:
```bash
fly certs create yourdomain.com
fly certs create www.yourdomain.com
```

Then add DNS records as instructed by Fly.

#### View Your App

```bash
fly open          # Open in browser
fly logs          # View logs
fly status        # Check app status
```

#### GitHub Actions Deployment

The template includes GitHub Actions for automatic deployment. To configure:

**Prerequisites**: You must first create the app on Fly.io before GitHub Actions can deploy to it.

1. **Create the app on Fly.io** (one-time setup)
   ```bash
   fly launch
   ```

   Follow the prompts to create your app. This generates the app name in `fly.toml`.

2. **Generate a Fly API token**

   Option A - Using CLI:
   ```bash
   fly tokens create deploy
   ```

   Option B - Using Dashboard:
   - Visit https://fly.io/dashboard/personal/tokens
   - Click "Create token"
   - Give it a name (e.g., "GitHub Actions")
   - Copy the token

3. **Add token to GitHub Secrets**
   - Go to your GitHub repository
   - Navigate to Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `FLY_API_TOKEN`
   - Value: Paste the token
   - Click "Add secret"

4. **Commit and push** your `fly.toml` file to trigger the first automated deployment.

**Security Note**: Never commit the `FLY_API_TOKEN` directly to your repository. Always use GitHub Secrets.

#### PR Preview Apps

The template includes GitHub Actions workflows for PR preview deployments. To enable them:

**Setup steps:**

1. **Update the workflow app name**
   - Edit `.github/workflows/fly-review.yml`
   - Change line 36 from `mysitename-site` to match your app name from `fly.toml`
   - Example: If your app is `my-app`, use `pr-${{ github.event.number }}-my-app`

2. **Generate a fresh org-level token** (required for creating/destroying apps)
   ```bash
   fly tokens org <YOUR_ORG_NAME>
   ```

   This generates and displays a token with permissions to create and destroy apps within your organization.

   **Important:**
   - Copy the token immediately when it's displayed
   - The token is only shown once
   - If you already have a token but it's not working, generate a fresh one

3. **Add token to GitHub Secrets**
   - Go to your GitHub repository → Settings → Secrets and variables → Actions
   - If `FLY_API_TOKEN` exists, click to edit it and paste the new token
   - If it doesn't exist, click "New repository secret" with name `FLY_API_TOKEN`
   - Paste the token and save

**How it works:**
- Each PR creates a new app named `pr-{number}-{your-app-name}`
- Apps are accessible at `https://pr-{number}-{your-app-name}.fly.dev`
- Apps are automatically destroyed when PRs are closed or merged

**Troubleshooting:**

If PR deployments fail with "Not authorized to deploy this app":
1. Verify the workflow file has the correct app name (not `mysitename-site`)
2. Regenerate a fresh org token: `fly tokens org <YOUR_ORG_NAME>`
3. Update the `FLY_API_TOKEN` secret in GitHub with the new token
4. Ensure you're using an org token, not a deploy token

**Note**:
- Regular deploy tokens (`fly tokens create deploy`) don't have permission to create new apps
- PR preview apps count toward your Fly.io resource limits
- Monitor usage at https://fly.io/dashboard

### Other Platforms

Build the production bundle:

```bash
npm run build
```

Deploy the `build/` directory to any Node.js hosting platform:
- **Vercel**: `vercel deploy`
- **Netlify**: Drag the `build/` folder to Netlify's deploy UI
- **Railway**: Connect your GitHub repo
- **Render**: Connect your GitHub repo

## Automated Dependency Updates

### Renovate (Recommended)

Renovate automatically creates pull requests to update your dependencies. It's more powerful and configurable than Dependabot.

The template includes a pre-configured `renovate.json` file with:
- Weekly updates (Monday mornings)
- Auto-merge for minor and patch updates
- Recommended security and stability settings

#### Setup

1. **Install Renovate GitHub App**
   - Go to https://github.com/apps/renovate
   - Click "Configure"
   - Select your account/organization
   - Choose "Only select repositories"
   - Select your repository from the dropdown
   - Click "Install" or "Save"
   - Select Product → "Renovate Only"
   - Choose a Preferred Mode → "Scan and Alert"
   - Click "Finish"

2. **Verify setup**
   - Renovate will create an onboarding PR within a few minutes
   - Review and merge the onboarding PR
   - Renovate will start creating update PRs based on `renovate.json`

3. **Customize (optional)**

   The included `renovate.json` can be customized. Common additions:
   ```json
   {
     "extends": ["config:recommended"],
     "schedule": ["before 5am on monday"],
     "packageRules": [
       {
         "matchUpdateTypes": ["minor", "patch"],
         "automerge": true
       },
       {
         "matchPackagePatterns": ["^@types/"],
         "automerge": true
       }
     ],
     "labels": ["dependencies"],
     "assignees": ["your-username"]
   }
   ```

**Note**: If you don't see the Renovate app option, you may need to install it first at https://github.com/apps/renovate/installations/new

#### Alternative: Dependabot

If you prefer Dependabot, create `.github/dependabot.yml`:
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
```

Renovate is recommended because it:
- Groups related updates
- Has better auto-merge capabilities
- Provides more detailed PR descriptions
- Can update non-npm dependencies (Docker, GitHub Actions, etc.)

## Node.js Version

This project requires Node.js >= 24.0.0

- Version specified in `.nvmrc`
- Use `nvm use` to switch versions
- Automatically checked before dev/build

## Clean Up

This template includes infrastructure from the original project. You may want to remove:

- Unused components in `app/components/`
- Unused services in `app/services/`
- GitHub Actions in `.github/` (customize for your needs)
- Deployment config in `fly.toml` (if not using Fly.io)

## License

MIT - Use freely for any project
