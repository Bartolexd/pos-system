import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { initializeApp, getApps } from "firebase/app";
import { getDatabase, ref, set, remove } from "firebase/database";
import { BrowserMultiFormatReader } from "@zxing/browser";

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
  const readerRef = useRef(null);
  const cooldownRef = useRef(false);
  const [status, setStatus] = useState("Iniciando cámara...");
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    reader.decodeFromConstraints(
      {
        audio: false,
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
      videoRef.current,
      async (result, err) => {
        if (result && !cooldownRef.current) {
          const code = result.getText();
          cooldownRef.current = true;
          setTimeout(() => { cooldownRef.current = false; }, 2500);

          if (navigator.vibrate) navigator.vibrate([60, 30, 60]);

          try {
            const sessionRef = ref(db, `scan-sessions/${sessionId}`);
            await set(sessionRef, { code, timestamp: Date.now() });
            setTimeout(() => remove(sessionRef), 1000);
            setStatus(`✅ ${code}`);
            setHistory(h => [{ code, time: new Date().toLocaleTimeString() }, ...h].slice(0, 6));
          } catch (e) {
            setError("Error al enviar el código.");
          }
        }
        if (err && err.name !== "NotFoundException") {
          setStatus("Apunta al código de barras");
        } else if (!result) {
          setStatus("Apunta al código de barras");
        }
      }
    ).catch((e) => {
      setError("No se pudo acceder a la cámara. Verifica los permisos en Safari.");
    });

    return () => {
      if (readerRef.current) readerRef.current.reset();
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
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          alignItems: "center", justifyContent: "center", pointerEvents: "none",
        }}>
          <div style={{ width: "60%", aspectRatio: "2/1", border: "2px solid #39ff8f", borderRadius: 4 }} />
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