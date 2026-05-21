import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import fs from 'fs';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';

import { Pool } from 'pg';
import { ChromaClient } from 'chromadb';
import axios from 'axios';
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const genAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY as string,
});

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

// Initialize DBs
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'eburon_db',
  password: 'eburon_db_pass_2026',
  port: 5432,
});

const chroma = new ChromaClient({ path: 'http://localhost:8000' });

// Helper: Get Embeddings using Ollama (Self-hosted)
async function getOllamaEmbedding(text: string) {
  try {
    const response = await axios.post(`${OLLAMA_URL}/api/embeddings`, {
      model: "nomic-embed-text",
      prompt: text
    });
    return response.data.embedding;
  } catch (err) {
    console.error('Ollama Embedding failed:', err);
    return null;
  }
}

// Memory Logic (Updated for Ollama)
async function saveMemory(uid: string, role: string, text: string) {
  try {
    await pool.query(
      'INSERT INTO conversation_history (uid, role, content) VALUES ($1, $2, $3)',
      [uid, role, text]
    );

    const embedding = await getOllamaEmbedding(text);
    if (embedding) {
      const collection = await chroma.getOrCreateCollection({ name: `user_memory_${uid.toLowerCase().replace(/[^a-z0-9]/g, '_')}` });
      await collection.add({
        ids: [Date.now().toString()],
        embeddings: [embedding],
        metadatas: [{ role, timestamp: new Date().toISOString() }],
        documents: [text],
      });
    }
  } catch (err) {
    console.error('Failed to save memory:', err);
  }
}

async function recallMemory(uid: string, query: string, limit: number = 5) {
  try {
    const embedding = await getOllamaEmbedding(query);
    if (!embedding) return [];

    const collection = await chroma.getOrCreateCollection({ name: `user_memory_${uid.toLowerCase().replace(/[^a-z0-9]/g, '_')}` });
    const results = await collection.query({
      queryEmbeddings: [embedding],
      nResults: limit,
    });

    return results.documents[0] || [];
  } catch (err) {
    console.error('Failed to recall memory:', err);
    return [];
  }
}

// Self-hosted RAG Generation using Gemma
async function generateGemmaResponse(prompt: string, context: string[]) {
  try {
    const fullPrompt = `Context:\n${context.join('\n')}\n\nUser Question: ${prompt}\n\nAssistant:`;
    const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
      model: "gemma",
      prompt: fullPrompt,
      stream: false
    });
    return response.data.response;
  } catch (err) {
    console.error('Gemma Generation failed:', err);
    return null;
  }
}

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

  const GOWA_URL = process.env.GOWA_URL || 'http://localhost:3001';
const GOWA_AUTH = 'Basic ' + Buffer.from('admin:eburon_whatsapp_2026').toString('base64');
const WHATSAPP_BUSINESS_NUMBER = process.env.WHATSAPP_BUSINESS_NUMBER || '1234567890'; // Your master bot number

// Helper: resolve WhatsApp credentials for a specific user (Multi-Device Version)
async function resolveUserWhatsAppCredentials(uid: string) {
  try {
    const response = await fetch(`${GOWA_URL}/devices/${uid}`, {
      headers: { 'Authorization': GOWA_AUTH }
    });
    const data: any = await response.json();
    
    // GoWA 200 means device exists/connected
    const connected = response.status === 200 && data.results?.paired;

    return {
      whatsappConnected: connected,
      whatsappPhone: data.results?.phone || null,
      whatsappDisplayName: data.results?.name || null,
      uid
    };
  } catch (err) {
    console.error('Failed to resolve GoWA credentials:', err);
    return {
      whatsappConnected: false,
      uid
    };
  }
}

