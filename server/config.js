'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');

// Tiny .env loader (no dependency). Real environment variables always win over the file.
(function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();

const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const dataDir = path.resolve(ROOT, process.env.DATA_DIR || 'data');
fs.mkdirSync(dataDir, { recursive: true });

// The secret is used to hash session tokens. If none is configured we create one once and keep it,
// otherwise every restart would log all customers out.
let sessionSecret = process.env.SESSION_SECRET || '';
if (!sessionSecret) {
  const f = path.join(dataDir, '.secret');
  if (fs.existsSync(f)) sessionSecret = fs.readFileSync(f, 'utf8').trim();
  if (!sessionSecret) {
    sessionSecret = crypto.randomBytes(48).toString('base64url');
    fs.writeFileSync(f, sessionSecret, { mode: 0o600 });
  }
}

const discord = {
  clientId: process.env.DISCORD_CLIENT_ID || '',
  clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
  botToken: process.env.DISCORD_BOT_TOKEN || '',
  guildId: process.env.DISCORD_GUILD_ID || '',
  adminRoleIds: list(process.env.ADMIN_ROLE_IDS),
  notifyChannelId: process.env.NOTIFY_CHANNEL_ID || '',
  redirectUri: `${baseUrl}/api/admin/auth/callback`,
};
discord.ready = !!(discord.clientId && discord.clientSecret && discord.botToken && discord.guildId && discord.adminRoleIds.length);

module.exports = {
  ROOT,
  port: Number(process.env.PORT) || 3000,
  baseUrl,
  origin: new URL(baseUrl).origin,
  secureCookies: baseUrl.startsWith('https://'),
  trustProxy: String(process.env.TRUST_PROXY).toLowerCase() === 'true',
  dataDir,
  sessionSecret,
  discord,
};
