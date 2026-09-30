# 🚀 SamleyGo Deployment Guide: Web (Vercel) & Google Play Store

This step-by-step production manual covers how to deploy **SamleyGo Food Delivery** to:
1. **The Web** using **Vercel** (with real-time Supabase database, live Leaflet maps, audio alert engine, and single-page routing).
2. **Google Play Store (Android)** using a verified **Trusted Web Activity (TWA) / Bubblewrap / PWABuilder** to generate a signed Android App Bundle (`.aab`) ready for Google Play Console submission.

---

## 📋 Prerequisites Checklist

Before you start, make sure you have:
- [ ] A **GitHub**, **GitLab**, or **Bitbucket** account with your SamleyGo repository.
- [ ] A **[Vercel](https://vercel.com/)** account (Hobby or Pro).
- [ ] Your **Supabase Project Credentials**:
  - `VITE_SUPABASE_URL` (e.g. `https://xyzcompany.supabase.co`)
  - `VITE_SUPABASE_ANON_KEY` (public client key)
  - `GEMINI_API_KEY` (optional, for AI features)
- [ ] A **[Google Play Console Developer Account](https://play.google.com/console)** ($25 one-time registration fee from Google).
- [ ] **Node.js 18+** and **Java JDK 17+** (if building Android locally using Google Bubblewrap CLI).

---

## 🌐 PART 1: Deploying to Web with Vercel

### Option A: Via Vercel Web Dashboard (Recommended)

1. **Push your code to GitHub / GitLab**:
   ```bash
   git add .
   git commit -m "feat: ready for production deployment"
   git push origin main
   ```

2. **Import into Vercel**:
   - Go to [vercel.com/new](https://vercel.com/new).
   - Log in with your Git provider and click **Import** next to your `samleygo` repository.

3. **Configure Project Settings**:
   - **Framework Preset**: `Vite` (automatically detected).
   - **Root Directory**: `./` (default).
   - **Build Command**: `npm run build` (or `bun run build`).
   - **Output Directory**: `dist`.
   - **Install Command**: `npm install` (or `bun install`).

4. **Add Environment Variables**:
   Under **Environment Variables**, enter the following keys:
   | Variable Name | Value | Purpose |
   |---|---|---|
   | `VITE_SUPABASE_URL` | `https://your-project.supabase.co` | Supabase endpoint |
   | `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOi...` | Supabase public anon key |
   | `GEMINI_API_KEY` | `AIzaSy...` (optional) | AI features |

5. **Deploy**:
   - Click **Deploy**.
   - Vercel will build the Vite bundle, generate static assets and service workers, and issue a free SSL certificate on your `.vercel.app` URL (e.g., `https://samleygo.vercel.app`).

---

### Option B: Via Vercel CLI (Terminal)

```bash
# 1. Install Vercel CLI globally
npm i -g vercel

# 2. Log in to your Vercel account
vercel login

# 3. Deploy to production
vercel --prod
```
During the prompt:
- Link to existing project? **No** (or select if already created)
- Project name: `samleygo`
- In which directory is your code located? `./`
- Want to modify settings? **No**

Set your production environment variables:
```bash
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_ANON_KEY production
vercel --prod
```

---

### ⚙️ SPA Routing & Headers Configuration (`vercel.json`)

To prevent 404 errors when visitors refresh deep URLs (e.g. `/orders/123`, `/restaurant/dashboard`, `/courier/dashboard`), SamleyGo includes a `vercel.json` file in the project root:

```json
{
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" },
        { "key": "X-XSS-Protection", "value": "1; mode=block" }
      ]
    },
    {
      "source": "/.well-known/assetlinks.json",
      "headers": [
        { "key": "Content-Type", "value": "application/json" }
      ]
    }
  ]
}
```

---

### 🔗 Custom Domain & Supabase Auth Redirects

1. In Vercel, go to **Project Settings > Domains** and add your custom domain (e.g. `samleygo.com` or `app.samleygo.com`). Follow the DNS instructions to add the `CNAME` or `A` record.
2. In your **Supabase Dashboard**:
   - Navigate to **Authentication > URL Configuration**.
   - Set **Site URL** to `https://samleygo.com`.
   - Add `https://samleygo.com/**` and `https://*.vercel.app/**` to **Redirect URLs**.

---

## 📱 PART 2: Publishing to Google Play Store (Android)

SamleyGo is already configured with `vite-plugin-pwa` including:
- Web App Manifest (`manifest.webmanifest`)
- Mobile icons (`192x192`, `512x512`, and `maskable`)
- GPS geolocation & background sync capabilities
- Standalone display mode with `#059669` emerald branding

Google's official recommendation for Progressive Web Apps on the Play Store is a **Trusted Web Activity (TWA)**. TWAs run directly inside the Chrome/Android system engine, giving you:
- **Instant updates**: When you push to Vercel, your Play Store app updates instantly without needing resubmission!
- **Play Store presence**: Downloadable directly from the Google Play Store with icon on the user's home screen.
- **Full screen**: No browser address bar or navigation buttons.
- **Hardware access**: Full GPS location tracking for riders, sound engine notifications, camera/photo uploads for food items.

---

### Method 1: Using PWABuilder (Fastest, No-Code Browser Tool)

1. Open [PWABuilder.com](https://www.pwabuilder.com/).
2. Enter your live Vercel URL: `https://samleygo.vercel.app` (or custom domain `https://samleygo.com`) and click **Start**.
3. PWABuilder will verify your manifest, service worker, and HTTPS security.
4. Click **Package For Stores > Android**.
5. Configure your Android Package:
   - **Package ID**: `com.samleygo.app`
   - **App Name**: `SamleyGo Food Delivery`
   - **Short Name**: `SamleyGo`
   - **Display Mode**: `Standalone`
   - **Include Notification Delegation**: `Checked`
   - **Signing Key**: Select **Generate New** (or upload your existing keystore). *Save the keystore file and passwords safely!*
6. Click **Generate Package**.
7. Download the `.zip` archive. Inside you will find:
   - `app-release-signed.aab` (The Android App Bundle to upload to Google Play).
   - `assetlinks.json` (Used for domain verification in Part 3).

---

### Method 2: Using Google Bubblewrap CLI (Official Google Tool)

Bubblewrap is Google's official command-line tool for generating production-ready Android App Bundles.

#### Step 1: Install Bubblewrap
```bash
npm install -g @bubblewrap/cli
```

#### Step 2: Initialize from your deployed Vercel URL
```bash
bubblewrap init --manifest https://samleygo.vercel.app/manifest.webmanifest
```

Bubblewrap will inspect your manifest and prompt you:
- **Application name**: `SamleyGo Food Delivery`
- **Short name**: `SamleyGo`
- **Application ID**: `com.samleygo.app`
- **Starting URL**: `/`
- **Theme color**: `#059669`
- **Background color**: `#ffffff`
- **Display mode**: `standalone`
- **Key store location**: `android.keystore`
- **Key name**: `samleygo-key`

#### Step 3: Build the Android App Bundle (`.aab`)
```bash
bubblewrap build
```
This generates:
- `app-release-signed.aab`

---

## 🔐 PART 3: Digital Asset Links (`assetlinks.json`)

To remove the Chrome browser URL bar and verify that your Android app owns the domain, Google requires a Digital Asset Links file hosted at:
`https://yourdomain.com/.well-known/assetlinks.json`

### 1. Get your SHA-256 Fingerprint
When you create your signing key or let Google Play App Signing manage it:
- In **Google Play Console**, go to **Setup > App Signing**.
- Copy the **SHA-256 certificate fingerprint** (e.g., `14:6D:E9:...`).

### 2. Create `public/.well-known/assetlinks.json` in your project:
```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.samleygo.app",
      "sha256_cert_fingerprints": [
        "YOUR_SHA256_FINGERPRINT_HERE"
      ]
    }
  }
]
```

### 3. Deploy to Vercel:
```bash
git add public/.well-known/assetlinks.json
git commit -m "chore: add digital asset links for Google Play TWA"
git push origin main
```

### 4. Verify:
Visit `https://yourdomain.com/.well-known/assetlinks.json` in your browser. It should return HTTP 200 with `application/json`.
You can also verify with Google's official tool:
[https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://yourdomain.com&relation=delegate_permission/common.handle_all_urls](https://digitalassetlinks.googleapis.com/v1/statements:list)

---

## 🛒 PART 4: Submitting to Google Play Console

### Step 1: Create the Application
1. Log in to [Google Play Console](https://play.google.com/console).
2. Click **Create app**:
   - **App name**: `SamleyGo - Food Delivery & Courier`
   - **Default language**: `English (United States)` or `English (United Kingdom)`
   - **App or game**: `App`
   - **Free or paid**: `Free`
   - Agree to Declarations and click **Create app**.

---

### Step 2: Store Presence Setup (Main Store Listing)
Prepare the following graphic assets:

| Asset | Specifications | Notes |
|---|---|---|
| **App Icon** | 512 x 512 px, PNG (up to 1 MB) | Emerald SamleyGo logo |
| **Feature Graphic** | 1024 x 500 px, JPG or PNG | High quality banner |
| **Phone Screenshots** | Min 2, max 8 (16:9 or 9:16 aspect ratio) | Screenshots of Customer, Restaurant, and Courier screens |
| **7-inch & 10-inch Tablet Screenshots** | At least 1 (optional but recommended) | Desktop/Tablet views |

**App Descriptions**:
- **Short description** (Up to 80 chars):
  > Order food from favorite restaurants with live courier tracking in Ghana.
- **Full description** (Up to 4000 chars):
  > SamleyGo is Ghana's fast, reliable food delivery platform connecting hungry customers, local restaurants, and fast dispatch couriers.
  >
  > Features:
  > - Browse top Ghanaian and continental restaurants.
  > - Live GPS courier tracking with real-time ETA and distance.
  > - Restaurant kitchen dashboard for managing incoming orders.
  > - Dedicated courier driver app with Bolt/Yango-style trip request alerts.
  > - Flexible payments including Mobile Money (MTN MoMo, Telecel Cash, AT Money) and Cash on Delivery.

---

### Step 3: App Content & Policy Declarations
Under **Policy and Programs > App Content**, complete the mandatory questionnaires:

1. **Privacy Policy**: Provide a valid URL (e.g. `https://samleygo.com/privacy` or hosted on Notion/GitHub).
2. **Ads**: Select **No, my app does not contain ads**.
3. **App Access**: Provide demo credentials (e.g. test customer account and test restaurant account) for Google's reviewers.
4. **Content Ratings**: Complete the IARC questionnaire. Food delivery apps qualify as **PEGI 3 / Everyone**.
5. **Target Audience**: Select **18 and over** (or 13+).
6. **Location Permissions**:
   - SamleyGo uses GPS location for couriers to broadcast live delivery coordinates and for customers to find nearby kitchens.
   - Declare: **App functionality & Delivery navigation**.
7. **Financial Features**: Declare standard e-commerce / food delivery payment processing.

---

### Step 4: Upload the Release & Launch

1. Go to **Release > Production** (or **Testing > Closed testing** first).
2. Click **Create new release**.
3. Ensure **Google Play App Signing** is enabled.
4. Upload your `app-release-signed.aab` bundle.
5. Enter **Release notes**:
   > Initial release of SamleyGo Food Delivery app for Ghana: real-time live map tracking, restaurant management, and rider dispatch.
6. Click **Next** and **Review release**.
7. Click **Start rollout to Production**!

Review typically takes **1 to 3 business days** for new developer accounts.

---

## ⚡ Benefits of This Architecture

1. **Zero Downtime Web Updates**:
   When you update prices, menus, or features on Vercel, the changes appear immediately inside the Google Play app without having to release a new version on Google Play!
2. **Sound Engine Compatibility**:
   The Bolt/Yango driver chimes and restaurant counter bells (`restaurant-bell.mp3` and `courier-sound.mp3`) play smoothly inside the Android TWA shell.
3. **Low Storage Footprint**:
   The downloaded `.aab` / APK is only **1–3 MB**, making it extremely fast to download over mobile data across Ghana.
4. **Unified Codebase**:
   One single repository in React + TypeScript + Tailwind serves desktop web, mobile web, and the Google Play Store Android app.

---

## 🛠️ Troubleshooting & Support

- **Issue**: Google Play app shows Chrome URL bar at the top.
  - **Fix**: Check `https://yourdomain.com/.well-known/assetlinks.json`. Ensure the SHA-256 fingerprint matches the **App Signing key** inside Google Play Console.
- **Issue**: Audio alerts don't play on mobile until first touch.
  - **Fix**: SamleyGo includes `initAudioUnlock()` in `src/lib/soundAlerts.ts`, which automatically primes the audio context on the user's first tap.
- **Issue**: 404 on page refresh on Vercel.
  - **Fix**: The included `vercel.json` rewrites all requests to `index.html` for single-page routing.
