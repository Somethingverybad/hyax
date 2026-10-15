import { useEffect, useRef } from "react";

/** Поток в <video>: звук играет RemoteAudio, поэтому здесь всегда без звука. */
const VideoView = ({ stream, mirrored, className }: { stream: MediaStream; mirrored?: boolean; className?: string }) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.play?.().catch(() => {});
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className={className} style={mirrored ? { transform: "scaleX(-1)" } : undefined} />;
};

export default VideoView;
