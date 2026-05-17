import { useState, useRef, useCallback } from 'react';
import { apiFetch } from './auth';

type VoiceState = 'idle' | 'recording' | 'processing' | 'error';

export const isMobileDevice = () =>
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent)); // iPad on iOS 13+

export const useVoiceInput = (onTranscript: (text: string) => void) => {
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);
  const stateRef = useRef<VoiceState>('idle');
  const recordingStartedAtRef = useRef<number>(0);
  const recorderMimeTypeRef = useRef<string>('audio/webm');

  const setVoiceState = (s: VoiceState) => {
    stateRef.current = s;
    setState(s);
  };

  const getFileNameForMimeType = (mimeType?: string) => {
    if (!mimeType) return 'audio.webm';
    if (mimeType.includes('mp4')) return 'audio.mp4';
    if (mimeType.includes('ogg')) return 'audio.ogg';
    if (mimeType.includes('wav')) return 'audio.wav';
    if (mimeType.includes('mpeg')) return 'audio.mp3';
    return 'audio.webm';
  };

  const sendAudioToServer = useCallback(async (audioBlob: Blob, mimeType?: string) => {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, getFileNameForMimeType(mimeType || audioBlob.type));

      const response = await apiFetch('/api/voice/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error((errorData as any).error || 'Транскрибация не удалась.');
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
      recordingStartedAtRef.current = 0;
    }
  }, [onTranscript]);

  const startFallbackRecognition = useCallback(() => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      setError('Голосовой ввод недоступен в этом браузере.');
      setVoiceState('error');
      setTimeout(() => setVoiceState('idle'), 2500);
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
      if (event.error === 'not-allowed') {
        setError('Нет доступа к микрофону.');
      } else if (event.error === 'no-speech') {
        setError('Речь не распознана. Попробуйте ещё раз.');
      } else {
        setError('Ошибка распознавания речи.');
      }
      setVoiceState('error');
      setTimeout(() => setVoiceState('idle'), 2500);
    };

    recognition.onend = () => {
      if (stateRef.current === 'recording') {
        setVoiceState('processing');
      }
      setTimeout(() => {
        if (stateRef.current === 'processing') setVoiceState('idle');
      }, 500);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [onTranscript]);

  const startRecording = useCallback(async () => {
    if (stateRef.current !== 'idle') return;

    setError(null);
    setVoiceState('recording');
    chunksRef.current = [];
    recordingStartedAtRef.current = Date.now();

    if (!navigator.mediaDevices?.getUserMedia) {
      console.warn('[VOICE] navigator.mediaDevices not available, trying SpeechRecognition');
      startFallbackRecognition();
      return;
    }

    try {
      console.log('[VOICE] Requesting microphone...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // iOS Safari supports audio/mp4, Chrome/Firefox prefer webm
      const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));

      const preferredMimeTypes = isIOS
        ? ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm']
        : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

      const selectedMimeType = preferredMimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
      console.log('[VOICE] Selected mimeType:', selectedMimeType || 'browser-default');

      const mediaRecorder = selectedMimeType
        ? new MediaRecorder(stream, { mimeType: selectedMimeType })
        : new MediaRecorder(stream);
      recorderMimeTypeRef.current = mediaRecorder.mimeType || selectedMimeType || 'audio/webm';

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(100);
      console.log('[VOICE] Recording started, mimeType:', recorderMimeTypeRef.current);
    } catch (err: any) {
      console.error('[VOICE] getUserMedia failed:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Нет доступа к микрофону. Разрешите доступ в настройках браузера.');
        setVoiceState('error');
        setTimeout(() => setVoiceState('idle'), 3000);
      } else {
        console.warn('[VOICE] Falling back to SpeechRecognition');
        startFallbackRecognition();
      }
    }
  }, [startFallbackRecognition]);

  const stopRecording = useCallback(async () => {
    if (stateRef.current !== 'recording') return;

    if (mediaRecorderRef.current) {
      setVoiceState('processing');

      await new Promise<void>((resolve) => {
        const recorder = mediaRecorderRef.current!;

        recorder.addEventListener('stop', () => {
          console.log('[VOICE] stopped, chunks:', chunksRef.current.length);

          if (chunksRef.current.length === 0) {
            setError('Не удалось записать звук.');
            setVoiceState('error');
            setTimeout(() => setVoiceState('idle'), 2000);
            resolve();
            return;
          }

          const recordingDurationMs = Date.now() - recordingStartedAtRef.current;
          if (recordingDurationMs < 300) {
            setError('Слишком короткая запись.');
            setVoiceState('error');
            setTimeout(() => setVoiceState('idle'), 2000);
            resolve();
            return;
          }

          const audioBlob = new Blob(chunksRef.current, { type: recorderMimeTypeRef.current });
          console.log('[VOICE] Blob size:', audioBlob.size, 'type:', recorderMimeTypeRef.current);
          sendAudioToServer(audioBlob, recorderMimeTypeRef.current).then(resolve);
        }, { once: true });

        recorder.requestData();
        recorder.stop();
      });

    } else if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setVoiceState('processing');
    }
  }, [sendAudioToServer]);

  // Toggle: start if idle, stop if recording (for desktop tap-to-toggle)
  const toggleRecording = useCallback(async () => {
    if (stateRef.current === 'idle') {
      await startRecording();
    } else if (stateRef.current === 'recording') {
      await stopRecording();
    }
  }, [startRecording, stopRecording]);

  return {
    state,
    error,
    startRecording,
    stopRecording,
    toggleRecording,
  };
};
