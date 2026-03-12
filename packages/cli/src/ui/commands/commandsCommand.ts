/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type CommandContext,
  type SlashCommand,
  type SlashCommandActionReturn,
  CommandKind,
} from './types.js';

/**
 * Action for `/commands list`.
 * Displays all currently registered slash commands.
 */
async function listAction(
  context: CommandContext,
): Promise<void | SlashCommandActionReturn> {
  const commands = context.ui.slashCommands;
  if (!commands || commands.length === 0) {
    return {
      type: 'message',
      messageType: 'info',
      content: 'No slash commands loaded.',
    };
  }

  const list = commands
    .map((cmd: SlashCommand) => `  - **/${cmd.name}**: ${cmd.description}`)
    .join('\n');

  return {
    type: 'message',
    messageType: 'info',
    content: `Available Slash Commands:\n\n${list}`,
  };
}

/**
 * Action for the default `/commands` invocation.
 */
async function defaultAction(
  _context: CommandContext,
  _args: string,
): Promise<void | SlashCommandActionReturn> {
  return {
    type: 'message',
    messageType: 'info',
    content: 'Usage: /commands [list|reload]',
  };
}

/**
 * Action for `/commands reload`.
 */
async function reloadAction(
  _context: CommandContext,
): Promise<void | SlashCommandActionReturn> {
  // TODO: Implement dynamic command reloading in this version
  /*
  appEvents.emit(AppEvent.ReloadRequested, {
    scope: 'commands',
  });
  */

  return {
    type: 'message',
    messageType: 'info',
    content: 'Reloading custom commands is not yet supported in this version.',
  };
}

export const commandsCommand: SlashCommand = {
  name: 'commands',
  description: 'Manage custom slash commands. Usage: /commands [list|reload]',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  subCommands: [
    {
      name: 'list',
      description: 'List all currently registered slash commands.',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: listAction,
    },
    {
      name: 'reload',
      altNames: ['refresh'],
      description: 'Reload custom command definitions from .toml files.',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: reloadAction,
    },
  ],
  action: defaultAction,
};
