import { FunctionCall } from '../state';
import { FunctionResponseScheduling } from '@google/genai';

export const whatsappTools: FunctionCall[] = [
  {
    name: 'send_whatsapp_message',
    description: 'Sends a WhatsApp message to a specific phone number using the connected user\'s WhatsApp account. Use this when the user asks to send a message, reply to a chat, or communicate via WhatsApp.',
    parameters: {
      type: 'OBJECT',
      properties: {
        phone: {
          type: 'STRING',
          description: 'The recipient phone number in international format (e.g., "62812345678").',
        },
        text: {
          type: 'STRING',
          description: 'The message content to send.',
        },
      },
      required: ['phone', 'text'],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: 'connect_whatsapp',
    description: 'Opens the WhatsApp connection interface so the user can link their personal or business WhatsApp account via QR code. Use when the user wants to set up or connect WhatsApp for the first time.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: 'check_whatsapp_messages',
    description: 'Checks for recent WhatsApp messages and conversation history for the connected user from the local database. Use when the user asks "check my WhatsApp", "any new messages", or "what was the last thing said".',
    parameters: {
      type: 'OBJECT',
      properties: {
        limit: {
          type: 'NUMBER',
          description: 'Maximum number of recent messages to retrieve. Default is 10.',
        },
      },
      required: [],
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: 'disconnect_whatsapp',
    description: 'Disconnects the user\'s WhatsApp account from Beatrice. Use only when the user explicitly asks to disconnect or unlink WhatsApp.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
  {
    name: 'check_whatsapp_status',
    description: 'Checks the current WhatsApp connection status, including whether the device is paired and ready. Use when the user asks "is WhatsApp connected" or "check my WhatsApp status".',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
    isEnabled: true,
    scheduling: FunctionResponseScheduling.INTERRUPT,
  },
];
