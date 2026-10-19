import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      alert("Error: " + error.message);
      setLoading(false);
      return;
    }

    alert("Bienvenido 🚀");
    window.location.reload();
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.logo}>CD</h1>

        <h2>Iniciar sesión</h2>
        <p style={styles.subtitle}>Acceso al sistema</p>

        <form onSubmit={handleLogin} style={styles.form}>
          <input
            type="email"
            placeholder="Correo electrónico"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
            required
          />

          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
            required
          />

          <button type="submit" style={styles.button} disabled={loading}>
            {loading ? "Cargando..." : "Entrar →"}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  container: {
    height: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "linear-gradient(135deg, #0f172a, #020617)",
  },
  card: {
    background: "#020617",
    padding: "40px",
    borderRadius: "20px",
    width: "350px",
    textAlign: "center",
    boxShadow: "0 0 30px rgba(0,255,255,0.2)",
  },
  logo: {
    fontSize: "48px",
    marginBottom: "10px",
    color: "#38bdf8",
  },
  subtitle: {
    color: "#94a3b8",
    marginBottom: "20px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "15px",
  },
  input: {
    padding: "12px",
    borderRadius: "10px",
    border: "1px solid #1e293b",
    background: "#020617",
    color: "white",
  },
  button: {
    padding: "12px",
    borderRadius: "10px",
    border: "none",
    background: "linear-gradient(90deg, #06b6d4, #3b82f6)",
    color: "white",
    fontWeight: "bold",
    cursor: "pointer",
  },
};