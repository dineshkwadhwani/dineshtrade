# DAlgo — New Customer EC2 Server Setup Guide (v3)

**Architecture:** Every customer runs on their own EC2 instance at `<subdomain>.dalgo.online`.  
All users authenticate at `dalgo.online` and are SSO-redirected to their subdomain after login.

---

## Step 0 — Commission the EC2 Instance (AWS Console)

### 0.1 — Launch Instance

Go to **AWS Console → EC2 → Instances → Launch Instance** (ensure region is **Mumbai ap-south-1**).

| Setting | Value |
|---|---|
| Name | `dalgo-<subdomain>` |
| AMI | Ubuntu Server 24.04 LTS or 26.04 LTS (HVM) |
| Instance type | **t3.small** minimum (t3.micro will OOM during build) |
| Key pair | Reuse existing `.pem` or create new — download and save safely |
| Storage | 20 GiB gp3 |
| Security Group | Create new (see 0.2) |

### 0.2 — Security Group Inbound Rules

| Type | Protocol | Port | Source |
|---|---|---|---|
| SSH | TCP | 22 | My IP only |
| HTTP | TCP | 80 | Anywhere 0.0.0.0/0 |
| HTTPS | TCP | 443 | Anywhere 0.0.0.0/0 |

Launch the instance 

> ⚠️ If your home IP changes, SSH will block you. Update the SSH rule source in AWS Console → EC2 → Security Groups.

### 0.3 — Allocate and Associate an Elastic IP (Static IP)

1. EC2 Dashboard → **Network & Security → Elastic IPs → Allocate Elastic IP address**
2. Leave defaults → click **Allocate**
3. Select the new IP → **Actions → Associate Elastic IP address**
4. Choose your new instance → click **Associate**

> **Cost note:** Elastic IP is free while attached to a **running** instance. Never stop the instance — only reboot.

### 0.4 — Point DNS to the EC2 IP

In your DNS provider (Namecheap / Route 53), add an **A Record**:

| Type | Host | Value |
|---|---|---|
| A Record | `<subdomain>` | `<Elastic IP>` |

DNS propagation takes 5–30 minutes. Verify: `ping <subdomain>.dalgo.online` should resolve to the Elastic IP.

### 0.5 — SSH Into the New Server

```bash
# Fix key permissions (run once on your Mac)
chmod 400 ~/Downloads/<your-key>.pem

# Connect
ssh -i ~/Downloads/<your-key>.pem ubuntu@<Elastic IP>
```

### Automated Server Setup

The repository includes [`setup-script.sh`](../setup-script.sh), which automates
the server-side portions of Steps 1–7 and creates the `deploybranch.sh` helper
from Step 11. It does not create the EC2 instance or make changes in AWS,
Supabase, or Zerodha. Before running it, complete the AWS, Elastic IP, DNS, and
security-group setup above, and have this customer's `.env.local` values and a
reachable email address for Let's Encrypt certificate notices ready. The Git
repository URL is already configured in the script; you do not need to provide it.
The script supports Ubuntu Server 24.04 LTS and 26.04 LTS and installs Node.js
24 LTS on either version.

From Terminal on your Mac, upload the script and connect to the instance:

```bash
scp -i ~/Downloads/<your-key>.pem setup-script.sh ubuntu@<Elastic IP>:/home/ubuntu/
ssh -i ~/Downloads/<your-key>.pem ubuntu@<Elastic IP>
```

On the server, run:

```bash
chmod 700 ~/setup-script.sh
~/setup-script.sh
```

The script prompts for the customer's lowercase subdomain and uses it to
configure `<subdomain>.dalgo.online`. It also asks for the certificate email
interactively.

The script uses the subdomain argument and asks for the certificate email, then
reports each setup stage. After cloning, it copies `.env.example` to
`.env.local` if needed and opens the file in `nano` before building or starting
the app. The example is only a template: `.env.local` is ignored by Git and is
not downloaded when the repository is cloned.

In the editor, replace the template values for this customer:

- Set `APP_BASE_URL` and `NEXT_PUBLIC_APP_URL` to
  `https://<subdomain>.dalgo.online`.
- Set `USE_MOCK_MARKET=false`, `ZERODHA_ENVIRONMENT=PROD`, and
  `CRON_ENABLED=true`.
- Set `CUSTOMER_IDS` to the customer's UUID from the Supabase `profiles` table.
- Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
  `SUPABASE_SERVICE_KEY` to the production project's values.
