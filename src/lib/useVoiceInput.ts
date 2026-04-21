import { useState, useRef, useCallback } from 'react';

type VoiceState = 'idle' | 'recording' | 'processing' | 'error';

export const useVoiceInput = (onTranscript: (text: string) => void) => {
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);
  const stateRef = useRef<VoiceState>('idle');
  const mimeTypeRef = useRef<string>('audio/webm');

  const setVoiceState = (s: VoiceState) => {
    stateRef.current = s;
    setState(s);
  };

  const getSupportedMimeType = () => {
    const types = [
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
      'audio/ogg',
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  };

  const getFileExtension = (mimeType: string) => {
    if (mimeType.includes('mp4')) return 'mp4';
    if (mimeType.includes('ogg')) return 'ogg';
    return 'webm';
  };

  const sendAudioToServer = useCallback(async (audioBlob: Blob) => {
    try {
      const mimeType = mimeTypeRef.current;
      const ext = getFileExtension(mimeType);

      // Send with correct filename and type so Groq can identify the format
      const file = new File([audioBlob], `audio.${ext}`, { type: mimeType.split(';')[0] });

      console.log('[VOICE] Sending to server:', file.name, file.type, file.size, 'bytes');

      const formData = new FormData();
      formData.append('audio', file);

      const response = await fetch('/api/voice/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Транскрибация не удалась.');
      }

      const data = await response.json();
      if (data.text) {
        onTranscript(data.text);
      }

      setVoiceState('idle');
      setError(null);
    } catch (err: any) {
      console.error('[VOICE] Transcription error:', err);
      setError(err.message || 'Ошибка при транскрибации.');
      setVoiceState('error');
      setTimeout(() => setVoiceState('idle'), 2000);
    } finally {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      chunksRef.current = [];
      mediaRecorderRef.current = null;
    }
  }, [onTranscript]);

  const startFallbackRecognition = useCallback(() => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      setError('Голосовой ввод не поддерживается вашим браузером.');
      setVoiceState('error');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          onTranscript(transcript);
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.error('[VOICE] Recognition error:', event.error);
      setError(`Ошибка при распознавании: ${event.error}`);
      setVoiceState('error');
      setTimeout(() => setVoiceState('idle'), 2000);
    };

    recognition.onend = () => {
      setVoiceState('idle');
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [onTranscript]);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setVoiceState('recording');
      chunksRef.current = [];

      if (navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = stream;

          const mimeType = getSupportedMimeType();

          const mediaRecorder = mimeType
            ? new MediaRecorder(stream, { mimeType })
            : new MediaRecorder(stream);

          // Store actual mimeType assigned by browser after construction
          mimeTypeRef.current = mediaRecorder.mimeType || mimeType || 'audio/webm';
          console.log('[VOICE] Recording started, actual mimeType:', mimeTypeRef.current);

          mediaRecorder.ondataavailable = (event) => {
            console.log('[VOICE] ondataavailable:', event.data.size, 'bytes');
            if (event.data.size > 0) {
              chunksRef.current.push(event.data);
            }
          };

          mediaRecorderRef.current = mediaRecorder;
          mediaRecorder.start(100); // собирать chunks каждые 100мс
        } catch (err) {
          console.warn('[VOICE] MediaRecorder failed, falling back to SpeechRecognition:', err);
          startFallbackRecognition();
        }
      } else {
        startFallbackRecognition();
      }
    } catch (err: any) {
      console.error('[VOICE] Error starting recording:', err);
      setError('Не удалось получить доступ к микрофону.');
      setVoiceState('error');
    }
  }, [startFallbackRecognition]);

  const stopRecording = useCallback(async () => {
    try {
      if (mediaRecorderRef.current && stateRef.current === 'recording') {
        setVoiceState('processing');

        await new Promise<void>((resolve) => {
          const recorder = mediaRecorderRef.current!;

          recorder.addEventListener('stop', () => {
            console.log('[VOICE] Stop event fired, chunks:', chunksRef.current.length);

            if (chunksRef.current.length === 0) {
              console.warn('[VOICE] No chunks recorded');
              setError('Не удалось записать звук.');
              setVoiceState('error');
              setTimeout(() => setVoiceState('idle'), 2000);
              resolve();
              return;
            }

            // Strip codec params for Blob — Groq needs clean mime type
            const blobType = mimeTypeRef.current.split(';')[0];
            const audioBlob = new Blob(chunksRef.current, { type: blobType });
            console.log('[VOICE] Blob size:', audioBlob.size, 'type:', blobType);
            sendAudioToServer(audioBlob).then(resolve);
          }, { once: true });

          recorder.stop();
        });
      } else if (recognitionRef.current && stateRef.current === 'recording') {
        recognitionRef.current.stop();
        setVoiceState('processing');
      }
    } catch (err: any) {
      console.error('[VOICE] Error stopping recording:', err);
      setError('Ошибка при остановке записи.');
      setVoiceState('error');
    }
  }, [sendAudioToServer]);

  return {
    state,
    error,
    startRecording,
    stopRecording,
  };
};