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
  const streamRef = useRef(null);
  const animRef = useRef(null);
  const detectorRef = useRef(null);
  const cooldownRef = useRef(false);

  const [status, setStatus] = useState("Iniciando cámara...");
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [manualCode, setManualCode] = useState("");
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    // Verificar soporte de BarcodeDetector
    if (!("BarcodeDetector" in window)) {
      setSupported(false);
      setError("Tu navegador no soporta escaneo automático.\nUsa Chrome en Android para escaneo automático.\nO ingresa el código manualmente abajo.");
      return;
    }

    const init = async () => {
      try {
        // Crear detector con todos los formatos de códigos de barras
        detectorRef.current = new window.BarcodeDetector({
          formats: [
            "ean_13", "ean_8", "upc_a", "upc_e",
            "code_39", "code_128", "code_93",
            "itf", "codabar", "qr_code", "data_matrix",
          ],
        });

        // Solicitar cámara trasera
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { exact: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", "true");
          await videoRef.current.play();
          setStatus("Apunta al código de barras");
          startScanLoop();
        }
      } catch (e) {
        console.error(e);
        // Si falla cámara trasera exacta, intentar con ideal
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
          });
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.setAttribute("playsinline", "true");
            await videoRef.current.play();
            setStatus("Apunta al código de barras");
            startScanLoop();
          }
        } catch (e2) {
          if (e2.name === "NotAllowedError") {
            setError("Permiso de cámara denegado.\nVe a Configuración de Chrome → Permisos → Cámara → Permitir.");
          } else {
            setError("No se pudo acceder a la cámara: " + e2.message);
          }
        }
      }
    };

    const startScanLoop = () => {
      const scan = async () => {
        if (!videoRef.current || !detectorRef.current) return;
        if (videoRef.current.readyState < 2) {
          animRef.current = requestAnimationFrame(scan);
          return;
        }

        try {
          const barcodes = await detectorRef.current.detect(videoRef.current);
          if (barcodes.length > 0 && !cooldownRef.current) {
            const code = barcodes[0].rawValue;
            cooldownRef.current = true;
            setTimeout(() => { cooldownRef.current = false; }, 2500);

            // Vibrar al detectar
            if (navigator.vibrate) navigator.vibrate([60, 30, 60]);

            await enviarCodigo(code);
          }
        } catch (e) {
          // Ignorar errores de detección — son normales cuando no hay código
        }

        animRef.current = requestAnimationFrame(scan);
      };

      animRef.current = requestAnimationFrame(scan);
    };

    init();

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
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
      setStatus("❌ Error al enviar");
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
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* Header */}
      <div style={{ width: "100%", maxWidth: 420, display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: error ? "#ff6b6b" : "#39ff8f",
          boxShadow: error ? "0 0 8px #ff6b6b" : "0 0 10px #39ff8f",
          animation: !error ? "pulse 2s ease-in-out infinite" : "none",
        }} />
        <span style={{ fontSize: 12, color: "#666", letterSpacing: "0.15em" }}>
          ESCÁNER · #{sessionId?.slice(0, 8)}
        </span>
        {supported && !error && (
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#39ff8f", background: "#1a2e20", padding: "2px 8px", borderRadius: 20 }}>
            ● AUTO
          </span>
        )}
      </div>

      {/* Visor de cámara */}
      <div style={{
        width: "100%", maxWidth: 420, aspectRatio: "4/3",
        borderRadius: 16, overflow: "hidden",
        border: `1px solid ${status.startsWith("✅") ? "#39ff8f44" : "#1e1e2e"}`,
        position: "relative", background: "#111",
        transition: "border-color 0.3s",
      }}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />

        {/* Marco de escaneo */}
        {!error && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
          }}>
            <div style={{ width: "72%", height: "36%", position: "relative" }}>
              {[
                { top: 0, left: 0, borderTop: "3px solid #39ff8f", borderLeft: "3px solid #39ff8f" },
                { top: 0, right: 0, borderTop: "3px solid #39ff8f", borderRight: "3px solid #39ff8f" },
                { bottom: 0, left: 0, borderBottom: "3px solid #39ff8f", borderLeft: "3px solid #39ff8f" },
                { bottom: 0, right: 0, borderBottom: "3px solid #39ff8f", borderRight: "3px solid #39ff8f" },
              ].map((s, i) => (
                <div key={i} style={{ position: "absolute", width: 20, height: 20, ...s }} />
              ))}
              <div style={{
                position: "absolute", left: "5%", right: "5%", height: 2,
                background: "linear-gradient(90deg, transparent, #39ff8f, transparent)",
                animation: "scanline 2s ease-in-out infinite",
              }} />
            </div>
          </div>
        )}

        {/* Flash verde al detectar */}
        {status.startsWith("✅") && (
          <div style={{
            position: "absolute", inset: 0,
            background: "rgba(57,255,143,0.15)",
            pointerEvents: "none",
          }} />
        )}

        {/* Error overlay */}
        {error && (
          <div style={{
            position: "absolute", inset: 0, background: "rgba(10,10,15,0.93)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24, textAlign: "center",
          }}>
            <p style={{ color: "#ff6b6b", fontSize: 13, lineHeight: 1.8, whiteSpace: "pre-line" }}>
              {error}
            </p>
          </div>
        )}
      </div>

      {/* Estado */}
      <div style={{
        width: "100%", maxWidth: 420, background: "#111118",
        border: `1px solid ${status.startsWith("✅") ? "#39ff8f44" : status.startsWith("❌") ? "#ff4d4d44" : "#1e1e2e"}`,
        borderRadius: 12, padding: "12px 16px", transition: "all 0.3s",
      }}>
        <div style={{ fontSize: 10, color: "#555", marginBottom: 3, letterSpacing: "0.1em" }}>
          ÚLTIMO ESCANEO
        </div>
        <div style={{
          fontSize: 15, fontWeight: 700,
          color: status.startsWith("✅") ? "#39ff8f" : status.startsWith("❌") ? "#ff6b6b" : "#888",
        }}>
          {status}
        </div>
      </div>

      {/* Input manual */}
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ fontSize: 10, color: "#444", letterSpacing: "0.1em", marginBottom: 6 }}>
          O INGRESA EL CÓDIGO MANUALMENTE
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            inputMode="numeric"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && manualCode.trim()) {
                enviarCodigo(manualCode.trim());
                setManualCode("");
              }
            }}
            placeholder="Ej: 7750182003827"
            style={{
              flex: 1, background: "#111118",
              border: "1px solid #1e1e2e", borderRadius: 10,
              padding: "10px 14px", color: "#f0ede8",
              fontFamily: "monospace", fontSize: 13, outline: "none",
            }}
          />
          <button
            onClick={() => { if (manualCode.trim()) { enviarCodigo(manualCode.trim()); setManualCode(""); } }}
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
              display: "flex", justifyContent: "space-between",
              alignItems: "center", fontSize: 12,
            }}>
              <span style={{ color: "#f0ede8", fontWeight: i === 0 ? 700 : 400 }}>{h.code}</span>
              <span style={{ color: "#444" }}>{h.time}</span>
            </div>
          ))}
        </div>
      )}

      {/* Instrucciones */}
      <div style={{
        width: "100%", maxWidth: 420,
        background: "#0d0d18", border: "1px solid #1e1e2e",
        borderRadius: 10, padding: "12px 14px",
      }}>
        <div style={{ fontSize: 10, color: "#444", letterSpacing: "0.1em", marginBottom: 8 }}>INSTRUCCIONES</div>
        <div style={{ fontSize: 11, color: "#555", lineHeight: 1.8 }}>
          1. Apunta la cámara al código de barras<br />
          2. Mantén el código dentro del marco verde<br />
          3. El escaneo es automático — no toques nada<br />
          4. Vibra al detectar un código ✓
        </div>
      </div>
    </div>
  );
}