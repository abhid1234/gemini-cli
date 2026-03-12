/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { thinkCommand } from './thinkCommand.js';
import { type CommandContext } from './types.js';
import { SettingScope } from '../../config/settings.js';

describe('thinkCommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = {
      services: {
        settings: {
          merged: {
            ui: {
              inlineThinkingMode: 'off',
            },
          },
          setValue: vi.fn(),
        },
      },
    } as unknown as CommandContext;
  });

  it('should toggle thinking mode to full when it is currently off', async () => {
    await thinkCommand.action(mockContext, '');

    expect(mockContext.services.settings.setValue).toHaveBeenCalledWith(
      SettingScope.User,
      'ui.inlineThinkingMode',
      'full',
    );
  });

  it('should toggle thinking mode to off when it is currently full', async () => {
    mockContext.services.settings.merged.ui.inlineThinkingMode = 'full';

    await thinkCommand.action(mockContext, '');

    expect(mockContext.services.settings.setValue).toHaveBeenCalledWith(
      SettingScope.User,
      'ui.inlineThinkingMode',
      'off',
    );
  });

  it('should set thinking mode to full explicitly', async () => {
    await thinkCommand.action(mockContext, 'full');

    expect(mockContext.services.settings.setValue).toHaveBeenCalledWith(
      SettingScope.User,
      'ui.inlineThinkingMode',
      'full',
    );
  });

  it('should set thinking mode to full with "on" argument', async () => {
    await thinkCommand.action(mockContext, 'on');

    expect(mockContext.services.settings.setValue).toHaveBeenCalledWith(
      SettingScope.User,
      'ui.inlineThinkingMode',
      'full',
    );
  });

  it('should set thinking mode to off explicitly', async () => {
    mockContext.services.settings.merged.ui.inlineThinkingMode = 'full';

    await thinkCommand.action(mockContext, 'off');

    expect(mockContext.services.settings.setValue).toHaveBeenCalledWith(
      SettingScope.User,
      'ui.inlineThinkingMode',
      'off',
    );
  });
});
