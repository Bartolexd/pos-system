import { useState } from "react";
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
  const [status, setStatus] = useState("Listo para escanear");
  const [history, setHistory] = useState([]);
  const [manualCode, setManualCode] = useState("");

 const enviarCodigo = async (code) => {
  const limpio = String(code).replace(/\D/g, ""); // 🔥 SOLO NÚMEROS

  if (!limpio) return;

  try {
    const sessionRef = ref(db, `scan-sessions/${sessionId}`);
    await set(sessionRef, { code: limpio, timestamp: Date.now() });

    setTimeout(() => remove(sessionRef), 1000);

    setStatus(`✅ ${limpio}`);
    setHistory(h => [{ code: limpio, time: new Date().toLocaleTimeString() }, ...h].slice(0, 8));
    setManualCode("");
  } catch (e) {
    setStatus("❌ Error al enviar");
  }
};

  return (
    <div style={{
      minHeight: "100dvh", background: "#0a0a0f", color: "#f0ede8",
      fontFamily: "monospace", display: "flex", flexDirection: "column",
      alignItems: "center", padding: "24px 16px", gap: 20,
    }}>
      {/* Header */}
      <div style={{ width: "100%", maxWidth: 380, display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#39ff8f", boxShadow: "0 0 10px #39ff8f" }} />
        <span style={{ fontSize: 13, color: "#888", letterSpacing: "0.2em" }}>
          ESCÁNER · #{sessionId?.slice(0, 8)}
        </span>
      </div>

      {/* Botón cámara nativa */}
      <div style={{
        width: "100%", maxWidth: 380, background: "#111118",
        border: "1px solid #39ff8f44", borderRadius: 16, padding: 24,
        textAlign: "center",
      }}>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>
          Toca el botón para abrir la cámara y escanear
        </p>
        <label style={{
          display: "block", background: "#39ff8f", color: "#07070d",
          padding: "14px 24px", borderRadius: 12, fontSize: 16,
          fontWeight: 700, cursor: "pointer", letterSpacing: "0.05em",
        }}>
          📷 Escanear código
          <input
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={async (e) => {
              const file = e.target.files[0];
              if (!file) return;
              setStatus("Procesando...");
              try {
                const { BrowserMultiFormatReader } = await import("@zxing/browser");
                const reader = new BrowserMultiFormatReader();
                const img = await createImageBitmap(file);
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                canvas.getContext("2d").drawImage(img, 0, 0);
                const result = await reader.decodeFromCanvas(canvas);
                await enviarCodigo(result.getText());
              } catch {
                setStatus("❌ No se detectó código. Intenta de nuevo.");
              }
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {/* Input manual */}
      <div style={{ width: "100%", maxWidth: 380 }}>
        <p style={{ fontSize: 11, color: "#555", marginBottom: 8, letterSpacing: "0.1em" }}>
          O INGRESA EL CÓDIGO MANUALMENTE
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enviarCodigo(manualCode)}
            placeholder="Ej: 7750182003827"
            style={{
              flex: 1, background: "#111118", border: "1px solid #1e1e2e",
              borderRadius: 10, padding: "12px 14px", color: "#f0ede8",
              fontFamily: "monospace", fontSize: 14, outline: "none",
            }}
          />
          <button
            onClick={() => enviarCodigo(manualCode)}
            style={{
              background: "#1a2e20", border: "1px solid #39ff8f44",
              color: "#39ff8f", padding: "12px 16px", borderRadius: 10,
              fontFamily: "monospace", fontSize: 13, cursor: "pointer",
            }}
          >
            Enviar
          </button>
        </div>
      </div>

      {/* Estado */}
      <div style={{
        width: "100%", maxWidth: 380, background: "#111118",
        border: "1px solid #1e1e2e", borderRadius: 12, padding: "14px 16px",
      }}>
        <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>ÚLTIMO ESCANEO</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: status.startsWith("✅") ? "#39ff8f" : status.startsWith("❌") ? "#ff6b6b" : "#f0ede8" }}>
          {status}
        </div>
      </div>

      {/* Historial */}
      {history.length > 0 && (
        <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 6 }}>
          <p style={{ fontSize: 11, color: "#555", letterSpacing: "0.1em" }}>HISTORIAL</p>
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