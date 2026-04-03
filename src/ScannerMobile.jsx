
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { initializeApp, getApps } from "firebase/app";
import { getDatabase, ref, set, remove } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyC3v1Yh2ZSoZtPNjzzdQQjulkC2Fx_P_T0",
  authDomain: "pos-system-9be7d.firebaseapp.com",
  databaseURL: "https://pos-system-9be7d-default-rtdb.firebaseio.com",
  projectId: "pos-system-9be7d",
  storageBucket: "pos-system-9be7d.appspot.com",
  messagingSenderId: "508733657442",
  appId: "1:508733657442:web:d426f977b9f14af7329c3b",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getDatabase(app);

export default function ScannerMobile() {
  const { sessionId } = useParams();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState("Iniciando cámara...");
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const cooldownRef = useRef(false);
  const animRef = useRef(null);

  useEffect(() => {
    let stream = null;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", true);
          await videoRef.current.play();
          setStatus("Apunta al código de barras");
          startScanning();
        }
      } catch (e) {
        console.error(e);
        setError("No se pudo acceder a la cámara. Ve a Configuración → Safari → Cámara → Permitir.");
      }
    };

    const startScanning = async () => {
      try {
        const ZXing = await import("@zxing/library");
        const hints = new Map();
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
          ZXing.BarcodeFormat.EAN_13,
          ZXing.BarcodeFormat.EAN_8,
          ZXing.BarcodeFormat.CODE_128,
          ZXing.BarcodeFormat.CODE_39,
          ZXing.BarcodeFormat.UPC_A,
          ZXing.BarcodeFormat.UPC_E,
        ]);

        const reader = new ZXing.BrowserMultiFormatReader(hints);

        const scanLoop = async () => {
          if (!videoRef.current || !canvasRef.current) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;

          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            try {
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const luminanceSource = new ZXing.RGBLuminanceSource(imageData.data, canvas.width, canvas.height);
              const binaryBitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminanceSource));
              const result = reader.decode(binaryBitmap);

              if (result && !cooldownRef.current) {
                const code = result.getText();
                cooldownRef.current = true;
                setTimeout(() => { cooldownRef.current = false; }, 2500);

                if (navigator.vibrate) navigator.vibrate([60, 30, 60]);

                const sessionRef = ref(db, `scan-sessions/${sessionId}`);
                await set(sessionRef, { code, timestamp: Date.now() });
                setTimeout(() => remove(sessionRef), 1000);

                setStatus(`✅ ${code}`);
                setHistory(h => [{ code, time: new Date().toLocaleTimeString() }, ...h].slice(0, 6));
              }
            } catch (e) {
              // No se detectó código, continuar
            }
          }

          animRef.current = requestAnimationFrame(scanLoop);
        };

        animRef.current = requestAnimationFrame(scanLoop);
      } catch (e) {
        console.error(e);
        setError("Error al iniciar el escáner.");
      }
    };

    startCamera();

    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [sessionId]);

  return (
    <div style={{
      minHeight: "100dvh", background: "#0a0a0f", color: "#f0ede8",
      fontFamily: "monospace", display: "flex", flexDirection: "column",
      alignItems: "center", padding: "20px 16px", gap: 16,
    }}>
      <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#39ff8f", boxShadow: "0 0 10px #39ff8f" }} />
        <span style={{ fontSize: 13, color: "#888", letterSpacing: "0.2em" }}>
          ESCÁNER · #{sessionId?.slice(0, 8)}
        </span>
      </div>

      <div style={{
        width: "100%", maxWidth: 380, aspectRatio: "1",
        borderRadius: 20, overflow: "hidden", border: "1px solid #1e1e2e",
        position: "relative", background: "#111",
      }}>
        <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          alignItems: "center", justifyContent: "center", pointerEvents: "none",
        }}>
          <div style={{
            width: "60%", aspectRatio: "2/1",
            border: "2px solid #39ff8f", borderRadius: 4,
          }} />
        </div>
      </div>

      <div style={{
        width: "100%", maxWidth: 380, background: "#111118",
        border: "1px solid #1e1e2e", borderRadius: 12, padding: "14px 16px",
      }}>
        <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>ESTADO</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: status.startsWith("✅") ? "#39ff8f" : "#f0ede8" }}>
          {status}
        </div>
      </div>

      {error && (
        <div style={{
          width: "100%", maxWidth: 380, background: "#1f0a0a",
          border: "1px solid #ff4d4d44", borderRadius: 12, padding: "12px 16px",
          color: "#ff6b6b", fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {history.length > 0 && (
        <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 6 }}>
          {history.map((h, i) => (
            <div key={i} style={{
              background: "#111118", border: "1px solid #1a1a28",
              borderRadius: 8, padding: "8px 12px",
              display: "flex", justifyContent: "space-between", fontSize: 12,
            }}>
              <span>{h.code}</span>
              <span style={{ color: "#444" }}>{h.time}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}