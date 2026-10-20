import { useState } from "react";
import { ArrowRight, CheckCircle2, LockKeyhole, Mail, UserRound, Boxes, Users, CreditCard, ClipboardList, ShoppingBag, Sparkles, ShieldCheck, PackageCheck, Truck, BarChart3, Headphones, Shield, Wallet } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import "./auth.css";

const labels = {
  register: { title: "Crea tu cuenta", description: "Regístrate para comenzar a administrar tu negocio." },
  login: { title: "Qué bueno verte", description: "Inicia sesión para continuar en tu espacio de trabajo." },
  forgot: { title: "Recupera tu acceso", description: "Te enviaremos un enlace para crear una contraseña nueva." },
  recovery: { title: "Crea una contraseña nueva", description: "Elige una contraseña segura para tu cuenta." },
};

export default function Login({ initialMode = "register", onRecoveryComplete }) {
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [flyerTab, setFlyerTab] = useState("sistema");

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setError("");
    setMessage("");
  };

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    const cleanEmail = email.trim().toLowerCase();

    if ((mode === "register" || mode === "recovery") && password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if ((mode === "register" || mode === "recovery") && password !== passwordConfirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "register") {
        const { data, error: authError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: { full_name: name.trim() },
            emailRedirectTo: window.location.origin,
          },
        });
        if (authError) throw authError;
        if (data.session) setMessage("Tu cuenta está lista. Ya puedes comenzar.");
        else setMessage("Te enviamos un correo para confirmar tu cuenta antes de iniciar sesión.");
      } else if (mode === "login") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (authError) throw authError;
      } else if (mode === "forgot") {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: window.location.origin,
        });
        if (authError) throw authError;
        setMessage("Si existe una cuenta con ese correo, recibirá un enlace para restablecer la contraseña.");
      } else {
        const { error: authError } = await supabase.auth.updateUser({ password });
        if (authError) throw authError;
        setMessage("Contraseña actualizada. Ya puedes continuar.");
        onRecoveryComplete?.();
      }
    } catch (authError) {
      setError(authError.message || "No se pudo completar la solicitud. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  const copy = labels[mode];
  return (
    <main className="auth-page">
      <div className="auth-glow auth-glow-one" />
      <div className="auth-glow auth-glow-two" />
      <header className="auth-topbar">
        <button className={`auth-top-link ${mode === "login" ? "active" : ""}`} type="button" onClick={() => changeMode("login")}>Iniciar sesión <ArrowRight size={15} /></button>
        <a className="auth-brand" href="/" aria-label="Sistema Negocio, inicio">
          <span className="auth-brand-mark">CD</span>
          <span>Corporativo Digital</span>
        </a>
      </header>
      <section className="auth-layout" aria-label="Acceso a Sistema Negocio">
        <div className="auth-intro">
          <div className="auth-intro-copy">
            <span className="auth-kicker">SISTEMA NEGOCIO</span>
            <h1>Todo tu negocio,<br /><span>en un solo lugar.</span></h1>
            <p>Organiza clientes, ventas, proveedores e inventario desde un espacio sencillo y seguro.</p>
          </div>
          <div className="auth-footnote"><LockKeyhole size={15} /> Tus datos se mantienen protegidos por cuenta.</div>
        </div>

        <section className="auth-card">
          <div className="auth-card-heading">
            <span className="auth-card-icon"><UserRound size={20} /></span>
            <p>{mode === "register" ? "PRIMEROS PASOS" : mode === "recovery" ? "SEGURIDAD DE LA CUENTA" : "BIENVENIDO DE VUELTA"}</p>
            <h2>{copy.title}</h2>
            <span className="auth-description">{copy.description}</span>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {mode === "register" && (
              <label className="auth-field">
                <span>Nombre completo</span>
                <span className="auth-input-wrap"><UserRound size={17} /><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Tu nombre" maxLength={100} required /></span>
              </label>
            )}
            {mode !== "recovery" && (
              <label className="auth-field">
                <span>Correo electrónico</span>
                <span className="auth-input-wrap"><Mail size={17} /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@empresa.com" required /></span>
              </label>
            )}
            {mode !== "forgot" && (
              <label className="auth-field">
                <span>{mode === "recovery" ? "Nueva contraseña" : "Contraseña"}</span>
                <span className="auth-input-wrap"><LockKeyhole size={17} /><input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mínimo 8 caracteres" minLength={mode === "register" || mode === "recovery" ? 8 : undefined} required /></span>
              </label>
            )}
            {(mode === "register" || mode === "recovery") && (
              <label className="auth-field">
                <span>Confirmar contraseña</span>
                <span className="auth-input-wrap"><LockKeyhole size={17} /><input type="password" autoComplete="new-password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} placeholder="Escríbela nuevamente" minLength={8} required /></span>
              </label>
            )}
            {mode === "login" && <button className="auth-text-button auth-forgot" type="button" onClick={() => changeMode("forgot")}>¿Olvidaste tu contraseña?</button>}

            {error && <p className="auth-feedback error" role="alert">{error}</p>}
            {message && <p className="auth-feedback success" role="status"><CheckCircle2 size={17} />{message}</p>}

            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? "Un momento…" : mode === "register" ? "Crear cuenta" : mode === "login" ? "Iniciar sesión" : mode === "forgot" ? "Enviar enlace" : "Actualizar contraseña"}
              {!busy && <ArrowRight size={18} />}
            </button>
          </form>

          {mode === "register" && <p className="auth-switch">¿Ya tienes una cuenta? <button className="auth-text-button" type="button" onClick={() => changeMode("login")}>Inicia sesión</button></p>}
          {mode === "login" && <p className="auth-switch">¿Aún no tienes cuenta? <button className="auth-text-button" type="button" onClick={() => changeMode("register")}>Regístrate</button></p>}
          {(mode === "forgot" || mode === "recovery") && <p className="auth-switch"><button className="auth-text-button" type="button" onClick={() => changeMode("login")}>Volver a iniciar sesión</button></p>}
          <p className="auth-legal">Al continuar, aceptas usar este espacio de forma responsable.</p>
        </section>
      </section>
      <section className="auth-flyer" aria-labelledby="auth-flyer-title">
        <div className="auth-flyer-heading">
          <span className="auth-kicker">UNA EXPERIENCIA COMPLETA</span>
          <h2 id="auth-flyer-title">Administra tu negocio. Encuentra lo que necesitas.</h2>
          <p>Herramientas de gestión y una tienda en línea, en un mismo espacio.</p>
        </div>
        <div className="auth-flyer-tabs" role="tablist" aria-label="Explora Sistema Negocio y la tienda">
          <button type="button" role="tab" aria-selected={flyerTab === "sistema"} className={flyerTab === "sistema" ? "selected" : ""} onClick={() => setFlyerTab("sistema")}><Boxes size={17} /> El sistema</button>
          <button type="button" role="tab" aria-selected={flyerTab === "tienda"} className={flyerTab === "tienda" ? "selected" : ""} onClick={() => setFlyerTab("tienda")}><ShoppingBag size={17} /> La tienda en línea</button>
        </div>
        {flyerTab === "sistema" ? (
          <div className="auth-flyer-grid" role="tabpanel">
            <FlyerCard icon={<Users />} title="Clientes" text="Organiza sus datos, perfiles, asignaciones y renovaciones." />
            <FlyerCard icon={<Boxes />} title="Inventario y cuentas" text="Controla existencias, disponibilidad y cuentas por vencer." />
            <FlyerCard icon={<CreditCard />} title="Ventas" text="Registra entregas de perfiles o cuentas completas a tus clientes." />
            <FlyerCard icon={<Wallet />} title="Pagos" text="Registra pagos y consulta saldos pendientes de cobro." />
            <FlyerCard icon={<Truck />} title="Proveedores" text="Mantén organizados los proveedores y su información." />
            <FlyerCard icon={<ClipboardList />} title="Tareas" text="Asigna pendientes al equipo y da seguimiento a su avance." />
            <FlyerCard icon={<BarChart3 />} title="Reportes" text="Consulta indicadores de ventas, pagos, clientes e inventario." />
            <FlyerCard icon={<Headphones />} title="Soporte y configuración" text="Gestiona solicitudes de ayuda y actualiza tu perfil." />
            <FlyerCard icon={<Shield />} title="Administración" text="Administra usuarios y permisos de acceso a los módulos." />
          </div>
        ) : (
          <div className="auth-store-panel" role="tabpanel">
            <span className="auth-store-icon"><ShoppingBag size={25} /></span>
            <div><h3>Explora nuestra tienda en línea</h3><p>Descubre el catálogo de servicios digitales y las opciones disponibles. Consulta los detalles de cada opción antes de elegir.</p></div>
            <span className="auth-store-note"><Sparkles size={16} /> Catálogo digital</span>
          </div>
        )}
        <div className="auth-flyer-footer"><span><ShieldCheck size={16} /> Gestión organizada y acceso por usuario</span><span><PackageCheck size={16} /> Todo a tu ritmo, desde cualquier dispositivo</span></div>
      </section>
    </main>
  );
}

function FlyerCard({ icon, title, text }) {
  return <article className="auth-flyer-card"><span>{icon}</span><h3>{title}</h3><p>{text}</p></article>;
}
