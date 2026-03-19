/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SlashCommandActionReturn,
  CommandContext,
  SlashCommand,
} from './types.js';
import { CommandKind } from './types.js';
import { chatResumeSubCommands } from './chatCommand.js';
import {
  convertSessionToClientHistory,
  uiTelemetryService,
} from '@google/gemini-cli-core';
import {
  convertSessionToHistoryFormats,
  SessionSelector,
} from '../../utils/sessionUtils.js';

export const resumeCommand: SlashCommand = {
  name: 'resume',
  altNames: ['history'],
  description: 'Browse auto-saved conversations and manage chat checkpoints',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    const trimmedArgs = args.trim();

    if (trimmedArgs) {
      const { config } = context.services;
      if (!config) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Configuration service not available.',
        };
      }

      try {
        const sessionSelector = new SessionSelector(config);
        const { sessionData } =
          await sessionSelector.resolveSession(trimmedArgs);

        // Use the old session's ID to continue it.
        config.setSessionId(sessionData.sessionId);
        uiTelemetryService.hydrate(sessionData);

        const historyData = convertSessionToHistoryFormats(
          sessionData.messages,
        );
        const clientHistory = convertSessionToClientHistory(
          sessionData.messages,
        );

        return {
          type: 'load_history',
          history: historyData.uiHistory,
          clientHistory,
        };
      } catch (error) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to resume session "${trimmedArgs}": ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    return {
      type: 'dialog',
      dialog: 'sessionBrowser',
    };
  },
  subCommands: chatResumeSubCommands,
};
