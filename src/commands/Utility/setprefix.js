import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { getGuildConfig, setConfigValue } from '../../services/guildConfig.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('setprefix')
        .setDescription('Change the bot prefix for this server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addStringOption(option =>
            option
                .setName('prefix')
                .setDescription('New prefix (1-5 characters)')
                .setRequired(true)
                .setMaxLength(5)
        ),

    async execute(interaction, config, client) {
        try {
            // Check permissions
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return await InteractionHelper.safeReply(interaction, {
                    embeds: [errorEmbed('❌ Missing Permissions', 'You need the **Manage Server** permission to change the prefix.')],
                    flags: MessageFlags.Ephemeral,
                });
            }

            const newPrefix = interaction.options.getString('prefix').trim();

            // Validate prefix
            if (newPrefix.length === 0 || newPrefix.length > 5) {
                return await InteractionHelper.safeReply(interaction, {
                    embeds: [errorEmbed('❌ Invalid Prefix', 'Prefix must be between 1 and 5 characters long.')],
                    flags: MessageFlags.Ephemeral,
                });
            }

            // Check for invalid characters
            if (!/^[!@#$%^&*.,;:?/\\[\]\-_+=~`|<>]+$/.test(newPrefix)) {
                return await InteractionHelper.safeReply(interaction, {
                    embeds: [errorEmbed('❌ Invalid Characters', 'Prefix can only contain special characters like: `! $ % ^ & * , . ; : ? / - _ + = ~`')],
                    flags: MessageFlags.Ephemeral,
                });
            }

            // Update the prefix in the database
            await setConfigValue(client, interaction.guildId, 'prefix', newPrefix);

            logger.info(`Prefix changed to "${newPrefix}" for guild ${interaction.guildId} by ${interaction.user.tag}`);

            // Confirm change
            await InteractionHelper.safeReply(interaction, {
                embeds: [successEmbed(
                    '✅ Prefix Updated',
                    `The server prefix has been changed to **\`${newPrefix}\`**\n\n` +
                    `Users can now type **\`${newPrefix}help\`** to view commands.`
                )],
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            logger.error('Error in setprefix command:', error);
            await InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('❌ Error', 'Failed to update the prefix. Please try again later.')],
                flags: MessageFlags.Ephemeral,
            });
        }
    },

    // Support for prefix commands too
    executePrefixCommand: async (message, args, client) => {
        try {
            // Check permissions
            if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
                return await message.reply('❌ You need the **Manage Server** permission to change the prefix.');
            }

            if (args.length === 0) {
                return await message.reply('❌ Please provide a new prefix. Example: `!setprefix $`');
            }

            const newPrefix = args.join(' ').trim();

            // Validate prefix
            if (newPrefix.length === 0 || newPrefix.length > 5) {
                return await message.reply('❌ Prefix must be between 1 and 5 characters long.');
            }

            // Check for invalid characters
            if (!/^[!@#$%^&*.,;:?/\\[\]\-_+=~`|<>]+$/.test(newPrefix)) {
                return await message.reply('❌ Prefix can only contain special characters.');
            }

            // Update the prefix
            await setConfigValue(client, message.guildId, 'prefix', newPrefix);

            logger.info(`Prefix changed to "${newPrefix}" for guild ${message.guildId} by ${message.author.tag}`);

            await message.reply(`✅ Prefix has been changed to **\`${newPrefix}\`**`);
        } catch (error) {
            logger.error('Error in setprefix prefix command:', error);
            await message.reply('❌ Failed to update the prefix.').catch(() => {});
        }
    }
};
