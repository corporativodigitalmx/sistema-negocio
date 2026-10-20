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
import Admin from "./pages/Admin.jsx";
import Tasks from "./pages/Tasks.jsx";
import Reports from "./pages/Reports.jsx";
import Support from "./pages/Support.jsx";
import Settings from "./pages/Settings.jsx";

function AccessGuard({allowed,fallback,children}) { return allowed ? children : <Navigate to={fallback} replace />; }

function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState("");
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

  const sessionUserId = session?.user?.id;
  useEffect(() => {
    let active = true;
    async function loadAccess() {
      if (!sessionUserId) { setAccess(null); return; }
      setAccessLoading(true); setAccessError("");
      const { data, error } = await supabase.from("user_access").select("user_id,email,full_name,role,permissions").eq("user_id", sessionUserId).maybeSingle();
      if (!active) return;
      if (error || !data) { setAccessError(error?.message || "No existe el perfil de permisos para esta cuenta."); setAccess(null); }
      else setAccess(data);
      setAccessLoading(false);
    }
    loadAccess();
    return () => { active = false; };
  }, [sessionUserId]);

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

  if (accessLoading || (!access && !accessError)) return <div style={styles.loading}><p>Preparando permisos…</p></div>;
  if (accessError) return <div style={styles.loading}><section><p>No se pudo cargar tu perfil de acceso: {accessError}</p><button onClick={() => supabase.auth.signOut()}>Cerrar sesión</button></section></div>;
  const isAdmin = access?.role === "superadmin";
  const can = (key) => isAdmin || Boolean(access?.permissions?.[key] || (key === "clients_view" && (access?.permissions?.clients_edit || access?.permissions?.clients_all)) || (key === "inventory_view" && access?.permissions?.inventory_all) || (key === "tasks_view" && access?.permissions?.tasks_manage) || (key === "accounts_view" && access?.permissions?.accounts_edit) || (key === "sales_view" && access?.permissions?.sales_edit) || (key === "payments_view" && access?.permissions?.payments_edit) || (key === "suppliers_view" && access?.permissions?.suppliers_edit) || (key === "support_view" && access?.permissions?.support_manage));
  const landing = can("dashboard_view") ? "/" : can("inventory_view") ? "/inventario" : can("clients_view") ? "/clientes" : can("accounts_view") ? "/cuentas" : can("sales_view") ? "/ventas" : can("payments_view") ? "/pagos" : can("suppliers_view") ? "/proveedores" : can("reports_view") ? "/reportes" : can("support_view") ? "/soporte" : can("settings_view") ? "/configuracion" : can("tasks_view") ? "/tareas" : "/sin-acceso";

  // 🚀 APP PRINCIPAL
  return (
    <BrowserRouter>
      <div style={styles.app}>

        {/* SIDEBAR */}
        <Sidebar access={access} />

        {/* CONTENIDO */}
        <div style={styles.main}>

          {/* TOPBAR */}
          <Topbar user={session.user} />

          {/* RUTAS */}
          <div style={styles.content}>
            <Routes>
              <Route path="/" element={<AccessGuard allowed={can("dashboard_view")} fallback={landing}><Dashboard user={session.user} /></AccessGuard>} />
              <Route path="/clientes" element={<AccessGuard allowed={can("clients_view")} fallback={landing}><Clientes userId={session.user.id} canEdit={can("clients_edit")} /></AccessGuard>} />
              <Route path="/cuentas" element={<AccessGuard allowed={can("accounts_view")} fallback={landing}><Cuentas canEdit={can("inventory_edit")} /></AccessGuard>} />
              <Route path="/ventas" element={<AccessGuard allowed={can("sales_view")} fallback={landing}><Ventas userId={session.user.id} canEdit={can("sales_edit")} /></AccessGuard>} />
              <Route path="/pagos" element={<AccessGuard allowed={can("payments_view")} fallback={landing}><Pagos userId={session.user.id} canEdit={can("payments_edit")} /></AccessGuard>} />
              <Route path="/proveedores" element={<AccessGuard allowed={can("suppliers_view")} fallback={landing}><Proveedores userId={session.user.id} canEdit={can("suppliers_edit")} /></AccessGuard>} />
              <Route path="/inventario" element={<AccessGuard allowed={can("inventory_view")} fallback={landing}><Inventario userId={session.user.id} isSuperadmin={isAdmin} canViewAll={can("inventory_all")} canEdit={can("inventory_edit")} /></AccessGuard>} />
              <Route path="/tareas" element={<AccessGuard allowed={can("tasks_view")} fallback={landing}><Tasks user={session.user} canManage={can("tasks_manage")} /></AccessGuard>} />
              <Route path="/reportes" element={<AccessGuard allowed={can("reports_view")} fallback={landing}><Reports /></AccessGuard>} />
              <Route path="/soporte" element={<AccessGuard allowed={can("support_view")} fallback={landing}><Support userId={session.user.id} canManage={can("support_manage")} /></AccessGuard>} />
              <Route path="/configuracion" element={<AccessGuard allowed={can("settings_view")} fallback={landing}><Settings user={session.user} /></AccessGuard>} />
              <Route path="/administracion" element={isAdmin ? <Admin /> : <Navigate to={landing} replace />} />
              <Route path="/sin-acceso" element={<div style={{color:"white"}}><h1>Sin módulos asignados</h1><p>Solicita al administrador que habilite tu acceso.</p></div>} />

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
