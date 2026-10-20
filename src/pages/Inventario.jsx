import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Boxes, CalendarDays, Check, Download, FileUp, Plus, Search, Trash2, UserRound, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import "./Inventario.css";

const KEY = "sistema-negocio:inventory:v1";
const TABLE = "inventario_cuentas";
const SERVICES = ["Netflix", "Prime Video", "Disney+", "ViX", "Spotify", "Max", "Crunchyroll", "Otro"];
const UNITS = { days: "días", months: "meses", years: "años" };

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseDate(value) {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}
function expiration(purchaseDate, duration, unit) {
  const date = parseDate(purchaseDate);
  const n = Number(duration);
  if (!date || !Number.isInteger(n) || n < 1) return "";
  if (unit === "days") date.setDate(date.getDate() + n);
  else {
    const day = date.getDate();
    date.setDate(1);
    if (unit === "years") date.setFullYear(date.getFullYear() + n);
    else date.setMonth(date.getMonth() + n);
    date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function dateLabel(value) {
  return parseDate(value)?.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) || "—";
}
function daysLeft(value) {
  const date = parseDate(value);
  return date ? Math.round((date - parseDate(today())) / 86400000) : null;
}
function statusFor(value) {
  const days = daysLeft(value);
  if (days === null) return { key: "unknown", label: "Sin fecha" };
  if (days < 0) return { key: "expired", label: "Vencida" };
  if (days <= 7) return { key: "soon", label: days === 0 ? "Vence hoy" : `Vence en ${days} d` };
  return { key: "active", label: "Vigente" };
}
function keyFor(userId) { return `${KEY}:${userId || "local"}`; }
function load(userId) {
  try {
    const value = JSON.parse(localStorage.getItem(keyFor(userId)) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}
function persistLocal(userId, records) {
  try { localStorage.setItem(keyFor(userId), JSON.stringify(records)); }
  catch { console.warn("No se pudo actualizar el respaldo local del inventario."); }
}
function id() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`; }
function fromDatabase(row) {
  return { id: row.id, ownerId: row.user_id, service: row.service, accountLabel: row.account_label, provider: row.provider,
    purchaseDate: row.purchase_date, duration: row.duration, unit: row.unit,
    profileCapacity: row.profile_capacity ?? 5, customers: Array.isArray(row.customers) ? row.customers : [], cost: row.cost ?? "", notes: row.notes || "" };
}
function toDatabase(row, userId) {
  return { id: row.id, user_id: row.ownerId || userId, service: row.service, account_label: row.accountLabel,
    provider: row.provider, purchase_date: row.purchaseDate, duration: 28,
    unit: "days", profile_capacity: Number(row.profileCapacity || 5), customers: row.customers, cost: row.cost === "" ? null : row.cost, notes: row.notes };
}
function blank() {
  return { service: "Netflix", accountLabel: "", provider: "", purchaseDate: today(), duration: "28", unit: "days", profileCapacity: "5", customers: "", cost: "", notes: "" };
}
function formFrom(row) {
  return { service: row.service, accountLabel: row.accountLabel, provider: row.provider, purchaseDate: row.purchaseDate, duration: "28", unit: "days", profileCapacity: String(row.profileCapacity ?? 5), customers: (row.customers || []).join(", "), cost: row.cost ?? "", notes: row.notes || "" };
}

export default function Inventario({ userId, isSuperadmin = false, canViewAll = isSuperadmin, canEdit = true }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [query, setQuery] = useState("");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blank);
  const [notice, setNotice] = useState("");
  const [supplierSuggestions, setSupplierSuggestions] = useState([]);
  useEffect(() => {
    let active = true;
    async function loadFromSupabase() {
      setLoading(true);
      let request = supabase.from(TABLE).select("*");
      if (!canViewAll) request = request.eq("user_id", userId);
      const { data, error } = await request.order("created_at", { ascending: false });
      if (!active) return;
      if (error) {
        setConnectionError(true);
        setNotice(`No se pudo cargar desde Supabase: ${error.message}`);
        setAccounts(load(userId));
        setLoading(false);
        return;
      }
      setConnectionError(false);
      let records = (data || []).map(fromDatabase);
      const localRecords = load(userId);
      if (!records.length && localRecords.length) {
        const { data: imported, error: importError } = await supabase.from(TABLE)
          .upsert(localRecords.map((row) => toDatabase({ ...row, id: row.id || id() }, userId)), { onConflict: "id" })
          .select("*");
        if (!active) return;
        if (importError) {
          setNotice(`No se pudo migrar el inventario local: ${importError.message}`);
          records = localRecords;
        } else {
          records = (imported || []).map(fromDatabase);
          setNotice(`Se migraron ${records.length} cuentas locales a Supabase.`);
        }
      }
      setAccounts(records);
      setLoading(false);
    }
    if (userId) loadFromSupabase();
    return () => { active = false; };
  }, [userId, canViewAll]);

  useEffect(() => { let active = true; if (canEdit) supabase.from("suppliers").select("name").eq("active", true).order("name").then(({ data }) => { if (active) setSupplierSuggestions(data || []); }); return () => { active = false; }; }, [canEdit]);

  const rows = useMemo(() => accounts
    .map((row) => ({ ...row, expirationDate: expiration(row.purchaseDate, row.duration, row.unit) }))
    .sort((a, b) => (a.expirationDate || "9999").localeCompare(b.expirationDate || "9999")), [accounts]);

  const stats = useMemo(() => rows.reduce((sum, row) => {
    const status = statusFor(row.expirationDate).key;
    if (status === "soon") sum.soon += 1;
    if (status === "expired") sum.expired += 1;
    sum.assigned += row.customers?.length || 0;
    return sum;
  }, { soon: 0, expired: 0, assigned: 0 }), [rows]);

  const visible = rows.filter((row) => {
    const text = [row.service, row.accountLabel, row.provider, ...(row.customers || [])].join(" ").toLocaleLowerCase("es-MX");
    const status = statusFor(row.expirationDate).key;
    return (!query || text.includes(query.trim().toLocaleLowerCase("es-MX")))
      && (serviceFilter === "all" || row.service === serviceFilter)
      && (statusFilter === "all" || (statusFilter === "unassigned" ? !row.customers?.length : status === statusFilter));
  });

  function openNew() {
    setEditingId(null); setForm(blank()); setNotice(""); setFormOpen(true);
  }
  function openEdit(row) {
    setEditingId(row.id); setForm(formFrom(row)); setNotice(""); setFormOpen(true);
  }
  function closeForm() {
    setFormOpen(false); setEditingId(null); setForm(blank());
  }
  function changeForm(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }
  async function save(event) {
    event.preventDefault();
    const duration = Number(form.duration);
    const profileCapacity = Number(form.profileCapacity);
    if (!form.accountLabel.trim() || !form.provider.trim() || !form.purchaseDate || !Number.isInteger(duration) || duration < 1) {
      setNotice("Completa identificador, proveedor, fecha y duración."); return;
    }
    if (!Number.isInteger(profileCapacity) || profileCapacity < 1 || profileCapacity > 20) {
      setNotice("La capacidad debe ser de 1 a 20 perfiles."); return;
    }
    const row = {
      id: editingId || id(), service: form.service, accountLabel: form.accountLabel.trim(),
      provider: form.provider.trim(), purchaseDate: form.purchaseDate, duration: 28, unit: "days",
      profileCapacity,
      customers: form.customers.split(/[,\n]/).map((name) => name.trim()).filter(Boolean),
      cost: form.cost === "" ? "" : Number(form.cost), notes: form.notes.trim(),
    };
    setSaving(true);
    const result = editingId
      ? await supabase.from(TABLE).update(toDatabase({ ...row, ownerId: accounts.find((item) => item.id === editingId)?.ownerId || userId }, userId)).eq("id", editingId).select("*").single()
      : await supabase.from(TABLE).insert(toDatabase({ ...row, ownerId: userId }, userId)).select("*").single();
    setSaving(false);
    if (result.error) { setNotice(`No se pudo guardar en Supabase: ${result.error.message}`); return; }
    const saved = fromDatabase(result.data);
    setAccounts((current) => editingId ? current.map((item) => item.id === editingId ? saved : item) : [saved, ...current]);
    persistLocal(userId, editingId ? accounts.map((item) => item.id === editingId ? saved : item) : [saved, ...accounts]);
    setNotice(editingId ? "Cuenta actualizada en Supabase." : "Cuenta agregada en Supabase.");
    closeForm();
  }
  async function remove(row) {
    if (!window.confirm(`¿Eliminar “${row.accountLabel}” del inventario?`)) return;
    const { error } = await supabase.from(TABLE).delete().eq("id", row.id);
    if (error) { setNotice(`No se pudo eliminar en Supabase: ${error.message}`); return; }
    setAccounts((current) => current.filter((item) => item.id !== row.id));
    persistLocal(userId, accounts.filter((item) => item.id !== row.id));
    setNotice("Cuenta eliminada de Supabase.");
  }
  function exportBackup() {
    const blob = new Blob([JSON.stringify({ app: "sistema-negocio", exportedAt: new Date().toISOString(), accounts }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `respaldo-inventario-${today()}.json`; link.click();
    URL.revokeObjectURL(url); setNotice("Respaldo descargado.");
  }
  function restoreBackup(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result));
        const imported = Array.isArray(payload) ? payload : payload.accounts;
        if (!Array.isArray(imported) || imported.some((row) => !row || !row.accountLabel || !row.provider || !row.purchaseDate)) throw new Error();
        if (!window.confirm(`El respaldo agregará o actualizará sus ${imported.length} cuentas en Supabase. ¿Continuar?`)) return;
        void (async () => {
          const normalized = imported.map((row) => ({ ...row, id: row.id || id(), customers: Array.isArray(row.customers) ? row.customers : [] }));
          setSaving(true);
          const { data, error } = await supabase.from(TABLE).upsert(normalized.map((row) => toDatabase(row, userId)), { onConflict: "id" }).select("*");
          setSaving(false);
          if (error) { setNotice(`No se pudo restaurar en Supabase: ${error.message}`); return; }
          const restored = (data || []).map(fromDatabase);
          const merged = [...restored, ...accounts.filter((current) => !restored.some((item) => item.id === current.id))];
          setAccounts(merged);
          persistLocal(userId, merged);
          setNotice("Respaldo combinado con el inventario de Supabase.");
        })();
      } catch { setNotice("El archivo no es un respaldo válido del inventario."); }
      finally { input.value = ""; }
    };
    reader.readAsText(file);
  }

  return <main className="inventory-page">
    <header className="inventory-heading">
      <div><p className="inventory-eyebrow">CONTROL DE SUSCRIPCIONES</p><h1>Inventario de cuentas</h1><p className="inventory-subtitle">Proveedores, vencimientos y clientes en un solo lugar.</p></div>
      <div className="inventory-actions">
        <button className="inv-button secondary" type="button" onClick={exportBackup} disabled={!accounts.length}><Download size={17} /> Respaldo</button>
        <label className="inv-button secondary upload-button"><FileUp size={17} /> Restaurar<input type="file" accept="application/json,.json" onChange={restoreBackup} /></label>
        {canEdit && <button className="inv-button primary" type="button" onClick={openNew}><Plus size={18} /> Nueva cuenta</button>}
      </div>
    </header>

    <div className="inventory-storage-note"><AlertTriangle size={17} /><span>{loading ? "Conectando con Supabase…" : connectionError ? "Supabase no está disponible; se muestra el respaldo local si existe. Los cambios no se guardarán hasta restablecer la conexión." : "Guardado en Supabase, separado por usuario. No guardes contraseñas aquí; descarga respaldos periódicamente."}</span></div>
    
    {notice && <div className="inventory-notice" role="status">{notice}</div>}

    <section className="inventory-stats">
      <Stat icon={<Boxes size={19} />} label="Cuentas registradas" value={accounts.length} tone="blue" />
      <Stat icon={<CalendarDays size={19} />} label="Vencen en 7 días" value={stats.soon} tone="amber" />
      <Stat icon={<AlertTriangle size={19} />} label="Vencidas" value={stats.expired} tone="red" />
      <Stat icon={<UserRound size={19} />} label="Asignaciones a clientes" value={stats.assigned} tone="green" />
    </section>

    <section className="inventory-panel">
      <div className="inventory-toolbar">
        <label className="inventory-search"><Search size={18} /><input aria-label="Buscar inventario" placeholder="Buscar cuenta, proveedor o cliente" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="inventory-filters">
          <label><span>Servicio</span><select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}><option value="all">Todos</option>{SERVICES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>Estado</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos</option><option value="active">Vigentes</option><option value="soon">Por vencer</option><option value="expired">Vencidas</option><option value="unassigned">Sin asignar</option></select></label>
        </div>
      </div>

      <div className="inventory-table-wrap">
        <table className="inventory-table">
          <thead><tr><th>Cuenta / servicio</th><th>Proveedor</th><th>Vencimiento</th><th>Duración</th><th>Clientes</th><th>Costo</th><th></th></tr></thead>
          <tbody>{visible.map((row) => {
            const status = statusFor(row.expirationDate);
            return <tr key={row.id}>
              <td><div className="inventory-account"><span className="service-mark">{row.service.slice(0, 1)}</span><span><strong>{row.accountLabel}</strong><small>{row.service}</small></span></div></td>
              <td>{row.provider}</td>
              <td><span className={`expiry-pill ${status.key}`}>{status.label}</span><small className="table-date">{dateLabel(row.expirationDate)}</small></td>
              <td>{row.duration} {UNITS[row.unit] || "meses"}</td>
              <td>{row.customers?.length ? <div className="customer-list">{row.customers.map((name, index) => <span key={`${name}-${index}`}>{name}</span>)}</div> : <span className="unassigned-label">Sin asignar</span>}</td>
              <td>{row.cost === "" || row.cost == null ? "—" : new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(row.cost))}</td>
              <td><div className="row-actions">{canEdit && <><button type="button" onClick={() => openEdit(row)}>Editar</button><button className="delete-row" type="button" aria-label={`Eliminar ${row.accountLabel}`} onClick={() => remove(row)}><Trash2 size={16} /></button></>}</div></td>
            </tr>;
          })}</tbody>
        </table>
        {!loading && !visible.length && <div className="inventory-empty"><span className="empty-icon"><Boxes size={25} /></span><h2>{accounts.length ? "No hay coincidencias" : "Tu inventario empieza aquí"}</h2><p>{accounts.length ? "Prueba con otra búsqueda o filtro." : "Registra una cuenta para controlar su proveedor, vencimiento y clientes."}</p>{!accounts.length && canEdit && <button className="inv-button primary" onClick={openNew}><Plus size={18} /> Agregar primera cuenta</button>}</div>}
      </div>
      <footer className="inventory-footer"><span>{visible.length} de {accounts.length} cuentas</span><span>Vencimiento calculado desde fecha de compra + duración.</span></footer>
    </section>

    {formOpen && <div className="inventory-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}>
      <section className="inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-form-title">
        <header className="modal-heading"><div><p className="inventory-eyebrow">{editingId ? "ACTUALIZAR REGISTRO" : "NUEVO REGISTRO"}</p><h2 id="inventory-form-title">{editingId ? "Editar cuenta" : "Agregar cuenta"}</h2></div><button type="button" className="modal-close" aria-label="Cerrar" onClick={closeForm}><X size={20} /></button></header>
        <form className="inventory-form" onSubmit={save}>
          <label>Servicio<select name="service" value={form.service} onChange={changeForm}>{SERVICES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="span-two">Identificador de cuenta<input name="accountLabel" value={form.accountLabel} onChange={changeForm} placeholder="Correo o etiqueta, sin contraseña" maxLength={120} required /></label>
          <label>Proveedor<input name="provider" list="inventory-provider-options" value={form.provider} onChange={changeForm} placeholder="Nombre del proveedor" maxLength={100} required /><datalist id="inventory-provider-options">{supplierSuggestions.map((supplier)=><option key={supplier.name} value={supplier.name}/>)}</datalist></label>
          <label>Fecha de compra<input name="purchaseDate" type="date" value={form.purchaseDate} onChange={changeForm} required /></label>
          <label>Perfiles disponibles<input name="profileCapacity" type="number" min="1" max="20" value={form.profileCapacity} onChange={changeForm} required /><small>Cuántos perfiles puede compartir esta cuenta.</small></label>
          <label>Duración del ciclo<input value="28 días" readOnly /></label>
          <label>Vencimiento calculado<input value={dateLabel(expiration(form.purchaseDate, form.duration, form.unit))} readOnly /></label>
          <label className="span-two">Cliente o clientes<textarea name="customers" value={form.customers} onChange={changeForm} placeholder="Nombres separados por coma; déjalo vacío si aún está libre." rows="2" maxLength={500} /></label>
          <label>Costo de compra (opcional)<span className="currency-field"><b>$</b><input name="cost" type="number" min="0" step="0.01" value={form.cost} onChange={changeForm} placeholder="0.00" /></span></label>
          <label>Notas (opcional)<input name="notes" value={form.notes} onChange={changeForm} placeholder="Perfil, renovación u observaciones" maxLength={300} /></label>
          {notice && <p className="form-notice">{notice}</p>}
          <footer className="form-actions"><button className="inv-button secondary" type="button" onClick={closeForm} disabled={saving}>Cancelar</button><button className="inv-button primary" type="submit" disabled={saving}><Check size={17} /> {saving ? "Guardando…" : "Guardar cuenta"}</button></footer>
        </form>
      </section>
    </div>}
  </main>;
}

function Stat({ icon, label, value, tone }) {
  return <article className="inventory-stat"><span className={`stat-icon ${tone}`}>{icon}</span><span><small>{label}</small><strong>{value}</strong></span></article>;
}