async function getOrCreateQRCode(uid: string) {
  console.log(`[WhatsApp] Starting QR sequence for user: ${uid}`);
  try {
    // 1. Check if device exists and its status
    const statusRes = await fetch(`${GOWA_URL}/devices/${uid}`, {
      headers: { 'Authorization': GOWA_AUTH }
    });

    if (statusRes.status === 200) {
      const statusData: any = await statusRes.json();
      console.log(`[WhatsApp] Device ${uid} status:`, statusData.results?.state);

      // If already logged in, no need for QR
      if (statusData.results?.paired) {
        return { success: true, message: 'Already connected', paired: true };
      }

      // If disconnected or stale, we'll try to get QR, 
      // but GoWA sometimes prefers a fresh device session.
      // Let's remove and re-add for a clean pairing state if not paired.
      console.log(`[WhatsApp] Device ${uid} exists but not paired. Re-initializing...`);
      await fetch(`${GOWA_URL}/devices/${uid}`, {
        method: 'DELETE',
        headers: { 'Authorization': GOWA_AUTH }
      });
    }

    // 2. Create/Re-create the device instance
    console.log(`[WhatsApp] Creating device instance for ${uid}...`);
    const createRes = await fetch(`${GOWA_URL}/devices`, {
      method: 'POST',
      headers: { 
        'Authorization': GOWA_AUTH,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ device_id: uid })
    });
    const createData = await createRes.json();
    console.log(`[WhatsApp] Device creation result:`, createData.code);

    // 3. Request the login QR
    console.log(`[WhatsApp] Requesting login QR for ${uid}...`);
    const loginRes = await fetch(`${GOWA_URL}/app/login`, {
      headers: { 
        'Authorization': GOWA_AUTH,
        'X-Device-Id': uid
      }
    });
    const loginData = await loginRes.json();

    if (loginData.results && loginData.results.qr_link) {
      const localUrl = loginData.results.qr_link;
      const fileName = localUrl.split('/').pop();
      const proxyUrl = `/api/whatsapp/qr-image/${uid}/${fileName}`;

      console.log(`[WhatsApp] QR generated successfully. Proxy URL: ${proxyUrl}`);
      return { 
        success: true, 
        qr_link: proxyUrl,
        qr_duration: loginData.results.qr_duration 
      };
    }

    console.error(`[WhatsApp] Login failed for ${uid}:`, loginData.message);
    return { error: { message: loginData.message || 'Failed to initiate login' } };
  } catch (err: any) {
    console.error(`[WhatsApp] QR sequence CRASHED for ${uid}:`, err.message);
    return { error: { message: 'WhatsApp Service Error' } };
  }
}
// Helper: fetch WhatsApp Pairing Code (Link with phone number)
async function getPairingCode(uid: string, phone: string) {
  try {
    // Ensure device exists
    try {
      await fetch(`${GOWA_URL}/devices`, {
        method: 'POST',
        headers: { 
          'Authorization': GOWA_AUTH,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ device_id: uid })
      });
    } catch (e) {}

    const response = await fetch(`${GOWA_URL}/app/login-with-code?phone=${phone}`, {
      headers: { 
        'Authorization': GOWA_AUTH,
        'X-Device-Id': uid
      }
    });
    const result = await response.json();
    if (result.results && result.results.code) {
      return { success: true, pairingCode: result.results.code };
    }
    return { error: { message: result.message || 'Failed to generate pairing code' } };
  } catch (err) {
    console.error('Pairing code sequence failed:', err);
    return { error: { message: 'Failed to generate pairing code' } };
  }
}

