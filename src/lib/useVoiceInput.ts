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

  const setVoiceState = (s: VoiceState) => {
    stateRef.current = s;
    setState(s);
  };

  const sendAudioToServer = useCallback(async (audioBlob: Blob) => {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');

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

          const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm';

          const mediaRecorder = new MediaRecorder(stream, { mimeType });

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              chunksRef.current.push(event.data);
            }
          };

          mediaRecorderRef.current = mediaRecorder;
          mediaRecorder.start();
        } catch (err) {
          console.warn('[VOICE] MediaRecorder not available, falling back to SpeechRecognition');
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
        mediaRecorderRef.current.stop();
        setVoiceState('processing');

        await new Promise<void>((resolve) => {
          const checkRecorder = setInterval(() => {
            if (mediaRecorderRef.current?.state === 'inactive') {
              clearInterval(checkRecorder);
              const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
              sendAudioToServer(audioBlob).then(resolve);
            }
          }, 50);
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