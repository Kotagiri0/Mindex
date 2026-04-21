import { useState, useRef, useCallback } from 'react';

type VoiceState = 'idle' | 'recording' | 'processing' | 'error';

export const useVoiceInput = (onTranscript: (text: string) => void) => {
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setState('recording');
      chunksRef.current = [];

      // Try native MediaRecorder first
      if (navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = stream;

          const mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm;codecs=opus',
          });

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              chunksRef.current.push(event.data);
            }
          };

          mediaRecorderRef.current = mediaRecorder;
          mediaRecorder.start();
        } catch (err) {
          console.warn('[VOICE] MediaRecorder not available, falling back to SpeechRecognition');
          // Fallback to webkitSpeechRecognition
          useFallbackRecognition();
        }
      } else {
        useFallbackRecognition();
      }
    } catch (err: any) {
      console.error('[VOICE] Error starting recording:', err);
      setError('Не удалось получить доступ к микрофону.');
      setState('error');
    }
  }, []);

  const stopRecording = useCallback(async () => {
    try {
      if (mediaRecorderRef.current && state === 'recording') {
        mediaRecorderRef.current.stop();
        setState('processing');

        return new Promise<void>((resolve) => {
          const checkRecorder = setInterval(() => {
            if (mediaRecorderRef.current?.state === 'inactive') {
              clearInterval(checkRecorder);
              const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
              sendAudioToServer(audioBlob).then(resolve);
            }
          }, 50);
        });
      } else if (recognitionRef.current && state === 'recording') {
        recognitionRef.current.stop();
        setState('processing');
      }
    } catch (err: any) {
      console.error('[VOICE] Error stopping recording:', err);
      setError('Ошибка при остановке записи.');
      setState('error');
    }
  }, [state]);

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

      setState('idle');
      setError(null);
    } catch (err: any) {
      console.error('[VOICE] Transcription error:', err);
      setError(err.message || 'Ошибка при транскрибации.');
      setState('error');
      setTimeout(() => setState('idle'), 2000);
    } finally {
      // Clean up
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      chunksRef.current = [];
      mediaRecorderRef.current = null;
    }
  }, [onTranscript]);

  const useFallbackRecognition = useCallback(() => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      setError('Голосовой ввод не поддерживается вашим браузером.');
      setState('error');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          onTranscript(transcript);
        } else {
          interimTranscript += transcript;
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.error('[VOICE] Recognition error:', event.error);
      setError(`Ошибка при распознавании: ${event.error}`);
      setState('error');
      setTimeout(() => setState('idle'), 2000);
    };

    recognition.onend = () => {
      setState('idle');
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [onTranscript]);

  return {
    state,
    error,
    startRecording,
    stopRecording,
  };
};
