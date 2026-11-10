'use strict';
// Talks to the Discord REST API. Secrets (client secret, bot token) are used ONLY here, on the server.
const config = require('./config');

const API = 'https://discord.com/api/v10';
const d = config.discord;
const SNOWFLAKE = /^\d{5,25}$/;

async function call(url, opts = {}) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
}

function authorizeUrl(state) {
  const p = new URLSearchParams({
    client_id: d.clientId,
    response_type: 'code',
    redirect_uri: d.redirectUri,
    scope: 'identify', // we only need to know WHO they are; membership/roles come from the bot below
    state,
  });
  return `https://discord.com/oauth2/authorize?${p}`;
}

async function exchangeCode(code) {
  const r = await call(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: d.clientId,
      client_secret: d.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: d.redirectUri,
    }),
  });
  if (!r.ok) throw new Error(`token exchange failed (${r.status})`);
  return r.json();
}

async function fetchUser(accessToken) {
  const r = await call(`${API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`user lookup failed (${r.status})`);
  return r.json();
}

// We don't need the user's token after we know their ID, so we revoke it right away.
async function revoke(accessToken) {
  await call(`${API}/oauth2/token/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: d.clientId, client_secret: d.clientSecret, token: accessToken }),
  });
}

// Asks Discord (as the BOT) for the member's roles in YOUR server. Returns null if not a member.
async function fetchMember(userId) {
  if (!SNOWFLAKE.test(String(userId))) throw new Error('bad user id');
  const r = await call(`${API}/guilds/${d.guildId}/members/${userId}`, { headers: { Authorization: `Bot ${d.botToken}` } });
  if (r.status === 404) {
    const body = await r.json().catch(() => ({}));
    if (body.code === 10007) return null; // Unknown Member
    throw new Error(`guild lookup failed: ${body.message || r.status} (is the bot in the server? is GUILD_ID right?)`);
  }
  if (!r.ok) throw new Error(`member lookup failed (${r.status})`);
  return r.json();
}

const hasAdminRole = (member) => Array.isArray(member?.roles) && member.roles.some((id) => d.adminRoleIds.includes(id));

function avatarUrl(user) {
  return user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null;
}

// Optional: announce new orders/tickets in a staff channel. Never blocks or breaks the request.
function notify(text) {
  if (!d.botToken || !d.notifyChannelId || !SNOWFLAKE.test(d.notifyChannelId)) return;
  call(`${API}/channels/${d.notifyChannelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${d.botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: String(text).slice(0, 1900), allowed_mentions: { parse: [] } }),
  }).catch((e) => console.warn('[notify] failed:', e.message));
}

module.exports = { authorizeUrl, exchangeCode, fetchUser, revoke, fetchMember, hasAdminRole, avatarUrl, notify };