- Copy `ENCRYPTION_KEY` and `SHARED_SSO_SECRET` exactly from the main server.
- Set a private `SESSION_SECRET` of at least 32 characters.
- Set `PROD_ZERODHA_ACCOUNT1` to the account alias, then set matching
  `PROD_ZERODHA_API_KEY_<NAME>` and `PROD_ZERODHA_API_SECRET_<NAME>` values from
  that customer's production Kite app. `<NAME>` must match the account alias.
- If using AI or application email features, configure the corresponding
  provider/API key or email settings too.

Save and exit nano (`Ctrl+O`, Enter, then `Ctrl+X`). The script checks for
required values and unedited template placeholders without printing secrets.
It also asks for confirmation before starting the app because
`CRON_ENABLED=true` can start scheduled trading. It will not reboot the server.

GitHub access is required to clone the repository. If the repo is private,
configure authorized GitHub access for the server before running the script.
After it completes, finish the manual Supabase and Zerodha steps below.

---

## Step 1 — Add Swap Space (required — prevents OOM kills during build)

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h   # verify swap shows 2G
```

---

## Step 2 — Install Node.js, npm, PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
node -v && npm -v && pm2 -v   # verify
```

---

## Step 3 — Clone the Repository

```bash
cd ~
git clone https://github.com/dineshkwadhwani/dineshtrade.git
cd dineshtrade
git checkout multitanent_refactor
```

---

## Step 4 — Create `.env.local`

The automated setup script copies the tracked `.env.example` template to the
Git-ignored `.env.local` after cloning, then opens it for customer-specific
configuration before building or starting the server. Do not expect the private
`.env.local` file or real production secrets to come from Git.

```bash
nano ~/dineshtrade/.env.local
```

If editing manually instead of using the setup script, copy the template first:

```bash
cp ~/dineshtrade/.env.example ~/dineshtrade/.env.local
chmod 600 ~/dineshtrade/.env.local
```

Update these values for this customer's instance:

| Variable | Value for this server |
|---|---|
| `APP_BASE_URL` | `https://<subdomain>.dalgo.online` |
| `NEXT_PUBLIC_APP_URL` | `https://<subdomain>.dalgo.online` |
| `ZERODHA_ENVIRONMENT` | `PROD` |
| `CRON_ENABLED` | `true` |
| `CUSTOMER_IDS` | `<customer-uuid>` (from Supabase `profiles` table) |
| `STATE_FILE_PATH` | *(remove this line — use Supabase backend)* |
| `USE_MOCK_MARKET` | `false` |

**Critical — these MUST be identical across ALL servers (main + every subdomain):**
- `ENCRYPTION_KEY` — copy exact value from main server
- `SHARED_SSO_SECRET` — copy exact value from main server
- `NEXT_PUBLIC_SUPABASE_URL` — same Supabase project
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — same Supabase project
- `SUPABASE_SERVICE_KEY` — same Supabase project

Set `SESSION_SECRET` to a private random value of at least 32 characters. Set
`PROD_ZERODHA_ACCOUNT1` to the customer's account alias and populate the matching
`PROD_ZERODHA_API_KEY_<NAME>` and `PROD_ZERODHA_API_SECRET_<NAME>` with the
customer's production Kite app credentials.

Verify the Supabase keys loaded correctly:
```bash
node -e "require('dotenv').config({path:'.env.local'}); console.log(process.env.NEXT_PUBLIC_SUPABASE_URL)"
# Should print: https://<your-project>.supabase.co
```

---

## Step 5 — Build and Start with PM2

```bash
cd ~/dineshtrade
npm ci
NODE_ENV=production NODE_OPTIONS="--max-old-space-size=2048" npm run build
pm2 start npm --name dineshtrade -- start
pm2 save
pm2 startup   # copy and run the printed command to enable auto-start on reboot
sudo reboot   # reboot to confirm PM2 restarts automatically
```

Verify the app is running:
```bash
pm2 status
curl http://localhost:3000   # should return HTML
```

---

## Step 6 — Install and Configure Nginx

```bash
sudo apt install nginx -y
sudo nano /etc/nginx/sites-available/<subdomain>
```

Paste:
```nginx
server {
    server_name <subdomain>.dalgo.online;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    listen 80;
    listen [::]:80;
}
```

