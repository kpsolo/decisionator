# Self-Hosting Deci (v0.1)

Deci is designed as a pure client-side application requiring **zero backend servers**. By default, it operates directly in the browser using the user's own Google Drive as the storage backend via Google Sheets.

If you wish to deploy your own instance of Deci or use your own Google Cloud project quota rather than the public instance, follow this setup guide.

---

## 1. Google Cloud Project Setup

To use Google Drive and Google Sheets APIs with Deci, you will need a Google Cloud Project with the **Google Drive API**, **Google Sheets API**, and **Google Picker API** enabled.

### Step 1: Create a Google Cloud Project
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Click **Select a project** > **New Project**.
3. Name your project (e.g., `Deci Decision Engine`) and click **Create**.

### Step 2: Enable Required APIs
1. Navigate to **APIs & Services** > **Library**.
2. Search for and enable the following 3 APIs:
   - **Google Drive API**
   - **Google Sheets API**
   - **Google Picker API**

---

## 2. OAuth 2.0 Client & Consent Screen

Deci exclusively requests the non-sensitive **`drive.file`** scope. This gives Deci access only to files it creates or files explicitly selected by the user via the Google Picker. It **never** has access to any other files in the user's Google Drive.

### Step 1: Configure OAuth Consent Screen
1. Navigate to **APIs & Services** > **OAuth consent screen**.
2. Select **External** user type and click **Create**.
3. Fill in the App Information:
   - **App name**: `Deci`
   - **User support email**: your contact email.
   - **Developer contact information**: your contact email.
4. Click **Save and Continue**.
5. Under **Scopes**, click **Add or Remove Scopes**:
   - Filter and select: `.../auth/drive.file` (`See, edit, create, and delete only the specific Google Drive files you use with this app`).
6. Click **Update** and **Save and Continue**.
7. Because `drive.file` is classified by Google as a **non-sensitive** scope, you can publish the consent screen to **Production** without undergoing Google verification or being limited by the 100-test-user restriction!

### Step 2: Create OAuth 2.0 Web Client ID
1. Navigate to **APIs & Services** > **Credentials**.
2. Click **Create Credentials** > **OAuth client ID**.
3. Set Application type to **Web application**.
4. Name: `Deci Web App`.
5. Under **Authorized JavaScript origins**:
   - Add your hosted origin (e.g. `https://kpsolo.github.io` or `https://yourdomain.com`).
   - If developing locally, add `http://localhost:5173`.
6. Click **Create**.
7. Copy the generated **Client ID** (you will set this as `VITE_GOOGLE_CLIENT_ID`).

---

## 3. Google API Key (for Google Picker)

1. Under **APIs & Services** > **Credentials**, click **Create Credentials** > **API key**.
2. Click **Edit API key** to restrict its permissions:
   - **Set application restrictions**: Select **Websites** (HTTP referrers) and add your website URL (`https://yourdomain.com/*`).
   - **Set API restrictions**: Select **Restrict key** and select only **Google Picker API**.
3. Copy the API key (you will set this as `VITE_GOOGLE_API_KEY`).

---

## 4. Environment Variables Configuration

Copy `.env.example` to `.env` in `apps/web`:

```bash
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=your-restricted-api-key
VITE_BASE_URL=https://yourdomain.com/
```

| Variable | Description |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | OAuth 2.0 Web Client ID generated in Step 2. |
| `VITE_GOOGLE_API_KEY` | HTTP-restricted API Key for Google Picker generated in Step 3. |
| `VITE_BASE_URL` | Base URL used when copying share links to projects. |

---

## 5. Building and Deploying

Deci is built using Vite and can be statically hosted anywhere (GitHub Pages, Cloudflare Pages, Netlify, Vercel, or AWS S3).

```bash
# Install dependencies
pnpm install

# Build static bundle
pnpm --filter @decisionator/web build
```

The compiled output will be generated in `apps/web/dist/`. Simply upload this folder to your static web server or host!
