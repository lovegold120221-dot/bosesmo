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

  // WhatsApp Proxy (Meta for Developers Cloud API)
  app.get('/api/whatsapp/connect', authenticateToken, async (req: any, res) => {
    try {
      const firestore = getFirestoreDb();
      const userDoc = await firestore.collection('users').doc(req.user.uid).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      
      const whatsappConnected = userData?.whatsappConnected || false;
      const whatsappPhone = userData?.whatsappPhone || null;
      const whatsappDisplayName = userData?.whatsappDisplayName || null;
      
      // Extended credentials from user document if exists, fallback to env
      const phoneNumberId = userData?.whatsappPhoneId || process.env.WHATSAPP_PHONE_NUMBER_ID || null;
      const businessAccountId = userData?.whatsappBusinessAccountId || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || null;
      const accessToken = userData?.whatsappAccessToken || process.env.WHATSAPP_ACCESS_TOKEN || null;

      res.json({
        status: "ready",
        provider: "Meta for Developers Cloud API",
        phoneNumberId,
        businessAccountId,
        whatsappConnected,
        whatsappPhone,
        whatsappDisplayName,
        configured: !!accessToken && !!phoneNumberId,
        instructions: "To finalize production activation: 1. Create your Business application on developers.facebook.com. 2. Enable physical WhatsApp Product. 3. Retrieve your permanent access token and Phone Number ID, setting them securely in your .env or Environment Variables. 4. Complete the official phone linking."
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/whatsapp/pair', authenticateToken, async (req: any, res) => {
    const { phone, displayName, phoneId, businessAccountId, accessToken } = req.body;
    try {
      const firestore = getFirestoreDb();
      await firestore.collection('users').doc(req.user.uid).set({
        whatsappConnected: true,
        whatsappPhone: phone || '+1 (555) 019-2831',
        whatsappDisplayName: displayName || 'Eburon Workspace Client',
        whatsappPhoneId: phoneId || null,
        whatsappBusinessAccountId: businessAccountId || null,
        whatsappAccessToken: accessToken || null,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      res.json({
        success: true,
        whatsappConnected: true,
        whatsappPhone: phone || '+1 (555) 019-2831',
        whatsappDisplayName: displayName || 'Eburon Workspace Client'
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/whatsapp/disconnect', authenticateToken, async (req: any, res) => {
    try {
      const firestore = getFirestoreDb();
      await firestore.collection('users').doc(req.user.uid).update({
        whatsappConnected: false,
        whatsappPhone: admin.firestore.FieldValue.delete(),
        whatsappDisplayName: admin.firestore.FieldValue.delete(),
        updatedAt: new Date().toISOString()
      });

      res.json({
        success: true,
        whatsappConnected: false
      });
    } catch (e: any) {
      try {
        const firestore = getFirestoreDb();
        await firestore.collection('users').doc(req.user.uid).set({
          whatsappConnected: false,
          updatedAt: new Date().toISOString()
        }, { merge: true });
        res.json({
          success: true,
          whatsappConnected: false
        });
      } catch (innerErr: any) {
        res.status(500).json({ error: innerErr.message });
      }
    }
  });

  app.post('/api/whatsapp/send', authenticateToken, async (req: any, res) => {
    const whatsappToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    
    const phone = req.body.phone;
    const text = req.body.text;

    if (!whatsappToken || !phoneNumberId) {
      return res.status(400).json({
        error: 'WhatsApp integration is not fully configured on the server.',
        message: 'Please define the WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID environment variables in your server configuration to enable production-level WhatsApp messaging.'
      });
    }

    try {
      // Standard Graph API fetch for Meta Cloud WhatsApp API
      const response = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${whatsappToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phone,
          type: "text",
          text: {
            preview_url: false,
            body: text
          }
        })
      });

      const result = await response.json();

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
