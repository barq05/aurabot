'use strict';
/*
 * AURABOT Discord bot (discord.js v14).
 *
 * What it does:
 *  - Goes online with a status, so members see the bot is alive.
 *  - On start, prints a setup report: is the bot in your server? what are the role IDs
 *    (copy them into ADMIN_ROLE_IDS)? can it post in the notification channel?
 *
 * How it relates to the website: the website backend does NOT need this process to be running for
 * dashboard login. It checks roles by calling Discord's REST API with the same BOT TOKEN, so the
 * bot only has to be a MEMBER of your server. Run this file if you want the bot visible/online and
 * the setup report:   npm install && npm run bot
 */
const config = require('../server/config');
const { Client, GatewayIntentBits, ActivityType, Events, PermissionFlagsBits } = require('discord.js');

const d = config.discord;
if (!d.botToken) { console.error('❌ DISCORD_BOT_TOKEN is empty (.env)'); process.exit(1); }

const client = new Client({ intents: [GatewayIntentBits.Guilds] }); // no privileged intents needed

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  c.user.setPresence({ status: 'online', activities: [{ name: 'AURABOT • بوتات ديسكورد', type: ActivityType.Watching }] });

  const guild = c.guilds.cache.get(d.guildId);
  if (!guild) {
    console.error(`❌ The bot is not in the server with ID "${d.guildId}". Invite it first (see README) and check DISCORD_GUILD_ID.`);
    return;
  }
  console.log(`✅ Server: ${guild.name}`);

  const roles = (await guild.roles.fetch()).filter((r) => r.name !== '@everyone').sort((a, b) => b.position - a.position);
  console.log('\nRoles in your server (copy the IDs you want into ADMIN_ROLE_IDS):');
  for (const r of roles.values()) console.log(`  ${d.adminRoleIds.includes(r.id) ? '✔ ALLOWED ' : '          '}${r.id}  ${r.name}`);
  const missing = d.adminRoleIds.filter((id) => !roles.has(id));
  if (missing.length) console.warn(`\n⚠️  ADMIN_ROLE_IDS contains IDs that are not roles of this server: ${missing.join(', ')}`);
  if (!d.adminRoleIds.length) console.warn('\n⚠️  ADMIN_ROLE_IDS is empty: nobody will be able to log in to the dashboard.');

  if (d.notifyChannelId) {
    const ch = await guild.channels.fetch(d.notifyChannelId).catch(() => null);
    const perms = ch && ch.permissionsFor(c.user);
    if (!ch) console.warn(`\n⚠️  NOTIFY_CHANNEL_ID ${d.notifyChannelId} not found in this server.`);
    else if (!perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) console.warn(`\n⚠️  The bot can't send messages in #${ch.name}. Give it "View Channel" + "Send Messages" there.`);
    else console.log(`\n✅ Notifications will be posted in #${ch.name}`);
  }
});

client.on(Events.Error, (e) => console.error('[discord]', e.message));
process.on('SIGINT', () => { client.destroy(); process.exit(0); });
client.login(d.botToken).catch((e) => { console.error('❌ Login failed (wrong DISCORD_BOT_TOKEN?):', e.message); process.exit(1); });
