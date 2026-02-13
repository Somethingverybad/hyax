import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";

interface VoicePlayerProps {
  voiceUrl: string;
  duration?: number;
  isOwn?: boolean;
}

const VoicePlayer = ({ voiceUrl, duration, isOwn = false }: VoicePlayerProps) => {
  console.log('🎵 VoicePlayer создан!', { voiceUrl, duration, isOwn });
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration || 0);
  const [audioData, setAudioData] = useState<number[]>([]);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    console.log('🎵 VoicePlayer useEffect - инициализация аудио', voiceUrl);
    const audio = new Audio(voiceUrl);
    audioRef.current = audio;

    audio.addEventListener('loadedmetadata', () => {
      // Используем duration из пропсов, если доступно, иначе из audio
      if (!duration || duration === 0) {
        console.log('🎵 Используем duration из audio:', audio.duration);
        setTotalDuration(Math.round(audio.duration));
      } else {
        console.log('🎵 Используем duration из пропсов:', duration);
      }
    });

    audio.addEventListener('timeupdate', () => {
      setCurrentTime(audio.currentTime);
    });

    audio.addEventListener('ended', () => {
      setIsPlaying(false);
      setCurrentTime(0);
    });

    // Генерируем визуализацию (упрощенная)
    generateWaveform();

    return () => {
      audio.pause();
      audio.remove();
    };
  }, [voiceUrl, duration]);

  // Генерация упрощенной визуализации звука
  const generateWaveform = () => {
    // Создаем случайные данные для визуализации (40 столбиков)
    const bars = 40;
    const data = Array.from({ length: bars }, () => Math.random() * 0.7 + 0.3);
    setAudioData(data);
  };

  // Рисуем визуализацию на canvas
  useEffect(() => {
    if (!canvasRef.current || audioData.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const barWidth = width / audioData.length;
    const progress = totalDuration > 0 ? currentTime / totalDuration : 0;

    ctx.clearRect(0, 0, width, height);

    audioData.forEach((value, index) => {
      const barHeight = value * height;
      const x = index * barWidth;
      const y = (height - barHeight) / 2;

      // Цвет в зависимости от прогресса
      const isPlayed = index / audioData.length < progress;
      
      if (isOwn) {
        ctx.fillStyle = isPlayed 
          ? 'rgba(255, 255, 255, 0.9)' 
          : 'rgba(255, 255, 255, 0.3)';
      } else {
        ctx.fillStyle = isPlayed 
          ? 'hsl(263, 90%, 65%)' 
          : 'rgba(150, 150, 150, 0.4)';
      }

      ctx.fillRect(x, y, barWidth * 0.7, barHeight);
    });
  }, [audioData, currentTime, totalDuration, isOwn]);

  const togglePlayPause = () => {
    console.log('🎵 VoicePlayer - togglePlayPause вызван', { isPlaying, hasAudio: !!audioRef.current });
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audioRef.current || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * totalDuration;

    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  console.log('🎵 VoicePlayer рендерится!', { 
    isPlaying, 
    currentTime, 
    totalDuration, 
    hasAudioData: audioData.length > 0 
  });

  return (
    <div className={cn(
      "flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-2xl min-w-[200px] sm:min-w-[220px] max-w-[280px] sm:max-w-[320px]",
      isOwn 
        ? "bg-gradient-primary text-primary-foreground shadow-glow" 
        : "bg-card border-2 border-border shadow-sm"
    )}>
      {/* Кнопка Play/Pause */}
      <Button
        variant="ghost"
        size="icon"
        onClick={togglePlayPause}
        className={cn(
          "h-9 w-9 sm:h-10 sm:w-10 rounded-full shrink-0 transition-all hover:scale-105",
          isOwn 
            ? "bg-white/20 hover:bg-white/30 text-white active:scale-95" 
            : "bg-primary/10 hover:bg-primary/20 text-primary active:scale-95"
        )}
        title={isPlaying ? "Пауза" : "Воспроизвести"}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" />
        ) : (
          <Play className="w-4 h-4 sm:w-5 sm:h-5 ml-0.5" fill="currentColor" />
        )}
      </Button>

      {/* Визуализация и информация */}
      <div className="flex-1 flex flex-col gap-1 sm:gap-1.5 min-w-0">
        {/* Визуализация звука */}
        <canvas
          ref={canvasRef}
          width={200}
          height={28}
          className="w-full h-6 sm:h-7 cursor-pointer touch-manipulation"
          onClick={handleProgressClick}
          title="Нажмите для перемотки"
        />

        {/* Время и длительность */}
        <div className="flex items-center justify-between">
          <span className={cn(
            "text-xs font-mono tabular-nums",
            isOwn ? "text-primary-foreground/90" : "text-muted-foreground"
          )}>
            {formatTime(currentTime)}
          </span>
          <span className={cn(
            "text-xs font-mono tabular-nums",
            isOwn ? "text-primary-foreground/70" : "text-muted-foreground/70"
          )}>
            {formatTime(totalDuration)}
          </span>
        </div>
      </div>
    </div>
  );
};

export default VoicePlayer;
