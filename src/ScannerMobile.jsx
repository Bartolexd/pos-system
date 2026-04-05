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
  const readerRef = useRef(null);
  const cooldownRef = useRef(false);
  const [status, setStatus] = useState("Iniciando cámara...");
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [manualCode, setManualCode] = useState("");

  useEffect(() => {
    let stopped = false;

    const init = async () => {
      try {
        const { BrowserMultiFormatReader, NotFoundException } = await import("@zxing/browser");

        const reader = new BrowserMultiFormatReader();
        readerRef.current = reader;

        const devices = await BrowserMultiFormatReader.listVideoInputDevices();

        // Buscar cámara trasera
        const backCamera = devices.find(d =>
          d.label.toLowerCase().includes("back") ||
          d.label.toLowerCase().includes("rear") ||
          d.label.toLowerCase().includes("environment") ||
          d.label.toLowerCase().includes("trasera")
        ) || devices[devices.length - 1] || devices[0];

        if (!backCamera) {
          setError("No se encontró cámara disponible.");
          return;
        }

        setStatus("Apunta al código de barras");

        await reader.decodeFromVideoDevice(
          backCamera.deviceId,
          videoRef.current,
          async (result, err) => {
            if (stopped) return;

            if (result && !cooldownRef.current) {
              const code = result.getText();
              cooldownRef.current = true;
              setTimeout(() => { cooldownRef.current = false; }, 3000);
              if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
              await enviarCodigo(code);
            }

            if (err && !(err instanceof NotFoundException)) {
              // Ignorar errores normales de "no detectado"
            }
          }
        );
      } catch (e) {
        if (!stopped) {
          console.error(e);
          if (e.name === "NotAllowedError") {
            setError("Permiso de cámara denegado.\n\nVe a Configuración → Safari → Cámara → Permitir.");
          } else if (e.name === "NotFoundError") {
            setError("No se encontró cámara en este dispositivo.");
          } else {
            setError("Error al iniciar cámara: " + e.message);
          }
        }
      }
    };

    init();

    return () => {
      stopped = true;
      if (readerRef.current) {
        try { readerRef.current.reset(); } catch (e) {}
      }
    };
  }, [sessionId]);

  const enviarCodigo = async (code) => {
    const limpio = String(code).trim();
    if (!limpio) return;
    try {
      const sessionRef = ref(db, `scan-sessions/${sessionId}`);
      await set(sessionRef, { code: limpio, timestamp: Date.now() });
      setTimeout(() => remove(sessionRef), 1000);
      setStatus(`✅ ${limpio}`);
      setHistory(h => [{ code: limpio, time: new Date().toLocaleTimeString() }, ...h].slice(0, 8));
    } catch (e) {
      setStatus("❌ Error al enviar — verifica conexión");
    }
  };

  return (
    <div style={{
      minHeight: "100dvh", background: "#0a0a0f", color: "#f0ede8",
      fontFamily: "monospace", display: "flex", flexDirection: "column",
      alignItems: "center", padding: "16px", gap: 14, boxSizing: "border-box",
    }}>
      <style>{`
        @keyframes scanline {
          0%   { top: 10%; opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { top: 90%; opacity: 0; }
        }
      `}</style>

      {/* Header */}
      <div style={{ width: "100%", maxWidth: 420, display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: error ? "#ff6b6b" : "#39ff8f",
          boxShadow: error ? "0 0 8px #ff6b6b" : "0 0 10px #39ff8f",
        }} />
        <span style={{ fontSize: 12, color: "#666", letterSpacing: "0.15em" }}>
          ESCÁNER · #{sessionId?.slice(0, 8)}
        </span>
      </div>

      {/* Visor */}
      <div style={{
        width: "100%", maxWidth: 420, aspectRatio: "4/3",
        borderRadius: 16, overflow: "hidden",
        border: "1px solid #1e1e2e", position: "relative", background: "#111",
      }}>
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />

        {/* Marco verde */}
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <div style={{ width: "70%", height: "35%", position: "relative" }}>
            {[
              { top: 0, left: 0, borderTop: "3px solid #39ff8f", borderLeft: "3px solid #39ff8f" },
              { top: 0, right: 0, borderTop: "3px solid #39ff8f", borderRight: "3px solid #39ff8f" },
              { bottom: 0, left: 0, borderBottom: "3px solid #39ff8f", borderLeft: "3px solid #39ff8f" },
              { bottom: 0, right: 0, borderBottom: "3px solid #39ff8f", borderRight: "3px solid #39ff8f" },
            ].map((s, i) => (
              <div key={i} style={{ position: "absolute", width: 24, height: 24, borderRadius: 2, ...s }} />
            ))}
            <div style={{
              position: "absolute", left: "5%", right: "5%", height: 2,
              background: "linear-gradient(90deg, transparent, #39ff8f, transparent)",
              boxShadow: "0 0 8px #39ff8f",
              animation: "scanline 2s ease-in-out infinite",
            }} />
          </div>
        </div>

        {/* Error overlay */}
        {error && (
          <div style={{
            position: "absolute", inset: 0, background: "rgba(10,10,15,0.92)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24, textAlign: "center",
          }}>
            <p style={{ color: "#ff6b6b", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-line" }}>
              {error}
            </p>
          </div>
        )}
      </div>

      {/* Estado */}
      <div style={{
        width: "100%", maxWidth: 420, background: "#111118",
        border: `1px solid ${status.startsWith("✅") ? "#39ff8f44" : status.startsWith("❌") ? "#ff4d4d44" : "#1e1e2e"}`,
        borderRadius: 12, padding: "12px 16px", transition: "border-color 0.3s",
      }}>
        <div style={{ fontSize: 10, color: "#555", marginBottom: 3, letterSpacing: "0.1em" }}>ESTADO</div>
        <div style={{
          fontSize: 14, fontWeight: 700,
          color: status.startsWith("✅") ? "#39ff8f" : status.startsWith("❌") ? "#ff6b6b" : "#f0ede8",
        }}>
          {status}
        </div>
      </div>

      {/* Manual */}
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ fontSize: 10, color: "#444", letterSpacing: "0.1em", marginBottom: 6 }}>
          O INGRESA MANUALMENTE
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            inputMode="numeric"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { enviarCodigo(manualCode); setManualCode(""); } }}
            placeholder="Ej: 7750182003827"
            style={{
              flex: 1, background: "#111118", border: "1px solid #1e1e2e",
              borderRadius: 10, padding: "10px 14px", color: "#f0ede8",
              fontFamily: "monospace", fontSize: 13, outline: "none",
            }}
          />
          <button
            onClick={() => { enviarCodigo(manualCode); setManualCode(""); }}
            style={{
              background: "#1a2e20", border: "1px solid #39ff8f44",
              color: "#39ff8f", padding: "10px 16px", borderRadius: 10,
              fontFamily: "monospace", fontSize: 13, cursor: "pointer",
            }}
          >
            Enviar
          </button>
        </div>
      </div>

      {/* Historial */}
      {history.length > 0 && (
        <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 10, color: "#444", letterSpacing: "0.1em" }}>HISTORIAL</div>
          {history.map((h, i) => (
            <div key={i} style={{
              background: "#111118", border: "1px solid #1a1a28",
              borderRadius: 8, padding: "8px 12px",
              display: "flex", justifyContent: "space-between", fontSize: 12,
            }}>
              <span style={{ color: "#f0ede8" }}>{h.code}</span>
              <span style={{ color: "#444" }}>{h.time}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}