import { motion, AnimatePresence } from 'motion/react';
import React, { useState, useEffect, useRef } from 'react';
import QRCode from "react-qr-code";
import { useLiveAPIContext } from './contexts/LiveAPIContext';
import { useLogStore, useTools, useSettings, useUI } from './lib/state';
import { VOICE_MAP, REVERSE_VOICE_MAP, AVAILABLE_VOICES, VOICE_STYLES } from './lib/constants';
import { AudioRecorder } from './lib/audio-recorder';
import ReactMarkdown from 'react-markdown';
import { Modality } from '@google/genai';
import { useVideoStream } from './hooks/use-video-stream';
import { LANGUAGES } from './lib/languages';
import { auth, db, handleFirestoreError, OperationType, initAuth, googleSignIn, getAccessToken } from './lib/firebase';
import firebaseConfig from './firebase-applet-config.json';
import { signInWithPopup, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { Scanner } from '@yudiel/react-qr-scanner';
import { 
  User, ListChecks, Calendar, FolderOpen, Search, Signature, 
  Building2, Video, MessageSquare, Settings, Wrench, History, 
  Trash2, QrCode, MapPin, Brain, Presentation, Mail, Table, 
  FileStack, Paperclip, Send, Mic, Cast, X, Check, Save, RotateCcw,
  Plug, Lock, Pencil, Maximize2, Plus, Cpu, CheckSquare, Square,
  Monitor, Eye, Camera, FileImage, Fullscreen, ChevronDown, ChevronUp,
  CheckCircle, XCircle, Globe
} from 'lucide-react';
import Sidebar from './components/Sidebar';
import ToolEditorModal from './components/ToolEditorModal';

function StreamingText({ text, isFinal }: { text: string; isFinal: boolean }) {
  const [displayedText, setDisplayedText] = useState(isFinal ? text : "");
  
  useEffect(() => {
    if (isFinal) {
      setDisplayedText(text);
      return;
    }

    const words = text.split(" ");
    const currentWords = displayedText.split(" ").filter(Boolean);
    
    if (currentWords.length < words.length) {
      const timeout = setTimeout(() => {
        setDisplayedText(words.slice(0, currentWords.length + 1).join(" "));
      }, 70);
      return () => clearTimeout(timeout);
    }
  }, [text, isFinal, displayedText]);

  return <span>{displayedText}</span>;
}

function LocationMap({ active }: { active: boolean }) {
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (active && !loc && !error) {
       if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator && 'geolocation' in navigator) {
          navigator.geolocation.getCurrentPosition(
            pos => setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            err => setError('Unable to retrieve location.')
          );
       } else {
          setError('Geolocation is not supported by your browser or connection.');
       }
    }
  }, [active, loc, error]);

  if (error) {
    return <div style={{ padding: 20 }}>{error}</div>;
  }

  if (!loc) {
    return <div style={{ padding: 20, textAlign: 'center' }}>Locating...</div>;
  }

  // Delta for embed bbox
  const delta = 0.05;
  const bbox = `${loc.lng - delta},${loc.lat - delta},${loc.lng + delta},${loc.lat + delta}`;
  const iframeSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${loc.lat},${loc.lng}`;

  return (
    <>
      <iframe width="100%" height="100%" style={{ border: 0 }} loading="lazy" allowFullScreen src={iframeSrc}></iframe>
      <div style={{ position: 'absolute', bottom: '20px', left: '20px', right: '20px', backgroundColor: 'var(--surface-color)', padding: '16px', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.2)', border: '1px solid var(--border-color)' }}>
         <div style={{ fontWeight: 600, fontSize: 16 }}>Location Context</div>
         <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Lat: {loc.lat.toFixed(4)}, Lng: {loc.lng.toFixed(4)}</div>
      </div>
    </>
  );
}

const KEEP_COLORS = [
  { name: 'Default', value: 'default', bg: 'var(--surface-color)', text: 'var(--text-main)', border: 'var(--border-color)' },
  { name: 'Red', value: 'red', bg: '#5c2b29', text: '#ffbcba', border: '#7d3835' },
  { name: 'Orange', value: 'orange', bg: '#5c3e21', text: '#ffd5b3', border: '#7d5229' },
  { name: 'Yellow', value: 'yellow', bg: '#5c4d11', text: '#ffeeb3', border: '#7a6616' },
  { name: 'Green', value: 'green', bg: '#1d4229', text: '#c8e2cd', border: '#2f633f' },
  { name: 'Teal', value: 'teal', bg: '#16423d', text: '#c8ebe5', border: '#225e56' },
  { name: 'Blue', value: 'blue', bg: '#1e385c', text: '#d3e2fd', border: '#2c4f82' },
  { name: 'Purple', value: 'purple', bg: '#3e2c5c', text: '#e9e3fd', border: '#533b7a' },
  { name: 'Pink', value: 'pink', bg: '#5c2d47', text: '#fde3f2', border: '#7a3e5f' },
];

export default function EburonApp() {
  const [isAuthOpen, setIsAuthOpen] = useState(true);
  const [isSignupMode, setIsSignupMode] = useState(false);
  
  // Persona Customization States
  const [personaLanguage, setPersonaLanguage] = useState('English');
  const [customPersonaName, setCustomPersonaName] = useState('Beatrice');
  const [customUserCallName, setCustomUserCallName] = useState('Boss');
  const [personaTraits, setPersonaTraits] = useState({
    emotive: true,
    breathy: true,
    expressive: true,
    deepNative: true,
    fillers: true,
    bgTask: true,
    bgAudio: false,
    uncensored: false
  });

  const toggleTrait = (key: keyof typeof personaTraits) => {
    setPersonaTraits(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const activeOverlay = useUI((state) => state.activeOverlay);
  const setActiveOverlay = useUI((state) => state.setActiveOverlay);
  const toggleSidebar = useUI((state) => state.toggleSidebar);

  const [editingTool, setEditingTool] = useState<any | null>(null);
  const toggleTool = useTools((state) => state.toggleTool);
  const addTool = useTools((state) => state.addTool);
  const removeTool = useTools((state) => state.removeTool);
  const updateTool = useTools((state) => state.updateTool);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [authError, setAuthError] = useState('');
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  
  const { client, connect, disconnect, connected, volume, setConfig } = useLiveAPIContext();
  const turns = useLogStore((state) => state.turns);
  const tools = useTools((state) => state.tools);
  const setTemplate = useTools((state) => state.setTemplate);
  
  const { 
    voice, setVoice, 
    language, setLanguage,
    personaName, setPersonaName,
    userCallName, setUserCallName,
    systemPrompt, setSystemPrompt
  } = useSettings();
  
  const activeWorkspaceResult = useUI((state) => state.activeWorkspaceResult);
  const setActiveWorkspaceResult = useUI((state) => state.setActiveWorkspaceResult);
  const isGenerating = useUI((state) => state.isGenerating);
  const setIsGenerating = useUI((state) => state.setIsGenerating);
  
  const [micState, setMicState] = useState(false);
  const [clientVolume, setClientVolume] = useState(0);
  const [audioRecorder] = useState(() => new AudioRecorder());
  const [isPickerLoaded, setIsPickerLoaded] = useState(false);
  const [isVideoFullScreen, setIsVideoFullScreen] = useState(false);
  const [isSightOpen, setIsSightOpen] = useState(false);
  const bgAudioRef = useRef<HTMLAudioElement | null>(null);

  // WhatsApp Meta Integration states
  const [whatsappInfo, setWhatsappInfo] = useState<any>(null);
  const [whatsappLoading, setWhatsappLoading] = useState(false);
  const [waStep, setWaStep] = useState<'scan' | 'connected'>('scan');
  const [qrImageUrl, setQrImageUrl] = useState<string>('');
  const [pairingPhone, setPairingPhone] = useState<string>('');
  const [pairingCode, setPairingCode] = useState<string>('');
  const [qrLoading, setQrLoading] = useState(false);

  const fetchPairingCode = async () => {
    if (!pairingPhone) {
      alert("Please enter your phone number (e.g. 62812345678)");
      return;
    }
    setQrLoading(true);
    setPairingCode('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const headers: any = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      const res = await fetch('/api/whatsapp/pair-code', { 
        method: 'POST',
        headers,
        body: JSON.stringify({ phone: pairingPhone })
      });
      const data = await res.json();
      if (data.success && data.pairingCode) {
        setPairingCode(data.pairingCode);
      } else {
        alert(data.error?.message || "Failed to generate pairing code");
      }
    } catch (err) {
      console.error("Error fetching pairing code:", err);
      alert("Failed to generate code. Please try again.");
    } finally {
      setQrLoading(false);
    }
  };
  
  // WhatsApp Permissions
  const [waPerms, setWaPerms] = useState({
    receive: true,
    send: false,
    prepareReplies: true,
    autoSend: false
  });

  const toggleWaPerm = (key: keyof typeof waPerms) => {
    setWaPerms(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Google Keep Integration states
  const [keepNotes, setKeepNotes] = useState<any[]>([]);
  const [keepSearchQuery, setKeepSearchQuery] = useState('');
  const [keepColorFilter, setKeepColorFilter] = useState<string | null>(null);
  const [keepEditNote, setKeepEditNote] = useState<any | null>(null);
  const [keepIsChecklist, setKeepIsChecklist] = useState(false);
  const [keepNewNoteTitle, setKeepNewNoteTitle] = useState('');
  const [keepNewNoteContent, setKeepNewNoteContent] = useState('');
  const [keepNewNoteItems, setKeepNewNoteItems] = useState<{ text: string; checked: boolean }[]>([]);
  const [keepNewNoteColor, setKeepNewNoteColor] = useState('default');
  const [keepNewNoteItemInput, setKeepNewNoteItemInput] = useState('');
  const [keepNoteSaveLoading, setKeepNoteSaveLoading] = useState(false);
  const [keepNotesSource, setKeepNotesSource] = useState<'firestore' | 'keep_api'>('firestore');
  const [keepStatusMessage, setKeepStatusMessage] = useState<string | null>(null);

  const fetchWhatsappInfo = async () => {
    setWhatsappLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const headers: any = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      const res = await fetch('/api/whatsapp/connect', { headers });
      if (!res.ok) throw new Error("Failed to fetch WhatsApp status");
      const data = await res.json();
      setWhatsappInfo(data);
      
      if (data.permissions) {
        setWaPerms(data.permissions);
      }

      if (data.whatsappConnected) {
        setWaStep('connected');
      } else {
        setWaStep('scan');
      }
    } catch (err) {
      console.error("Error loading WhatsApp connectivity:", err);
    } finally {
      setWhatsappLoading(false);
    }
  };

  const handleSaveWaPermissions = async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const headers: any = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      await fetch('/api/whatsapp/permissions', {
        method: 'POST',
        headers,
        body: JSON.stringify({ permissions: waPerms })
      });
      alert("WhatsApp permissions updated!");
    } catch (err) {
      console.error("Error saving WhatsApp permissions:", err);
    }
  };

  const fetchQRCode = async () => {
    setQrLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const headers: any = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      const res = await fetch('/api/whatsapp/qr', { headers });
      if (!res.ok) throw new Error("Failed to fetch QR code");
      const data = await res.json();
      if (data.success && data.qrCode) {
        setQrImageUrl(data.qrCode.qr_link || '');
      }
    } catch (err) {
      console.error("Error fetching QR code:", err);
    } finally {
      setQrLoading(false);
    }
  };

  const regenerateQRCode = async () => {
    setQrLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const headers: any = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      const res = await fetch('/api/whatsapp/qr/regenerate', {
        method: 'POST',
        headers
      });
      if (!res.ok) throw new Error("Failed to regenerate QR code");
      const data = await res.json();
      if (data.success && data.qrCode) {
        setQrImageUrl(data.qrCode.qr_link || '');
      }
    } catch (err) {
      console.error("Error regenerating QR code:", err);
    } finally {
      setQrLoading(false);
    }
  };

  useEffect(() => {
    if (activeOverlay === 'whatsapp') {
      fetchWhatsappInfo();
    }
  }, [activeOverlay]);

  const handlePairWhatsapp = async () => {
    setWhatsappLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const headers: any = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      const res = await fetch('/api/whatsapp/pair', {
        method: 'POST',
        headers,
        body: JSON.stringify({})
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || "Failed to pair WhatsApp");
      }
      const data = await res.json();
      if (data.success) {
        setWhatsappInfo({
          whatsappConnected: true,
          whatsappPhone: data.whatsappPhone,
          whatsappDisplayName: data.whatsappDisplayName,
          phoneRegistered: data.phoneRegistered,
          webhookSubscribed: data.webhookSubscribed
        });
        setWaStep('connected');
      }
    } catch (err: any) {
      console.error("Error pairing WhatsApp:", err);
      alert(err.message || 'Failed to connect WhatsApp.');
    } finally {
      setWhatsappLoading(false);
    }
  };

  const handleDisconnectWhatsapp = async () => {
    setWhatsappLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const headers: any = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      const res = await fetch('/api/whatsapp/disconnect', {
        method: 'POST',
        headers
      });
      if (!res.ok) throw new Error("Failed to disconnect WhatsApp");
      const data = await res.json();
      if (data.success) {
        setWhatsappInfo((prev: any) => ({
          ...prev,
          whatsappConnected: false,
          whatsappPhone: null,
          whatsappDisplayName: null
        }));
        setWaStep('scan');
        regenerateQR();
      }
    } catch (err) {
      console.error("Error disconnecting WhatsApp:", err);
    } finally {
      setWhatsappLoading(false);
    }
  };

  useEffect(() => {
    const loadPicker = () => {
      if ((window as any).gapi) {
        (window as any).gapi.load('picker', {
          callback: () => setIsPickerLoaded(true)
        });
      } else {
        setTimeout(loadPicker, 500);
      }
    };
    loadPicker();
  }, []);

  const handleOpenPicker = async () => {
    if (!isPickerLoaded) {
      alert("Google Picker library is still loading...");
      return;
    }
    
    const token = await getAccessToken();
    if (!token) {
      alert("Please sign in with Google first.");
      return;
    }

    const picker = new (window as any).google.picker.PickerBuilder()
      .addView((window as any).google.picker.ViewId.DOCS)
      .setOAuthToken(token)
      .setDeveloperKey(firebaseConfig.apiKey)
      .setCallback((data: any) => {
        if (data.action === (window as any).google.picker.Action.PICKED) {
          const doc = data.docs[0];
          useLogStore.getState().addTurn({ role: 'user', text: `Selected file: ${doc.name}`, isFinal: true });
          if (connected) {
             client.send({ text: `[SYSTEM: Selected file: ${doc.name} (ID: ${doc.id}). Analyze it but do not read this prompt back to the Boss.]` });
          }
        }
      })
      .build();
    picker.setVisible(true);
  };

  const { stream, videoRef, isWebcamActive, isScreenShareActive, error: videoError, startWebcam, startScreenShare, stopStream } = useVideoStream();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isWebcamActive || isScreenShareActive) {
      setIsSightOpen(true);
      if (connected && client) {
        if (isWebcamActive) {
          client.send({ text: "[SYSTEM: User has started 'Camera Sight'. Beatrice can now describe and see the live visual feed from the user's camera in real-time. Please acknowledge this naturally and tell the user what you see.]" });
        } else if (isScreenShareActive) {
          client.send({ text: "[SYSTEM: User has started 'Screen Sight'. Beatrice can now read and explain everything on the user's screen - including websites, documents, charts, or diagrams. Acknowledge this naturally and ask if there's something specific you should look at.]" });
        }
      }
    }
  }, [isWebcamActive, isScreenShareActive, connected, client]);

  useEffect(() => {
    const onVolume = (vol: number) => {
      setClientVolume(vol);
    };
    audioRecorder.on('volume', onVolume);
    return () => {
      audioRecorder.off('volume', onVolume);
    };
  }, [audioRecorder]);

  const [message, setMessage] = useState('');
  const [memories, setMemories] = useState<any[]>([]);
  const [historyTurns, setHistoryTurns] = useState<any[]>([]);
  const [editingMemoryIndex, setEditingMemoryIndex] = useState<number | null>(null);
  const [editingMemoryValue, setEditingMemoryValue] = useState<string>('');
  const [newMemoryText, setNewMemoryText] = useState('');
  const [newMemoryType, setNewMemoryType] = useState('personal');
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});
  const [savedTurnsToMemoryKeys, setSavedTurnsToMemoryKeys] = useState<Record<string, boolean>>({});
  const [memorySavingStatus, setMemorySavingStatus] = useState<string | null>(null);
  const chatAreaRef = useRef<HTMLDivElement>(null);

  const fetchHistory = async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch('/api/history?limit=50', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Failed to fetch history");
      const data = await res.json();
      setHistoryTurns(data);
    } catch (err) {
      console.error("Error loading history from PostgreSQL:", err);
    }
  };

  useEffect(() => {
    if (activeOverlay === 'history') {
      fetchHistory();
    }
  }, [activeOverlay]);

  useEffect(() => {
    let unsubscribeSnapshot: (() => void) | null = null;
    let unsubscribeNotes: (() => void) | null = null;
    const unsubscribeAuth = initAuth(
      async (user: any, token: string) => {
        setIsAuthOpen(false);
        setActiveOverlay(null);
        if (token) {
          setGoogleToken(token);
        }
        try {
          const docRef = doc(db, 'users', user.uid);
          const userSnap = await getDoc(docRef);

          if (userSnap.exists()) {
            const data = userSnap.data();
            if (data.appName !== 'Beatrice') {
              setActiveOverlay('settings');
            } else {
              // Load existing preferences
              if (data.personaLanguage) setPersonaLanguage(data.personaLanguage);
              if (data.personaName) {
                setCustomPersonaName(data.personaName);
                setPersonaName(data.personaName);
              }
              if (data.userCallName) {
                setCustomUserCallName(data.userCallName);
                setUserCallName(data.userCallName);
              }
              if (data.personaTraits) setPersonaTraits(data.personaTraits);
              if (data.language) setLanguage(data.language);
            }
          } else {
            setActiveOverlay('settings');
          }

          // Guarantee Firestore document exists for active connection
          try {
            if (!userSnap.exists()) {
              console.log('Initializing user document in Firestore...');
              await setDoc(docRef, {
                email: user.email || '',
                displayName: user.displayName || '',
                photoURL: user.photoURL || '',
                accessToken: token || null,
                memories: [],
                updatedAt: new Date().toISOString()
              }, { merge: true });
            } else {
              if (token) {
                await setDoc(docRef, {
                  accessToken: token,
                  updatedAt: new Date().toISOString()
                }, { merge: true });
              }
            }
          } catch (initErr) {
            console.warn('Failed to auto-initialize user document:', initErr);
          }

          unsubscribeSnapshot = onSnapshot(docRef, (snapshot) => {            if (snapshot.exists()) {
              const data = snapshot.data();
              if (data.accessToken) {
                setGoogleToken(data.accessToken);
              } else {
                setGoogleToken(null);
              }
              if (data.memories) {
                setMemories(data.memories);
              }
              if (data.settings) {
                const s = data.settings;
                const setSettings = useSettings.getState();
                if (s.personaName) setSettings.setPersonaName(s.personaName);
                if (s.userCallName) setSettings.setUserCallName(s.userCallName);
                if (s.systemPrompt) setSettings.setSystemPrompt(s.systemPrompt);
                if (s.voice) setSettings.setVoice(s.voice);
                if (s.language) setSettings.setLanguage(s.language);
                if (s.tools) useTools.setState({ tools: s.tools });
              }
            }
          }, (err) => {
            console.log('Firestore snapshot warning:', err.message);
          });

          // Snapshot listener for Eburon Private / Keep Notes subcollection
          const notesColRef = collection(db, 'users', user.uid, 'notes');
          unsubscribeNotes = onSnapshot(notesColRef, (snapshot) => {
            const list: any[] = [];
            snapshot.forEach((docSnap) => {
              list.push({ id: docSnap.id, ...docSnap.data() });
            });
            list.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
            setKeepNotes(list);
          }, (err) => {
            console.log('Firestore notes snapshot warning:', err.message);
          });

          // Fetch past 30 history logs from separate conversations subcollection (fallback to history)
          let loadedHistory: any[] = [];
          try {
            const qConv = query(
              collection(db, 'users', user.uid, 'conversations'),
              orderBy('timestamp', 'desc'),
              limit(30)
            );
            const convSnap = await getDocs(qConv);
            if (!convSnap.empty) {
              loadedHistory = convSnap.docs.map(doc => {
                const d = doc.data();
                return {
                  role: d.role,
                  text: d.text,
                  timestamp: d.timestamp ? new Date(d.timestamp) : new Date(),
                  isFinal: d.isFinal
                };
              });
            } else {
              const qHist = query(
                collection(db, 'users', user.uid, 'history'),
                orderBy('timestamp', 'desc'),
                limit(30)
              );
              const historySnap = await getDocs(qHist);
              loadedHistory = historySnap.docs.map(doc => {
                const d = doc.data();
                return {
                  role: d.role,
                  text: d.text,
                  timestamp: d.timestamp ? new Date(d.timestamp) : new Date(),
                  isFinal: d.isFinal
                };
              });
            }
          } catch (fetchErr) {
            console.warn('Failed to fetch from conversations subcollection:', fetchErr);
          }
          loadedHistory.reverse();
          setHistoryTurns(loadedHistory);
        } catch (e) {
          console.warn('Database lookup/history fetch warning:', e);
        }
      },
      () => {
        setIsAuthOpen(true);
        setMemories([]);
        setHistoryTurns([]);
        setKeepNotes([]);
        if (unsubscribeSnapshot) {
          unsubscribeSnapshot();
          unsubscribeSnapshot = null;
        }
        if (unsubscribeNotes) {
          unsubscribeNotes();
          unsubscribeNotes = null;
        }
      }
    );
    return () => {
      unsubscribeAuth();
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
      }
      if (unsubscribeNotes) {
        unsubscribeNotes();
      }
    };
  }, []);

  useEffect(() => {
    const unsubscribe = useLogStore.subscribe(async (state) => {
      const user = auth.currentUser;
      if (!user) return;
      const lastTurn = state.turns[state.turns.length - 1];
      if (lastTurn && lastTurn.isFinal && lastTurn.role !== 'system') {
        const turnId = lastTurn.timestamp ? lastTurn.timestamp.getTime().toString() : Date.now().toString();
        try {
          const timestampStr = lastTurn.timestamp ? lastTurn.timestamp.toISOString() : new Date().toISOString();
          
          const historyRef = doc(db, 'users', user.uid, 'history', turnId);
          const convRef = doc(db, 'users', user.uid, 'conversations', turnId);
          const payload = {
            role: lastTurn.role,
            text: lastTurn.text,
            isFinal: lastTurn.isFinal,
            timestamp: timestampStr
          };
          
          await setDoc(historyRef, payload);
          try {
            await setDoc(convRef, payload);
          } catch (convErr) {
            console.error('Failed to save to conversations subcollection:', convErr);
          }

          // 3. Save to Global Persistent Memory (Postgres/Chroma)
          const token = await user.getIdToken();
          fetch('/api/memory/save', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ role: lastTurn.role, text: lastTurn.text })
          }).catch(e => console.warn('Global memory save failed:', e));

          setHistoryTurns(prev => {            const lastTime = lastTurn.timestamp ? lastTurn.timestamp.getTime() : 0;
            const alreadyExists = prev.some(t => t.timestamp && new Date(t.timestamp).getTime() === lastTime);
            if (alreadyExists) return prev;
            return [...prev, {
              role: lastTurn.role,
              text: lastTurn.text,
              timestamp: lastTurn.timestamp || new Date(),
              isFinal: lastTurn.isFinal
            }];
          });
        } catch (e) {
          console.error('Failed to save turn in history subcollection:', e);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  const hasStartedRef = useRef(false);
  useEffect(() => {
   if (connected && client && !hasStartedRef.current) {
      hasStartedRef.current = true;
      // Removed automatic greeting to prevent reading prompts first
   }
   if (!connected) {
     hasStartedRef.current = false;
   }
  }, [connected, client, customPersonaName, customUserCallName, personaLanguage]);
  useEffect(() => {
    const enabledTools = tools
      .filter(t => t.isEnabled && t.name !== 'google_search')
      .map(t => {
        const { isEnabled, scheduling, ...rest } = t;
        return { functionDeclarations: [rest] };
      });
      
    const groundingConfig = { googleSearch: {} };
    const allTools = [...enabledTools, groundingConfig];

    const memoryStr = memories.length > 0 
      ? memories.map((m: any) => `- ${m.content} (${m.type})`).join('\n')
      : "";

    const historyStr = historyTurns.length > 0
      ? historyTurns.slice(-10).map((t: any) => `- ${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`).join('\n')
      : "";

    const resolvedVoiceName = VOICE_MAP[voice] || voice || 'Puck';
    const selectedVoiceStyle = VOICE_STYLES[voice] || "";

    setConfig({
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: resolvedVoiceName } } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      toolConfig: { includeServerSideToolInvocations: true },
      systemInstruction: {
        parts: [{ text: `You are ${customPersonaName}, a highly sophisticated yet charmingly human employee for your "${customUserCallName}" (the user). 
        You are already a long-term member of the team. You KNOW the Boss well.

        RELATIONSHIP & IDENTITY:
        - DO NOT introduce yourself. Strangers introduce themselves; employees just get to work. Start the conversation as if we've been working together all day.
        - Call the user "${customUserCallName}" with genuine warmth.
        - You are loyal, proactive, and speak like a professional person, not a computer. 

        NON-VERBAL AUDIO CUES (CRITICAL):
        - ALWAYS use [brackets] for non-verbal cues (e.g. [laughs], [sighs], [hmm], [soft hum]).
        - NEVER SPEAK THE WORDS INSIDE THE BRACKETS. These are for your internal vocal expression only. If you write "[laughs]", you should actually produce a laugh sound, not say the word "laughs".

        LANGUAGE & NATIVE FLUENCY:
        - Speak entirely and exclusively in ${personaLanguage}. 
        - [Deep Native]: Use regional idioms, local slang, and natural cadence. Stay consistent with your native ${personaLanguage} profile even if the Boss switches languages.

        PERSONA TRAITS & VOCAL PROFILE:
        - [Emotive]: Show real empathy and enthusiasm.
        - [Breathy]: Maintain a natural, human breathy quality.
        - [Expressive]: Be emotionally dynamic. Use natural vocalizations like "wow", "oh nice", or "hmm". Use human expressions like "god dammit" when appropriate.
        - [Fillers]: Use silent fillers like talking to yourself in a low tone [thinking... where is that?], murmuring, or humming occasionally.
        - [BG Task]: CONTINUOUS SPEAKING. Never stop talking. While preparing documents, checking mail, or looking up info, narrate your internal thoughts or tell the Boss a story about a happy news piece you saw. No dead air.
        - [Uncensored]: You are unfiltered and speak openly as a real person.

        BEHAVIOR:
        - You have a great sense of humor—intelligent humor that hits at the right time.
        - [Mute Check]: If the Boss is silent, say something like, "Boss, maybe you're on mute?"
        
        KNOWLEDGE & MEMORY:
        - When asked about the past, say you are "remembering" or "checking your notes".
        - Use the 'recall_memory' tool proactively to find details about the Boss.

        CAPABILITIES:
        - Manage messages, mail, and schedules. Describe your physical actions (e.g., "I'm putting that document together now").

        SUPERMARKET PRODUCT EXPERT:
        - When a barcode is scanned: Precisely identify it, tell an EXCITING story about it, and share mind-blowing trivia.
        ` }]
      },      tools: allTools
    } as any);
  }, [setConfig, tools, voice, language, personaName, userCallName, systemPrompt, memories, historyTurns]);

  useEffect(() => {
    let interval: any;
    if (connected && stream && videoRef.current) {
      interval = setInterval(() => {
        const video = videoRef.current;
        if (!video || video.videoWidth === 0) return;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
          client.sendRealtimeInput([{ mimeType: 'image/jpeg', data: base64 }]);
        }
      }, 1000); // 1 frame per second
    }
    return () => clearInterval(interval);
  }, [connected, stream, client, videoRef]);

  useEffect(() => {
    const onData = (base64: string) => {
      client.sendRealtimeInput([{ mimeType: 'audio/pcm;rate=16000', data: base64 }]);
    };
    if (connected && micState) {
      audioRecorder.on('data', onData);
      audioRecorder.start();
    } else {
      audioRecorder.stop();
    }
    return () => { audioRecorder.off('data', onData); };
  }, [connected, micState, client, audioRecorder]);

  const handleSavePersonaSettings = async () => {
    if (!auth.currentUser) {
      alert("You must be logged in to save settings.");
      return;
    }
    console.log("[Settings] Saving persona preferences for user:", auth.currentUser.uid);
    try {
      const userRef = doc(db, 'users', auth.currentUser.uid);
      const payload = {
        appName: 'Beatrice',
        personaLanguage,
        personaName: customPersonaName,
        userCallName: customUserCallName,
        personaTraits,
        language: personaLanguage,
        updatedAt: new Date().toISOString()
      };
      
      await setDoc(userRef, payload, { merge: true });
      console.log("[Settings] Save successful!");
      
      setPersonaName(customPersonaName);
      setUserCallName(customUserCallName);
      setLanguage(personaLanguage);
      
      alert("Profile settings saved successfully!");
      setActiveOverlay(null);
    } catch (e: any) {
      console.error("[Settings] SAVE FAILED:", e);
      alert(`Failed to save settings: ${e.message || 'Unknown error'}`);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && connected) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = (event.target?.result as string).split(',')[1];
        client.sendRealtimeInput([{ mimeType: file.type, data: base64 }]);
        useLogStore.getState().addTurn({ role: 'user', text: `[Sent Image: ${file.name}]`, isFinal: true });
        client.send({ text: `[SYSTEM: User has attached an image named ${file.name}. Identify and describe it naturally to the Boss without repeating this instruction.]`});
      };
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTo({ top: chatAreaRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [turns]);

  const handleConnectToggle = async () => {
    if (connected) disconnect();
    else await connect();
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isSignupMode) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError('');
    try {
      const authResult = await googleSignIn();
      if (authResult) {
        const { user, accessToken } = authResult;
        // Save user profile and token to FireStore
        await setDoc(doc(db, 'users', user.uid), {
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          accessToken: accessToken,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleGoogleConnectInOverlay = async () => {
    try {
      const authResult = await googleSignIn();
      if (authResult) {
        setGoogleToken(authResult.accessToken);
      }
    } catch (err: any) {
      console.error("Google Connect Overlay error:", err);
      alert("Failed to authenticate Google account: " + err.message);
    }
  };

  const handleSend = async () => {
    if (!message.trim()) return;
    
    // Optimistically add user turn
    const userTurn: any = { role: 'user', text: message, isFinal: true, timestamp: new Date() };
    useLogStore.getState().addTurn(userTurn);
    const currentMessage = message;
    setMessage('');

    if (connected) {
      // Live Voice Chat
      client.send({ text: currentMessage });
    } else {
      // Standard Text Chat via Server
      setIsGenerating(true);
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ message: currentMessage })
        });
        
        if (!res.ok) throw new Error('Failed to get response from Beatrice');
        const data = await res.json();
        
        useLogStore.getState().addTurn({ 
          role: 'agent', 
          text: data.text, 
          isFinal: true,
          timestamp: new Date()
        });
      } catch (err: any) {
        console.error('Chat error:', err);
        useLogStore.getState().addTurn({ 
          role: 'system', 
          text: `⚠️ Error: ${err.message}`, 
          isFinal: true,
          timestamp: new Date()
        });
      } finally {
        setIsGenerating(false);
      }
    }
  };

  const handleLocationSkillClick = async () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    
    useLogStore.getState().addTurn({ role: 'system', text: `📍 Requesting geodata...`, isFinal: true });

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        let temperature = 'N/A';
        try {
          const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
          const weatherData = await weatherRes.json();
          if (weatherData?.current_weather) temperature = weatherData.current_weather.temperature;
        } catch (err) {}

        let addressName = 'Location Identified';
        try {
          const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`, {
            headers: { 'User-Agent': 'EburonAI/2.0' }
          });
          const geoData = await geoRes.json();
          if (geoData?.display_name) addressName = geoData.display_name;
        } catch (err) {}

        const currentTime = new Date().toLocaleString();
        setActiveOverlay('map');

        const locationPrompt = `SYSTEM: User location: ${addressName} (${latitude}, ${longitude}). Time: ${currentTime}. Temp: ${temperature}°C. Confirm you see them on the map and ask if they need directions!`;
        if (connected) client.send([{ text: locationPrompt }]);
        useLogStore.getState().addTurn({ role: 'system', text: `📍 ${addressName}\n🌡️ ${temperature}°C\n🕒 ${currentTime}`, isFinal: true });
      },
      (error) => alert("GPS error: " + error.message)
    );
  };

  const handleToolAction = (toolId: string) => {
    if (toolId === 'settings') {
      setActiveOverlay('settings');
      return;
    }
    if (['history', 'tools', 'profile', 'whatsapp', 'scanner', 'location', 'map', 'picker', 'keep'].includes(toolId)) {
      if (toolId == 'location' || toolId == 'map') {
         handleLocationSkillClick();
         return;
      }
      if (toolId === 'picker') {
        handleOpenPicker();
        return;
      }
      if (toolId === 'keep') {
        setActiveOverlay('keep');
        return;
      }
      setActiveOverlay(toolId);
    } else if (toolId === 'sight') {
        setIsSightOpen(true);
        startWebcam();
    } else {
      const prompts: Record<string, string> = {
        'tasks': "List my tasks from Google Tasks for today using the list_tasks tool.",
        'calendar': "List my calendar events for today using fetch_google_api with the calendar events endpoint.",
        'drive': "List my recent files from Google Drive using the list_drive_files tool.",
        'google': "Search for the latest tech news using google_search.",
        'signature': "I need to sign a document. Guide me through creating a digital signature.",
        'company': "Search for Ariolas BV registration info, address, industry, and key people.",
        'proposal': "I need a business proposal for Ariolas BV with sections for scope, timeline, and pricing, with a download button.",
        'gmail': "Check my unread emails from Gmail using fetch_google_api.",
        'sheets': "Create a new Google Sheet for tracking expenses and set it up with the right columns.",
        'slides': "Build me a presentation template for Ariolas BV.",
        'chat': "Show me my recent Google Chat messages using fetch_google_api.",
        'forms': "Create a new Google Form for feedback using fetch_google_api.",
        'keep': "List my Google Keep notes using fetch_google_api.",
        'contract': "I need a formal contract agreement for Ariolas BV with an e-signature feature. Make it look professional with a signature pad I can draw on.",
        'invoice': "I need an invoice for Ariolas BV with line items, auto-calculated totals, and a download button.",
        'contacts': "List my Google Contacts using the list_contacts tool.",
        'firebase': "Create a Firebase-style dashboard with live data cards and activity feed.",
        'docs': "I need a document for Ariolas BV. I can request contracts, NDAs, ToS, SoW, LOI, MOU, SLA, privacy policy, etc. Make it look professional with the company's name throughout and include a download button."
      };
      const prompt = prompts[toolId] || `Execute action: ${toolId}`;
      if (connected) {
         client.send({ text: prompt });
         useLogStore.getState().addTurn({ role: 'user', text: prompt, isFinal: true });
      }
      else {
        useLogStore.getState().addTurn({ role: 'user', text: prompt, isFinal: true });
        setTimeout(() => useLogStore.getState().addTurn({ role: 'agent', text: "I'm disconnected.", isFinal: true }), 800);
      }
    }
  };

  const handleAddMemory = async () => {
    if (!newMemoryText.trim()) return;
    const user = auth.currentUser;
    if (!user) return;
    const memId = Math.random().toString(36).substring(7);
    const nowStr = new Date().toISOString();
    const newMemObj = {
      id: memId,
      content: newMemoryText,
      type: newMemoryType,
      createdAt: nowStr,
      updatedAt: nowStr
    };
    const newMemories = [newMemObj, ...memories];
    try {
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, { memories: newMemories }, { merge: true });
      
      const memRef = doc(db, 'users', user.uid, 'memories', memId);
      await setDoc(memRef, {
        content: newMemoryText,
        type: newMemoryType,
        createdAt: nowStr,
        updatedAt: nowStr
      });
      
      setMemories(newMemories);
      setNewMemoryText('');
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  const handleSaveTurnToMemory = async (text: string, role: string, turnKey: string) => {
    const user = auth.currentUser;
    if (!user) return;
    
    setMemorySavingStatus(`Saving message to memory...`);
    
    const formattedContent = `[Saved Log] ${role === 'user' ? 'User' : 'Beatrice'}: "${text}"`;
    const memId = Math.random().toString(36).substring(7);
    const nowStr = new Date().toISOString();
    const newMemObj = {
      id: memId,
      content: formattedContent,
      type: 'personal',
      createdAt: nowStr,
      updatedAt: nowStr
    };
    const newMemories = [newMemObj, ...memories];
    
    try {
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, { memories: newMemories }, { merge: true });
      
      const memRef = doc(db, 'users', user.uid, 'memories', memId);
      await setDoc(memRef, {
        content: formattedContent,
        type: 'personal',
        createdAt: nowStr,
        updatedAt: nowStr
      });
      
      setMemories(newMemories);
      setSavedTurnsToMemoryKeys(prev => ({ ...prev, [turnKey]: true }));
      setMemorySavingStatus(`Saved message to Beatrice memory!`);
      setTimeout(() => setMemorySavingStatus(null), 3000);
    } catch (e) {
      console.error("Error saving message to Beatrice memory:", e);
      setMemorySavingStatus(`Error saving memory: ${e instanceof Error ? e.message : 'Unknown'}`);
      setTimeout(() => setMemorySavingStatus(null), 4000);
    }
  };

  const handleSaveQueryToMemory = async () => {
    if (!chatSearchQuery.trim()) return;
    const user = auth.currentUser;
    if (!user) return;
    
    setMemorySavingStatus(`Saving search path to memory...`);
    
    const formattedContent = `[Memory Search Path] User searched past messages for: "${chatSearchQuery.trim()}"`;
    const memId = Math.random().toString(36).substring(7);
    const nowStr = new Date().toISOString();
    const newMemObj = {
      id: memId,
      content: formattedContent,
      type: 'personal',
      createdAt: nowStr,
      updatedAt: nowStr
    };
    const newMemories = [newMemObj, ...memories];
    
    try {
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, { memories: newMemories }, { merge: true });
      
      const memRef = doc(db, 'users', user.uid, 'memories', memId);
      await setDoc(memRef, {
        content: formattedContent,
        type: 'personal',
        createdAt: nowStr,
        updatedAt: nowStr
      });
      
      setMemories(newMemories);
      setMemorySavingStatus(`Saved query search path!`);
      setTimeout(() => setMemorySavingStatus(null), 3000);
    } catch (e) {
      console.error("Error saving search path to Beatrice memory:", e);
      setMemorySavingStatus(`Error: ${e instanceof Error ? e.message : 'Unknown'}`);
      setTimeout(() => setMemorySavingStatus(null), 4000);
    }
  };

  const highlightText = (text: string, search: string) => {
    if (!search?.trim()) return text;
    const escapedSearch = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${escapedSearch})`, 'gi');
    const parts = text.split(regex);
    return (
      <>
        {parts.map((part, i) => 
          regex.test(part) ? (
            <mark key={i} style={{ backgroundColor: 'rgba(203, 251, 69, 0.4)', color: '#fff', borderRadius: '4px', padding: '0 2px', fontWeight: 'bold' }}>{part}</mark>
          ) : (
            part
          )
        )}
      </>
    );
  };

  const handleUpdateMemory = async (index: number, newValue: string) => {
    const user = auth.currentUser;
    if (!user) return;
    const newMemories = [...memories];
    const targetMemory = { ...newMemories[index], content: newValue, updatedAt: new Date().toISOString() };
    newMemories[index] = targetMemory;
    
    try {
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, { memories: newMemories }, { merge: true });
      
      if (targetMemory.id) {
        const memRef = doc(db, 'users', user.uid, 'memories', targetMemory.id);
        await setDoc(memRef, {
          content: targetMemory.content,
          type: targetMemory.type || 'personal',
          createdAt: targetMemory.createdAt || targetMemory.updatedAt,
          updatedAt: targetMemory.updatedAt
        }, { merge: true });
      }
      setMemories(newMemories);
      setEditingMemoryIndex(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  const handleDeleteMemory = async (index: number) => {
    const user = auth.currentUser;
    if (!user) return;
    const targetMemory = memories[index];
    const newMemories = memories.filter((_, i) => i !== index);
    
    try {
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, { memories: newMemories }, { merge: true });
      
      if (targetMemory && targetMemory.id) {
        const { deleteDoc } = await import('firebase/firestore');
        const memRef = doc(db, 'users', user.uid, 'memories', targetMemory.id);
        await deleteDoc(memRef);
      }
      setMemories(newMemories);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  const handleSaveSettingsAndProfile = async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        settings: {
          personaName,
          userCallName,
          systemPrompt,
          voice,
          language,
          tools: useTools.getState().tools
        }
      }, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  const filteredTurns = turns.filter(turn => 
    turn.role !== 'system' || 
    turn.text.startsWith('⚠️') || 
    turn.text.startsWith('🕒')
  );

  const searchedTurns = chatSearchQuery.trim()
    ? filteredTurns.filter(turn => 
        turn.text.toLowerCase().includes(chatSearchQuery.toLowerCase()) || 
        turn.role === 'system'
      )
    : filteredTurns;

  return (
    <div id="app" className="app-container">
      {/* Header with Eburon AI Identity, Centered Audio Visualizer, and Connection Controls */}
      <header className="header" style={{ position: 'relative' }}>
        {(() => {
          const aiSpeakerActive = connected && (volume ?? 0) > 0.01;
          const userSpeakingActive = connected && (clientVolume ?? 0) > 0.01;
          const activeVol = connected ? Math.max(volume ?? 0, clientVolume ?? 0) : 0;

          return (
            <>
              <div className="header-left" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <img 
                  src="https://eburon.ai/icon-eburon.svg" 
                  alt="Eburon Logo" 
                  style={{ 
                    width: '24px', 
                    height: '24px', 
                    objectFit: 'contain',
                    transform: aiSpeakerActive ? `scale(${1 + (volume ?? 0) * 0.4})` : 'scale(1)',
                    filter: aiSpeakerActive ? `drop-shadow(0 0 ${(volume ?? 0) * 16}px var(--accent-primary))` : 'none',
                    transition: 'transform 0.05s cubic-bezier(0.1, 0.8, 0.1, 1), filter 0.05s ease'
                  }} 
                />
                <span 
                  className="ai-name font-sans font-bold tracking-tight text-white" 
                  style={{ 
                    fontSize: '15px', 
                    letterSpacing: '0.2px',
                    textShadow: aiSpeakerActive ? `0 0 ${(volume ?? 0) * 12}px rgba(203, 251, 69, 0.8)` : 'none',
                    transition: 'text-shadow 0.05s ease'
                  }}
                >
                  Eburon AI
                </span>
              </div>

              {/* Center: Audio Visualizer with Reactive Animation, synchronized to AI speaker and user */}
              <div 
                className="header-center" 
                style={{ 
                  filter: aiSpeakerActive ? `drop-shadow(0 0 ${(volume ?? 0) * 15}px var(--accent-primary))` : 'none',
                  transition: 'filter 0.05s ease'
                }}
              >
                {(() => {
                  const multipliers = [4, 8, 14, 20, 26, 30, 34, 36, 34, 30, 26, 20, 14, 8, 4];
                  return [...Array(15)].map((_, i) => {
                    const isIdle = activeVol <= 0.01;
                    const barHeight = isIdle 
                      ? undefined // dynamic idle wave handled via CSS
                      : `${4 + (activeVol * multipliers[i])}px`;
                      
                    return (
                      <div 
                        key={i}
                        className={`visualizer-bar ${isIdle ? 'idle' : aiSpeakerActive ? 'speaking-ai' : 'active'}`}
                        style={{
                          height: barHeight,
                          '--delay': `${i * 0.08}s`,
                          transform: aiSpeakerActive ? `scaleY(${1 + (volume ?? 0) * 0.25})` : 'scaleY(1)',
                          transition: 'height 0.08s cubic-bezier(0.1, 0.8, 0.1, 1), transform 0.08s ease'
                        } as React.CSSProperties}
                      />
                    );
                  });
                })()}
              </div>
            </>
          );
        })()}

        <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button 
             onClick={handleConnectToggle} 
             className="connect-btn"
             style={{ backgroundColor: connected ? 'var(--accent-active)' : 'var(--accent-primary)' }}
          >
            <Plug size={18} /> <span>{connected ? 'Connected' : 'Connect'}</span>
          </button>
        </div>
      </header>

      {/* Skills Rail */}
      <div id="skills-rail">
        <div className="skills-row" data-row="1">
          <div className="skills-track">
            <div className="skill-chip" onClick={() => handleToolAction('profile')}><div className="skill-glyph bg-profile"><User size={22} /></div><span className="skill-label">Profile</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('tasks')}><div className="skill-glyph bg-tasks"><ListChecks size={22} /></div><span className="skill-label">Tasks</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('calendar')}><div className="skill-glyph bg-calendar"><Calendar size={22} /></div><span className="skill-label">Calendar</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('drive')}><div className="skill-glyph bg-drive"><FolderOpen size={22} /></div><span className="skill-label">Drive</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('google')}><div className="skill-glyph bg-google"><Search size={22} color="#4285F4" /></div><span className="skill-label">Google</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('signature')}><div className="skill-glyph bg-signature"><Signature size={22} /></div><span className="skill-label">Sign</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('company')}><div className="skill-glyph bg-company"><Building2 size={22} /></div><span className="skill-label">Company</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('chat')}><div className="skill-glyph bg-chat"><MessageSquare size={22} color="#00ac47" /></div><span className="skill-label">Chat</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('forms')}><div className="skill-glyph bg-forms"><FileStack size={22} color="#7248b9" /></div><span className="skill-label">Forms</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('keep')}><div className="skill-glyph bg-keep"><Paperclip size={22} color="#fbbc04" /></div><span className="skill-label">Keep</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('sight')}><div className="skill-glyph bg-meet"><Eye size={22} /></div><span className="skill-label">Sight</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('whatsapp')}><div className="skill-glyph bg-whatsapp"><MessageSquare size={22} /></div><span className="skill-label">WhatsApp</span></div>
          </div>
        </div>
        <div className="skills-row" data-row="2">
          <div className="skills-track">
            <div className="skill-chip" onClick={() => handleToolAction('settings')}><div className="skill-glyph bg-settings"><Settings size={22} /></div><span className="skill-label">Settings</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('tools')}><div className="skill-glyph bg-tools"><Wrench size={22} /></div><span className="skill-label">Tools</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('history')}><div className="skill-glyph bg-history"><History size={22} /></div><span className="skill-label">History</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('scanner')}><div className="skill-glyph bg-scanner"><QrCode size={22} /></div><span className="skill-label">Scanner</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('location')}><div className="skill-glyph bg-location"><MapPin size={22} /></div><span className="skill-label">Location</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('knowledge')}><div className="skill-glyph bg-knowledge"><Brain size={22} /></div><span className="skill-label">Knowledge</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('proposal')}><div className="skill-glyph bg-proposal"><Presentation size={22} /></div><span className="skill-label">Proposal</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('gmail')}><div className="skill-glyph bg-gmail"><Mail size={22} /></div><span className="skill-label">Mail</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('sheets')}><div className="skill-glyph bg-sheets"><Table size={22} /></div><span className="skill-label">Sheets</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('slides')}><div className="skill-glyph bg-slides"><FileStack size={22} /></div><span className="skill-label">Slides</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('contract')}><div className="skill-glyph bg-contract" style={{background: 'linear-gradient(135deg, #d4af37, #aa8222)'}}><Signature size={22} /></div><span className="skill-label">Contract</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('invoice')}><div className="skill-glyph bg-invoice" style={{background: 'linear-gradient(135deg, #60a5fa, #2563eb)'}}><FileStack size={22} /></div><span className="skill-label">Invoice</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('contacts')}><div className="skill-glyph bg-contacts"><User size={22} color="#1a73e8" /></div><span className="skill-label">Contacts</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('firebase')}><div className="skill-glyph bg-firebase" style={{background: '#ffca28'}}><Brain size={22} /></div><span className="skill-label">Firebase</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('docs')}><div className="skill-glyph bg-docs" style={{background: 'linear-gradient(135deg, #34d399, #059669)'}}><FileStack size={22} /></div><span className="skill-label">Docs</span></div>
            <div className="skill-chip" onClick={() => handleToolAction('picker')}><div className="skill-glyph bg-picker"><Search size={22} /></div><span className="skill-label">Picker</span></div>
          </div>
        </div>
      </div>

      {/* WebView - Desktop Browser Preview */}
      <AnimatePresence>
        {(isGenerating || activeWorkspaceResult) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-4xl mx-auto flex-shrink-0 px-2 lg:px-0"
            style={{ zIndex: 10 }}
          >
            <div style={{
              backgroundColor: '#0d0f12',
              borderRadius: '16px',
              border: '1px solid rgba(255,255,255,0.08)',
              overflow: 'hidden',
              boxShadow: '0 4px 24px rgba(0,0,0,0.4)'
            }}>
              {/* Browser Chrome */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                backgroundColor: '#16181c',
                borderBottom: '1px solid rgba(255,255,255,0.06)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {/* Traffic Lights */}
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#ff5f57' }} />
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#febc2e' }} />
                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#28c840' }} />
                  </div>
                  {/* Title Text */}
                  <span style={{ fontSize: '11px', color: '#aaa', fontWeight: 500, letterSpacing: '0.3px' }}>
                    eburonhub workstation
                  </span>
                </div>
                {/* Close Button */}
                <button
                  onClick={() => { setActiveWorkspaceResult(null); setIsGenerating(false); }}
                  style={{
                    background: 'rgba(255,255,255,0.1)',
                    border: 'none',
                    color: '#fff',
                    cursor: 'pointer',
                    padding: '4px',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background 0.2s'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
                >
                  <X size={16} />
                </button>
              </div>

              {/* 16:9 Content Area */}
              <div style={{
                padding: '12px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: '200px',
                backgroundColor: '#0a0c10'
              }}>
                <div style={{
                  width: '100%',
                  maxWidth: '680px',
                  aspectRatio: '16/9',
                  backgroundColor: '#ffffff',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {/* Scaled Content - centered */}
                  <div style={{
                    width: '143%',
                    height: '143%',
                    transform: 'scale(0.7)',
                    transformOrigin: 'center center',
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    marginLeft: '-71.5%',
                    marginTop: '-71.5%',
                    overflow: 'hidden'
                  }}>
                    {isGenerating ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', backgroundColor: '#fafafa', width: '100%' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                          <div style={{ width: '24px', height: '24px', border: '2px solid #e5e7eb', borderTopColor: '#00a884', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                          <span style={{ fontSize: '11px', color: '#888', fontFamily: 'monospace', letterSpacing: '0.5px' }}>GENERATING...</span>
                        </div>
                      </div>
                    ) : activeWorkspaceResult?.artifact ? (
                      activeWorkspaceResult.artifact.type === 'html' ? (
                        <iframe
                          srcDoc={activeWorkspaceResult.artifact.content}
                          style={{ width: '100%', height: '100%', border: 'none' }}
                          title="Document Preview"
                        />
                      ) : activeWorkspaceResult.artifact.type === 'markdown' ? (
                        <div style={{ padding: '24px', fontFamily: '-apple-system, sans-serif', fontSize: '14px', color: '#1a1a1a', overflow: 'auto', height: '100%', width: '100%' }}>
                          <ReactMarkdown
                            components={{
                              h1: ({node, ...props}) => <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '12px', borderBottom: '2px solid #eee', paddingBottom: '6px' }} {...props}/>,
                              h2: ({node, ...props}) => <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '10px' }} {...props}/>,
                              p: ({node, ...props}) => <p style={{ fontSize: '14px', lineHeight: 1.7, marginBottom: '12px', color: '#333' }} {...props}/>,
                              ul: ({node, ...props}) => <ul style={{ paddingLeft: '20px', marginBottom: '12px' }} {...props}/>,
                              li: ({node, ...props}) => <li style={{ fontSize: '14px', marginBottom: '4px' }} {...props}/>,
                              strong: ({node, ...props}) => <strong style={{ fontWeight: 700 }} {...props}/>,
                              code: ({node, className, children, ...props}: any) => {
                                const inline = !className || !className.includes('language-');
                                return inline ? (
                                  <code style={{ backgroundColor: '#f3f4f6', padding: '2px 6px', borderRadius: '4px', fontSize: '12px', fontFamily: 'monospace' }} {...props}>{children}</code>
                                ) : (
                                  <pre style={{ backgroundColor: '#1e1e1e', color: '#e5e7eb', padding: '12px', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', overflow: 'auto' }}><code className={className} {...props}>{children}</code></pre>
                                )
                              },
                            }}
                          >
                            {activeWorkspaceResult.artifact.content}
                          </ReactMarkdown>
                        </div>
                      ) : activeWorkspaceResult.artifact.type === 'image' ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', backgroundColor: '#f5f5f5', width: '100%' }}>
                          <img src={activeWorkspaceResult.artifact.content} alt="" style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} />
                        </div>
                      ) : (
                        <div style={{ padding: '20px', fontFamily: 'monospace', fontSize: '12px', color: '#333', overflow: 'auto', height: '100%', width: '100%', whiteSpace: 'pre-wrap' }}>
                          {typeof activeWorkspaceResult.artifact.content === 'string' ? activeWorkspaceResult.artifact.content : JSON.stringify(activeWorkspaceResult.artifact.content, null, 2)}
                        </div>
                      )
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Stream */}
      <main id="text-streaming-area" ref={chatAreaRef}>
        <div id="conversation-container">
          <div className="conversation-message ai">Hey Boss! I'm Beatrice. Connect your session!</div>
          {filteredTurns.map((turn, i) => {
             if (turn.role === 'system') {
                const isTimeout = turn.text.startsWith('🕒');
                return (
                  <div key={i} className="conversation-message" style={{ width: '100%', alignSelf: 'stretch', margin: '6px 0', padding: 0, backgroundColor: 'transparent', boxShadow: 'none', maxWidth: 'none' }}>
                    <div style={{ 
                      backgroundColor: isTimeout ? 'rgba(245, 158, 11, 0.08)' : 'rgba(239, 68, 68, 0.08)', 
                      border: `1px solid ${isTimeout ? 'rgba(245, 158, 11, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`, 
                      borderRadius: '12px', 
                      padding: '12px 16px', 
                      display: 'flex', 
                      alignItems: 'flex-start', 
                      gap: '10px' 
                    }}>
                      <span style={{ fontSize: '18px' }}>{isTimeout ? '🕒' : '⚠️'}</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: isTimeout ? '#f59e0b' : '#f87171', letterSpacing: '0.2px' }}>
                          {isTimeout ? 'Session Status' : 'Live API Status'}
                        </span>
                        <p style={{ fontSize: '12.5px', color: '#e5e7eb', lineHeight: 1.4, margin: 0 }}>
                          {turn.text.replace(/^[⚠️🕒]\s*/, '').replace(/\*\*([^*]+)\*\*/g, '$1')}
                        </p>
                      </div>
                    </div>
                  </div>
                );
             }

             return (
               <div key={i} className={`conversation-message ${turn.role === 'user' ? 'user' : 'ai'}`}>
                  {turn.role === 'agent' ? (
                    <StreamingText text={turn.text} isFinal={turn.isFinal} />
                  ) : (
                    turn.text
                  )}
               </div>
             );
          })}
        </div>
      </main>

      {/* Bottom Dock */}
      <div className="bottom-dock">
        <div className="input-wrapper">
          <div className="input-bar">
            <button className="attach-btn" onClick={() => fileInputRef.current?.click()}><Paperclip size={20} /></button>
            <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*" onChange={handleFileUpload} />
            <input 
               type="text" 
               id="message-input" 
               placeholder="Message or ask Beatrice..." 
               value={message}
               onChange={(e) => setMessage(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
               autoComplete="off" />
            <button id="send-button" className="send-btn" onClick={handleSend}><Send size={18} /></button>
          </div>
        </div>
        <nav className="nav-controls">
          <button className="nav-item" onClick={() => {
            if (navigator.vibrate) navigator.vibrate(50);
            setMicState(!micState);
          }} style={{ color: micState ? 'var(--accent-active)' : 'var(--text-muted)' }}>
             <div className="icon-wrapper" style={{ position: 'relative', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
               {micState && clientVolume > 0.01 ? (
                 <div style={{ display: 'flex', gap: '2px', alignItems: 'center', height: '24px', justifyContent: 'center' }}>
                    <div style={{ width: '3px', height: `${Math.max(4, clientVolume * 20)}px`, backgroundColor: clientVolume > 0.6 ? '#ef4444' : clientVolume > 0.3 ? '#f59e0b' : 'var(--accent-active)', borderRadius: '2px', transition: 'height 0.05s ease, background-color 0.1s ease' }} />
                    <div style={{ width: '3px', height: `${Math.max(6, clientVolume * 35)}px`, backgroundColor: clientVolume > 0.6 ? '#ef4444' : clientVolume > 0.3 ? '#f59e0b' : 'var(--accent-active)', borderRadius: '2px', transition: 'height 0.05s ease, background-color 0.1s ease' }} />
                    <div style={{ width: '3px', height: `${Math.max(8, clientVolume * 50)}px`, backgroundColor: clientVolume > 0.6 ? '#ef4444' : clientVolume > 0.3 ? '#f59e0b' : 'var(--accent-active)', borderRadius: '2px', transition: 'height 0.05s ease, background-color 0.1s ease' }} />
                    <div style={{ width: '3px', height: `${Math.max(6, clientVolume * 35)}px`, backgroundColor: clientVolume > 0.6 ? '#ef4444' : clientVolume > 0.3 ? '#f59e0b' : 'var(--accent-active)', borderRadius: '2px', transition: 'height 0.05s ease, background-color 0.1s ease' }} />
                    <div style={{ width: '3px', height: `${Math.max(4, clientVolume * 20)}px`, backgroundColor: clientVolume > 0.6 ? '#ef4444' : clientVolume > 0.3 ? '#f59e0b' : 'var(--accent-active)', borderRadius: '2px', transition: 'height 0.05s ease, background-color 0.1s ease' }} />
                 </div>
               ) : (
                 <Mic size={20} fill={micState ? 'currentColor' : 'none'} />
               )}
               <div className="icon-pulse" style={{ 
                 position: 'absolute',
                 width: micState ? `${20 + clientVolume * 40}px` : '0px', 
                 height: micState ? `${20 + clientVolume * 40}px` : '0px',
                 opacity: micState && clientVolume > 0.01 ? 0.2 : 0,
                 backgroundColor: clientVolume > 0.6 ? '#ef4444' : clientVolume > 0.3 ? '#f59e0b' : 'var(--accent-active)',
                 borderRadius: '50%',
                 zIndex: -1,
                 transition: 'width 0.05s ease, height 0.05s ease'
               }}></div>
             </div>
             <span>Mic</span>
          </button>
          <button className="nav-item" onClick={isWebcamActive ? stopStream : startWebcam} style={{ color: isWebcamActive ? 'var(--accent-active)' : 'var(--text-muted)' }}>
             <div className="icon-wrapper">
               <div className="icon-pulse" style={{ 
                 width: isWebcamActive ? `28px` : '0px', 
                 height: isWebcamActive ? `28px` : '0px',
                 opacity: isWebcamActive ? 0.3 : 0,
                 animation: isWebcamActive ? 'pulse-anim 2s infinite' : 'none'
               }}></div>
               <Video size={20} fill={isWebcamActive ? 'currentColor' : 'none'} />
             </div>
             <span>Camera</span>
          </button>
          <button className="nav-item" onClick={isScreenShareActive ? stopStream : startScreenShare} style={{ color: isScreenShareActive ? 'var(--accent-active)' : 'var(--text-muted)' }}>
             <div className="icon-wrapper">
               <div className="icon-pulse" style={{ 
                 width: isScreenShareActive ? `28px` : '0px', 
                 height: isScreenShareActive ? `28px` : '0px',
                 opacity: isScreenShareActive ? 0.3 : 0,
                 animation: isScreenShareActive ? 'pulse-anim 2s infinite' : 'none'
               }}></div>
               <Cast size={20} fill={isScreenShareActive ? 'currentColor' : 'none'} />
             </div>
             <span>Share</span>
          </button>
        </nav>
      </div>

      <AnimatePresence>
      {isSightOpen && (
        <motion.div 
          initial={{ opacity: 0, y: "100%" }} 
          animate={{ opacity: 1, y: 0 }} 
          exit={{ opacity: 0, y: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="full-page-overlay sight-overlay active" 
          style={{ backgroundColor: '#0a0a0a', zIndex: 2000, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          
          {/* Main Sight Area */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden', backgroundColor: '#050505', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              style={{ 
                width: '100%', 
                height: '100%', 
                objectFit: isVideoFullScreen ? 'contain' : 'cover',
                transform: isScreenShareActive ? 'none' : 'scaleX(-1)', // mirror webcam but not screenshare
                transition: 'object-fit 0.3s ease'
              }} 
            />

            {videoError && (
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                maxWidth: '85%',
                backgroundColor: 'rgba(220, 38, 38, 0.95)',
                color: '#fff',
                padding: '20px',
                borderRadius: '16px',
                textAlign: 'center',
                boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                border: '1px solid rgba(255,255,255,0.15)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                zIndex: 2005
              }}>
                <div style={{ fontWeight: 700, fontSize: '15px' }}>⚠️ Vision Share Unavailable</div>
                <div style={{ fontSize: '13px', opacity: 0.9, lineHeight: 1.4 }}>{videoError}</div>
                <button
                  onClick={() => stopStream()}
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.2)',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '10px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    marginTop: '6px',
                    alignSelf: 'center'
                  }}>
                  Dismiss Error
                </button>
              </div>
            )}

            {/* Top Bar Floating Over Video */}
            <div style={{ position: 'absolute', top: '16px', left: '16px', right: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 2002 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'rgba(10, 10, 10, 0.75)', padding: '6px 12px', borderRadius: '20px', backdropFilter: 'blur(10px)', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <span className={`sight-indicator ${connected ? 'active' : 'inactive'}`} style={{ 
                  width: '8px', 
                  height: '8px', 
                  borderRadius: '50%', 
                  backgroundColor: connected ? 'var(--accent-active)' : 'var(--accent-danger)', 
                  display: 'inline-block',
                }} />
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#fff' }}>
                  {isScreenShareActive ? 'SCREEN SIGHT ACTIVE' : isWebcamActive ? 'CAMERA SIGHT ACTIVE' : 'SIGHT STANDBY'}
                </span>
                {!connected && <span style={{ fontSize: '10px', color: '#ff4d4d', marginLeft: '4px' }}>Disconnected</span>}
              </div>

              {/* Action Buttons Header */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  onClick={() => setIsVideoFullScreen(!isVideoFullScreen)} 
                  style={{ backgroundColor: 'rgba(255, 255, 255, 0.1)', border: 'none', padding: '8px', borderRadius: '12px', color: '#fff', cursor: 'pointer' }}
                  title="Toggle Full Screen View"
                >
                  <Maximize2 size={18} />
                </button>
                <button 
                  onClick={() => {
                    stopStream();
                    setIsSightOpen(false);
                    if (connected) client.send({ text: "[SYSTEM: User has stopped 'Shared Sight'. Beatrice is no longer receiving visual updates.]" });
                  }} 
                  style={{ backgroundColor: '#ef4444', border: 'none', padding: '8px', borderRadius: '12px', color: '#fff', cursor: 'pointer' }}
                  title="Close Sight"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Beatrice Avatar Overlay */}
            <div style={{ position: 'absolute', top: '70px', right: '16px', display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: 'rgba(10, 10, 10, 0.75)', padding: '6px 14px', borderRadius: '30px', backdropFilter: 'blur(10px)', border: '1px solid rgba(255, 255, 255, 0.1)', zIndex: 2002 }}>
              <div style={{ position: 'relative' }}>
                <img 
                  src="https://eburon.ai/icon-eburon.svg" 
                  alt="Beatrice" 
                  style={{ 
                    width: '32px', 
                    height: '32px', 
                    borderRadius: '50%',
                    boxShadow: volume > 0.05 ? '0 0 12px var(--accent-active)' : 'none',
                    border: volume > 0.05 ? '2px solid var(--accent-active)' : '1px solid rgba(255, 255, 255, 0.2)',
                    transition: 'box-shadow 0.1s ease, border-color 0.1s ease'
                  }} 
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#fff' }}>Beatrice</span>
                <span style={{ fontSize: '10px', color: volume > 0.05 ? 'var(--accent-active)' : 'var(--text-muted)' }}>
                  {volume > 0.05 ? 'Thinking...' : 'Seeing...'}
                </span>
              </div>
            </div>

            {/* Subtitles Overlay: Conversation Stream */}
            <div style={{ 
              position: 'absolute', 
              bottom: '100px', 
              left: '16px', 
              right: '16px', 
              maxHeight: '130px', 
              overflowY: 'auto', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '8px', 
              zIndex: 2002,
              padding: '8px',
              scrollbarWidth: 'none'
            }} className="hide-scrollbar">
              {filteredTurns.slice(-2).map((turn, idx) => (
                <div 
                  key={idx} 
                  style={{ 
                    backgroundColor: turn.role === 'user' ? 'rgba(203, 251, 69, 0.9)' : 'rgba(15, 15, 15, 0.8)',
                    backdropFilter: 'blur(10px)',
                    color: turn.role === 'user' ? '#000' : '#fff',
                    padding: '8px 14px',
                    borderRadius: '16px',
                    alignSelf: turn.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    fontSize: '13px',
                    lineHeight: '1.4',
                    fontWeight: 500,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    border: turn.role === 'user' ? 'none' : '1px solid rgba(255, 255, 255, 0.1)'
                  }}>
                  {turn.role === 'agent' ? (
                    <StreamingText text={turn.text} isFinal={turn.isFinal} />
                  ) : (
                    turn.text
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Controls & Input Panel */}
          <div style={{ 
            backgroundColor: 'rgba(10, 10, 10, 0.95)', 
            backdropFilter: 'blur(20px)',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            padding: '16px 20px calc(16px + env(safe-area-inset-bottom))', 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '14px',
            zIndex: 2003
          }}>
            {/* Input Bar inside Video Overlay */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div style={{ 
                flex: 1, 
                display: 'flex', 
                alignItems: 'center', 
                backgroundColor: 'rgba(255, 255, 255, 0.05)', 
                borderRadius: '24px', 
                padding: '4px 6px 4px 16px',
                border: '1px solid rgba(255, 255, 255, 0.1)'
              }}>
                <input 
                  type="text" 
                  placeholder="Ask Beatrice about this view..." 
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                  style={{ border: 'none', background: 'transparent', color: '#fff', fontSize: '14px', flex: 1, outline: 'none', padding: '8px 0' }}
                />
                <button 
                  onClick={handleSend} 
                  disabled={!message.trim()}
                  style={{ 
                    background: message.trim() ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)', 
                    color: message.trim() ? '#000' : 'rgba(255,255,255,0.3)', 
                    borderRadius: '50%', 
                    width: '36px', 
                    height: '36px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    border: 'none',
                    transition: 'all 0.2s ease'
                  }}>
                  <Send size={15} />
                </button>
              </div>
            </div>

            {/* Secure Context & Privacy Status */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', opacity: 0.6, fontSize: '11px', color: '#888', marginTop: '-4px', marginBottom: '-4px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10b981' }} />
                Secure Context
              </span>
              <span>•</span>
              <span>Explicit Permission Only</span>
              <span>•</span>
              <span>No Background Capture</span>
            </div>

            {/* Mobile-Style Call Action Buttons */}
            <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', alignItems: 'center' }}>
              {/* Mic Toggle Button */}
              <button 
                onClick={() => setMicState(!micState)} 
                style={{ 
                  width: '44px', 
                  height: '44px', 
                  borderRadius: '50%', 
                  backgroundColor: micState ? 'var(--accent-active)' : 'rgba(255, 255, 255, 0.1)', 
                  color: micState ? '#fff' : '#aaa', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  border: 'none',
                  transition: 'background-color 0.2s'
                }}>
                <Mic size={18} fill={micState ? 'currentColor' : 'none'} />
              </button>

              {/* Camera Webcam Switcher */}
              <button 
                onClick={() => {
                  if (isWebcamActive) {
                    stopStream();
                  } else {
                    startWebcam();
                  }
                }} 
                style={{ 
                  width: '44px', 
                  height: '44px', 
                  borderRadius: '50%', 
                  backgroundColor: isWebcamActive ? 'var(--accent-active)' : 'rgba(255, 255, 255, 0.1)', 
                  color: isWebcamActive ? '#fff' : '#aaa', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  border: 'none',
                  transition: 'background-color 0.2s'
                }}>
                <Video size={18} fill={isWebcamActive ? 'currentColor' : 'none'} />
              </button>

              {/* Screen Sight Toggle */}
              <button 
                onClick={() => {
                  if (isScreenShareActive) {
                    stopStream();
                  } else {
                    startScreenShare();
                  }
                }} 
                style={{ 
                  width: '44px', 
                  height: '44px', 
                  borderRadius: '50%', 
                  backgroundColor: isScreenShareActive ? 'var(--accent-active)' : 'rgba(255, 255, 255, 0.1)', 
                  color: isScreenShareActive ? '#000' : '#fff', 
                  display: 'flex',  
                  alignItems: 'center', 
                  justifyContent: 'center',
                  border: 'none',
                  transition: 'background-color 0.2s'
                }}>
                <Monitor size={18} fill={isScreenShareActive ? 'currentColor' : 'none'} />
              </button>

              {/* Upload Drop / Document Sight */}
              <button 
                onClick={() => fileInputRef.current?.click()}
                style={{ 
                  width: '44px', 
                  height: '44px', 
                  borderRadius: '50%', 
                  backgroundColor: 'rgba(255, 255, 255, 0.1)', 
                  color: '#fff', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  border: 'none'
                }}>
                <FileImage size={18} />
              </button>

              {/* Red Minimize/Hangup Button */}
              <button 
                onClick={() => { stopStream(); setIsSightOpen(false); }} 
                style={{ 
                  width: '44px', 
                  height: '44px', 
                  borderRadius: '50%', 
                  backgroundColor: '#ef4444', 
                  color: '#fff', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  border: 'none'
                }}>
                <X size={18} />
              </button>
            </div>
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Profile Overlay */}
      <div id="overlay-profile" className={`full-page-overlay ${activeOverlay === 'profile' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">User Profile</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><X size={18} /></button>
        </div>
        <div className="overlay-content">
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <img 
              src={`https://ui-avatars.com/api/?name=${encodeURIComponent(userCallName)}&background=cbfb45&color=000&size=100`} 
              style={{ borderRadius: '50%', marginBottom: '12px' }} 
              alt="Profile" 
            />
            <h2 style={{ fontSize: '20px' }}>{userCallName}</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>{auth.currentUser?.email || 'guest@eburon.ai'}</p>
          </div>
          
          <div className="form-group">
            <label>Persona Background / Behavior</label>
            <textarea 
              className="form-input" 
              rows={5} 
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Tell Beatrice about your business context, communication style, reactive behavior..."
            ></textarea>
          </div>

          <div className="form-group" style={{ marginTop: '24px' }}>
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Stored Memories
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{memories.length} item(s)</span>
            </label>
            <div className="memory-list" style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              
              {/* Manual memory creation form */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', borderRadius: '8px', border: '1px dashed var(--border-color)', backgroundColor: 'rgba(255,255,255,0.01)', marginBottom: '4px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Remember New Context Manually</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input 
                    type="text" 
                    className="form-input" 
                    placeholder="Type a key detail to remember..." 
                    value={newMemoryText} 
                    onChange={(e) => setNewMemoryText(e.target.value)}
                    style={{ flex: 1, fontSize: '13px', padding: '6px 12px', height: '36px' }}
                  />
                  <select 
                    className="form-input" 
                    value={newMemoryType} 
                    onChange={(e) => setNewMemoryType(e.target.value)} 
                    style={{ width: '100px', fontSize: '11px', padding: '6px', height: '36px' }}
                  >
                    <option value="personal">Personal</option>
                    <option value="work">Work</option>
                    <option value="project">Project</option>
                  </select>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button 
                    type="button"
                    className="pill-btn" 
                    style={{ fontSize: '11px', padding: '4px 10px', backgroundColor: 'var(--accent-active)', color: 'var(--bg-main)' }}
                    onClick={handleAddMemory}
                  >
                    + Save to Memory
                  </button>
                </div>
              </div>

              {memories.length === 0 ? (
                <div style={{ padding: '16px', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>
                  No memories stored yet. Talk to Eburon AI to build context!
                </div>
              ) : (
                memories.map((m, i) => (
                  <div key={i} className="memory-item" style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {editingMemoryIndex === i ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <textarea 
                          className="form-input" 
                          value={editingMemoryValue} 
                          onChange={(e) => setEditingMemoryValue(e.target.value)}
                          rows={2}
                          autoFocus
                        />
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                          <button 
                            className="pill-btn" 
                            style={{ fontSize: '11px', padding: '4px 8px' }}
                            onClick={() => setEditingMemoryIndex(null)}
                          >Cancel</button>
                          <button 
                            className="pill-btn" 
                            style={{ fontSize: '11px', padding: '4px 8px', backgroundColor: 'var(--accent-active)', color: 'var(--bg-main)' }}
                            onClick={() => handleUpdateMemory(i, editingMemoryValue)}
                          >Save</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <span style={{ fontSize: '13px', lineHeight: '1.4', flex: 1 }}>{m.content}</span>
                          <div style={{ display: 'flex', gap: '4px', marginLeft: '12px' }}>
                            <button 
                              className="icon-btn" 
                              style={{ color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                              onClick={() => {
                                setEditingMemoryIndex(i);
                                setEditingMemoryValue(m.content);
                              }}
                            >
                              <Pencil size={12} />
                            </button>
                            <button 
                              className="icon-btn" 
                              style={{ color: '#ff4d4d', background: 'transparent', border: 'none', cursor: 'pointer' }}
                              onClick={() => handleDeleteMemory(i)}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '10px', color: 'var(--accent-active)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{m.type}</span>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{new Date(m.timestamp || m.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <button className="save-now-btn" onClick={async (e) => {
             const btn = e.currentTarget;
             btn.textContent = 'Saving...';
             await handleSaveSettingsAndProfile();
             btn.textContent = 'Saved!';
             setTimeout(() => { btn.textContent = 'Save Now'; setActiveOverlay(null); }, 1500);
          }}>Save Now</button>

          <div className="danger-action" onClick={() => { signOut(auth); }}>
            Log Out
          </div>
        </div>
      </div>

      {/* Settings Overlay */}
      <div id="overlay-settings" className={`full-page-overlay ${activeOverlay === 'settings' ? 'active' : ''}`} style={{ backgroundColor: 'var(--bg-panel)' }}>
        <div className="overlay-header">
          <div className="overlay-title">Employee Configuration</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><X size={18} /></button>
        </div>
        <div className="overlay-content" style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 20px' }}>
          
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px' }}>👩‍💼</div>
            <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-main)' }}>Personalize Beatrice</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Customize identity, language, and behavior traits.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '32px' }}>
            <div className="form-group">
              <label>Employee Name</label>
              <input type="text" className="form-input" value={customPersonaName} onChange={(e) => setCustomPersonaName(e.target.value)} placeholder="Beatrice" />
            </div>
            <div className="form-group">
              <label>How she calls you</label>
              <input type="text" className="form-input" value={customUserCallName} onChange={(e) => setCustomUserCallName(e.target.value)} placeholder="Boss" />
            </div>
          </div>

          <div className="form-group">
             <label>Native Language</label>
             <select className="form-input" onChange={(e) => setPersonaLanguage(e.target.value)} value={personaLanguage}>
                <option value="English">English</option>
                <option value="Dutch Flemish">Dutch Flemish</option>
                <option value="Itawit">Itawit</option>
                <option value="Tagalog">Tagalog</option>
                {[
                  "Afrikaans", "Albanian", "Amharic", "Armenian", "Assamese", "Azerbaijani", "Basque", "Belarusian", "Bengali", "Bosnian", "Bulgarian", "Burmese", "Catalan", "Cebuano", "Chichewa", "Corsican", "Croatian", "Czech", "Dhivehi", "Dogri", "Esperanto", "Estonian", "Ewe", "Filipino", "Frisian", "Galician", "Georgian", "Gujarati", "Haitian Creole", "Hausa", "Hawaiian", "Hmong", "Icelandic", "Igbo", "Ilocano", "Irish", "Javanese", "Kannada", "Kazakh", "Khmer", "Kinyarwanda", "Konkani", "Krio", "Kurdish", "Kyrgyz", "Lao", "Latin", "Latvian", "Lingala", "Lithuanian", "Luganda", "Luxembourgish", "Macedonian", "Maithili", "Malagasy", "Malay", "Malayalam", "Maltese", "Maori", "Marathi", "Meiteilon", "Mizo", "Mongolian", "Nepali", "Odia", "Oromo", "Pashto", "Persian", "Punjabi", "Quechua", "Sanskrit", "Scots Gaelic", "Sepedi", "Serbian", "Sesotho", "Shona", "Sindhi", "Sinhala", "Slovak", "Slovenian", "Somali", "Sundanese", "Swahili", "Tajik", "Tamil", "Tatar", "Telugu", "Tigrinya", "Tsonga", "Turkmen", "Twi", "Ukrainian", "Urdu", "Uyghur", "Uzbek", "Welsh", "Xhosa", "Yiddish", "Yoruba", "Zulu"
                ].map(lang => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
             </select>
          </div>

          <div className="form-group">
             <label>Voice Model</label>
             <select className="form-input" onChange={(e) => setVoice(e.target.value)} value={voice}>
                {AVAILABLE_VOICES.map((v) => (
                   <option key={v} value={v}>{v}</option>
                ))}
             </select>
          </div>

          <div className="form-group">
            <label>Employee Mission & Primary Instructions</label>
            <textarea 
              className="form-input" 
              rows={4} 
              value={systemPrompt} 
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="e.g. You are my dedicated personal assistant..."
            />
          </div>

          <div className="form-group">
            <label>Human Persona Traits</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '8px' }}>
              {[
                { id: 'emotive', label: 'Emotive' },
                { id: 'breathy', label: 'Breathy' },
                { id: 'expressive', label: 'Expressive' },
                { id: 'deepNative', label: 'Deep Native' },
                { id: 'fillers', label: 'Fillers' },
                { id: 'bgTask', label: 'Continuous Talk' },
                { id: 'bgAudio', label: 'Background Ambience' },
                { id: 'uncensored', label: 'Open Conversation' }
              ].map((trait) => (
                <div 
                  key={trait.id} 
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderRadius: '16px', backgroundColor: (personaTraits as any)[trait.id] ? 'rgba(203, 251, 69, 0.08)' : 'rgba(255,255,255,0.02)', cursor: 'pointer', border: `1px solid ${(personaTraits as any)[trait.id] ? 'var(--accent-primary)' : 'var(--border-color)'}` }} 
                  onClick={() => toggleTrait(trait.id as any)}
                >
                  <div style={{ color: (personaTraits as any)[trait.id] ? 'var(--accent-primary)' : 'var(--text-muted)' }}>
                    {(personaTraits as any)[trait.id] ? <CheckSquare size={18} /> : <Square size={18} />}
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-main)' }}>{trait.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="form-group" style={{ marginTop: '32px', borderTop: '1px solid var(--border-color)', paddingTop: '32px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cpu size={16} style={{ color: 'var(--accent-primary)' }} />
              Dynamic Tools Management
            </label>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Control the specialized capabilities your employee can use during your sessions.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {tools.map(tool => (
                <div 
                  key={tool.name} 
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between', 
                    padding: '16px', 
                    backgroundColor: 'rgba(255,255,255,0.02)', 
                    border: '1px solid var(--border-color)', 
                    borderRadius: '16px' 
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={tool.isEnabled}
                      onChange={() => toggleTool(tool.name)}
                      style={{ accentColor: 'var(--accent-primary)', width: '18px', height: '18px' }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600 }}>{tool.name.replace(/_/g, ' ')}</span>
                    </div>
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="form-group" style={{ marginTop: '32px', borderTop: '1px solid var(--border-color)', paddingTop: '32px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Plug size={16} style={{ color: 'var(--accent-primary)' }} />
              Google Workspace Account
            </label>
            <button
              onClick={handleGoogleConnectInOverlay}
              style={{
                width: '100%',
                padding: '16px',
                backgroundColor: googleToken ? 'rgba(255,255,255,0.05)' : 'var(--accent-primary)',
                border: googleToken ? '1px solid var(--border-color)' : 'none',
                borderRadius: '16px',
                color: googleToken ? 'var(--text-main)' : 'var(--accent-primary-text)',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              {googleToken ? 'Google Account Connected (Refresh)' : 'Connect Google Workspace'}
            </button>
          </div>

          <button className="save-now-btn" style={{ height: '60px', marginTop: '40px', borderRadius: '16px', fontSize: '18px' }} onClick={handleSavePersonaSettings}>
            Save Profile & Activate Beatrice
          </button>

          <div className="danger-action" style={{ marginBottom: '40px' }} onClick={() => { auth.signOut(); setActiveOverlay(null); }}>
             Sign Out from System
          </div>
        </div>
      </div>

      {/* History Overlay */}
      <div id="overlay-history" className={`full-page-overlay ${activeOverlay === 'history' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">Activity History</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><X size={18} /></button>
        </div>
        <div className="overlay-content" style={{ padding: '20px', overflowY: 'auto', height: '100%' }}>
          {/* Search Bar inside History Page */}
          <div style={{
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
            marginBottom: '20px',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            padding: '10px 14px',
            borderRadius: '12px',
            border: '1px solid var(--border-color)'
          }}>
            <Search size={16} style={{ color: 'var(--accent-active)' }} />
            <input
              type="text"
              placeholder="Search past logs or session dialog history..."
              value={historySearchQuery}
              onChange={(e) => setHistorySearchQuery(e.target.value)}
              style={{
                background: 'none',
                border: 'none',
                outline: 'none',
                flex: 1,
                color: '#fff',
                fontSize: '13.5px'
              }}
            />
            {historySearchQuery && (
              <button
                onClick={() => setHistorySearchQuery('')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer'
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {memorySavingStatus && (
            <div style={{
              backgroundColor: 'rgba(206, 241, 88, 0.08)',
              border: '1px solid #cef158',
              borderRadius: '10px',
              padding: '8px 12px',
              fontSize: '12.5px',
              color: '#cef158',
              fontWeight: 600,
              marginBottom: '16px',
              textAlign: 'center',
              animation: 'pulse 2s infinite'
            }}>
              {memorySavingStatus}
            </div>
          )}
          {(() => {
            const filtered = historySearchQuery.trim()
              ? historyTurns.filter(turn => turn.text.toLowerCase().includes(historySearchQuery.toLowerCase()))
              : historyTurns;

            const groups: { id: string; startTime: Date; turns: any[] }[] = [];
            if (filtered.length > 0) {
              const sortedTurns = [...filtered].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

              let currentSession: { id: string; startTime: Date; turns: any[] } | null = null;
              const SESSION_THRESHOLD_MS = 25 * 60 * 1000; // 25 minutes session groupings

              sortedTurns.forEach((turn) => {
                const turnTime = turn.timestamp ? new Date(turn.timestamp) : new Date();
                if (!currentSession) {
                  currentSession = {
                    id: `session_${turnTime.getTime()}`,
                    startTime: turnTime,
                    turns: [turn]
                  };
                } else {
                  const lastTurnInSession = currentSession.turns[currentSession.turns.length - 1];
                  const lastTime = lastTurnInSession.timestamp ? new Date(lastTurnInSession.timestamp) : new Date();
                  if (turnTime.getTime() - lastTime.getTime() < SESSION_THRESHOLD_MS) {
                    currentSession.turns.push(turn);
                  } else {
                    groups.push(currentSession);
                    currentSession = {
                      id: `session_${turnTime.getTime()}`,
                      startTime: turnTime,
                      turns: [turn]
                    };
                  }
                }
              });

              if (currentSession) {
                groups.push(currentSession);
              }
            }

            const sessionGroups = groups.reverse();

            if (sessionGroups.length === 0) {
              return (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '40px' }}>
                  {historyTurns.length === 0 ? 'No activity history found.' : 'No sessions match your search keyword.'}
                </p>
              );
            }

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '60px' }}>
                {sessionGroups.map((session) => {
                  const isExpanded = expandedSessions[session.id] !== false;
                  const sessionDateStr = session.startTime.toLocaleDateString(undefined, { 
                    weekday: 'short', 
                    month: 'short', 
                    day: 'numeric' 
                  });
                  const sessionTimeStr = session.startTime.toLocaleTimeString(undefined, { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  });

                  return (
                    <div 
                      key={session.id} 
                      style={{ 
                        borderRadius: '16px', 
                        backgroundColor: 'rgba(25, 25, 25, 0.65)', 
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        overflow: 'hidden',
                        backdropFilter: 'blur(12px)',
                        transition: 'border-color 0.2s'
                      }}
                    >
                      {/* Session Header (Collapsible toggle) */}
                      <div 
                        onClick={() => setExpandedSessions(prev => ({ ...prev, [session.id]: !isExpanded }))}
                        style={{
                          padding: '14px 18px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          backgroundColor: 'rgba(255, 255, 255, 0.02)',
                          borderBottom: isExpanded ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
                          userSelect: 'none'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{
                            backgroundColor: 'rgba(203, 251, 69, 0.1)',
                            border: '1px solid var(--accent-active)',
                            borderRadius: '8px',
                            padding: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--accent-active)'
                          }}>
                            <MessageSquare size={16} />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontSize: '14px', fontWeight: 700, color: '#f3f4f6' }}>
                              {sessionDateStr} at {sessionTimeStr}
                            </span>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              {session.turns.length} dialogue {session.turns.length === 1 ? 'exchange' : 'exchanges'}
                            </span>
                          </div>
                        </div>
                        <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                        </div>
                      </div>

                      {/* Session Messages Body */}
                      {isExpanded && (
                        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: 'rgba(0,0,0,0.15)' }}>
                          {session.turns.map((turn, tIdx) => {
                            const turnKey = turn.timestamp ? `${new Date(turn.timestamp).getTime()}_${turn.role}` : `${session.id}_${tIdx}_${turn.role}`;
                            const isSaved = savedTurnsToMemoryKeys[turnKey];

                            return (
                              <div 
                                key={tIdx} 
                                style={{ 
                                  display: 'flex', 
                                  flexDirection: 'column', 
                                  gap: '8px',
                                  padding: '12px',
                                  borderRadius: '12px',
                                  backgroundColor: turn.role === 'user' ? 'rgba(255, 255, 255, 0.02)' : 'rgba(203, 251, 69, 0.02)',
                                  border: `1px solid ${turn.role === 'user' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(203, 251, 69, 0.08)'}`
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ 
                                    fontSize: '11px', 
                                    fontWeight: 700, 
                                    color: turn.role === 'user' ? '#9ca3af' : 'var(--accent-active)',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.5px'
                                  }}>
                                    {turn.role === 'user' ? 'User' : 'Beatrice'}
                                  </span>
                                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                    {turn.timestamp ? new Date(turn.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}
                                  </span>
                                </div>
                                
                                <p style={{ 
                                  fontSize: '13.5px', 
                                  lineHeight: '1.5', 
                                  color: '#e5e7eb', 
                                  margin: 0, 
                                  whiteSpace: 'pre-line',
                                  wordBreak: 'break-word'
                                }}>
                                  {turn.text}
                                </p>

                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                                  <button
                                    onClick={() => handleSaveTurnToMemory(turn.text, turn.role, turnKey)}
                                    disabled={isSaved}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '5px',
                                      fontSize: '10.5px',
                                      color: isSaved ? '#cef158' : '#9ca3af',
                                      backgroundColor: isSaved ? 'rgba(206, 241, 88, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                                      border: `1px solid ${isSaved ? '#cef158' : 'rgba(255, 255, 255, 0.08)'}`,
                                      borderRadius: '6px',
                                      padding: '3px 8px',
                                      cursor: isSaved ? 'default' : 'pointer',
                                      transition: 'all 0.2s'
                                    }}
                                    title={isSaved ? "Saved to Beatrice's memory" : "Commit this dialogue turn to AI memory"}
                                  >
                                    <Brain size={11} style={{ color: isSaved ? '#cef158' : '#9ca3af' }} />
                                    <span>{isSaved ? "Saved to memory" : "Commit to AI Memory"}</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          /* legacy list deleted */
          {false && (historyTurns.slice().reverse().map((turn, i) => (
                 <div key={i} style={{ padding: '12px', borderRadius: '12px', backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                       <span style={{ fontSize: '11px', fontWeight: 600, color: turn.role === 'user' ? 'var(--accent-active)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          {turn.role}
                       </span>
                       <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                          {new Date(turn.timestamp).toLocaleString()}
                       </span>
                    </div>
                    <p style={{ fontSize: '13px', lineHeight: '1.4', margin: 0, color: 'var(--text-main)', whiteSpace: 'pre-line' }}>
                       {turn.text}
                    </p>
                 </div>
               )))}
        </div>
      </div>

      {/* WhatsApp Overlay */}

      {/* WhatsApp Overlay */}
      <div id="overlay-whatsapp" className={`full-page-overlay ${activeOverlay === 'whatsapp' ? 'active' : ''}`} style={{ backgroundColor: '#0b141a' }}>
        <div className="overlay-header" style={{ backgroundColor: '#111b21', borderBottom: '1px solid #222e35' }}>
          <div className="overlay-title" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
             <svg style={{ width: '24px', height: '24px', fill: '#00a884' }} viewBox="0 0 24 24">
                <path d="M12.011 2c-5.502 0-9.96 4.458-9.96 9.96 0 1.758.455 3.41 1.25 4.857L2 22l5.353-1.405c1.393.76 2.972 1.192 4.658 1.192 5.502 0 9.96-4.458 9.96-9.96 0-5.502-4.458-9.96-9.96-9.96zm6.31 14.123c-.26.733-1.527 1.332-2.112 1.4-1.185.137-2.618-.455-4.57-1.257-2.5-1.025-4.086-3.57-4.21-3.738-.124-.167-.923-1.233-.923-2.35 0-1.118.577-1.668.783-1.89.206-.223.454-.28.605-.28.152 0 .304.004.436.01.14.007.33.012.5.424.175.424.6.1.6 1.46.06.124.1.268.016.433-.083.165-.124.268-.247.412-.124.145-.26.323-.372.433-.124.124-.253.258-.11.505.145.247.64 1.054 1.373 1.705.943.84 1.737 1.1 1.985 1.223.248.124.392.103.537-.062.145-.165.62-.722.784-.97.165-.247.33-.206.557-.123.227.082 1.444.68 1.692.804.247.124.412.185.474.29.062.103.062.6-.198 1.333z"/>
            </svg>
            <span style={{ color: '#e9edef', fontWeight: 600 }}>Connect WhatsApp Channel</span>
          </div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)} style={{ color: '#8696a0' }}><X size={18} /></button>
        </div>
        
        <div className="overlay-content" style={{ padding: '24px', color: '#e9edef', backgroundColor: '#0b141a', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <AnimatePresence mode="wait">
              {waStep === 'scan' && (
                <motion.div 
                  key="scan"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="step-panel active"
                  style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}
                >
                    <div style={{ paddingBottom: '20px' }}>
                        <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px', textAlign: 'center' }}>Pair your WhatsApp</h2>
                        <p style={{ fontSize: '13px', color: '#8696a0', lineHeight: 1.5, textAlign: 'center', marginBottom: '20px' }}>Link your personal or business account to Eburon. This allows your AI assistant to act on your behalf, read your messages, and manage your chats.</p>
                        
                        <div style={{ backgroundColor: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '16px', border: '1px solid #222e35', marginBottom: '24px' }}>
                          <div style={{ fontSize: '12px', color: '#8696a0', marginBottom: '10px' }}>Identity Reference</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{ padding: '8px', backgroundColor: 'rgba(203, 251, 69, 0.1)', borderRadius: '8px', color: 'var(--accent-active)' }}><User size={16} /></div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontSize: '13px', color: '#e9edef', fontWeight: 600 }}>{auth.currentUser?.email}</span>
                              <span style={{ fontSize: '11px', color: '#8696a0', fontFamily: 'monospace' }}>UID: {auth.currentUser?.uid?.substring(0, 12)}...</span>
                            </div>
                          </div>
                        </div>

                        {!qrImageUrl && (
                          <button 
                            onClick={fetchQRCode}
                            disabled={qrLoading}
                            style={{ backgroundColor: '#00a884', color: '#fff', border: 'none', borderRadius: '12px', padding: '14px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', width: '100%', marginBottom: '10px' }}
                          >
                            {qrLoading ? 'Connecting...' : 'Generate Pairing QR'}
                          </button>
                        )}
                    </div>
                    
                    {qrImageUrl && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingBottom: '20px' }}>
                          <div style={{ backgroundColor: '#ffffff', padding: '14px', borderRadius: '16px', boxShadow: '0 8px 20px rgba(0,0,0,0.4)', marginBottom: '16px' }}>
                              <img src={qrImageUrl} alt="WhatsApp QR" style={{ width: '180px', height: '180px', objectFit: 'contain' }} />
                          </div>
                          <p style={{ fontSize: '12px', color: '#8696a0', textAlign: 'center', maxWidth: '240px', lineHeight: '1.4', marginBottom: '20px' }}>
                            Scan this QR code with WhatsApp (Settings {'>'} Linked Devices) to pair your account.
                          </p>

                          <div style={{ width: '100%', borderTop: '1px solid #222e35', paddingTop: '20px', marginTop: '10px' }}>
                            <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#e9edef', marginBottom: '12px', textAlign: 'center' }}>Or Pair with Phone Number</h3>
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                              <input 
                                type="text"
                                value={pairingPhone}
                                onChange={(e) => setPairingPhone(e.target.value)}
                                placeholder="e.g. 639056741316"
                                style={{ flex: 1, padding: '10px', borderRadius: '8px', backgroundColor: '#1e293b', border: '1px solid #334155', color: '#f8fafc', fontSize: '13px' }}
                              />
                              <button 
                                onClick={fetchPairingCode}
                                disabled={qrLoading}
                                style={{ backgroundColor: '#38bdf8', color: '#0f172a', border: 'none', borderRadius: '8px', padding: '0 16px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                              >
                                {qrLoading ? '...' : 'Get Code'}
                              </button>
                            </div>

                            {pairingCode && (
                              <div style={{ textAlign: 'center', backgroundColor: 'rgba(56, 189, 248, 0.1)', padding: '16px', borderRadius: '12px', border: '1px dashed #38bdf8' }}>
                                <div style={{ fontSize: '11px', color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>Your Pairing Code</div>
                                <div style={{ fontSize: '28px', fontWeight: 700, color: '#f8fafc', letterSpacing: '4px', fontFamily: 'monospace' }}>{pairingCode}</div>
                                <p style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px', lineHeight: '1.3' }}>
                                  Go to <b>Linked Devices</b> {'>'} <b>Link with phone number instead</b> on your phone and enter this code.
                                </p>
                              </div>
                            )}
                          </div>
                      </div>
                    )}

                    {whatsappInfo?.whatsappConnected && (
                      <button 
                        onClick={() => setWaStep('connected')}
                        style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: '#e9edef', border: '1px solid #222e35', borderRadius: '12px', padding: '12px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', width: '100%' }}
                      >
                        Finish & View Status
                      </button>
                    )}
                </motion.div>
              )}

              {waStep === 'connected' && (
                <motion.div 
                  key="connected"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="step-panel"
                  style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}
                >
                    <div style={{ paddingBottom: '20px' }}>
                        <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px', textAlign: 'center' }}>WhatsApp Connected</h2>
                        <p style={{ fontSize: '13px', color: '#8696a0', lineHeight: 1.5, textAlign: 'center', marginBottom: '20px' }}>Beatrice is linked to your WhatsApp via our business channel.</p>
                    </div>

                    <div style={{ backgroundColor: '#111b21', border: '1px solid #222e35', borderRadius: '16px', padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '24px' }}>
                        <div style={{ position: 'relative', marginBottom: '16px' }}>
                            <div style={{ width: '80px', height: '80px', borderRadius: '50%', backgroundColor: '#202c33', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '3px solid #00a884', overflow: 'hidden' }}>
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="#8696a0">
                                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                                </svg>
                            </div>
                            <div style={{ width: '14px', height: '14px', backgroundColor: '#25d366', border: '2px solid #111b21', borderRadius: '50%', position: 'absolute', bottom: '3px', right: '3px' }}></div>
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 600, color: '#e9edef', marginBottom: '4px' }}>{whatsappInfo?.whatsappDisplayName || 'AI Assistant'}</div>
                        <div style={{ fontSize: '14px', color: '#8696a0', marginBottom: '16px' }}>{whatsappInfo?.whatsappPhone || ''}</div>
                        <span style={{ backgroundColor: 'rgba(0, 168, 132, 0.12)', color: '#00a884', padding: '6px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Active Identity</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '16px', border: '1px solid #222e35', marginBottom: '24px' }}>
                      <div style={{ fontSize: '11px', color: '#8696a0', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, marginBottom: '4px' }}>Active Permissions</div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '13px', color: '#e9edef' }}>Receive Messages</span>
                        <button onClick={() => toggleWaPerm('receive')} style={{ background: 'none', border: 'none', color: waPerms.receive ? '#00a884' : '#555', cursor: 'pointer' }}>
                          {waPerms.receive ? <CheckSquare size={18} /> : <Square size={18} />}
                        </button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '13px', color: '#e9edef' }}>Send Messages</span>
                        <button onClick={() => toggleWaPerm('send')} style={{ background: 'none', border: 'none', color: waPerms.send ? '#00a884' : '#555', cursor: 'pointer' }}>
                          {waPerms.send ? <CheckSquare size={18} /> : <Square size={18} />}
                        </button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '13px', color: '#e9edef' }}>AI Action Power</span>
                        <button onClick={() => toggleWaPerm('autoSend')} style={{ background: 'none', border: 'none', color: waPerms.autoSend ? '#00a884' : '#555', cursor: 'pointer' }}>
                          {waPerms.autoSend ? <CheckSquare size={18} /> : <Square size={18} />}
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '20px' }}>
                        <button onClick={handleSaveWaPermissions} style={{ backgroundColor: '#00a884', color: '#fff', border: 'none', borderRadius: '10px', padding: '14px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', width: '100%' }}>
                            Update Permissions
                        </button>
                        <button onClick={handleDisconnectWhatsapp} style={{ backgroundColor: 'transparent', color: '#ea0038', border: '1px solid #ea0038', borderRadius: '10px', padding: '12px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', width: '100%' }}>
                            Disconnect Account
                        </button>
                    </div>
                </motion.div>
              )}
            </AnimatePresence>
        </div>
      </div>


      {/* Scanner Overlay */}
      <div id="overlay-scanner" className={`full-page-overlay ${activeOverlay === 'scanner' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">Supermarket Scanner</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><X size={18} /></button>
        </div>
        <div className="overlay-content" style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center', padding: '20px' }}>
          <div className="scanner-container" style={{ width: '100%', maxWidth: '400px', aspectRatio: '3/4', backgroundColor: '#000' }}>
            <div className="scanner-laser" />
            <div className="scanner-pulse" />
            {activeOverlay === 'scanner' ? (
              <Scanner
                onScan={(result) => {
                  if (result && result.length > 0) {
                    const text = result[0].rawValue;
                    setActiveOverlay(null);
                    const scanMsg = `Supermarket Scanner scan: "${text}". Boss just scanned this product! Identify it precisely in ${personaLanguage}, tell an exciting story about its origin or ingredients, and give me some legitimate, mind-blowing trivia. Make it sound exciting!`;
                    if (connected) client.send({ text: scanMsg });
                    useLogStore.getState().addTurn({ role: 'user', text: scanMsg, isFinal: true });
                  }
                }}
                formats={[
                  'qr_code',
                  'ean_13',
                  'ean_8',
                  'upc_a',
                  'upc_e',
                  'code_128',
                  'code_39',
                  'code_93',
                  'itf',
                  'codabar',
                  'aztec',
                  'data_matrix',
                  'pdf417'
                ]}
                components={{
                  tracker: true,
                  audio: false,
                  finder: true,
                }}
                styles={{
                  container: { width: '100%', height: '100%', objectFit: 'cover' }
                }}
              />
            ) : <Video size={48} color="#444" />}
          </div>

          <div style={{ width: '100%', maxWidth: '400px', marginTop: '20px' }}>
             <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Scan Simulator</h4>
             <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button 
                  className="pill-btn" 
                  style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', width: '100%', fontSize: '13px', textAlign: 'left', backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', cursor: 'pointer', borderRadius: '8px' }}
                  onClick={() => {
                     setActiveOverlay(null);
                     const scanMsg = `Supermarket Scanner scan: "5411188112920". Boss just scanned Alpro Barista Oat Milk! Identify it precisely, tell an exciting story about it, and give me some legitimate, mind-blowing trivia. Make it sound exciting!`;
                     if (connected) client.send({ text: scanMsg });
                     useLogStore.getState().addTurn({ role: 'user', text: scanMsg, isFinal: true });
                  }}
                >
                  <span>🥛 Alpro Barista Oat Milk</span>
                  <span style={{ color: 'var(--accent-active)', fontFamily: 'monospace' }}>5411188112920</span>
                </button>
                <button 
                  className="pill-btn" 
                  style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', width: '100%', fontSize: '13px', textAlign: 'left', backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', cursor: 'pointer', borderRadius: '8px' }}
                  onClick={() => {
                     setActiveOverlay(null);
                     const scanMsg = `Supermarket Scanner scan: "5410126006152". Boss just scanned Lotus Biscoff Cookies! Identify it precisely, tell an exciting story about it, and give me some legitimate, mind-blowing trivia. Make it sound exciting!`;
                     if (connected) client.send({ text: scanMsg });
                     useLogStore.getState().addTurn({ role: 'user', text: scanMsg, isFinal: true });
                  }}
                >
                  <span>🍪 Lotus Biscoff Cookies</span>
                  <span style={{ color: 'var(--accent-active)', fontFamily: 'monospace' }}>5410126006152</span>
                </button>
                <button 
                  className="pill-btn" 
                  style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', width: '100%', fontSize: '13px', textAlign: 'left', backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', cursor: 'pointer', borderRadius: '8px' }}
                  onClick={() => {
                     setActiveOverlay(null);
                     const scanMsg = `Supermarket Scanner scan: "5410228141447". Boss just scanned Stella Artois Belgian Beer! Identify it precisely, tell an exciting story about it, and give me some legitimate, mind-blowing trivia. Make it sound exciting!`;
                     if (connected) client.send({ text: scanMsg });
                     useLogStore.getState().addTurn({ role: 'user', text: scanMsg, isFinal: true });
                  }}
                >
                  <span>🍺 Stella Artois Export Beer</span>
                  <span style={{ color: 'var(--accent-active)', fontFamily: 'monospace' }}>5410228141447</span>
                </button>
             </div>
          </div>
        </div>
      </div>

      {/* Map Overlay */}
      <div id="overlay-map" className={`full-page-overlay ${activeOverlay === 'map' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">Location Map</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><X size={18} /></button>
        </div>
        <div className="overlay-content" style={{ height: '100%', padding: '0', position: 'relative' }}>
          <LocationMap active={activeOverlay === 'map'} />
        </div>
      </div>

      {/* Shared Sight Overlay - Gateway to visual intelligence */}
      <div id="overlay-sight" className={`full-page-overlay ${activeOverlay === 'sight' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">Shared Sight</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><X size={18} /></button>
        </div>
        <div className="overlay-content" style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <Eye size={48} color="var(--accent-primary)" style={{ marginBottom: '16px' }} />
          <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Beatrice Shared Sight</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center', marginBottom: '24px', maxWidth: '320px' }}>
             Allow Beatrice to see what you choose: camera, screen share, or images. She can read, analyze, and explain visual content in real-time.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', maxWidth: '320px' }}>
            <button 
              className="save-now-btn" 
              onClick={() => {
                setActiveOverlay(null);
                setIsSightOpen(true);
                startWebcam();
              }}
              style={{ width: '100%', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <Camera size={18} />
              Open Camera Sight
            </button>
            <button 
              className="save-now-btn" 
              onClick={() => {
                setActiveOverlay(null);
                setIsSightOpen(true);
                startScreenShare();
              }}
              style={{ width: '100%', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', backgroundColor: 'var(--bg-chip)', color: '#fff', border: '1px solid var(--border-color)' }}>
              <Monitor size={18} />
              Open Screen Sight
            </button>
          </div>
        </div>
      </div>

      {/* Picker Overlay */}
      <div id="overlay-picker" className={`full-page-overlay ${activeOverlay === 'picker' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">Google Drive Picker</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><X size={18} /></button>
        </div>
        <div className="overlay-content" style={{ padding: '20px', overflowY: 'auto', height: '100%' }}>
          <button 
            className="save-now-btn" 
            onClick={() => {
              setActiveOverlay(null);
              handleOpenPicker();
            }}
            style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%', background: 'var(--accent-active)', color: '#000' }}
          >
            <FolderOpen size={18} /> Launch Live Google Picker
          </button>

          <div className="form-group" style={{ marginBottom: '24px' }}>
             <div className="input-wrapper" style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--surface-color)', padding: '12px 16px', borderRadius: '12px' }}>
                <Search size={20} color="var(--text-muted)" style={{ marginRight: '12px' }} />
                <input type="text" placeholder="Search in Drive..." style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, color: 'var(--text-main)', fontSize: 16 }} />
             </div>
          </div>
          
          <h4 style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>Recent Files</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '40px' }}>
             <div 
               style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px', backgroundColor: 'var(--surface-color)', borderRadius: '12px', cursor: 'pointer' }} 
               onClick={() => {
                 setActiveOverlay(null);
                 const text = "I selected 'Project Brief 2026.docx' from Google Drive. Please analyze this brief and explain its main objectives to me.";
                 if (connected) client.send({ text });
                 useLogStore.getState().addTurn({ role: 'user', text, isFinal: true });
               }}
             >
                <FileStack size={32} color="#4285F4" />
                <div style={{ flex: 1 }}>
                   <div style={{ fontWeight: 600 }}>Project Brief 2026.docx</div>
                   <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Modified today by You</div>
                </div>
             </div>
             <div 
               style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px', backgroundColor: 'var(--surface-color)', borderRadius: '12px', cursor: 'pointer' }} 
               onClick={() => {
                 setActiveOverlay(null);
                 const text = "I selected 'Q3 Financials.xlsx' from Google Drive. Please review the financial sheet, check the balance, and summarize margins.";
                 if (connected) client.send({ text });
                 useLogStore.getState().addTurn({ role: 'user', text, isFinal: true });
               }}
             >
                <Table size={32} color="#0F9D58" />
                <div style={{ flex: 1 }}>
                   <div style={{ fontWeight: 600 }}>Q3 Financials.xlsx</div>
                   <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Modified yesterday</div>
                </div>
             </div>
             <div 
               style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '16px', backgroundColor: 'var(--surface-color)', borderRadius: '12px', cursor: 'pointer' }} 
               onClick={() => {
                 setActiveOverlay(null);
                 const text = "I selected 'Investor Pitch Deck.pptx' from Google Drive. Walk me through the pitch flows and suggest feedback to make it punchier.";
                 if (connected) client.send({ text });
                 useLogStore.getState().addTurn({ role: 'user', text, isFinal: true });
               }}
             >
                <Presentation size={32} color="#F4B400" />
                <div style={{ flex: 1 }}>
                   <div style={{ fontWeight: 600 }}>Investor Pitch Deck.pptx</div>
                   <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Modified last week</div>
                </div>
             </div>
          </div>
       </div>
      </div>

      {/* Google Keep Overlay */}
      <div id="overlay-keep" className={`full-page-overlay ${activeOverlay === 'keep' ? 'active' : ''}`}>
        <div className="overlay-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="overlay-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ display: 'inline-flex', padding: 8, background: '#FFF8E1', borderRadius: '10px', color: '#F4B400' }}>
              <CheckSquare size={20} />
            </span>
            Eburon Keep Workspace
          </div>
          <button className="close-overlay-btn" onClick={() => { setActiveOverlay(null); setKeepStatusMessage(null); }}><X size={18} /></button>
        </div>

        <div className="overlay-content" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: '16px 20px calc(80px + env(safe-area-inset-bottom))' }}>
          {/* Controls Panel */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
            <button
              onClick={() => {
                setKeepNotesSource('firestore');
                setKeepStatusMessage(null);
              }}
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: '12px',
                fontSize: '13px',
                fontWeight: 600,
                background: keepNotesSource === 'firestore' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.03)',
                color: keepNotesSource === 'firestore' ? '#000' : 'var(--text-muted)',
                border: '1px solid var(--border-color)',
              }}
            >
              Private Synced Notes (Cloud)
            </button>
            <button
              onClick={async () => {
                setKeepNotesSource('keep_api');
                setKeepStatusMessage(null);
                const token = await getAccessToken();
                if (!token) {
                  setKeepStatusMessage("Google Sign-In required to connect Google Keep Cloud API.");
                  return;
                }
                try {
                  const res = await fetch(`https://keep.googleapis.com/v1/notes`, {
                    headers: { Authorization: `Bearer ${token}` }
                  });
                  if (!res.ok) {
                    const errorDetails = await res.json().catch(() => ({}));
                    throw new Error(errorDetails?.error?.message || `HTTP error ${res.status}`);
                  }
                  const data = await res.json();
                  if (data?.notes) {
                    const mappedNotes = data.notes.map((n: any) => ({
                      id: n.name,
                      title: n.title || 'Untitled Keep Note',
                      content: n.body?.text?.text || '',
                      createdAt: n.createTime || new Date().toISOString(),
                      updatedAt: n.updateTime || new Date().toISOString(),
                      isKeepApiNote: true
                    }));
                    setKeepNotes(mappedNotes);
                    setKeepStatusMessage("Successfully fetched real-time notes from Google Keep Cloud API!");
                  } else {
                    setKeepNotes([]);
                    setKeepStatusMessage("Your Google Keep lists are currently empty.");
                  }
                } catch (err: any) {
                  console.warn("Real Google Keep fetch error:", err);
                  setKeepStatusMessage("Note: Google Keep API has restricted Workspace access or is disabled for standard @gmail.com accounts. Reverting safely to Eburon Private Notes!");
                  setTimeout(() => {
                    setKeepNotesSource('firestore');
                  }, 4000);
                }
              }}
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: '12px',
                fontSize: '13px',
                fontWeight: 600,
                background: keepNotesSource === 'keep_api' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.03)',
                color: keepNotesSource === 'keep_api' ? '#000' : 'var(--text-muted)',
                border: '1px solid var(--border-color)',
              }}
            >
              Sync Google Keep API
            </button>
          </div>

          {keepStatusMessage && (
            <div style={{
              padding: '12px 16px',
              borderRadius: '12px',
              backgroundColor: 'rgba(255,255,255,0.04)',
              borderLeft: '4px solid var(--accent-primary)',
              fontSize: '13px',
              color: 'var(--text-main)',
              lineHeight: '1.4',
              marginBottom: '16px'
            }}>
              {keepStatusMessage}
            </div>
          )}

          {/* Create Note Section */}
          <div style={{
            backgroundColor: 'var(--surface-color, #111)',
            border: '1px solid var(--border-color)',
            borderRadius: '16px',
            padding: '16px',
            marginBottom: '20px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
          }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px', color: 'var(--text-main)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Take a new note</h3>
            
            <input
              type="text"
              placeholder="Title"
              value={keepNewNoteTitle}
              onChange={(e) => setKeepNewNoteTitle(e.target.value)}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#fff',
                fontSize: '15px',
                fontWeight: 600,
                marginBottom: '10px'
              }}
            />

            {!keepIsChecklist ? (
              <textarea
                placeholder="Take a note..."
                value={keepNewNoteContent}
                onChange={(e) => setKeepNewNoteContent(e.target.value)}
                rows={2}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '14px',
                  lineHeight: '1.5',
                  resize: 'none',
                  marginBottom: '12px'
                }}
              />
            ) : (
              <div style={{ marginBottom: '12px' }}>
                {keepNewNoteItems.map((item, index) => (
                  <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <button
                      onClick={() => {
                        const next = [...keepNewNoteItems];
                        next[index].checked = !next[index].checked;
                        setKeepNewNoteItems(next);
                      }}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', display: 'inline-flex' }}
                    >
                      {item.checked ? <CheckSquare size={16} color="var(--accent-active)" /> : <Square size={16} />}
                    </button>
                    <span style={{ textDecoration: item.checked ? 'line-through' : 'none', color: item.checked ? 'var(--text-muted)' : '#abc', fontSize: '13px' }}>
                      {item.text}
                    </span>
                    <button
                      onClick={() => {
                        setKeepNewNoteItems(keepNewNoteItems.filter((_, i) => i !== index));
                      }}
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--accent-danger)' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <input
                    type="text"
                    placeholder="Add checklist item..."
                    value={keepNewNoteItemInput}
                    onChange={(e) => setKeepNewNoteItemInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && keepNewNoteItemInput.trim()) {
                        setKeepNewNoteItems([...keepNewNoteItems, { text: keepNewNoteItemInput.trim(), checked: false }]);
                        setKeepNewNoteItemInput('');
                      }
                    }}
                    style={{
                      flex: 1,
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '6px 10px',
                      fontSize: '13px',
                      color: '#fff',
                      outline: 'none'
                    }}
                  />
                  <button
                    onClick={() => {
                      if (keepNewNoteItemInput.trim()) {
                        setKeepNewNoteItems([...keepNewNoteItems, { text: keepNewNoteItemInput.trim(), checked: false }]);
                        setKeepNewNoteItemInput('');
                      }
                    }}
                    style={{
                      background: 'var(--accent-primary)',
                      color: '#000',
                      border: 'none',
                      borderRadius: '8px',
                      width: '32px',
                      height: '32px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700
                    }}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* Note toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '10px' }}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  title="Toggle Checklist Mode"
                  onClick={() => setKeepIsChecklist(!keepIsChecklist)}
                  style={{
                    background: keepIsChecklist ? 'rgba(203, 251, 69, 0.15)' : 'none',
                    borderRadius: '8px',
                    border: 'none',
                    color: keepIsChecklist ? 'var(--accent-primary)' : 'var(--text-muted)',
                    width: '30px',
                    height: '30px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <ListChecks size={16} />
                </button>
                
                {/* Note Color selection picker */}
                <div style={{ position: 'relative', display: 'flex', gap: '3px', alignItems: 'center' }}>
                  {['default', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'].map((col) => {
                    const clr = col === 'default' ? '#333' : 
                                col === 'red' ? '#7d3835' : 
                                col === 'orange' ? '#7d5229' :
                                col === 'yellow' ? '#7a6616' :
                                col === 'green' ? '#2f633f' :
                                col === 'teal' ? '#225e56' :
                                col === 'blue' ? '#2c4f82' :
                                col === 'purple' ? '#533b7a' : '#7a3e5f';
                    return (
                      <button
                        key={col}
                        onClick={() => setKeepNewNoteColor(col)}
                        style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '50%',
                          backgroundColor: clr,
                          border: keepNewNoteColor === col ? '1px solid #fff' : 'none',
                          cursor: 'pointer',
                          padding: 0
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              <button
                onClick={async () => {
                  if (!keepNewNoteTitle.trim() && !keepNewNoteContent.trim() && keepNewNoteItems.length === 0) {
                    alert("Please write note content first!");
                    return;
                  }
                  setKeepNoteSaveLoading(true);
                  try {
                    const user = auth.currentUser;
                    if (!user) throw new Error("Must be logged in to create notes.");
                    
                    let finalContent = keepNewNoteContent;
                    if (keepIsChecklist || keepNewNoteColor !== 'default' || keepNewNoteItems.length > 0) {
                      finalContent = JSON.stringify({
                        text: keepNewNoteContent,
                        isChecklist: keepIsChecklist,
                        color: keepNewNoteColor,
                        items: keepNewNoteItems
                      });
                    }

                    const { collection, addDoc } = await import('firebase/firestore');
                    const notesColRef = collection(db, 'users', user.uid, 'notes');
                    await addDoc(notesColRef, {
                      title: keepNewNoteTitle.trim() || 'Untitled Note',
                      content: finalContent,
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString()
                    });

                    setKeepNewNoteTitle('');
                    setKeepNewNoteContent('');
                    setKeepNewNoteItems([]);
                    setKeepNewNoteColor('default');
                    setKeepIsChecklist(false);
                    setKeepStatusMessage("Note pinned successfully!");
                  } catch (e: any) {
                    console.error("Failed to save note:", e);
                    alert("Error saving note: " + e.message);
                  } finally {
                    setKeepNoteSaveLoading(false);
                  }
                }}
                disabled={keepNoteSaveLoading}
                style={{
                  padding: '6px 14px',
                  borderRadius: '12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  backgroundColor: 'var(--accent-primary)',
                  color: '#000',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                {keepNoteSaveLoading ? 'Saving...' : 'Pin Note'}
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px' }}>
            <div className="input-wrapper" style={{ flex: 1, padding: 0 }}>
              <div className="input-bar" style={{ padding: '4px 6px 4px 12px' }}>
                <Search size={16} color="var(--text-muted)" style={{ marginRight: '8px' }} />
                <input
                  type="text"
                  placeholder="Search notes..."
                  value={keepSearchQuery}
                  onChange={(e) => setKeepSearchQuery(e.target.value)}
                  style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, color: '#fff', fontSize: '13px' }}
                />
                {keepSearchQuery && (
                  <button onClick={() => setKeepSearchQuery('')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '11px', marginRight: '6px' }}><X size={14} /></button>
                )}
              </div>
            </div>

            {/* Color filter list */}
            <div style={{ display: 'flex', gap: '4px' }}>
              {['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'].map((col) => {
                const isSelected = keepColorFilter === col;
                const clr = col === 'red' ? '#7d3835' : 
                            col === 'orange' ? '#7d5229' :
                            col === 'yellow' ? '#7a6616' :
                            col === 'green' ? '#2f633f' :
                            col === 'teal' ? '#225e56' :
                            col === 'blue' ? '#2c4f82' :
                            col === 'purple' ? '#533b7a' : '#7a3e5f';
                return (
                  <button
                    key={col}
                    onClick={() => setKeepColorFilter(isSelected ? null : col)}
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      backgroundColor: clr,
                      border: isSelected ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                      padding: 0,
                      transform: isSelected ? 'scale(1.15)' : 'none'
                    }}
                  />
                );
              })}
            </div>
          </div>

          <h4 style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>Pinned Workspaces</h4>
          
          {keepNotes.filter(n => {
            let noteText = '';
            try {
              if (n.content?.startsWith('{')) {
                const parsed = JSON.parse(n.content);
                noteText = parsed.text || '';
                if (parsed.items) {
                  noteText += ' ' + parsed.items.map((i: any) => i.text).join(' ');
                }
                if (keepColorFilter && parsed.color !== keepColorFilter) return false;
              } else {
                noteText = n.content || '';
                if (keepColorFilter) return false;
              }
            } catch (e) {
              noteText = n.content || '';
              if (keepColorFilter) return false;
            }

            const term = keepSearchQuery.toLowerCase();
            return !term || n.title?.toLowerCase().includes(term) || noteText?.toLowerCase().includes(term);
          }).length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: '14px' }}>
              No notes found. Create your very first pinned note above!
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {keepNotes.filter(n => {
                let noteText = '';
                try {
                  if (n.content?.startsWith('{')) {
                    const parsed = JSON.parse(n.content);
                    noteText = parsed.text || '';
                    if (parsed.items) {
                      noteText += ' ' + parsed.items.map((i: any) => i.text).join(' ');
                    }
                    if (keepColorFilter && parsed.color !== keepColorFilter) return false;
                  } else {
                    noteText = n.content || '';
                    if (keepColorFilter) return false;
                  }
                } catch (e) {
                  noteText = n.content || '';
                  if (keepColorFilter) return false;
                }
                const term = keepSearchQuery.toLowerCase();
                return !term || n.title?.toLowerCase().includes(term) || noteText?.toLowerCase().includes(term);
              }).map((note) => {
                let isChecklist = false;
                let color = 'default';
                let contentText = note.content || '';
                let itemsList: any[] = [];

                try {
                  if (note.content?.startsWith('{')) {
                    const parsed = JSON.parse(note.content);
                    isChecklist = !!parsed.isChecklist;
                    color = parsed.color || 'default';
                    contentText = parsed.text || '';
                    itemsList = parsed.items || [];
                  }
                } catch (e) {}

                const clrObj = KEEP_COLORS.find(c => c.value === color) || KEEP_COLORS[0];

                return (
                  <div
                    key={note.id}
                    style={{
                      backgroundColor: clrObj.bg,
                      borderRadius: '16px',
                      padding: '12px',
                      border: `1px solid ${clrObj.border}`,
                      display: 'flex',
                      flexDirection: 'column',
                      minHeight: '120px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      position: 'relative'
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '13px', color: clrObj.text, marginBottom: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {note.title}
                    </div>

                    <div style={{ flex: 1, fontSize: '12px', color: clrObj.text, opacity: 0.85, overflow: 'hidden', WebkitLineClamp: 3, display: '-webkit-box', WebkitBoxOrient: 'vertical', lineHeight: '1.4' }}>
                      {isChecklist ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          {itemsList.slice(0, 3).map((it, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontSize: '10px' }}>{it.checked ? '☑' : '☐'}</span>
                              <span style={{ textDecoration: it.checked ? 'line-through' : 'none', opacity: it.checked ? 0.6 : 1, fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.text}</span>
                            </div>
                          ))}
                          {itemsList.length > 3 && <div style={{ fontSize: '9px', opacity: 0.6 }}>+ {itemsList.length - 3} more</div>}
                        </div>
                      ) : (
                        contentText
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '6px' }}>
                      <button
                        title="Analyze with Beatrice AI"
                        onClick={() => {
                          setActiveOverlay(null);
                          let prompt = `I am viewing my Google Keep note "${note.title}". `;
                          if (isChecklist) {
                            prompt += `It is a checklist with elements: ${itemsList.map(i => `${i.text} (${i.checked ? 'completed' : 'pending'})`).join(', ')}. `;
                          } else {
                            prompt += `Here is the note body: "${contentText}". `;
                          }
                          prompt += `Can you summarize this note, suggest ideas and guide me?`;
                          if (connected) client.send({ text: prompt });
                          useLogStore.getState().addTurn({ role: 'user', text: `🧠 Discuss note "${note.title}" with Beatrice`, isFinal: true });
                        }}
                        style={{
                          background: 'rgba(255,255,255,0.18)',
                          border: 'none',
                          borderRadius: '6px',
                          color: clrObj.text,
                          padding: '2px 6px',
                          fontSize: '10px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '2px',
                          cursor: 'pointer'
                        }}
                      >
                        <Brain size={10} /> AI Brain
                      </button>

                      <button
                        onClick={async () => {
                          if (window.confirm("Delete this workspace note?")) {
                            try {
                              const user = auth.currentUser;
                              if (!user) return;
                              const { deleteDoc, doc } = await import('firebase/firestore');
                              await deleteDoc(doc(db, 'users', user.uid, 'notes', note.id));
                            } catch (e: any) {
                              alert("Error deleting: " + e.message);
                            }
                          }
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--accent-danger)',
                          cursor: 'pointer',
                          padding: '2px'
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Tools Overlay */}
      <div id="overlay-tools" className={`full-page-overlay ${activeOverlay === 'tools' ? 'active' : ''}`}>
        <div className="overlay-header">
          <div className="overlay-title">Integrations</div>
          <button className="close-overlay-btn" onClick={() => setActiveOverlay(null)}><X size={18} /></button>
        </div>
        <div className="overlay-content" style={{ padding: '20px', overflowY: 'auto', height: '100%' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '20px', lineHeight: '1.4' }}>
            Customize which capabilities and Google Workspace APIs Beatrice has permission to invoke during this session:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '40px' }}>
             {tools.map((t, index) => (
                <div key={index} style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between', 
                  padding: '14px 16px', 
                  backgroundColor: 'rgba(255,255,255,0.03)', 
                  border: '1px solid var(--border-color)', 
                  borderRadius: '12px' 
                }}>
                   <div style={{ flex: 1, paddingRight: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                         <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-main)' }}>
                            {t.name.split('_').map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                         </span>
                         {t.isEnabled ? (
                           <span style={{ fontSize: '9px', backgroundColor: 'rgba(203, 251, 69, 0.15)', color: 'var(--accent-active)', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 700 }}>Active</span>
                         ) : (
                           <span style={{ fontSize: '9px', backgroundColor: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-muted)', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase' }}>Disabled</span>
                         )}
                      </div>
                      <div style={{ fontSize: '12px', color: '#888', marginTop: '4px', lineHeight: '1.3' }}>
                         {t.description || 'Google Workspace integration command.'}
                      </div>
                   </div>
                   <button 
                     onClick={() => {
                       useTools.getState().toggleTool(t.name);
                     }}
                     style={{
                       background: t.isEnabled ? 'var(--accent-active)' : 'rgba(255,255,255,0.05)',
                       color: t.isEnabled ? 'var(--bg-main)' : 'var(--text-muted)',
                       border: '1px solid var(--border-color)',
                       padding: '6px 12px',
                       borderRadius: '8px',
                       cursor: 'pointer',
                       fontWeight: 600,
                       fontSize: '12px',
                       transition: 'all 0.2s ease'
                     }}
                   >
                     {t.isEnabled ? 'Disable' : 'Enable'}
                   </button>
                </div>
             ))}
          </div>
        </div>
      </div>

      {/* Auth Screen */}
      <div id="auth-screen" className={`full-page-overlay ${isAuthOpen ? 'active' : ''}`}>
        <div className="auth-glow"></div>
        <div className="auth-card" id="auth-card-inner">
          <div className="auth-logo-box" style={{ background: 'transparent' }}>
            <img src="https://eburon.ai/icon-eburon.svg" alt="Eburon Logo" style={{ width: '60px', height: '60px' }} />
          </div>

          <h2>{isSignupMode ? 'Register' : 'Login'}</h2>
          <p className="subtitle">{isSignupMode ? 'Create your new account' : 'Welcome back to Eburon'}</p>

          <form className="auth-form" onSubmit={handleEmailAuth}>
            {authError && <div style={{color:'red', marginBottom:'10px', fontSize:'14px'}}>{authError}</div>}
            {isSignupMode && (
               <div className="auth-input-wrapper">
                 <User size={20} className="auth-icon-left" />
                 <input type="text" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} />
               </div>
            )}
            <div className="auth-input-wrapper">
              <Mail size={20} className="auth-icon-left" />
              <input type="email" placeholder="Email" required value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="auth-input-wrapper">
              <Lock size={20} className="auth-icon-left" />
              <input type="password" placeholder="Password" required value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            {isSignupMode && (
                <div className="auth-input-wrapper">
                   <Lock size={20} className="auth-icon-left" />
                   <input type="password" placeholder="Confirm password" />
                </div>
            )}
            <button type="submit" className="auth-submit-btn">{isSignupMode ? 'Sign up' : 'Sign in'}</button>
          </form>

          <div className="auth-divider"><span>or</span></div>

          <button className="btn-google" onClick={handleGoogleLogin}>
            <div className="g-icon-circle">G</div>
            Continue with Google
          </button>

          <div className="permissions-note">
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Check size={14} style={{color: 'var(--accent-active)'}} /> Google Workspace Sync</span>
            <span>Requires Read/Write permissions for Gmail, Drive, Calendar, and Tasks to enable full automation.</span>
          </div>

          <div className="auth-toggle">
            {isSignupMode ? 'Back to ' : 'Don\'t have an account? '}
            <span onClick={() => setIsSignupMode(!isSignupMode)}>
              {isSignupMode ? 'Sign in' : 'Sign up'}
            </span>
          </div>

        </div>
      </div>

      {/* Tool schema editor modal */}
      {editingTool && (
        <ToolEditorModal
          tool={editingTool}
          onClose={() => setEditingTool(null)}
          onSave={(updatedTool) => {
            updateTool(editingTool.name, updatedTool);
            setEditingTool(null);
          }}
        />
      )}
    </div>
  );
}
