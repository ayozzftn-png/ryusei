#!/usr/bin/env node

/**
 * Automated Prefix Command Support Converter
 * 
 * This script scans all command files and adds executePrefixCommand support
 * to commands that don't already have it.
 * 
 * Usage: node scripts/add-prefix-support.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

const log = {
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  title: (msg) => console.log(`\n${colors.cyan}${msg}${colors.reset}\n`),
};

/**
 * Recursively get all .js files from a directory
 */
async function getAllFiles(dir, fileList = []) {
  const files = await fs.readdir(dir, { withFileTypes: true });
  
  for (const file of files) {
    const filePath = path.join(dir, file.name);
    
    if (file.isDirectory()) {
      if (file.name !== 'modules') {
        await getAllFiles(filePath, fileList);
      }
    } else if (file.name.endsWith('.js')) {
      fileList.push(filePath);
    }
  }
  
  return fileList;
}

/**
 * Check if a command file already has executePrefixCommand
 */
function hasExecutePrefixCommand(content) {
  return content.includes('executePrefixCommand');
}

/**
 * Extract the main execute function logic
 */
function extractExecuteLogic(content) {
  // Match the execute function
  const executeMatch = content.match(/async\s+execute\s*\([^)]*\)\s*\{([\s\S]*?)^\s*\},?\s*$/m);
  
  if (!executeMatch) {
    return null;
  }
  
  const executeBody = executeMatch[1];
  
  // Count opening and closing braces to find the complete function body
  let braceCount = 0;
  let endIndex = 0;
  
  for (let i = 0; i < executeBody.length; i++) {
    if (executeBody[i] === '{') braceCount++;
    if (executeBody[i] === '}') braceCount--;
    
    if (braceCount === -1) {
      endIndex = i;
      break;
    }
  }
  
  if (endIndex === 0) {
    return executeBody;
  }
  
  return executeBody.substring(0, endIndex);
}

/**
 * Check if command is slash-only (no prefix support recommended)
 */
function isSlashOnly(content) {
  return content.includes('slashOnly') || content.includes('setDMPermission(false)');
}

/**
 * Generate prefix command wrapper based on command type
 */
function generatePrefixWrapper(commandName, content, executeLogic) {
  // Check if it's an interaction-based command
  const isInteractionBased = content.includes('InteractionHelper.safeDefer') || 
                             content.includes('interaction.options.getSubcommand');
  
  // Check if it has subcommands
  const hasSubcommands = content.includes('getSubcommand()');
  
  // Simple commands that can be easily adapted
  if (!hasSubcommands && isInteractionBased) {
    return `
    executePrefixCommand: async (message, args, client) => {
        try {
            // Extract client from message for compatibility
            const interaction = { client: message.client, guildId: message.guildId };
            
            // Call the main execute logic adapted for message context
            // Note: This is a basic adapter. Complex commands may need manual adjustment.
            const response = await executeCommand(message, args, client);
            
            if (response && response.embeds) {
                await message.reply(response);
            }
        } catch (error) {
            logger.error('${commandName} prefix command error:', error);
            await message.reply('❌ An error occurred while executing this command.').catch(() => {});
        }
    }`;
  }
  
  // For complex commands with subcommands, suggest manual update
  return null;
}

/**
 * Add prefix support to a command file
 */
async function addPrefixSupport(filePath) {
  try {
    let content = await fs.readFile(filePath, 'utf-8');
    
    // Skip if already has prefix support
    if (hasExecutePrefixCommand(content)) {
      return { status: 'skipped', reason: 'Already has executePrefixCommand' };
    }
    
    // Skip slash-only commands
    if (isSlashOnly(content)) {
      return { status: 'skipped', reason: 'Slash-only command' };
    }
    
    // Find the export default object
    const exportMatch = content.match(/export\s+default\s+\{([\s\S]*)\};?$/);
    
    if (!exportMatch) {
      return { status: 'skipped', reason: 'Could not find export default' };
    }
    
    const objectContent = exportMatch[1];
    const endBrace = content.lastIndexOf('}');
    
    // Create a basic prefix wrapper
    const prefixWrapper = `
    executePrefixCommand: async (message, args, client) => {
        try {
            // Basic prefix command handler
            // For complex commands, manual adjustment may be needed
            const { logger } = await import('../../utils/logger.js');
            
            // Call execute with adapted parameters
            await module.exports.default.execute?.(message, args, client)?.catch(err => {
                logger.error('Prefix command error:', err);
                message.reply('❌ An error occurred.').catch(() => {});
            });
        } catch (error) {
            logger.error('Prefix wrapper error:', error);
            await message.reply('❌ An error occurred while executing this command.').catch(() => {});
        }
    }`;
    
    // Insert before the closing brace
    const updatedContent = content.slice(0, endBrace) + `,${prefixWrapper}\n`;
    const finalContent = updatedContent + content.slice(endBrace);
    
    // Write the updated file
    await fs.writeFile(filePath, finalContent, 'utf-8');
    
    return { status: 'updated', message: 'Added basic prefix support' };
  } catch (error) {
    return { status: 'error', reason: error.message };
  }
}

/**
 * Main execution
 */
async function main() {
  log.title('🤖 Prefix Command Support Converter');
  
  const commandsDir = path.join(__dirname, '../src/commands');
  
  log.info(`Scanning commands directory: ${commandsDir}`);
  
  // Get all command files
  const commandFiles = await getAllFiles(commandsDir);
  
  log.info(`Found ${commandFiles.length} command files to process\n`);
  
  let stats = {
    total: commandFiles.length,
    updated: 0,
    skipped: 0,
    errors: 0
  };
  
  // Process each command file
  for (const filePath of commandFiles) {
    const relPath = path.relative(commandsDir, filePath);
    const result = await addPrefixSupport(filePath);
    
    if (result.status === 'updated') {
      log.success(`${relPath}`);
      stats.updated++;
    } else if (result.status === 'skipped') {
      log.warn(`${relPath} - ${result.reason}`);
      stats.skipped++;
    } else if (result.status === 'error') {
      log.error(`${relPath} - ${result.reason}`);
      stats.errors++;
    }
  }
  
  // Print summary
  log.title('Summary');
  log.info(`Total files: ${stats.total}`);
  log.success(`Updated: ${stats.updated}`);
  log.warn(`Skipped: ${stats.skipped}`);
  log.error(`Errors: ${stats.errors}`);
  
  if (stats.errors === 0) {
    log.success('\n✓ All commands processed successfully!');
    log.info('Restart your bot to apply the changes.');
  }
}

main().catch(err => {
  log.error('Fatal error:', err.message);
  process.exit(1);
});

