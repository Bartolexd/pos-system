import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import ScannerMobile from './ScannerMobile.jsx'
import { auth } from './firebase/firebase'
import { onAuthStateChanged } from 'firebase/auth'

function ProtectedScanner() {
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setChecking(false);
    });
    return unsub;
  }, []);

  if (checking) return (
    <div style={{ minHeight: "100dvh", background: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center", color: "#39ff8f", fontFamily: "monospace" }}>
      Cargando...
    </div>
  );

  if (!user) return <Navigate to="/" state={{ from: location.pathname }} replace />;

  return <ScannerMobile />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/scanner/:sessionId" element={<ProtectedScanner />} />
        <Route path="/*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
)