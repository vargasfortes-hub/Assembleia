/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  where, 
  doc, 
  getDoc, 
  setDoc,
  Timestamp,
  orderBy
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db, signInWithGoogle, logout } from './firebase';
import { Meeting, Attendee, OperationType, FirestoreErrorInfo } from './types';
import { 
  Users, 
  Plus, 
  LogIn, 
  LogOut, 
  ClipboardCheck, 
  UserCheck, 
  Calendar, 
  ArrowLeft,
  Copy,
  CheckCircle2,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Main App Component

// Error Display Component
function ErrorDisplay({ error, onRetry }: { error: any, onRetry: () => void }) {
  let errorMessage = "Ocorreu um erro inesperado.";
  try {
    const parsed = JSON.parse(error.message);
    if (parsed.error.includes("insufficient permissions")) {
      errorMessage = "Você não tem permissão para realizar esta ação.";
    }
  } catch (e) {
    errorMessage = error?.message || errorMessage;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-100 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border border-red-100">
        <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-stone-900 mb-2">Ops! Algo deu errado</h2>
        <p className="text-stone-600 mb-6">{errorMessage}</p>
        <button 
          onClick={onRetry}
          className="w-full bg-stone-900 text-white py-3 rounded-xl font-medium hover:bg-stone-800 transition-colors"
        >
          Tentar Novamente
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [appError, setAppError] = useState<any>(null);

  // Error handling utility
  const handleFirestoreError = useCallback((error: unknown, operationType: OperationType, path: string | null) => {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email || undefined,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo: auth.currentUser?.providerData.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL
        })) || []
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    setAppError(new Error(JSON.stringify(errInfo)));
  }, []);

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentMeeting, setCurrentMeeting] = useState<Meeting | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [isSigning, setIsSigning] = useState(false);
  const [hasSigned, setHasSigned] = useState(false);
  const [view, setView] = useState<'dashboard' | 'meeting'>('dashboard');
  const [meetingIdInput, setMeetingIdInput] = useState('');
  const [newMeetingTitle, setNewMeetingTitle] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [selectedBloco, setSelectedBloco] = useState<string>('');
  const [selectedApartamento, setSelectedApartamento] = useState<string>('');

  const apartamentos = Array.from({ length: 6 }, (_, floor) => 
    Array.from({ length: 4 }, (_, apt) => `${(floor + 1) * 100 + (apt + 1)}`)
  ).flat();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Listen to attendees if in a meeting
  useEffect(() => {
    if (view === 'meeting' && currentMeeting?.id) {
      const q = query(
        collection(db, 'meetings', currentMeeting.id, 'attendees'),
        orderBy('signedAt', 'desc')
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Attendee));
        setAttendees(list);
        
        // Check if current user has signed
        if (user) {
          const signed = list.some(a => a.userId === user.uid);
          setHasSigned(signed);
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, `meetings/${currentMeeting.id}/attendees`);
      });

      return () => unsubscribe();
    }
  }, [view, currentMeeting?.id, user]);

  const handleCreateMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newMeetingTitle.trim()) return;

    try {
      const meetingData: Omit<Meeting, 'id'> = {
        title: newMeetingTitle,
        hostId: user.uid,
        hostName: user.displayName || 'Anônimo',
        createdAt: new Date().toISOString()
      };

      const docRef = await addDoc(collection(db, 'meetings'), meetingData);
      setCurrentMeeting({ id: docRef.id, ...meetingData });
      setView('meeting');
      setNewMeetingTitle('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'meetings');
    }
  };

  const handleJoinMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetingIdInput.trim()) return;

    try {
      const docRef = doc(db, 'meetings', meetingIdInput.trim());
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        setCurrentMeeting({ id: docSnap.id, ...docSnap.data() } as Meeting);
        setView('meeting');
        setMeetingIdInput('');
      } else {
        alert('Reunião não encontrada.');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `meetings/${meetingIdInput}`);
    }
  };

  const handleSignPresence = async () => {
    if (!user || !currentMeeting?.id || hasSigned) return;
    if (!selectedBloco || !selectedApartamento) {
      alert('Por favor, selecione seu Bloco e Apartamento.');
      return;
    }

    setIsSigning(true);
    try {
      const attendeeData: Omit<Attendee, 'id'> = {
        userId: user.uid,
        userName: user.displayName || 'Anônimo',
        userEmail: user.email || '',
        bloco: selectedBloco,
        apartamento: selectedApartamento,
        signedAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'meetings', currentMeeting.id, 'attendees', user.uid), attendeeData);
      setHasSigned(true);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `meetings/${currentMeeting.id}/attendees/${user.uid}`);
    } finally {
      setIsSigning(false);
    }
  };

  const copyMeetingId = () => {
    if (currentMeeting?.id) {
      navigator.clipboard.writeText(currentMeeting.id);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <Loader2 className="w-8 h-8 animate-spin text-stone-400" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-stone-100 text-center"
        >
          <div className="w-16 h-16 bg-stone-900 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <ClipboardCheck className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold text-stone-900 mb-2">Lista de Presença</h1>
          <p className="text-stone-500 mb-8">Assine sua presença em reuniões de forma rápida e segura.</p>
          
          <button 
            onClick={signInWithGoogle}
            className="w-full flex items-center justify-center gap-3 bg-white border-2 border-stone-200 text-stone-700 py-4 rounded-2xl font-semibold hover:bg-stone-50 hover:border-stone-300 transition-all active:scale-95"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="Google" />
            Entrar com Google
          </button>
        </motion.div>
      </div>
    );
  }

  if (appError) {
    return <ErrorDisplay error={appError} onRetry={() => setAppError(null)} />;
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans">
        {/* Header */}
        <header className="bg-white border-b border-stone-200 px-4 sm:px-6 py-4 sticky top-0 z-10 shadow-sm">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('dashboard')}>
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-stone-900 rounded-lg flex items-center justify-center">
                <ClipboardCheck className="text-white w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <span className="font-bold text-base sm:text-lg">Presença Meet</span>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              <div className="flex items-center gap-2">
                <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-stone-200" alt={user.displayName || ''} />
                <span className="text-xs sm:text-sm font-medium hidden sm:inline">{user.displayName}</span>
              </div>
              <button 
                onClick={logout}
                className="p-2 text-stone-400 hover:text-red-500 transition-colors"
                title="Sair"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-5xl mx-auto p-4 sm:p-6">
          <AnimatePresence mode="wait">
            {view === 'dashboard' ? (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="grid md:grid-cols-2 gap-8"
              >
                {/* Create Meeting */}
                <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-stone-200">
                  <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center mb-6">
                    <Plus className="w-6 h-6" />
                  </div>
                  <h2 className="text-xl sm:text-2xl font-bold mb-2">Criar Reunião</h2>
                  <p className="text-stone-500 text-sm sm:text-base mb-6">Inicie uma nova lista de presença para sua reunião.</p>
                  
                  <form onSubmit={handleCreateMeeting} className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">Título da Reunião</label>
                      <input 
                        type="text" 
                        value={newMeetingTitle}
                        onChange={(e) => setNewMeetingTitle(e.target.value)}
                        placeholder="Ex: Aula de Matemática - 20/03"
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-stone-900/10 transition-all text-sm sm:text-base"
                        required
                      />
                    </div>
                    <button 
                      type="submit"
                      className="w-full bg-stone-900 text-white py-4 rounded-xl font-bold hover:bg-stone-800 transition-all active:scale-95 text-sm sm:text-base"
                    >
                      Criar Lista
                    </button>
                  </form>
                </div>

                {/* Join Meeting */}
                <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-stone-200">
                  <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mb-6">
                    <LogIn className="w-6 h-6" />
                  </div>
                  <h2 className="text-xl sm:text-2xl font-bold mb-2">Entrar em Reunião</h2>
                  <p className="text-stone-500 text-sm sm:text-base mb-6">Insira o código da reunião para assinar a lista.</p>
                  
                  <form onSubmit={handleJoinMeeting} className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">Código da Reunião</label>
                      <input 
                        type="text" 
                        value={meetingIdInput}
                        onChange={(e) => setMeetingIdInput(e.target.value)}
                        placeholder="Cole o código aqui..."
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-stone-900/10 transition-all text-sm sm:text-base"
                        required
                      />
                    </div>
                    <button 
                      type="submit"
                      className="w-full bg-stone-200 text-stone-900 py-4 rounded-xl font-bold hover:bg-stone-300 transition-all active:scale-95 text-sm sm:text-base"
                    >
                      Acessar Lista
                    </button>
                  </form>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="meeting"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                {/* Meeting Header */}
                <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-stone-200">
                  <button 
                    onClick={() => setView('dashboard')}
                    className="flex items-center gap-2 text-stone-400 hover:text-stone-900 mb-6 transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span className="text-sm font-medium">Voltar</span>
                  </button>

                  <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 text-stone-400 mb-2">
                        <Calendar className="w-4 h-4" />
                        <span className="text-xs sm:text-sm font-medium">
                          {currentMeeting && format(new Date(currentMeeting.createdAt), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                        </span>
                      </div>
                      <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-stone-900 leading-tight">{currentMeeting?.title}</h1>
                      <p className="text-stone-500 text-sm sm:text-base mt-1">Organizado por <span className="font-semibold text-stone-700">{currentMeeting?.hostName}</span></p>
                    </div>

                    <div className="flex flex-col gap-2 w-full lg:w-auto">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Código da Reunião</span>
                      <div className="flex items-center gap-2 bg-stone-100 p-2 pl-4 rounded-xl border border-stone-200">
                        <code className="text-sm sm:text-base font-mono font-bold text-stone-600 truncate">{currentMeeting?.id}</code>
                        <button 
                          onClick={copyMeetingId}
                          className="p-2 bg-white rounded-lg border border-stone-200 hover:bg-stone-50 transition-colors shrink-0"
                        >
                          {copySuccess ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Action Panel */}
                  <div className="lg:col-span-1 space-y-6">
                    <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-stone-200">
                      <h3 className="text-lg sm:text-xl font-bold mb-4">Sua Presença</h3>
                      {hasSigned ? (
                        <div className="bg-emerald-50 border border-emerald-100 p-6 rounded-2xl text-center">
                          <div className="w-12 h-12 bg-emerald-500 text-white rounded-full flex items-center justify-center mx-auto mb-4">
                            <UserCheck className="w-6 h-6" />
                          </div>
                          <p className="text-emerald-800 font-bold mb-1">Presença Confirmada!</p>
                          <p className="text-emerald-600 text-sm">Você já assinou esta lista.</p>
                          {attendees.find(a => a.userId === user.uid) && (
                            <p className="text-emerald-700 text-xs mt-2 font-medium">
                              Bloco {attendees.find(a => a.userId === user.uid)?.bloco} - Apto {attendees.find(a => a.userId === user.uid)?.apartamento}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <p className="text-stone-500 text-sm">Selecione sua identificação para registrar sua presença.</p>
                          
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1.5">Bloco</label>
                              <select 
                                value={selectedBloco}
                                onChange={(e) => setSelectedBloco(e.target.value)}
                                className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/10 transition-all appearance-none"
                              >
                                <option value="">Selecione</option>
                                <option value="I">Bloco I</option>
                                <option value="II">Bloco II</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1.5">Apartamento</label>
                              <select 
                                value={selectedApartamento}
                                onChange={(e) => setSelectedApartamento(e.target.value)}
                                className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/10 transition-all appearance-none"
                              >
                                <option value="">Selecione</option>
                                {apartamentos.map(apt => (
                                  <option key={apt} value={apt}>{apt}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <button 
                            onClick={handleSignPresence}
                            disabled={isSigning}
                            className="w-full bg-emerald-600 text-white py-4 rounded-xl font-bold hover:bg-emerald-700 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 mt-2 text-sm sm:text-base"
                          >
                            {isSigning ? <Loader2 className="w-5 h-5 animate-spin" /> : <ClipboardCheck className="w-5 h-5" />}
                            Assinar Lista
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Attendees List */}
                  <div className="lg:col-span-2">
                    <div className="bg-white rounded-3xl shadow-sm border border-stone-200 overflow-hidden">
                      <div className="p-6 border-bottom border-stone-100 flex items-center justify-between bg-stone-50/50">
                        <div className="flex items-center gap-3">
                          <Users className="w-5 h-5 text-stone-400" />
                          <h3 className="font-bold">Participantes ({attendees.length})</h3>
                        </div>
                      </div>
                      
                      <div className="divide-y divide-stone-100 max-h-[500px] overflow-y-auto">
                        {attendees.length === 0 ? (
                          <div className="p-12 text-center text-stone-400">
                            <Users className="w-12 h-12 mx-auto mb-4 opacity-20" />
                            <p>Ninguém assinou a lista ainda.</p>
                          </div>
                        ) : (
                          attendees.map((attendee) => (
                            <motion.div 
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              key={attendee.id} 
                              className="p-4 flex items-center justify-between hover:bg-stone-50 transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-stone-100 rounded-full flex items-center justify-center text-stone-500 font-bold">
                                  {attendee.userName.charAt(0)}
                                </div>
                                <div>
                                  <p className="font-bold text-stone-900">{attendee.userName}</p>
                                  <p className="text-xs text-stone-500 font-medium">Bloco {attendee.bloco} - Apto {attendee.apartamento}</p>
                                  <p className="text-[10px] text-stone-400">{attendee.userEmail}</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-xs font-bold text-stone-400 uppercase tracking-tighter">Assinado às</p>
                                <p className="text-sm font-mono text-stone-600">{format(new Date(attendee.signedAt), "HH:mm")}</p>
                              </div>
                            </motion.div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
  );
}
