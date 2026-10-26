#!/usr/bin/env bash
set -Eeuo pipefail

trap 'status=$?; printf "\n[ERROR] Setup stopped near line %s (exit %s).\n" "$LINENO" "$status" >&2; exit "$status"' ERR

readonly REPO_URL="https://github.com/dineshkwadhwani/dineshtrade.git"
readonly BRANCH="multitanent_refactor"
readonly APP_DIR="${HOME}/dineshtrade"
readonly ENV_FILE="${APP_DIR}/.env.local"

fail() {
  printf '[ERROR] %s\n' "$1" >&2
  exit 1
}

confirm() {
  local answer
  read -r -p "$1 [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" ]] || fail "Stopped because confirmation was not given."
}

step() {
  printf '\n[%s] %s\n' "$1" "$2"
}

[[ "$EUID" -ne 0 ]] || fail "Run this script as the ubuntu user, not with sudo."
[[ "$#" -eq 0 ]] || fail "Run without arguments; the script will prompt for the customer subdomain."
[[ -t 0 ]] || fail "Run this script in an interactive SSH terminal."

printf '%s\n' "DAlgo server setup for Ubuntu 24.04"
read -r -p "Customer subdomain (lowercase, for example: isha): " SUBDOMAIN
[[ "$SUBDOMAIN" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || \
  fail "Use a lowercase subdomain containing only letters, numbers, and interior hyphens."
readonly SUBDOMAIN
readonly DOMAIN="${SUBDOMAIN}.dalgo.online"

[[ -r /etc/os-release ]] || fail "Cannot identify the operating system."
# shellcheck source=/etc/os-release
source /etc/os-release
[[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "24.04" ]] || \
  fail "This script expects Ubuntu 24.04 LTS."

read -r -p "Email address for Let's Encrypt certificate notices: " CERT_EMAIL
[[ "$CERT_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || \
  fail "Enter a valid email address."

printf '\nThis script will configure %s on this EC2 instance.\n' "$DOMAIN"
printf '%s\n' \
  "- Before continuing, point the DNS A record to this instance's Elastic IP." \
  "- In the EC2 security group, allow inbound TCP 80 and 443 from 0.0.0.0/0." \
  "- The SSH rule should remain restricted to your IP." \
  "- The GitHub repository must be accessible to this server."
confirm "Are DNS and the security group ready?"

step "1/8" "Installing Ubuntu packages and Node.js 20"
sudo -v
sudo apt-get update
sudo apt-get install -y ca-certificates curl git gnupg nginx certbot \
  python3-certbot-nginx nano
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install --global pm2
printf 'Node: %s | npm: %s | PM2: %s\n' \
  "$(node --version)" "$(npm --version)" "$(pm2 --version | tail -n 1)"

step "2/8" "Configuring 2 GiB swap"
if sudo swapon --show=NAME --noheadings | grep -Fxq /swapfile; then
  printf '%s\n' "Swap file is already active."
else
  if [[ ! -e /swapfile ]]; then
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
  fi
  sudo swapon /swapfile
fi
if ! grep -Eq '^[[:space:]]*/swapfile[[:space:]]' /etc/fstab; then
  printf '%s\n' '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
free -h

step "3/8" "Cloning the application branch"
if [[ -d "${APP_DIR}/.git" ]]; then
  [[ -z "$(git -C "$APP_DIR" status --porcelain)" ]] || \
    fail "${APP_DIR} has uncommitted tracked changes; resolve them before setup."
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
elif [[ -e "$APP_DIR" ]]; then
  fail "${APP_DIR} exists but is not a Git repository; move it aside before setup."
else
  git clone --single-branch --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

step "4/8" "Checking production environment configuration"
if [[ ! -f "$ENV_FILE" ]]; then
  [[ -f "${APP_DIR}/.env.example" ]] || fail "The cloned repository has no .env.example template."
  cp "${APP_DIR}/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  printf '%s\n' "Created .env.local from the repository's .env.example template."
else
  cat <<EOF
An existing .env.local was found and will be preserved. Review its values for
this customer; the setup script will not replace it with the example template.
EOF
fi

cat <<EOF
Before the build or app startup, edit ${ENV_FILE} and replace the template values:
  - APP_BASE_URL and NEXT_PUBLIC_APP_URL: https://${DOMAIN}
  - USE_MOCK_MARKET: false
  - CUSTOMER_IDS: this customer's Supabase profiles UUID
  - NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_KEY: production Supabase project values
  - ENCRYPTION_KEY and SHARED_SSO_SECRET: copy exactly from the main server
  - SESSION_SECRET: a private random value of at least 32 characters
  - PROD_ZERODHA_ACCOUNT1 and its PROD_ZERODHA_API_KEY_<NAME> /
    PROD_ZERODHA_API_SECRET_<NAME>: this customer's production Kite app values
  - ZERODHA_ENVIRONMENT=PROD and CRON_ENABLED=true

The .env.example file is only a template; .env.local is ignored by Git and is
not downloaded by cloning the repository. Do not paste secrets into chat or
commit the .env.local file.
EOF
nano "$ENV_FILE"
[[ -f "$ENV_FILE" ]] || fail "The required .env.local file was not created."
chmod 600 "$ENV_FILE"
confirm "Did you save the customer-specific .env.local values in nano?"

step "5/8" "Installing dependencies and validating settings"
cd "$APP_DIR"
npm ci
node - "$DOMAIN" <<'NODE'
const fs = require('node:fs')
const dotenv = require('dotenv')

const env = dotenv.parse(fs.readFileSync('.env.local'))
const domain = process.argv[2]
const required = [
  'APP_BASE_URL',
  'NEXT_PUBLIC_APP_URL',
  'ZERODHA_ENVIRONMENT',
  'CRON_ENABLED',
  'CUSTOMER_IDS',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_KEY',
  'ENCRYPTION_KEY',
  'SHARED_SSO_SECRET',
  'SESSION_SECRET',
]
const missing = required.filter((key) => !env[key]?.trim())
const isPlaceholder = (value) =>
  /your[_ -]|primary-customer-uuid|secondary-customer-uuid|your-project|\.{3}/i.test(value)
const placeholders = required.filter((key) => env[key]?.trim() && isPlaceholder(env[key]))

if (missing.length) {
  console.error(`Missing or empty settings in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}
if (placeholders.length) {
  console.error(`Replace template placeholder values for: ${placeholders.join(', ')}`)
  process.exit(1)
}
if (env.APP_BASE_URL !== `https://${domain}` ||
    env.NEXT_PUBLIC_APP_URL !== `https://${domain}`) {
  console.error('APP_BASE_URL and NEXT_PUBLIC_APP_URL must both equal https://' + domain)
  process.exit(1)
}
if (env.ZERODHA_ENVIRONMENT !== 'PROD') {
  console.error('ZERODHA_ENVIRONMENT must be PROD for this server.')
  process.exit(1)
}
if (env.CRON_ENABLED !== 'true') {
  console.error('CRON_ENABLED must be exactly true to match the server setup guide.')
  process.exit(1)
}
if (env.STATE_FILE_PATH?.trim()) {
  console.error('Remove STATE_FILE_PATH; this setup uses the Supabase backend.')
  process.exit(1)
}
if (env.USE_MOCK_MARKET !== 'false') {
  console.error('Set USE_MOCK_MARKET=false for this production server.')
  process.exit(1)
}
if (env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters.')
  process.exit(1)
}
const customerIds = env.CUSTOMER_IDS.split(',').map((id) => id.trim()).filter(Boolean)
if (customerIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
  console.error('CUSTOMER_IDS must contain valid Supabase profile UUIDs.')
  process.exit(1)
}
let accountCount = 0
for (let index = 1; env[`PROD_ZERODHA_ACCOUNT${index}`]; index++) {
  const accountName = env[`PROD_ZERODHA_ACCOUNT${index}`].trim()
  if (!/^[A-Z0-9_]+$/.test(accountName)) {
    console.error(`Use an uppercase account alias for PROD_ZERODHA_ACCOUNT${index}.`)
    process.exit(1)
  }
  for (const key of [
    `PROD_ZERODHA_API_KEY_${accountName}`,
    `PROD_ZERODHA_API_SECRET_${accountName}`,
  ]) {
    if (!env[key]?.trim() || isPlaceholder(env[key])) {
      console.error(`Set a real production Zerodha credential for ${key}.`)
      process.exit(1)
    }
  }
  accountCount++
}
if (accountCount === 0) {
  console.error('Set PROD_ZERODHA_ACCOUNT1 and its matching production API key and secret.')
  process.exit(1)
}
console.log('Required settings are present; secret values were not displayed.')
NODE
confirm "CRON_ENABLED=true can start scheduled trading when the app launches. Are broker settings and the customer ID correct, and do you approve starting it?"

step "6/8" "Building the production application"
NODE_ENV=production NODE_OPTIONS="--max-old-space-size=2048" npm run build

step "7/8" "Starting the app with PM2 and configuring Nginx"
if pm2 describe dineshtrade >/dev/null 2>&1; then
  pm2 restart dineshtrade --update-env
else
  pm2 start npm --name dineshtrade -- start
fi
sudo env PATH="$PATH" "$(command -v pm2)" startup systemd -u "$USER" --hp "$HOME"
pm2 save

NGINX_AVAILABLE="/etc/nginx/sites-available/${DOMAIN}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"
if sudo test -e "$NGINX_AVAILABLE"; then
  sudo cp "$NGINX_AVAILABLE" "${NGINX_AVAILABLE}.backup.$(date +%Y%m%d%H%M%S)"
fi
sudo tee "$NGINX_AVAILABLE" >/dev/null <<EOF
server {
    server_name ${DOMAIN};

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }

    listen 80;
    listen [::]:80;
}
EOF
sudo ln -sfn "$NGINX_AVAILABLE" "$NGINX_ENABLED"
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

step "8/8" "Requesting HTTPS certificate and creating deploy helper"
sudo certbot --nginx --non-interactive --agree-tos --email "$CERT_EMAIL" \
  --redirect -d "$DOMAIN"
sudo nginx -t
sudo systemctl reload nginx

DEPLOY_SCRIPT="${HOME}/deploybranch.sh"
if [[ -e "$DEPLOY_SCRIPT" ]]; then
  cp "$DEPLOY_SCRIPT" "${DEPLOY_SCRIPT}.backup.$(date +%Y%m%d%H%M%S)"
fi
cat >"$DEPLOY_SCRIPT" <<'DEPLOY'
#!/usr/bin/env bash
set -Eeuo pipefail
cd "$HOME/dineshtrade"

branch="multitanent_refactor"
before="$(git rev-parse HEAD)"
git fetch origin "$branch"
git merge --ff-only FETCH_HEAD
after="$(git rev-parse HEAD)"

if git diff --quiet "$before" "$after" -- package-lock.json; then
  printf '%s\n' "Dependencies unchanged; skipping npm ci."
else
  npm ci
fi

rm -rf .next
NODE_ENV=production NODE_OPTIONS="--max-old-space-size=2048" npm run build
pm2 restart dineshtrade --update-env
DEPLOY
chmod 700 "$DEPLOY_SCRIPT"

printf '\nWaiting for the local app to respond'
for _ in {1..30}; do
  HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3000 || true)"
  if [[ "$HTTP_CODE" =~ ^[23][0-9][0-9]$ ]]; then
    printf '\nLocal app responded with HTTP %s.\n' "$HTTP_CODE"
    break
  fi
  printf '.'
  sleep 1
done
[[ "${HTTP_CODE:-}" =~ ^[23][0-9][0-9]$ ]] || {
  printf '\nPM2 did not get a successful response. Recent logs:\n' >&2
  pm2 logs dineshtrade --lines 60 --nostream >&2
  fail "Check the PM2 logs and .env.local before continuing."
}

pm2 status
curl -fsSI --max-time 20 "https://${DOMAIN}"
printf '\nSetup completed for https://%s\n' "$DOMAIN"
printf 'Deploy future changes with: %s\n' "$DEPLOY_SCRIPT"
cat <<EOF
Manual follow-up still required:
  1. Supabase: add https://${DOMAIN} and its /auth/reset-password URL to the
     Authentication redirect URLs. Keep the Site URL at https://dalgo.online
     and confirm the reset email template uses {{ .ConfirmationURL }}.
  2. Zerodha: set the callback URL to
     https://${DOMAIN}/api/dalgo/setup/kite-callback.
  3. Supabase: complete the customer's auth user and profiles row setup.
See Steps 9, 10, and 12 in the server setup guide for details.
EOF
