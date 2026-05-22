/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { FunctionCall } from '../state';
import { FunctionResponseScheduling } from '@google/genai';

export const personalAssistantTools: FunctionCall[] = [
  {
    name: 'create_calendar_event',
    description: 'Creates a new event in the user\'s calendar.',
    parameters: {
      type: 'OBJECT',
      properties: {
        summary: {
          type: 'STRING',
          description: 'The title or summary of the event.',
        },
        location: {
          type: 'STRING',
          description: 'The location of the event.',
        },
        startTime: {
          type: 'STRING',
          description: 'The start time of the event in ISO 8601 format.',
        },
        endTime: {
          type: 'STRING',
          description: 'The end time of the event in ISO 8601 format.',
        },
      },
      required: ['summary', 'startTime', 'endTime'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: 'send_email',
    description: 'Sends an email to a specified recipient.',
    parameters: {
      type: 'OBJECT',
      properties: {
        recipient: {
          type: 'STRING',
          description: 'The email address of the recipient.',
        },
        subject: {
          type: 'STRING',
          description: 'The subject line of the email.',
        },
        body: {
          type: 'STRING',
          description: 'The body content of the email.',
        },
      },
      required: ['recipient', 'subject', 'body'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: 'set_reminder',
    description: 'Sets a reminder for the user.',
    parameters: {
      type: 'OBJECT',
      properties: {
        task: {
          type: 'STRING',
          description: 'The task for the reminder.',
        },
        time: {
          type: 'STRING',
          description: 'The time for the reminder in ISO 8601 format.',
        },
      },
      required: ['task', 'time'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: 'recall_memory',
    description: 'Searches through long-term semantic memory to recall past conversations, specific details, or learned preferences about the Boss. Use this whenever the Boss asks about something previously discussed or when you need context from the past.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'The semantic search query (e.g., "what did we say about the project deadline?").',
        },
      },
      required: ['query'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: 'show_secondary_ui',
    description: 'Reveals the secondary dashboard interface with buttons, settings, and activity logs. Use this ONLY when the user explicitly asks to "show the buttons", "show overview", or "what can you do".',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: 'manage_camera',
    description: 'Controls the user\'s camera interface. Use this when the user says "open my camera", "flip camera", or "close camera".',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['open', 'flip', 'close'],
          description: 'The camera action to perform.',
        },
      },
      required: ['action'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
];
