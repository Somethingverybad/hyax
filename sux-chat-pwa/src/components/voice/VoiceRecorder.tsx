import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, X, Send, Trash2, Check, Circle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface VoiceRecorderProps {
  onSend: (audioBlob: Blob, duration: number) => void;
  onCancel: () => void;
}

const VoiceRecorder = ({ onSend, onCancel }: VoiceRecorderProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    // Запускаем запись сразу при монтировании
    startRecording();

    return () => {
      // Очистка при размонтировании
      stopRecording();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        } 
      });
      
      streamRef.current = stream;

      // Используем webm для лучшей совместимости
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        setAudioBlob(audioBlob);
        const url = URL.createObjectURL(audioBlob);
        setAudioUrl(url);
        
        // Останавливаем все треки
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }
      };

      mediaRecorder.start();
      setIsRecording(true);

      // Запускаем таймер
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (error) {
      console.error("Error accessing microphone:", error);
      toast.error("Не удалось получить доступ к микрофону");
      onCancel();
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const handleStop = () => {
    stopRecording();
  };

  const handleSend = () => {
    if (audioBlob) {
      onSend(audioBlob, recordingTime);
    }
  };

  const handleDelete = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    onCancel();
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 bg-card border-2 border-border rounded-xl shadow-md">
      {/* Индикатор записи */}
      <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
        {isRecording ? (
          <>
            {/* Анимированная иконка микрофона при записи */}
            <div className="relative flex items-center justify-center">
              <Circle className="w-8 h-8 sm:w-10 sm:h-10 text-red-500 animate-ping absolute" />
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-red-500 rounded-full flex items-center justify-center">
                <Mic className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
            </div>
            
            {/* Время записи */}
            <div className="flex flex-col">
              <span className="text-xs sm:text-sm font-medium text-foreground">Запись...</span>
              <span className="text-lg sm:text-xl font-bold font-mono text-red-500 tabular-nums">
                {formatTime(recordingTime)}
              </span>
            </div>
          </>
        ) : audioBlob ? (
          <>
            {/* Иконка записанного голосового */}
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary/20 rounded-full flex items-center justify-center border-2 border-primary">
              <Check className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            </div>
            
            {/* Информация о записи */}
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-xs sm:text-sm font-medium text-muted-foreground">Голосовое сообщение</span>
              <span className="text-base sm:text-lg font-bold font-mono text-foreground tabular-nums">
                {formatTime(recordingTime)}
              </span>
            </div>
          </>
        ) : null}
      </div>

      {/* Кнопки управления */}
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {isRecording ? (
          <>
            {/* Отмена */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDelete}
              className="h-9 w-9 sm:h-10 sm:w-10 hover:bg-destructive/10 hover:text-destructive transition-colors"
              title="Отменить"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </Button>
            
            {/* Стоп */}
            <Button
              variant="default"
              size="icon"
              onClick={handleStop}
              className="h-9 w-9 sm:h-10 sm:w-10 bg-red-500 hover:bg-red-600 shadow-lg transition-all"
              title="Остановить запись"
            >
              <Square className="w-4 h-4 sm:w-5 sm:h-5 fill-white" />
            </Button>
          </>
        ) : audioBlob ? (
          <>
            {/* Удалить */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDelete}
              className="h-9 w-9 sm:h-10 sm:w-10 hover:bg-destructive/10 hover:text-destructive transition-colors"
              title="Удалить и записать заново"
            >
              <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
            </Button>
            
            {/* Отправить */}
            <Button
              variant="default"
              size="icon"
              onClick={handleSend}
              className="h-9 w-9 sm:h-10 sm:w-10 bg-gradient-primary shadow-glow hover:shadow-glow-lg hover:scale-105 transition-all"
              title="Отправить голосовое"
            >
              <Send className="w-4 h-4 sm:w-5 sm:h-5" />
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default VoiceRecorder;