Enable and reload:
```bash
sudo ln -s /etc/nginx/sites-available/<subdomain> /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

---

## Step 7 — SSL Certificate (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d <subdomain>.dalgo.online
# Certbot auto-modifies nginx config for HTTPS and sets up auto-renewal
sudo nginx -t && sudo systemctl reload nginx
```

Verify HTTPS works:
```bash
curl -I https://<subdomain>.dalgo.online
```

---

## Step 8 — EC2 Security Group

In AWS Console → EC2 → instance → Security Groups → Inbound rules, ensure these ports are open:

| Type | Port | Source |
|---|---|---|
| SSH | 22 | Your IP |
| HTTP | 80 | 0.0.0.0/0 |
| HTTPS | 443 | 0.0.0.0/0 |

---

## Step 9 — Supabase Configuration

Do these once per new subdomain in the **Supabase Dashboard**:

### Authentication → URL Configuration → Redirect URLs
Add:
```
https://dalgo.online/auth/reset-password
https://<subdomain>.dalgo.online
https://<subdomain>.dalgo.online/auth/reset-password
http://localhost:3000/auth/reset-password
```

### Authentication → Email Templates → Reset Password
Ensure the action URL in the template is:
```
{{ .ConfirmationURL }}
```
The app requests redirects to `/auth/reset-password`; keep the Supabase Site URL set to `https://dalgo.online` so recovery returns to the main auth server. The generated confirmation URL must be used so Supabase can validate the recovery token before redirecting.

---

## Step 10 — Zerodha Developer Console

Each customer's Zerodha API app must have its redirect/callback URL set to their subdomain:

```
https://<subdomain>.dalgo.online/api/dalgo/setup/kite-callback
```

This is done in the customer's Zerodha developer account, not in this codebase.

---

## Step 11 — Deploy Script (`deploybranch.sh`)

Create this on the server for future deployments:

```bash
nano ~/deploybranch.sh
chmod +x ~/deploybranch.sh
```

```bash
#!/bin/bash
set -e

cd ~/dineshtrade

echo "1/5 Pulling latest from GitHub..."
git checkout multitanent_refactor
git pull origin multitanent_refactor

echo "2/5 Checking dependencies..."
if git diff HEAD~1 package-lock.json > /dev/null 2>&1 || [ ! -d node_modules ]; then
  npm ci
else
  echo "  → No dependency changes, skipping npm ci"
fi

echo "3/5 Cleaning previous build..."
rm -rf .next

echo "4/5 Building production bundle..."
NODE_ENV=production NODE_OPTIONS="--max-old-space-size=2048" npm run build

echo "5/5 Restarting PM2 process..."
pm2 restart dineshtrade --update-env
```

---

## Step 12 — Customer Onboarding in Supabase

After the server is up, set up the customer's record in Supabase:

1. **Create Supabase Auth user**: Authentication → Users → Add user (email + password)
2. **Set profile**: In `profiles` table, ensure a row exists with:
   - `id` = the Auth user's UID
   - `role` = `customer`
   - `status` = `identity_verified` (or `active` if already set up)
   - `subdomain` = `<subdomain>` (e.g. `narendra`)
3. **First login**: Customer logs in at `https://dalgo.online/login`
4. **SSO redirect**: After login, automatically redirected to `https://<subdomain>.dalgo.online`
5. **Broker setup**: Customer connects Zerodha from Settings → Connection
6. **Reset positions**: Admin runs reset from the Admin panel to seed positions from Zerodha

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Build killed during `git pull` | OOM — insufficient RAM | Add swap (Step 1) |
| `Invalid API key` in PM2 logs | Wrong/truncated Supabase keys in `.env.local` | Re-paste keys from Supabase dashboard |
| Login gives "Invalid email or password" | Supabase keys wrong or line-wrapped | Check key lengths match main server |
| LTP = Avg price on Holdings | `ENCRYPTION_KEY` mismatch — can't decrypt broker token | Copy exact key from main server |
| Strategies all show "accumulator" | Post-reset default (expected) | Re-tag via Holdings page strategy pill |
| Password reset email goes to homepage | Email template not updated in Supabase | Set action URL to `{{ .SiteURL }}/auth/reset-password` |
| Unauthenticated user sees login form on subdomain | Old code | Deploy latest — middleware now redirects to `dalgo.online/login` |

---

*Generated: 2026-08-16 | Branch: multitanent_refactor*
