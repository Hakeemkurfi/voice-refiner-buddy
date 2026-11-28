import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Live in-page camera: one tap on the shutter captures and sends the photo
// straight away (no "Use photo / Retake" screen from the phone's camera app).
export function InstantCamera({ onShot, onClose }: { onShot: (file: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
      })
      .catch((e: Error) => setError(e.message || "Camera not available"));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const shoot = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (!b) return;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      onShot(new File([b], "photo.jpg", { type: "image/jpeg" }));
    }, "image/jpeg", 0.92);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="relative flex-1 overflow-hidden">
        {error ? (
          <p className="p-6 text-sm text-destructive">Camera could not open: {error}. Allow camera access, or use Upload from gallery.</p>
        ) : (
          <video ref={videoRef} playsInline muted className="h-full w-full object-contain" />
        )}
      </div>
      <div className="flex items-center justify-between gap-4 p-4">
        <Button variant="outline" onClick={onClose}><X className="h-4 w-4" /> Close</Button>
        <Button size="lg" className="h-16 w-16 rounded-full" disabled={!!error} onClick={shoot} aria-label="Take and send photo">
          <Camera className="h-7 w-7" />
        </Button>
        <span className="w-20" />
      </div>
    </div>
  );
}
