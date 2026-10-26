import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BadgeCheck, Boxes, CheckCircle2, LockKeyhole, Mail, MessageCircle, ShoppingBag, UserRound, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import "./Store.css";

const money = (value) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(value || 0));

export default function Store() {
  const [session, setSession] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [items, setItems] = useState([]);
  const [priceItems, setPriceItems] = useState([]);
  const [savingPrices, setSavingPrices] = useState({});
  const [priceNotice, setPriceNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", whatsapp: "", password: "" });
  const [purchaseNotice, setPurchaseNotice] = useState("");
  const [purchaseError, setPurchaseError] = useState("");
  const [purchaseBusy, setPurchaseBusy] = useState("");

  const refresh = useCallback(async (activeSession) => {
    setLoading(true); setError("");
    let admin = false;
    if (activeSession) {
      const { data: access } = await supabase.from("user_access").select("role").eq("user_id", activeSession.user.id).maybeSingle();
      admin = access?.role === "superadmin";
    }
    setIsSuperadmin(admin);
    const view = activeSession && !admin ? "reseller_store_catalog" : "public_store_catalog";
    const { data, error: queryError } = await supabase.from(view).select("*").order("service");
    if (queryError) { setError("No pudimos cargar el catálogo. Estamos preparando la tienda; vuelve a intentarlo en unos minutos."); setItems([]); }
    else { setItems(data || []); setError(""); }
    if (admin) {
      const { data: editableRows, error: editableError } = await supabase.from("inventario_cuentas")
        .select("id,service,store_title,store_public_profile_price,store_reseller_profile_price,store_public_account_price,store_reseller_account_price")
        .order("service");
      if (editableError) { setPriceItems([]); setPriceNotice("No se pudo cargar la edición de precios."); }
      else {
        const stockByService = new Map((data || []).map((item) => [item.service, item]));
        const priceByService = new Map();
        for (const row of editableRows || []) {
          if (!priceByService.has(row.service)) priceByService.set(row.service, { ...row, catalog: stockByService.get(row.service) });
        }
        setPriceItems([...priceByService.values()].map((row) => ({ ...row,
          publicProfile: row.store_public_profile_price ?? "", resellerProfile: row.store_reseller_profile_price ?? "",
          publicAccount: row.store_public_account_price ?? "", resellerAccount: row.store_reseller_account_price ?? "" })));
        setPriceNotice("");
      }
    } else setPriceItems([]);
    setLoading(false);
  }, []);

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
  function changePrice(itemId, field, value) {
    setPriceItems((current) => current.map((item) => item.id === itemId ? { ...item, [field]: value } : item));
  }
  async function savePrices(item) {
    const fields = {
      store_public_profile_price: item.publicProfile,
      store_reseller_profile_price: item.resellerProfile,
      store_public_account_price: item.publicAccount,
      store_reseller_account_price: item.resellerAccount,
    };
    if (Object.values(fields).some((value) => value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0))) {
      setPriceNotice("Los precios deben ser números iguales o mayores a cero."); return;
    }
    setSavingPrices((current) => ({ ...current, [item.id]: true })); setPriceNotice("");
    const payload = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value === "" ? null : Number(value)]));
    const { error: saveError } = await supabase.from("inventario_cuentas").update(payload).eq("service", item.service);
    setSavingPrices((current) => ({ ...current, [item.id]: false }));
    if (saveError) { setPriceNotice(`No se pudieron guardar los precios: ${saveError.message}`); return; }
    setPriceNotice(`Precios de ${item.service} guardados.`);
    await refresh(session);
  }
  async function beginPurchase(item, deliveryType) {
    if (!session) { openAuth("register"); setPurchaseNotice("Regístrate o inicia sesión para solicitar tu compra."); return; }
    const choice = deliveryType === "profile" ? "perfil" : "cuenta completa";
    setPurchaseBusy(`${item.service}:${deliveryType}`); setPurchaseError(""); setPurchaseNotice("");
    const { data, error: orderError } = await supabase.rpc("request_store_purchase", { p_service: item.service, p_delivery_type: deliveryType });
    setPurchaseBusy("");
    if (orderError) { setPurchaseError(orderError.message || "No se pudo registrar la solicitud."); return; }
    setPurchaseNotice(`Solicitud de ${choice} para ${item.store_title} registrada por ${money(data.amount)}. Folio ${String(data.sale_id).slice(0, 8)}. El pago en línea aún no está conectado; al confirmar el pago, el sistema asignará automáticamente el inventario.`);
  }

  return <main className="store-page">
    <header className="store-topbar"><a href="/" className="store-back"><ArrowLeft size={16} /> Inicio</a><a className="store-brand" href="/tienda"><span>CD</span> Corporativo Digital</a>
      <div className="store-account">{session ? <><span>{customer?.full_name || session.user.email}{customer?.tier === "reseller" && <small><BadgeCheck size={13} /> Revendedor</small>}</span><button type="button" onClick={signOut}>Cerrar sesión</button></> : <><button type="button" onClick={() => openAuth("login")}>Iniciar sesión</button><button className="store-register-button" type="button" onClick={() => openAuth("register")}><UserRound size={16} /> Crear cuenta</button></>}</div>
    </header>
    <section className="store-hero"><span className="store-eyebrow"><ShoppingBag size={15} /> CATÁLOGO DIGITAL</span><h1>Encuentra tu próxima plataforma.</h1><p>Elige un perfil o una cuenta completa. La disponibilidad se actualiza desde el inventario.</p><div className="store-promise"><span><Boxes size={16} /> Existencias actualizadas</span><span><MessageCircle size={16} /> WhatsApp requerido para atención</span></div></section>
    {purchaseNotice && <p className="store-notice" role="status">{purchaseNotice}</p>}
    {purchaseError && <p className="store-notice error" role="alert">{purchaseError}</p>}
    {error && <p className="store-notice error" role="alert">{error}</p>}
    {isSuperadmin && <section className="store-admin-pricing" aria-label="Administración de precios de tienda"><div className="store-admin-heading"><span className="store-eyebrow">ADMINISTRACIÓN · SUPERUSUARIO</span><h2>Precios de la tienda</h2><p>Las cuentas disponibles del inventario aparecen aquí automáticamente. Ajusta los precios para consumidor y revendedor.</p></div>
      {priceNotice && <p className={`store-notice${priceNotice.startsWith("No se") || priceNotice.startsWith("Los precios") ? " error" : ""}`} role="status">{priceNotice}</p>}
      {priceItems.length ? <div className="store-admin-grid">{priceItems.map((item) => <article className="store-admin-card" key={item.service}><div className="store-admin-card-title"><span className="store-service-mark">{item.service.slice(0, 1)}</span><div><small>{item.service}</small><h3>{item.catalog?.store_title?.trim() || item.service}</h3><p>{item.catalog?.available_profiles || 0} perfiles · {item.catalog?.available_full_accounts || 0} cuentas completas disponibles</p></div></div>
        <div className="store-admin-prices"><strong>Perfil</strong><label>Consumidor<input type="number" min="0" step="0.01" value={item.publicProfile} onChange={(event) => changePrice(item.id, "publicProfile", event.target.value)} placeholder="Consultar" /></label><label>Revendedor<input type="number" min="0" step="0.01" value={item.resellerProfile} onChange={(event) => changePrice(item.id, "resellerProfile", event.target.value)} placeholder="Consultar" /></label>
          <strong>Cuenta completa</strong><label>Consumidor<input type="number" min="0" step="0.01" value={item.publicAccount} onChange={(event) => changePrice(item.id, "publicAccount", event.target.value)} placeholder="Consultar" /></label><label>Revendedor<input type="number" min="0" step="0.01" value={item.resellerAccount} onChange={(event) => changePrice(item.id, "resellerAccount", event.target.value)} placeholder="Consultar" /></label></div>
        <button type="button" className="store-admin-save" disabled={Boolean(savingPrices[item.id])} onClick={() => savePrices(item)}>{savingPrices[item.id] ? "Guardando…" : "Guardar precios"}</button></article>)}</div> : !loading && <div className="store-empty"><span><Boxes size={23} /></span><h2>No hay cuentas disponibles para publicar</h2><p>Las cuentas aparecerán al estar disponibles, vigentes y tener correo y contraseña guardados en inventario.</p></div>}
    </section>}
    {loading ? <div className="store-empty">Cargando catálogo…</div> : items.length ? <section className="store-grid" aria-label="Catálogo de productos">
      {items.map((item) => {
        const profilesAvailable = Number(item.available_profiles || 0) > 0;
        const accountAvailable = Boolean(item.full_account_available);
        const soldOut = !profilesAvailable && !accountAvailable;
        return <article className={`store-card ${soldOut ? "sold-out" : "in-stock"}`} key={item.item_id}>
          <div className="store-card-top"><span className="store-service-mark">{item.service.slice(0, 1)}</span><span className={`store-stock ${soldOut ? "out" : "available"}`}><i />{soldOut ? "Stock agotado" : "Disponible"}</span></div>
          <p className="store-service">{item.service}</p><h2>{item.store_title}</h2><p className="store-description">{item.store_description || "Servicio digital disponible para entrega."}</p>
          <div className="store-stock-detail">{profilesAvailable ? `${item.available_profiles} perfiles disponibles` : accountAvailable ? "Sin perfiles disponibles" : "Sin existencias disponibles"}{accountAvailable && <span> · {item.available_full_accounts || 1} cuentas completas</span>}</div>
          <div className="store-options">
            <button type="button" className="store-buy-option" disabled={!profilesAvailable || Boolean(purchaseBusy)} onClick={() => beginPurchase(item, "profile")}><span><strong>Solicitar perfil</strong><small>{profilesAvailable ? `${item.available_profiles} disponibles` : "Stock agotado"}</small></span><b>{item.profile_price == null ? "Consultar" : money(item.profile_price)}</b><ArrowRight size={16} /></button>
            <button type="button" className="store-buy-option" disabled={!accountAvailable || Boolean(purchaseBusy)} onClick={() => beginPurchase(item, "full_account")}><span><strong>Solicitar cuenta completa</strong><small>{accountAvailable ? `${item.available_full_accounts || 1} disponibles` : "Stock agotado"}</small></span><b>{item.account_price == null ? "Consultar" : money(item.account_price)}</b><ArrowRight size={16} /></button>
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
