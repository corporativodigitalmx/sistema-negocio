import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BadgeCheck, Boxes, CheckCircle2, LockKeyhole, Mail, MessageCircle, ShoppingBag, UserRound, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import "./Store.css";

const money = (value) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(value || 0));

export default function Store() {
  const [session, setSession] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", whatsapp: "", password: "" });
  const [purchaseNotice, setPurchaseNotice] = useState("");

  const refresh = useCallback(async (activeSession = session) => {
    setLoading(true); setError("");
    const view = activeSession ? "reseller_store_catalog" : "public_store_catalog";
    const { data, error: queryError } = await supabase.from(view).select("*").order("service").order("store_title");
    if (queryError) { setError("No pudimos cargar el catálogo. Estamos preparando la tienda; vuelve a intentarlo en unos minutos."); setItems([]); }
    else { setItems(data || []); setError(""); }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      void refresh(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setCustomer(null);
      void refresh(nextSession);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [refresh]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    supabase.from("store_customer_profiles").select("full_name,email,whatsapp,tier").eq("user_id", session.user.id).maybeSingle().then(({ data }) => {
      if (active) setCustomer(data || null);
    });
    return () => { active = false; };
  }, [session]);

  function openAuth(mode) { setAuthMode(mode); setAuthMessage(""); setAuthError(""); setPurchaseNotice(""); }
  async function submitAuth(event) {
    event.preventDefault(); setAuthBusy(true); setAuthError(""); setAuthMessage("");
    const email = form.email.trim().toLowerCase();
    try {
      if (authMode === "register") {
        const { data, error: signupError } = await supabase.auth.signUp({ email, password: form.password, options: { data: { buyer_type: "store_customer", full_name: form.name.trim(), whatsapp: form.whatsapp.trim() }, emailRedirectTo: `${window.location.origin}/tienda` } });
        if (signupError) throw signupError;
        if (data.session) { setSession(data.session); setAuthMode(""); setForm({ name: "", email: "", whatsapp: "", password: "" }); }
        else setAuthMessage("Te enviamos un correo para confirmar tu cuenta. Al confirmar, inicia sesión para obtener el precio de revendedor.");
      } else {
        const { data, error: signinError } = await supabase.auth.signInWithPassword({ email, password: form.password });
        if (signinError) throw signinError;
        setSession(data.session); setAuthMode(""); setForm({ name: "", email: "", whatsapp: "", password: "" });
      }
    } catch (err) { setAuthError(err.message || "No se pudo completar el registro."); }
    finally { setAuthBusy(false); }
  }

  async function signOut() { await supabase.auth.signOut(); setSession(null); setCustomer(null); }
  function beginPurchase(item, deliveryType) {
    if (!session) { openAuth("register"); setPurchaseNotice("Regístrate o inicia sesión para continuar con tu compra."); return; }
    const choice = deliveryType === "profile" ? "perfil" : "cuenta completa";
    setPurchaseNotice(`Elegiste ${choice} de ${item.store_title}. El pago y la reserva automática se activarán al terminar la configuración de Mercado Pago.`);
  }

  return <main className="store-page">
    <header className="store-topbar"><a href="/" className="store-back"><ArrowLeft size={16} /> Inicio</a><a className="store-brand" href="/tienda"><span>CD</span> Corporativo Digital</a>
      <div className="store-account">{session ? <><span>{customer?.full_name || session.user.email}{customer?.tier === "reseller" && <small><BadgeCheck size={13} /> Revendedor</small>}</span><button type="button" onClick={signOut}>Cerrar sesión</button></> : <button className="store-register-button" type="button" onClick={() => openAuth("register")}><UserRound size={16} /> Crear cuenta</button>}</div>
    </header>
    <section className="store-hero"><span className="store-eyebrow"><ShoppingBag size={15} /> CATÁLOGO DIGITAL</span><h1>Encuentra tu próxima plataforma.</h1><p>Elige un perfil o una cuenta completa. La disponibilidad se actualiza desde el inventario.</p><div className="store-promise"><span><Boxes size={16} /> Existencias actualizadas</span><span><MessageCircle size={16} /> WhatsApp requerido para atención</span></div></section>
    {purchaseNotice && <p className="store-notice" role="status">{purchaseNotice}</p>}
    {error && <p className="store-notice error" role="alert">{error}</p>}
    {loading ? <div className="store-empty">Cargando catálogo…</div> : items.length ? <section className="store-grid" aria-label="Catálogo de productos">
      {items.map((item) => {
        const profilesAvailable = Number(item.available_profiles || 0) > 0;
        const accountAvailable = Boolean(item.full_account_available);
        const soldOut = !profilesAvailable && !accountAvailable;
        return <article className={`store-card ${soldOut ? "sold-out" : "in-stock"}`} key={item.item_id}>
          <div className="store-card-top"><span className="store-service-mark">{item.service.slice(0, 1)}</span><span className={`store-stock ${soldOut ? "out" : "available"}`}><i />{soldOut ? "Agotada" : "Disponible"}</span></div>
          <p className="store-service">{item.service}</p><h2>{item.store_title}</h2><p className="store-description">{item.store_description || "Servicio digital disponible para entrega."}</p>
          <div className="store-stock-detail">{profilesAvailable ? `${item.available_profiles} perfiles disponibles` : accountAvailable ? "Cuenta disponible" : "Sin existencias por ahora"}</div>
          <div className="store-options">
            <button type="button" className="store-buy-option" disabled={!profilesAvailable} onClick={() => beginPurchase(item, "profile")}><span><strong>Elegir perfil</strong><small>{profilesAvailable ? `${item.available_profiles} disponibles` : "Agotado"}</small></span><b>{item.profile_price == null ? "Consultar" : money(item.profile_price)}</b><ArrowRight size={16} /></button>
            <button type="button" className="store-buy-option" disabled={!accountAvailable} onClick={() => beginPurchase(item, "full_account")}><span><strong>Cuenta completa</strong><small>{accountAvailable ? "Disponible" : "No disponible"}</small></span><b>{item.account_price == null ? "Consultar" : money(item.account_price)}</b><ArrowRight size={16} /></button>
          </div>
        </article>;
      })}
    </section> : <div className="store-empty"><span><Boxes size={23} /></span><h2>Aún no hay productos publicados</h2><p>Cuando el administrador publique cuentas con precios, aparecerán aquí.</p></div>}
    <footer className="store-footer"><LockKeyhole size={15} /> Los datos de acceso de las cuentas no se muestran en el catálogo.</footer>

    {authMode && <div className="store-auth-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthMode(""); }}><section className="store-auth-card" role="dialog" aria-modal="true" aria-labelledby="store-auth-title"><button type="button" className="store-close" aria-label="Cerrar" onClick={() => setAuthMode("")}><X size={19} /></button><span className="store-auth-icon"><UserRound size={19} /></span><p className="store-eyebrow">CUENTA DE CLIENTE</p><h2 id="store-auth-title">{authMode === "register" ? "Crea tu cuenta" : "Inicia sesión"}</h2><p className="store-auth-subtitle">{authMode === "register" ? "Regístrate y obtén precio de revendedor." : "Entra a tu cuenta de la tienda."}</p>
      <form onSubmit={submitAuth}>
        {authMode === "register" && <label>Nombre completo<span><UserRound size={16} /><input autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} minLength={2} maxLength={120} required placeholder="Tu nombre" /></span></label>}
        <label>Correo electrónico<span><Mail size={16} /><input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required placeholder="tu@correo.com" /></span></label>
        {authMode === "register" && <label>WhatsApp<span><MessageCircle size={16} /><input type="tel" autoComplete="tel" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} minLength={8} maxLength={24} required placeholder="+52 55 1234 5678" /></span><small>Lo usaremos para dar seguimiento a tu compra.</small></label>}
        <label>Contraseña<span><LockKeyhole size={16} /><input type="password" autoComplete={authMode === "register" ? "new-password" : "current-password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} required placeholder="Mínimo 8 caracteres" /></span></label>
        {authError && <p className="store-auth-feedback error" role="alert">{authError}</p>}{authMessage && <p className="store-auth-feedback success" role="status"><CheckCircle2 size={16} />{authMessage}</p>}
        <button type="submit" className="store-auth-submit" disabled={authBusy}>{authBusy ? "Un momento…" : authMode === "register" ? "Crear cuenta" : "Iniciar sesión"}<ArrowRight size={16} /></button>
      </form><button className="store-auth-switch" type="button" onClick={() => openAuth(authMode === "register" ? "login" : "register")}>{authMode === "register" ? "¿Ya tienes cuenta? Inicia sesión" : "¿Aún no tienes cuenta? Regístrate"}</button>
    </section></div>}
  </main>;
}
