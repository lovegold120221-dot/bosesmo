import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User, linkWithPopup } from 'firebase/auth';
import { initializeFirestore, doc, getDocFromServer, getDoc, setDoc, getDocFromCache } from 'firebase/firestore';

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDjmcE7CiKrNpSnu20gFB2cG620HU36Zqg",
  authDomain: "gen-lang-client-0836251512.firebaseapp.com",
  databaseURL: "https://gen-lang-client-0836251512-default-rtdb.firebaseio.com",
  projectId: "gen-lang-client-0836251512",
  storageBucket: "gen-lang-client-0836251512.firebasestorage.app",
  messagingSenderId: "811711024905",
  appId: "1:811711024905:web:b805531d56342ba41b8dd8",
  measurementId: "G-CEGJCJ914Y",
  firestoreDatabaseId: "master-db"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const firestoreId = firebaseConfig.firestoreDatabaseId || '';
console.log(`[Firebase] Initializing Firestore with Database ID: ${firestoreId || '(default)'}`);
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true
}, firestoreId === '' ? undefined : firestoreId);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({
  prompt: 'consent',
  access_type: 'offline'
});
// Required Scopes for Google Workspace APIs
provider.addScope('https://www.googleapis.com/auth/tasks');
provider.addScope('https://www.googleapis.com/auth/calendar');
provider.addScope('https://www.googleapis.com/auth/drive');
provider.addScope('https://www.googleapis.com/auth/documents');
provider.addScope('https://www.googleapis.com/auth/spreadsheets');
provider.addScope('https://www.googleapis.com/auth/presentations');
provider.addScope('https://www.googleapis.com/auth/forms.body');
provider.addScope('https://www.googleapis.com/auth/forms.responses.readonly');
provider.addScope('https://www.googleapis.com/auth/contacts');
provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
provider.addScope('https://www.googleapis.com/auth/userinfo.email');
provider.addScope('https://www.googleapis.com/auth/gmail.send');
provider.addScope('https://www.googleapis.com/auth/gmail.modify');
provider.addScope('https://www.googleapis.com/auth/gmail.readonly');
provider.addScope('https://www.googleapis.com/auth/chat.messages');
provider.addScope('https://www.googleapis.com/auth/chat.spaces');
provider.addScope('https://www.googleapis.com/auth/meetings.space.created');

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      const token = await getAccessToken();
      if (onAuthSuccess) onAuthSuccess(user, token || '');
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    let result;
    const currentUser = auth.currentUser;
    
    if (currentUser) {
      try {
        console.log('Attempting to link existing user account with Google Provider...');
        result = await linkWithPopup(currentUser, provider);
      } catch (linkErr: any) {
        if (linkErr.code === 'auth/credential-already-in-use') {
          console.warn('Google account already linked to another user. Signing into that account instead...');
          result = await signInWithPopup(auth, provider);
        } else if (linkErr.code === 'auth/provider-already-linked') {
          console.log('Google account already linked to this user. Re-authenticating to get fresh token...');
          result = await signInWithPopup(auth, provider);
        } else {
          console.warn('Linking failed, falling back to standard sign in:', linkErr);
          result = await signInWithPopup(auth, provider);
        }
      }
    } else {
      result = await signInWithPopup(auth, provider);
    }

    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Firebase Auth');
    }

    cachedAccessToken = credential.accessToken;
    
    try {
      localStorage.setItem(`eburon_at_${result.user.uid}`, cachedAccessToken);
    } catch (localStoreErr) {
      console.warn('Failed to cache token to localStorage:', localStoreErr);
    }

    // Securely persist Google OAuth user info & credentials in the user's Firestore document
    try {
      await setDoc(doc(db, 'users', result.user.uid), {
        email: result.user.email,
        displayName: result.user.displayName,
        photoURL: result.user.photoURL,
        accessToken: cachedAccessToken,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (fsErr) {
      console.error('Failed to save authenticated user / token to Firestore of sign in:', fsErr);
    }

    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  if (cachedAccessToken) {
    return cachedAccessToken;
  }
  const currentUser = auth.currentUser;
  if (currentUser) {
    // 1. Instantly check localStorage for offline survival and speed
    try {
      const localToken = localStorage.getItem(`eburon_at_${currentUser.uid}`);
      if (localToken) {
        cachedAccessToken = localToken;
        return localToken;
      }
    } catch (localStoreErr) {
      console.warn('Could not read token from localStorage cache:', localStoreErr);
    }

    // 2. Fetch from Firestore (falling back to cache upon offline exception)
    try {
      const userDocRef = doc(db, 'users', currentUser.uid);
      let userSnap;
      try {
        userSnap = await getDoc(userDocRef);
      } catch (err: any) {
        const isOffline = err?.message?.toLowerCase().includes('offline') || err?.code === 'unavailable';
        if (isOffline) {
          console.warn('Firestore is offline, attempting to resolve token from local cache...');
          try {
            userSnap = await getDocFromCache(userDocRef);
          } catch (cacheErr) {
            console.warn('Failed to retrieve token from Firestore client cache:', cacheErr);
          }
        } else {
          throw err;
        }
      }

      if (userSnap && userSnap.exists()) {
        const data = userSnap.data();
        if (data && data.accessToken) {
          cachedAccessToken = data.accessToken;
          try {
            localStorage.setItem(`eburon_at_${currentUser.uid}`, data.accessToken);
          } catch (_) {}
          return data.accessToken;
        }
      }
    } catch (e) {
      console.error('Error fetching token from Firestore:', e);
    }
  }
  return null;
};

export const logout = async () => {
  const currentUser = auth.currentUser;
  if (currentUser) {
    try {
      localStorage.removeItem(`eburon_at_${currentUser.uid}`);
    } catch (_) {}
  }
  await auth.signOut();
  cachedAccessToken = null;
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
