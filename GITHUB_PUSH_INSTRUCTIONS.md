# Push to GitHub - Instructions

Your changes are committed locally. Here's how to push them to GitHub:

## ✅ Changes Already Committed
```
Commit: Fix YouTube 429 error with cookie authentication
Files: src/services/youtube.ts, docker-compose.yml, Dockerfile
```

---

## Method 1: Browser-Based Authentication (Recommended)

### Step 1: Create a Personal Access Token
1. Open your browser and go to: https://github.com/settings/tokens
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. Give it a name: `music-twitch-deploy`
4. Select scopes: Check **`repo`** (full control of private repositories)
5. Click **"Generate token"** at the bottom
6. **COPY THE TOKEN** (you'll only see it once!)

### Step 2: Push with Token
```bash
cd /Users/ahmed/Desktop/music-twitch
git push
```

When prompted:
- **Username**: Your GitHub username
- **Password**: Paste the token you just created (NOT your GitHub password)

---

## Method 2: SSH (One-time setup, easier for future pushes)

### Step 1: Generate SSH key
```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
# Press Enter 3 times (default location, no passphrase)
```

### Step 2: Copy public key
```bash
cat ~/.ssh/id_ed25519.pub
```

### Step 3: Add to GitHub
1. Go to: https://github.com/settings/ssh/new
2. Title: `Mac Desktop`
3. Paste the key content
4. Click **"Add SSH key"**

### Step 4: Change remote to SSH
```bash
cd /Users/ahmed/Desktop/music-twitch
git remote set-url origin git@github.com:YOUR_USERNAME/music-twitch.git
git push
```

---

## After Pushing to GitHub

**On your Debian 12 server**, run:
```bash
cd /root/music-twitch
git pull
docker-compose down
docker-compose build --no-cache
docker-compose up -d
docker-compose logs -f
```

Look for: `Using YouTube cookies from: /app/cookies.txt` in the logs.

---

## Quick Copy-Paste Command

If you want to push right now with a token:
```bash
cd /Users/ahmed/Desktop/music-twitch && git push
```
Then paste your token when prompted for password.
