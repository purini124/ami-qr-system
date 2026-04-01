# AMI QR System 🏭

QR label generation, printing, and scan tracking for AMI manufacturing.

---

## 📁 Project Structure

```
ami-qr-system/
├── index.js            ← Main app (add your code here)
├── package.json        ← Dependencies & scripts
├── render.yaml         ← Render deployment config
├── .env.example        ← Environment variable template
├── .gitignore          ← Git ignore rules
└── README.md           ← This file
```

---

## 🚀 Deploy to Render — Step by Step

### 1. Add your index.js
Place your `index.js` app file in this folder.

### 2. Push to GitHub

Open terminal in this folder and run:

```bash
git init
git add .
git commit -m "Initial commit — AMI QR System"
```

Go to [github.com/new](https://github.com/new), create a new repo, then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/ami-qr-system.git
git branch -M main
git push -u origin main
```

---

### 3. Create Web Service on Render

1. Go to [render.com](https://render.com) → Sign in
2. Click **New +** → **Web Service**
3. Click **Connect GitHub** → Select your repo
4. Fill in:

| Setting | Value |
|--------|-------|
| Name | `ami-qr-system` |
| Environment | `Node` |
| Build Command | `npm install` |
| Start Command | `node index.js` |

5. Click **Create Web Service**

---

### 4. Set Environment Variables

In your service → **Environment** tab → Add these:

| Key | Value |
|-----|-------|
| `ADMIN_ID` | your login username |
| `ADMIN_PASSWORD` | your secure password |
| `RENDER_DISK_MOUNT` | `/data` |
| `BASE_URL` | *(set after first deploy — see Step 6)* |

---

### 5. Add Persistent Disk

> ⚠️ Without this, all your asset data resets on every deploy!

1. In your service → **Disks** tab
2. Click **Add Disk**
3. Set:
   - **Name:** `ami-data`
   - **Mount Path:** `/data`
   - **Size:** `1 GB`
4. Click **Save**

---

### 6. Set BASE_URL

After your first deploy Render gives you a URL like:
`https://ami-qr-system-xxxx.onrender.com`

Go back to **Environment** tab and add:

| Key | Value |
|-----|-------|
| `BASE_URL` | `https://ami-qr-system-xxxx.onrender.com` |

Then trigger a **Manual Deploy** → Deploy latest commit.

---

### ✅ Your app is live!

Login at your Render URL with your `ADMIN_ID` and `ADMIN_PASSWORD`.

---

## 💻 Run Locally

```bash
# Install dependencies
npm install

# Create your local .env file
cp .env.example .env
# Edit .env — set ADMIN_ID, ADMIN_PASSWORD, leave BASE_URL empty

# Start with auto-reload
npm run dev

# Or start normally
npm start
```

App runs at → [http://localhost:3000](http://localhost:3000)

---

## ⚠️ Free Tier Limits

| Limit | Detail |
|-------|--------|
| Sleep after inactivity | Spins down after 15 min idle — first load takes ~30s |
| Disk | 1 GB included |
| Always-on | Requires Starter plan ($7/mo) |

---

## 🛠 Tech Stack

| Package | Purpose |
|---------|---------|
| `express` | Web server & routing |
| `qrcode` | QR code generation |
| `body-parser` | Form data parsing |
| `dotenv` | Environment config |
| `assets.json` | File-based data storage (on Render disk) |
