import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";

/**
 * Reads a QR code with the back camera, inside the app's own view. Calls
 * `onResult` once with the code's text. Uses the web view's camera rather
 * than a native scanner, which crashed the Android app.
 */
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(onResult);
  done.current = onResult;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    const stop = () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This device can't open the camera here.");
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (stopped) return stop();
      const el = video.current!;
      el.srcObject = stream;
      await el.play();
      timer = setInterval(() => {
        if (!context || el.videoWidth === 0) return;
        canvas.width = el.videoWidth;
        canvas.height = el.videoHeight;
        context.drawImage(el, 0, 0);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
        if (found?.data) {
          stop();
          done.current(found.data);
        }
      }, 200);
    })().catch((e: unknown) => {
      const name = (e as { name?: string })?.name;
      setError(
        name === "NotAllowedError"
          ? "Calendaria isn't allowed to use the camera. Allow it in Android's app settings, or type the code instead."
          : `Couldn't open the camera (${e instanceof Error ? e.message : String(e)}). Type the code instead.`,
      );
    });
    return stop;
  }, []);

  return (
    <div className="qr-scanner">
      {error ? (
        <p className="qr-error">{error}</p>
      ) : (
        <>
          <video ref={video} playsInline muted />
          <div className="qr-frame" />
          <p className="qr-hint">Point the camera at the code on your PC</p>
        </>
      )}
      <button type="button" className="qr-close" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}
