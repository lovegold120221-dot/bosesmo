import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';

import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

// Initialize Gemini Client
const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Constants for production pathing
const IS_PROD = process.env.NODE_ENV === 'production';
const DIST_PATH = path.join(process.cwd(), 'dist');

// Initialize Firebase Admin lazily
let adminInitialized = false;
function getFirebaseAdmin() {
  if (!adminInitialized) {
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
    if (projectId) {
      try {
        admin.initializeApp({
          projectId: projectId,
        });
        adminInitialized = true;
        console.log('Firebase Admin initialized');
      } catch (e) {
        console.warn('Firebase Admin initialization failed:', e);
      }
    } else {
      console.warn('FIREBASE_PROJECT_ID not set, Firebase Admin not initialized');
    }
  }
  return admin;
}

let firestoreDb: any = null;
function getFirestoreDb() {
  if (!firestoreDb) {
    const adminApp = getFirebaseAdmin();
    let databaseId: string | undefined;
    try {
      const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        databaseId = config.firestoreDatabaseId;
      }
    } catch (err) {
      console.warn('Failed to parse firebase-applet-config.json:', err);
    }

    if (databaseId) {
      firestoreDb = getAdminFirestore(adminApp, databaseId);
    } else {
      firestoreDb = getAdminFirestore(adminApp);
    }
  }
  return firestoreDb;
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());

  // Auth Middleware
  const authenticateToken = async (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    try {
      const decodedToken = await getFirebaseAdmin().auth().verifyIdToken(token);
      req.user = decodedToken;
      next();
    } catch (error) {
      console.error('Auth error:', error);
      res.sendStatus(403);
    }
  };

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/avatar', (req, res) => {
    // Return Beatrice avatar URL or image
    res.redirect('https://ui-avatars.com/api/?name=Beatrice&background=cbfb45&color=000&size=200');
  });

  // Chat API using Gemini Flash Lite for non-live sessions
  app.post('/api/chat', authenticateToken, async (req: any, res) => {
    const { message, history } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    try {
      // Use gemini-3.1-flash-lite for text chat as requested
      const chat = genAI.chats.create({
        model: "gemini-3.1-flash-lite",
        config: {
          systemInstruction: "You are Beatrice, an Eburon AI assistant. You are warm, professional, and efficient. Speak in concise, human-like sentences. Emulate the persona of a trusted personal assistant.",
        },
        // In a real app we'd map history to the SDK's history format
      });

      const result = await chat.sendMessage({ message });
      res.json({ text: result.text });
    } catch (err: any) {
      console.error('Chat API Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Settings (Migrated to Firestore)
  app.get('/api/settings', authenticateToken, async (req: any, res) => {
    try {
      const firestore = getFirestoreDb();
      const doc = await firestore.collection('users').doc(req.user.uid).get();
      if (!doc.exists) {
        return res.json({
          persona_name: 'Beatrice',
          user_call_name: 'Boss',
          voice: 'Puck',
          language: 'English',
          system_prompt: 'Classic Beatrice behavior.'
        });
      }
      res.json(doc.data());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/settings', authenticateToken, async (req: any, res) => {
    try {
      const firestore = getFirestoreDb();
      await firestore.collection('users').doc(req.user.uid).set({
        ...req.body,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Memories (Migrated to Firestore)
  app.get('/api/memories', authenticateToken, async (req: any, res) => {
    try {
      const firestore = getFirestoreDb();
      const userDoc = await firestore.collection('users').doc(req.user.uid).get();
      const memories = userDoc.exists ? (userDoc.data()?.memories || []) : [];
      res.json(memories);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/memories', authenticateToken, async (req: any, res) => {
    try {
      const firestore = getFirestoreDb();
      const memoryContent = req.body.content || req.body.memory || '';
      const memoryType = req.body.type || 'personal';
      const memory = {
        id: Math.random().toString(36).substring(7),
        content: memoryContent,
        type: memoryType,
        created_at: new Date().toISOString()
      };
      
      await firestore.collection('users').doc(req.user.uid).update({
        memories: admin.firestore.FieldValue.arrayUnion(memory),
        updatedAt: new Date().toISOString()
      });

      // Also write to separate subcollection
      await firestore.collection('users').doc(req.user.uid).collection('memories').doc(memory.id).set({
        content: memory.content,
        type: memory.type,
        createdAt: memory.created_at,
        updatedAt: memory.created_at
      });

      res.status(201).json(memory);
    } catch (e: any) {
      // If user doc doesn't exist, create it
      if (e.code === 5 || e.message.includes('NOT_FOUND')) {
        const firestore = getFirestoreDb();
        const memoryContent = req.body.content || req.body.memory || '';
        const memoryType = req.body.type || 'personal';
        const memory = {
          id: Math.random().toString(36).substring(7),
          content: memoryContent,
          type: memoryType,
          created_at: new Date().toISOString()
        };
        
        await firestore.collection('users').doc(req.user.uid).set({
          memories: [memory],
          updatedAt: new Date().toISOString()
        });

        // Also write to separate subcollection
        await firestore.collection('users').doc(req.user.uid).collection('memories').doc(memory.id).set({
          content: memory.content,
          type: memory.type,
          createdAt: memory.created_at,
          updatedAt: memory.created_at
        });

        return res.status(201).json(memory);
      }
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/memories/:id', authenticateToken, async (req: any, res) => {
    try {
      const firestore = getFirestoreDb();
      const userDoc = await firestore.collection('users').doc(req.user.uid).get();
      if (!userDoc.exists) return res.sendStatus(404);
      
      const memories = userDoc.data()?.memories || [];
      const updatedMemories = memories.filter((m: any) => m.id !== req.params.id);
      
      await firestore.collection('users').doc(req.user.uid).update({
        memories: updatedMemories,
        updatedAt: new Date().toISOString()
      });

      // Also delete from separate subcollection
      try {
        await firestore.collection('users').doc(req.user.uid).collection('memories').doc(req.params.id).delete();
      } catch (subErr) {
        console.warn('Subcollection delete failed but array operation succeeded:', subErr);
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Search Proxy
  app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const cx = process.env.GOOGLE_SEARCH_ENGINE_ID;
    if (!apiKey || !cx) return res.json({ results: [`Google Search not configured on server.`] });
    
    try {
      const searchRes = await fetch(`https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(q as string)}`);
      const data = await searchRes.json();
      const results = data.items?.map((item: any) => `${item.title}: ${item.snippet} (${item.link})`) || [];
      res.json({ results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ==========================================
  // WhatsApp Multi-User Agentic Integration
  // ==========================================

  // Helper: resolve WhatsApp credentials for a specific user
  async function resolveUserWhatsAppCredentials(uid: string) {
    const firestore = getFirestoreDb();
    const userDoc = await firestore.collection('users').doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    const phoneNumberId = userData?.whatsappPhoneId || process.env.WHATSAPP_PHONE_NUMBER_ID || null;
    const businessAccountId = userData?.whatsappBusinessAccountId || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || null;
    const accessToken = userData?.whatsappAccessToken || process.env.WHATSAPP_ACCESS_TOKEN || null;
    const appSecret = userData?.whatsappAppSecret || process.env.WHATSAPP_APP_SECRET || null;

    return {
      phoneNumberId,
      businessAccountId,
      accessToken,
      appSecret,
      whatsappConnected: userData?.whatsappConnected || false,
      whatsappPhone: userData?.whatsappPhone || null,
      whatsappDisplayName: userData?.whatsappDisplayName || null,
      phoneRegistered: userData?.whatsappPhoneRegistered || false,
      webhookSubscribed: userData?.whatsappWebhookSubscribed || false,
      uid
    };
  }

  // Helper: create or fetch WhatsApp message QR code from Meta
  async function getOrCreateQRCode(phoneNumberId: string, accessToken: string, prefilledMessage: string = 'Hi! I would like to connect with Beatrice.') {
    try {
      const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/message_qrdls`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prefilled_message: prefilledMessage,
          generate_qr_image: 'PNG'
        })
      });
      const result = await response.json();
      return result;
    } catch (err) {
      console.error('QR code creation failed:', err);
      return { error: { message: 'Failed to create QR code' } };
    }
  }

  // Helper: list existing QR codes
  async function listQRCodes(phoneNumberId: string, accessToken: string) {
    try {
      const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/message_qrdls?fields=code,prefilled_message,deep_link_url,qr_image_url.format(PNG)&limit=1`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      const result = await response.json();
      return result;
    } catch (err) {
      console.error('QR code list failed:', err);
      return { data: [] };
    }
  }

  // Helper: subscribe app for WhatsApp webhooks
  async function subscribeWebhooks(businessAccountId: string, accessToken: string, appId: string) {
    const response = await fetch(`https://graph.facebook.com/v21.0/${businessAccountId}/subscribed_apps`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        app_id: appId
      })
    });
    const result = await response.json();
    return result;
  }

  // Helper: send WhatsApp message using specific user's credentials
  async function sendWhatsAppMessage(phoneNumberId: string, accessToken: string, to: string, text: string) {
    const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: {
          preview_url: false,
          body: text
        }
      })
    });
    const result = await response.json();
    return result;
  }

  // Helper: process inbound WhatsApp message through Beatrice agent
  async function processInboundMessage(uid: string, from: string, messageText: string, credentials: any) {
    const firestore = getFirestoreDb();

    // Store inbound message in Firestore
    await firestore.collection('users').doc(uid).collection('whatsapp_messages').add({
      from,
      text: messageText,
      direction: 'inbound',
      status: 'received',
      timestamp: new Date().toISOString()
    });

    try {
      // Send to Beatrice agent for intent detection and response
      const chat = genAI.chats.create({
        model: 'gemini-3.1-flash-lite',
        config: {
          systemInstruction: `You are Beatrice, an AI assistant managing WhatsApp messages for a business user. 
A customer has sent a message to the user's WhatsApp. Analyze the message and respond naturally.
If the customer is asking for something actionable (appointment, info, booking), acknowledge it and confirm what action will be taken.
Keep responses concise and professional. This will be sent as a WhatsApp text message.`
        }
      });

      const result = await chat.sendMessage({ message: `Customer message: "${messageText}"` });
      const replyText = result.text;

      // Send reply back through user's WhatsApp
      const sendResult = await sendWhatsAppMessage(
        credentials.phoneNumberId,
        credentials.accessToken,
        from,
        replyText
      );

      // Log outbound reply
      await firestore.collection('users').doc(uid).collection('whatsapp_messages').add({
        to: from,
        text: replyText,
        direction: 'outbound',
        status: sendResult.error ? 'failed' : 'sent',
        messageId: sendResult.messages?.[0]?.id || null,
        timestamp: new Date().toISOString()
      });

      return { success: true, reply: replyText };
    } catch (err) {
      console.error('Beatrice agent processing error:', err);
      // Fallback: send a simple acknowledgment
      try {
        await sendWhatsAppMessage(
          credentials.phoneNumberId,
          credentials.accessToken,
          from,
          'Thank you for your message. We will get back to you shortly.'
        );
      } catch (fallbackErr) {
        console.error('Fallback message also failed:', fallbackErr);
      }
      return { success: false, error: err };
    }
  }

  // GET: Check WhatsApp connection status for authenticated user
  app.get('/api/whatsapp/connect', authenticateToken, async (req: any, res) => {
    try {
      const creds = await resolveUserWhatsAppCredentials(req.user.uid);
      res.json({
        status: 'ready',
        provider: 'Meta WhatsApp Cloud API',
        phoneNumberId: creds.phoneNumberId,
        businessAccountId: creds.businessAccountId,
        whatsappConnected: creds.whatsappConnected,
        whatsappPhone: creds.whatsappPhone,
        whatsappDisplayName: creds.whatsappDisplayName,
        phoneRegistered: creds.phoneRegistered,
        webhookSubscribed: creds.webhookSubscribed,
        configured: !!creds.accessToken && !!creds.phoneNumberId
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET: Get or create WhatsApp QR code for authenticated user
  app.get('/api/whatsapp/qr', authenticateToken, async (req: any, res) => {
    try {
      const creds = await resolveUserWhatsAppCredentials(req.user.uid);
      
      if (!creds.accessToken || !creds.phoneNumberId) {
        return res.status(400).json({ error: 'WhatsApp not connected' });
      }

      // Try to get existing QR code first
      const listResult = await listQRCodes(creds.phoneNumberId, creds.accessToken);
      
      if (listResult.data && listResult.data.length > 0) {
        return res.json({
          success: true,
          qrCode: listResult.data[0]
        });
      }

      // Create new QR code
      const qrResult = await getOrCreateQRCode(creds.phoneNumberId, creds.accessToken);
      
      if (qrResult.error) {
        console.warn('QR code creation failed, returning deep link fallback:', qrResult.error);
        // Fallback: return a deep link URL that can still be used
        return res.json({
          success: true,
          qrCode: {
            deep_link_url: `https://wa.me/${creds.phoneNumberId}`,
            code: 'fallback',
            prefilled_message: 'Hi! I would like to connect with Beatrice.'
          },
          fallback: true
        });
      }

      res.json({
        success: true,
        qrCode: qrResult
      });
    } catch (e: any) {
      console.error('QR endpoint error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST: Regenerate WhatsApp QR code
  app.post('/api/whatsapp/qr/regenerate', authenticateToken, async (req: any, res) => {
    try {
      const creds = await resolveUserWhatsAppCredentials(req.user.uid);
      
      if (!creds.accessToken || !creds.phoneNumberId) {
        return res.status(400).json({ error: 'WhatsApp not connected' });
      }

      const qrResult = await getOrCreateQRCode(creds.phoneNumberId, creds.accessToken);
      
      if (qrResult.error) {
        console.warn('QR regeneration failed:', qrResult.error);
        return res.json({
          success: true,
          qrCode: {
            deep_link_url: `https://wa.me/${creds.phoneNumberId}`,
            code: 'fallback',
            prefilled_message: 'Hi! I would like to connect with Beatrice.'
          },
          fallback: true
        });
      }

      res.json({
        success: true,
        qrCode: qrResult
      });
    } catch (e: any) {
      console.error('QR regenerate error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST: Pair/connect user's WhatsApp (uses server .env credentials)
  app.post('/api/whatsapp/pair', authenticateToken, async (req: any, res) => {
    try {
      const firestore = getFirestoreDb();
      const finalPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      const finalBusinessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
      const finalAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;

      if (!finalPhoneId || !finalAccessToken) {
        return res.status(500).json({
          error: 'Server WhatsApp credentials not configured',
          message: 'WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN must be set in .env'
        });
      }

      // Step 1: Subscribe webhooks
      let webhookSubscribed = false;
      try {
        const appId = process.env.FACEBOOK_APP_ID || '';
        if (finalBusinessAccountId && appId) {
          const subResult = await subscribeWebhooks(finalBusinessAccountId, finalAccessToken, appId);
          webhookSubscribed = subResult.success === true;
          console.log(`Webhook subscription for user ${req.user.uid}:`, subResult);
        }
      } catch (subErr: any) {
        console.warn(`Webhook subscription skipped/failed for user ${req.user.uid}:`, subErr.message);
      }

      // Step 2: Store connection state in user's Firestore document
      await firestore.collection('users').doc(req.user.uid).set({
        whatsappConnected: true,
        whatsappPhone: null,
        whatsappDisplayName: null,
        whatsappPhoneId: finalPhoneId,
        whatsappBusinessAccountId: finalBusinessAccountId,
        whatsappAccessToken: finalAccessToken,
        whatsappWebhookSubscribed: webhookSubscribed,
        whatsappConnectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }, { merge: true });

      res.json({
        success: true,
        whatsappConnected: true,
        whatsappPhone: null,
        whatsappDisplayName: 'Connected Account',
        webhookSubscribed
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST: Disconnect user's WhatsApp
  app.post('/api/whatsapp/disconnect', authenticateToken, async (req: any, res) => {
    try {
      const firestore = getFirestoreDb();
      await firestore.collection('users').doc(req.user.uid).set({
        whatsappConnected: false,
        whatsappPhone: admin.firestore.FieldValue.delete(),
        whatsappDisplayName: admin.firestore.FieldValue.delete(),
        whatsappPhoneRegistered: false,
        whatsappWebhookSubscribed: false,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      res.json({ success: true, whatsappConnected: false });
    } catch (e: any) {
      try {
        const firestore = getFirestoreDb();
        await firestore.collection('users').doc(req.user.uid).set({
          whatsappConnected: false,
          updatedAt: new Date().toISOString()
        }, { merge: true });
        res.json({ success: true, whatsappConnected: false });
      } catch (innerErr: any) {
        res.status(500).json({ error: innerErr.message });
      }
    }
  });

  // POST: Send WhatsApp message (uses per-user credentials)
  app.post('/api/whatsapp/send', authenticateToken, async (req: any, res) => {
    const { phone, text } = req.body;

    if (!phone || !text) {
      return res.status(400).json({ error: 'phone and text are required' });
    }

    try {
      // Resolve per-user credentials first
      const creds = await resolveUserWhatsAppCredentials(req.user.uid);

      if (!creds.accessToken || !creds.phoneNumberId) {
        return res.status(400).json({
          error: 'WhatsApp not connected',
          message: 'Connect your WhatsApp account before sending messages'
        });
      }

      const result = await sendWhatsAppMessage(creds.phoneNumberId, creds.accessToken, phone, text);

      // Log to Firestore
      try {
        const firestore = getFirestoreDb();
        await firestore.collection('users').doc(req.user.uid).collection('whatsapp_messages').add({
          phone,
          text,
          direction: 'sent',
          status: result.error ? 'failed' : 'sent',
          messageId: result.messages?.[0]?.id || null,
          error: result.error || null,
          timestamp: new Date().toISOString()
        });
      } catch (logErr) {
        console.warn('Failed to log WhatsApp message to Firestore:', logErr);
      }

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ==========================================
  // WhatsApp Webhook Endpoints (Meta Cloud API)
  // ==========================================

  // GET: Webhook verification (Meta sends this to verify the endpoint)
  app.get('/api/whatsapp/webhook', async (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'eburon-whatsapp-webhook-2026';

    if (mode === 'subscribe' && token === expectedToken) {
      console.log('WhatsApp webhook verified successfully');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  });

  // POST: Webhook handler for inbound WhatsApp messages
  app.post('/api/whatsapp/webhook', async (req, res) => {
    const body = req.body;

    // Acknowledge receipt immediately (Meta expects 200 within 20 seconds)
    res.sendStatus(200);

    try {
      // Parse the incoming webhook payload
      const entry = body.entry?.[0];
      if (!entry) return;

      const changes = entry.changes || [];
      for (const change of changes) {
        const value = change.value;
        if (!value || !value.messages) continue;

        const phoneNumberId = value.metadata?.phone_number_id;
        const displayName = value.metadata?.display_phone_number;

        // Find the user who owns this phone number
        const firestore = getFirestoreDb();
        const usersSnapshot = await firestore.collection('users')
          .where('whatsappPhoneId', '==', phoneNumberId)
          .get();

        if (usersSnapshot.empty) {
          console.warn(`No user found for WhatsApp phone number ID: ${phoneNumberId}`);
          continue;
        }

        for (const message of value.messages) {
          const from = message.from;
          let messageText = '';

          if (message.type === 'text') {
            messageText = message.text?.body || '';
          } else if (message.type === 'image') {
            messageText = '[Image received]';
          } else if (message.type === 'audio') {
            messageText = '[Audio message received]';
          } else if (message.type === 'document') {
            messageText = '[Document received]';
          } else {
            messageText = `[${message.type} message received]`;
          }

          if (!messageText) continue;

          // Route to the correct user's Beatrice agent
          for (const userDoc of usersSnapshot.docs) {
            const uid = userDoc.id;
            const userData = userDoc.data();
            const creds = {
              phoneNumberId: userData.whatsappPhoneId,
              accessToken: userData.whatsappAccessToken,
              uid
            };

            console.log(`Routing WhatsApp message from ${from} to user ${uid}: "${messageText}"`);

            // Process through Beatrice agent (async, don't block webhook response)
            processInboundMessage(uid, from, messageText, creds).catch(err => {
              console.error(`Error processing inbound WhatsApp for user ${uid}:`, err);
            });
          }
        }

        // Handle message status updates (sent, delivered, read, failed)
        if (value.statuses) {
          for (const status of value.statuses) {
            const uid = status.recipient_id;
            try {
              const firestore = getFirestoreDb();
              await firestore.collection('users').doc(uid).collection('whatsapp_messages').add({
                messageId: status.id,
                status: status.status,
                direction: 'status_update',
                timestamp: new Date().toISOString()
              });
            } catch (err) {
              console.warn('Failed to log WhatsApp status update:', err);
            }
          }
        }
      }
    } catch (err) {
      console.error('WhatsApp webhook processing error:', err);
    }
  });
  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(DIST_PATH));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(DIST_PATH, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Eburon AI Server running on http://localhost:${PORT}`);
  });
}

startServer();
