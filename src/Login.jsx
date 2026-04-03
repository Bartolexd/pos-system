import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "./firebase/firebase";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (event) => {
    event.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Ingresa email y contraseña.");
      return;
    }

    try {
      setLoading(true);
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      console.error("Error de login:", err);
      setError("Usuario o contraseña incorrectos.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Iniciar sesión</h1>
        <p className="section-copy">Ingresa con tu correo y contraseña para acceder al POS. El registro solo lo puede crear un administrador.</p>
        <form onSubmit={handleLogin} className="form-grid">
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="input"
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="button primary" type="submit" disabled={loading}>
            {loading ? "Procesando..." : "Ingresar"}
          </button>
        </form>

        {error && <p className="error-text">{error}</p>}

        <div className="auth-footer">
          <p>Registro deshabilitado. Pide a un admin que genere tu cuenta.</p>
        </div>
      </div>
    </div>
  );
}

export default Login;
