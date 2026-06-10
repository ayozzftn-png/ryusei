import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getLevelingConfig, getUserLevelData } from '../services/leveling.js';
import { addXp } from '../services/xpSystem.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { getGuildConfig } from '../services/guildConfig.js';

const MESSAGE_XP_RATE_LIMIT_ATTEMPTS = 12;
const MESSAGE_XP_RATE_LIMIT_WINDOW_MS = 10000;

export default {
  name: Events.MessageCreate,
  async execute(message, client) {
    try {
      // Ignore bot messages and DMs
      if (message.author.bot || !message.guild) return;

      // Handle prefix commands
      await handlePrefixCommands(message, client);

      // Handle leveling
      await handleLeveling(message, client);
    } catch (error) {
      logger.error('Error in messageCreate event:', error);
    }
  }
};

/**
 * Handle prefix-based commands
 */
async function handlePrefixCommands(message, client) {
  try {
    // Get the guild's prefix setting
    const guildConfig = await getGuildConfig(client, message.guildId);
    const prefix = guildConfig.prefix || client.config?.bot?.prefix || '!';

    // Check if message starts with prefix
    if (!message.content.startsWith(prefix)) {
      return;
    }

    // Parse command and arguments
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift()?.toLowerCase();

    if (!commandName) return;

    // Find the command
    const command = client.commands.get(commandName) || 
                   client.commands.find(cmd => cmd.aliases && cmd.aliases.includes(commandName));

    if (!command) {
      // Optionally respond to unknown commands
      // await message.reply('❌ Command not found!');
      return;
    }

    // Check if command is slash-only (skip prefix execution)
    if (command.slashOnly) {
      await message.reply('❌ This command only works as a slash command. Use `/' + commandName + '`');
      return;
    }

    // Handle cooldowns
    if (!client.cooldowns) {
      client.cooldowns = new Map();
    }

    const now = Date.now();
    const cooldownAmount = (command.cooldown || 3) * 1000;
    const userCooldownKey = `${commandName}-${message.author.id}`;

    if (client.cooldowns.has(userCooldownKey)) {
      const expirationTime = client.cooldowns.get(userCooldownKey) + cooldownAmount;
      if (now < expirationTime) {
        const timeLeft = (expirationTime - now) / 1000;
        await message.reply(`⏳ Please wait ${timeLeft.toFixed(1)}s before using this command again.`);
        return;
      }
    }

    client.cooldowns.set(userCooldownKey, now);
    setTimeout(() => client.cooldowns.delete(userCooldownKey), cooldownAmount);

    // Execute the command
    try {
      logger.info(`Executing prefix command: ${commandName} by ${message.author.tag}`);
      
      // Check if command has a prefix execute method
      if (command.executePrefixCommand) {
        await command.executePrefixCommand(message, args, client);
      } else if (command.execute) {
        // Fallback to regular execute (might not work for slash commands)
        await command.execute(message, args, client);
      } else {
        await message.reply('❌ This command does not support prefix usage.');
      }
    } catch (error) {
      logger.error(`Error executing prefix command ${commandName}:`, error);
      await message.reply('❌ An error occurred while executing this command.').catch(() => {});
    }
  } catch (error) {
    logger.error('Error in handlePrefixCommands:', error);
  }
}

/**
 * Handle leveling system
 */
async function handleLeveling(message, client) {
  try {
    const rateLimitKey = `xp-event:${message.guild.id}:${message.author.id}`;
    const canProcess = await checkRateLimit(rateLimitKey, MESSAGE_XP_RATE_LIMIT_ATTEMPTS, MESSAGE_XP_RATE_LIMIT_WINDOW_MS);
    if (!canProcess) {
      return;
    }

    const levelingConfig = await getLevelingConfig(client, message.guild.id);
    
    if (!levelingConfig?.enabled) {
      return;
    }

    // Ignore specified channels
    if (levelingConfig.ignoredChannels?.includes(message.channel.id)) {
      return;
    }

    // Ignore specified roles
    if (levelingConfig.ignoredRoles?.length > 0) {
      const member = await message.guild.members.fetch(message.author.id).catch(() => {
        return null;
      });
      if (member && member.roles.cache.some(role => levelingConfig.ignoredRoles.includes(role.id))) {
        return;
      }
    }

    // Ignore blacklisted users
    if (levelingConfig.blacklistedUsers?.includes(message.author.id)) {
      return;
    }

    // Ignore empty messages
    if (!message.content || message.content.trim().length === 0) {
      return;
    }

    const userData = await getUserLevelData(client, message.guild.id, message.author.id);
    
    // Check cooldown before giving XP
    const cooldownTime = levelingConfig.xpCooldown || 60;
    const now = Date.now();
    const timeSinceLastMessage = now - (userData.lastMessage || 0);
    
    // If message is too recent, skip XP gain
    if (timeSinceLastMessage < cooldownTime * 1000) {
      return;
    }

    // Calculate XP to give
    const minXP = levelingConfig.xpRange?.min || levelingConfig.xpPerMessage?.min || 15;
    const maxXP = levelingConfig.xpRange?.max || levelingConfig.xpPerMessage?.max || 25;

    // Ensure valid range
    const safeMinXP = Math.max(1, minXP);
    const safeMaxXP = Math.max(safeMinXP, maxXP);

    // Give random XP within range
    const xpToGive = Math.floor(Math.random() * (safeMaxXP - safeMinXP + 1)) + safeMinXP;

    // Apply multiplier if set
    let finalXP = xpToGive;
    if (levelingConfig.xpMultiplier && levelingConfig.xpMultiplier > 1) {
      finalXP = Math.floor(finalXP * levelingConfig.xpMultiplier);
    }

    // Add XP and check for level up
    const result = await addXp(client, message.guild, message.member, finalXP);
    
    if (result.success && result.leveledUp) {
      logger.info(
        `${message.author.tag} leveled up to level ${result.level} in ${message.guild.name}`
      );
    }
  } catch (error) {
    logger.error('Error handling leveling for message:', error);
  }
}
