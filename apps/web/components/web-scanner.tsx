'use client';

import { Camera, CameraOff, Flashlight, FlashlightOff, VideoOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Banner } from './ui/feedback';
import { Button } from './ui/primitives';

type CameraState = 'idle' | 'starting' | 'running' | 'denied' | 'unavailable';

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
  }
}

/**
 * Camera QR scanner for browsers. Uses the native BarcodeDetector when available, otherwise jsQR.
 * Repeated reads of the same value are suppressed, and scanning pauses while `paused` is true.
 */
export function WebScanner({ onDetect, paused }: { onDetect: (value: string) => void; paused: boolean }) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastRef = useRef<{ value: string; at: number } | null>(null);
  const pausedRef = useRef(paused);
  const [state, setState] = useState<CameraState>('idle');
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });
  pausedRef.current = paused;

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    setTorch({ supported: false, on: false });
    setState((s) => (s === 'running' || s === 'starting' ? 'idle' : s));
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setState('unavailable');
      return;
    }
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      const track = stream.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorch({ supported: Boolean(caps.torch), on: false });
      setState('running');
    } catch (err) {
      const name = (err as Error).name;
      setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
    }
  }, []);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (state !== 'running') return;
    let cancelled = false;
    let detector: BarcodeDetectorLike | null = null;
    try {
      detector = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
    } catch {
      detector = null;
    }
    let jsQR: ((data: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null = null;
    if (!detector) void import('jsqr').then((m) => (jsQR = m.default));

    const tick = async () => {
      if (cancelled) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && !pausedRef.current) {
        let value: string | null = null;
        try {
          if (detector) {
            const codes = await detector.detect(video);
            value = codes[0]?.rawValue ?? null;
          } else if (jsQR) {
            canvasRef.current ??= document.createElement('canvas');
            const canvas = canvasRef.current;
            const scale = Math.min(1, 640 / video.videoWidth);
            canvas.width = Math.floor(video.videoWidth * scale);
            canvas.height = Math.floor(video.videoHeight * scale);
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx && canvas.width && canvas.height) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              value = jsQR(img.data, img.width, img.height)?.data ?? null;
            }
          }
        } catch {
          value = null;
        }
        if (value) {
          const now = Date.now();
          const last = lastRef.current;
          // Ignore repeated detections of the same code for a few seconds.
          if (!last || last.value !== value || now - last.at > 4000) {
            lastRef.current = { value, at: now };
            onDetect(value);
          } else {
            lastRef.current = { value, at: now };
          }
        }
      }
      setTimeout(() => void tick(), 180);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [state, onDetect]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch.on } as MediaTrackConstraintSet] });
      setTorch((s) => ({ ...s, on: !s.on }));
    } catch {
      setTorch({ supported: false, on: false });
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-navy-950">
        <video ref={videoRef} playsInline muted className={`size-full object-cover ${state === 'running' ? '' : 'invisible'}`} />
        {state === 'running' && (
          <>
            <div className="scan-frame" aria-hidden />
            <div className="scan-line" aria-hidden />
            <p className="absolute inset-x-0 bottom-3 text-center text-sm font-semibold text-white drop-shadow">{t('scan.pointCamera')}</p>
          </>
        )}
        {state !== 'running' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
            {state === 'denied' || state === 'unavailable' ? <VideoOff className="size-10 text-navy-200" aria-hidden /> : <Camera className="size-10 text-teal-200" aria-hidden />}
            <p className="max-w-xs text-sm text-navy-100">{state === 'denied' ? t('scan.cameraDenied') : state === 'unavailable' ? t('scan.webCameraUnsupported') : t('scan.cameraPermissionBody')}</p>
            {(state === 'idle' || state === 'denied') && (
              <Button variant="accent" icon={<Camera className="size-5" aria-hidden />} onClick={() => void start()}>
                {state === 'denied' ? t('common.retry') : t('scan.startCamera')}
              </Button>
            )}
            {state === 'starting' && <p className="text-sm">{t('common.loading')}</p>}
          </div>
        )}
      </div>
      {state === 'running' && (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={<CameraOff className="size-4" aria-hidden />} onClick={stop}>
            {t('scan.stopCamera')}
          </Button>
          {torch.supported && (
            <Button variant="secondary" size="sm" aria-pressed={torch.on} icon={torch.on ? <FlashlightOff className="size-4" aria-hidden /> : <Flashlight className="size-4" aria-hidden />} onClick={() => void toggleTorch()}>
              {torch.on ? t('scan.torchOff') : t('scan.torchOn')}
            </Button>
          )}
        </div>
      )}
      {state === 'denied' && <Banner tone="warning">{t('scan.cameraDenied')}</Banner>}
    </div>
  );
}
