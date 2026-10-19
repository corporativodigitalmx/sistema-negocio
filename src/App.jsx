import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

// COMPONENTES
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";

// PÁGINAS
import Dashboard from "./pages/Dashboard";
import Clientes from "./pages/Clientes";
import Cuentas from "./pages/Cuentas";
import Ventas from "./pages/Ventas";
import Pagos from "./pages/Pagos";
import Proveedores from "./pages/Proveedores";
import Login from "./pages/login.jsx";
import Inventario from "./pages/Inventario.jsx";

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(() => window.location.hash.includes("type=recovery"));

  useEffect(() => {
    // 🔐 Obtener sesión
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    // 🔄 Escuchar cambios
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
        if (event === "SIGNED_OUT") setPasswordRecovery(false);
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  // ⏳ Loading inicial
  if (loading) {
    return (
      <div style={styles.loading}>
        <p>Cargando sistema...</p>
      </div>
    );
  }

  // 🔐 Si no hay sesión → LOGIN
  if (passwordRecovery) {
    return <Login initialMode="recovery" onRecoveryComplete={() => setPasswordRecovery(false)} />;
  }

  if (!session) {
    return <Login />;
  }

  // 🚀 APP PRINCIPAL
  return (
    <BrowserRouter>
      <div style={styles.app}>

        {/* SIDEBAR */}
        <Sidebar />

        {/* CONTENIDO */}
        <div style={styles.main}>

          {/* TOPBAR */}
          <Topbar user={session.user} />

          {/* RUTAS */}
          <div style={styles.content}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/clientes" element={<Clientes />} />
              <Route path="/cuentas" element={<Cuentas />} />
              <Route path="/ventas" element={<Ventas />} />
              <Route path="/pagos" element={<Pagos />} />
              <Route path="/proveedores" element={<Proveedores />} />
              <Route path="/inventario" element={<Inventario userId={session.user.id} />} />

              {/* Redirección */}
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </div>

        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;

const styles = {
  app: {
    display: "flex",
    height: "100vh",
    background: "#020617",
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
  },
  content: {
    flex: 1,
    padding: "20px",
    overflow: "auto",
  },
  loading: {
    height: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "#020617",
    color: "white",
  },
};