// ... existing code ...

  // POST: Get WhatsApp pairing code for authenticated user
  app.post('/api/whatsapp/pair-code', authenticateToken, async (req: any, res) => {
    try {
      const { phone } = req.body;
      if (!phone) return res.status(400).json({ error: 'Phone number is required' });
      
      const result = await getPairingCode(req.user.uid, phone);
      if (result.error) return res.status(500).json(result);
      
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET: Proxy WhatsApp QR image
  app.get('/api/whatsapp/qr-image/:uid/:file', async (req, res) => {
    try {
      const { file } = req.params;
      const response = await fetch(`${GOWA_URL}/statics/qrcode/${file}`, {
        headers: { 'Authorization': GOWA_AUTH }
      });
      
      if (!response.ok) return res.sendStatus(404);
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      res.setHeader('Content-Type', 'image/png');
      res.send(buffer);
    } catch (err) {
      res.sendStatus(500);
    }
  });

// Helper: send WhatsApp message as the user
async function sendWhatsAppMessage(uid: string, to: string, text: string) {
  const response = await fetch(`${GOWA_URL}/send/message`, {
    method: 'POST',
    headers: {
      'Authorization': GOWA_AUTH,
      'Content-Type': 'application/json',
      'X-Device-Id': uid
    },
    body: JSON.stringify({
      phone: to,
      message: text
    })
  });
  const result = await response.json();
  return result;
}

// Helper: fetch real chat list from user's session (Read All/CRUD)
async function fetchUserChats(uid: string) {
  const response = await fetch(`${GOWA_URL}/chats?device_id=${uid}`, {
    headers: { 'Authorization': GOWA_AUTH }
  });
  const data = await response.json();
  return data.results || [];
}

  // Beatrice Core: Handle inbound WhatsApp message through Beatrice agent
  async function processInboundMessage(uid: string, from: string, messageText: string, credentials: any) {
    const firestore = getFirestoreDb();

    // Store inbound message in Firestore
    await firestore.collection('users').doc(uid).collection('whatsapp_messages').add({
      phone: from,
      text: messageText,
      direction: 'inbound',
      timestamp: new Date().toISOString()
    });

    try {
      // 1. Semantic Recall (Learning from the past)
      const relatedContext = await recallMemory(uid, messageText);
      const contextPrompt = relatedContext.length > 0 
        ? `\n[RECALLED MEMORIES]:\n${relatedContext.map(m => `- ${m}`).join('\n')}\n` 
        : "";

      // 2. Initialize Gemini Chat
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const chat = model.startChat({
        history: [],
        generationConfig: { maxOutputTokens: 1000 }
      });

      const systemMsg = `You are Beatrice, an AI assistant managing WhatsApp messages.
A customer (${from}) has sent a message. Analyze it and respond naturally.
${contextPrompt}
Respond concisely and professionally.`;

      const result = await chat.sendMessage(`[SYSTEM: ${systemMsg}]\nCustomer: "${messageText}"`);
      const replyText = result.response.text();

      // 3. Send reply back
      const sendResult = await sendWhatsAppMessage(uid, from, replyText);

      // 4. Save to Long-term Memory (Learning)
      saveMemory(uid, 'assistant', replyText).catch(e => console.warn('Memory save failed:', e));

      // Log outbound reply
      await firestore.collection('users').doc(uid).collection('whatsapp_messages').add({
        phone: from,
        text: replyText,
        direction: 'outbound',
        status: sendResult.code !== 200 ? 'failed' : 'sent',
        messageId: sendResult.results?.message_id || null,
        timestamp: new Date().toISOString()
      });

      return { success: true, reply: replyText };
    } catch (err) {
      console.error('Beatrice agent processing error:', err);
      return { success: false, error: err };
    }
  }

  // GET: Full conversation history from PostgreSQL
  app.get('/api/history', authenticateToken, async (req: any, res) => {
    try {
      const { limit = 50 } = req.query;
      const result = await pool.query(
        'SELECT role, content as text, timestamp FROM conversation_history WHERE uid = $1 ORDER BY timestamp DESC LIMIT $2',
        [req.user.uid, limit]
      );
      res.json(result.rows.reverse());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Memory APIs
  app.post('/api/memory/save', authenticateToken, async (req: any, res) => {
    try {
      const { role, text } = req.body;
      await saveMemory(req.user.uid, role, text);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/memory/recall', authenticateToken, async (req: any, res) => {
    try {
      const { query } = req.query;
      const results = await recallMemory(req.user.uid, query as string);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET: Get or create WhatsApp QR code for authenticated user
  app.get('/api/whatsapp/qr', authenticateToken, async (req: any, res) => {
    try {
      const qrResult = await getOrCreateQRCode(req.user.uid);
      
      if (qrResult.error) {
        return res.status(500).json(qrResult);
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
      const qrResult = await getOrCreateQRCode(req.user.uid);
      
      if (qrResult.error) {
        return res.status(500).json(qrResult);
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

  // POST: Pair/connect user's WhatsApp
  app.post('/api/whatsapp/pair', authenticateToken, async (req: any, res) => {
    try {
      const creds = await resolveUserWhatsAppCredentials(req.user.uid);
      res.json({
        success: true,
        whatsappConnected: creds.whatsappConnected,
        whatsappPhone: creds.whatsappPhone,
        whatsappDisplayName: creds.whatsappDisplayName || 'Connected Account'
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST: Disconnect user's WhatsApp
  app.post('/api/whatsapp/disconnect', authenticateToken, async (req: any, res) => {
    try {
      await fetch(`${GOWA_URL}/devices/${req.user.uid}/logout`, {
        method: 'POST',
        headers: { 'Authorization': GOWA_AUTH }
      });

      const firestore = getFirestoreDb();
      await firestore.collection('users').doc(req.user.uid).set({
        whatsappConnected: false,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      res.json({ success: true, whatsappConnected: false });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST: Send WhatsApp message (uses per-user GoWA session)
  app.post('/api/whatsapp/send', authenticateToken, async (req: any, res) => {
    const { phone, text } = req.body;

    if (!phone || !text) {
      return res.status(400).json({ error: 'phone and text are required' });
    }

    try {
      const result = await sendWhatsAppMessage(req.user.uid, phone, text);

      // Log to Firestore
      try {
        const firestore = getFirestoreDb();
        await firestore.collection('users').doc(req.user.uid).collection('whatsapp_messages').add({
          phone,
          text,
          direction: 'sent',
          status: result.code !== 200 ? 'failed' : 'sent',
          messageId: result.results?.message_id || null,
          error: result.message || null,
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

  // GET: Check WhatsApp connection status for authenticated user
  app.get('/api/whatsapp/connect', authenticateToken, async (req: any, res) => {
    try {
      const creds = await resolveUserWhatsAppCredentials(req.user.uid);
      res.json({
        status: creds.whatsappConnected ? 'ready' : 'disconnected',
        provider: 'GOWA Multi-Device',
        phoneNumberId: req.user.uid,
        whatsappConnected: creds.whatsappConnected,
        whatsappPhone: creds.whatsappPhone,
        whatsappDisplayName: creds.whatsappDisplayName,
        configured: true
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET: Get messages from Firestore or Live from Phone
  app.get('/api/whatsapp/messages', authenticateToken, async (req: any, res) => {
    try {
      const { live } = req.query;
      
      if (live === 'true') {
        const chats = await fetchUserChats(req.user.uid);
        return res.json(chats);
      }

      const limitCount = parseInt(req.query.limit as string) || 20;
      const firestore = getFirestoreDb();
      const snapshot = await firestore.collection('users').doc(req.user.uid)
        .collection('whatsapp_messages')
        .orderBy('timestamp', 'desc')
        .limit(limitCount)
        .get();
      
      const messages = snapshot.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data()
      }));
      res.json(messages);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Memory APIs
  app.post('/api/memory/save', authenticateToken, async (req: any, res) => {
    try {
      const { role, text } = req.body;
      await saveMemory(req.user.uid, role, text);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/memory/recall', authenticateToken, async (req: any, res) => {
    try {
      const { query } = req.query;
      const results = await recallMemory(req.user.uid, query as string);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ==========================================
  // WhatsApp Webhook Endpoints (Multi-Device)
  // ==========================================

  // GET: Webhook verification (GOWA/Generic)
  app.get('/api/whatsapp/webhook', async (req, res) => {
    res.status(200).send('Webhook active');
  });

  // POST: Webhook handler for inbound WhatsApp messages from GoWA
  app.post('/api/whatsapp/webhook', async (req, res) => {
    // Security check: Verify GOWA secret if configured
    const secret = req.headers['x-webhook-secret'];
    if (process.env.WHATSAPP_WEBHOOK_SECRET && secret !== process.env.WHATSAPP_WEBHOOK_SECRET) {
      return res.sendStatus(403);
    }

    const body = req.body;
    res.sendStatus(200);

    try {
      const event = body.event;
      const data = body.data;
      if (event !== 'message' || !data) return;

      const deviceId = body.device_id; // This is the User's UID
      const from = data.from;
      const messageText = data.body || '';

      if (!deviceId || !messageText) return;

      console.log(`Routing Multi-Device message from ${from} to session owner ${deviceId}: "${messageText}"`);

      // Process through Beatrice agent (acts as the user's virtual self)
      processInboundMessage(deviceId, from, messageText, { phoneNumberId: deviceId }).catch(err => {
        console.error(`Error processing inbound Multi-Device WhatsApp for user ${deviceId}:`, err);
      });
    } catch (err) {
      console.error('GoWA webhook processing error:', err);
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
