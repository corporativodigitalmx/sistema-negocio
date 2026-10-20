import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CalendarDays, Clock3, MessageCircle, Plus, Search, UserRound, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import "./Clientes.css";

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const dateValue = (value) => {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day, 12);
};
const dateLabel = (value) => dateValue(value)?.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) || "—";
const daysRemaining = (value) => {
  const date = dateValue(value);
  return date ? Math.round((date - dateValue(today())) / 86400000) : null;
};
function assignmentStatus(assignment) {
  const days = daysRemaining(assignment.expires_on);
  if (days === null) return { key: "unknown", label: "Sin fecha" };
  if (days < 0) return { key: "expired", label: "Vencida" };
  if (days <= 7) return { key: "soon", label: days === 0 ? "Vence hoy" : `Vence en ${days} días` };
  return { key: "active", label: "Vigente" };
}
function whatsappUrl(phone, name) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) digits = `52${digits}`;
  if (digits.startsWith("521") && digits.length === 13) digits = `52${digits.slice(3)}`;
  if (digits.length < 11 || digits.length > 15) return "";
  const message = encodeURIComponent(`Hola ${name}, te contacto sobre tu cuenta y su vencimiento.`);
  return `https://wa.me/${digits}?text=${message}`;
}

export default function Clientes({ userId, canEdit = true }) {
  const [clients, setClients] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [clientForm, setClientForm] = useState({ full_name: "", phone: "", notes: "" });
  const [assignmentForm, setAssignmentForm] = useState({ inventory_account_id: "", profile_name: "", starts_on: today(), notes: "" });

  const reload = useCallback(async () => {
    setLoading(true);
    const [clientsResult, assignmentsResult, accountsResult] = await Promise.all([
      supabase.from("clients").select("*").order("full_name"),
      supabase.from("client_account_assignments")
        .select("id,user_id,client_id,inventory_account_id,profile_name,starts_on,duration_days,expires_on,notes,created_at,inventory:inventario_cuentas!client_account_assignments_inventory_account_id_fkey(id,service,account_label,provider,user_id)")
        .order("created_at", { ascending: false }),
      supabase.from("inventario_cuentas").select("id,service,account_label,provider,user_id").order("service"),
    ]);
    if (clientsResult.error) setNotice(`No se pudieron cargar clientes. Aplica la migración de clientes en Supabase. Detalle: ${clientsResult.error.message}`);
    else setClients(clientsResult.data || []);
    if (assignmentsResult.error) setNotice(`No se pudo cargar el historial de cuentas: ${assignmentsResult.error.message}`);
    else setAssignments(assignmentsResult.data || []);
    if (accountsResult.error) setNotice(`No se pudieron consultar cuentas del inventario: ${accountsResult.error.message}`);
    else setAccounts(accountsResult.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { queueMicrotask(() => void reload()); }, [reload]);

  const selected = clients.find((client) => client.id === selectedId) || null;
  const allStatuses = useMemo(() => assignments.map((assignment) => ({ assignment, status: assignmentStatus(assignment) })), [assignments]);
  const soonCount = allStatuses.filter(({ status }) => status.key === "soon").length;
  const expiredCount = allStatuses.filter(({ status }) => status.key === "expired").length;
  const clientRows = useMemo(() => clients.map((client) => {
    const history = assignments.filter((assignment) => assignment.client_id === client.id);
    return { ...client, history, soon: history.filter((row) => assignmentStatus(row).key === "soon").length,
      expired: history.filter((row) => assignmentStatus(row).key === "expired").length,
      active: history.filter((row) => assignmentStatus(row).key === "active" || assignmentStatus(row).key === "soon").length };
  }), [clients, assignments]);
  const visibleClients = clientRows.filter((client) => {
    const term = `${client.full_name} ${client.phone}`.toLocaleLowerCase("es-MX");
    return (!query || term.includes(query.trim().toLocaleLowerCase("es-MX")))
      && (filter === "all" || (filter === "soon" ? client.soon > 0 : client.expired > 0));
  });
  const clientAssignments = selected ? assignments.filter((item) => item.client_id === selected.id) : [];

  async function createClient(event) {
    event.preventDefault();
    setNotice("");
    setSaving(true);
    const { data, error } = await supabase.from("clients").insert({
      user_id: userId, full_name: clientForm.full_name.trim(), phone: clientForm.phone.trim(), notes: clientForm.notes.trim(),
    }).select("*").single();
    setSaving(false);
    if (error) { setNotice(`No se pudo guardar el cliente: ${error.message}`); return; }
    setClients((current) => [...current, data].sort((a, b) => a.full_name.localeCompare(b.full_name, "es")));
    setSelectedId(data.id);
    setClientForm({ full_name: "", phone: "", notes: "" });
    setNewClientOpen(false);
    setNotice("Cliente registrado.");
  }

  async function assignAccount(event) {
    event.preventDefault();
    if (!selected || !assignmentForm.inventory_account_id || !assignmentForm.profile_name.trim()) {
      setNotice("Selecciona una cuenta y escribe el perfil asignado."); return;
    }
    setSaving(true); setNotice("");
    const { data, error } = await supabase.from("client_account_assignments").insert({
      user_id: selected.user_id, client_id: selected.id, inventory_account_id: assignmentForm.inventory_account_id,
      profile_name: assignmentForm.profile_name.trim(), starts_on: assignmentForm.starts_on, duration_days: 28,
      notes: assignmentForm.notes.trim(),
    }).select("id,user_id,client_id,inventory_account_id,profile_name,starts_on,duration_days,expires_on,notes,created_at,inventory:inventario_cuentas!client_account_assignments_inventory_account_id_fkey(id,service,account_label,provider,user_id)").single();
    setSaving(false);
    if (error) { setNotice(`No se pudo asignar la cuenta: ${error.message}`); return; }
    setAssignments((current) => [data, ...current]);
    setAssignmentForm({ inventory_account_id: "", profile_name: "", starts_on: today(), notes: "" });
    setNotice("Cuenta asignada por 28 días. La asignación anterior permanece en el historial.");
  }

  if (selected) return <main className="clients-page">
    <button className="clients-back" type="button" onClick={() => { setSelectedId(null); setNotice(""); }}><ArrowLeft size={17} /> Todos los clientes</button>
    <header className="clients-heading"><div><p className="clients-eyebrow">FICHA DE CLIENTE</p><h1>{selected.full_name}</h1><p className="clients-subtitle">{selected.phone || "Sin teléfono registrado"}</p></div><WhatsAppLink client={selected} /></header>
    {notice && <p className="clients-notice" role="status">{notice}</p>}
    <section className="clients-stats">
      <Summary icon={<UserRound />} label="Cuentas asignadas" value={clientAssignments.length} />
      <Summary icon={<Clock3 />} label="Por vencer" value={clientAssignments.filter((row) => assignmentStatus(row).key === "soon").length} tone="amber" />
      <Summary icon={<AlertTriangle />} label="Vencidas" value={clientAssignments.filter((row) => assignmentStatus(row).key === "expired").length} tone="red" />
    </section>
    {canEdit && <form className="client-assignment-form" onSubmit={assignAccount}>
      <div className="client-form-heading"><div><p className="clients-eyebrow">NUEVA ASIGNACIÓN</p><h2>Asignar cuenta o perfil</h2></div><span>Duración fija: <strong>28 días</strong></span></div>
      <label>Cuenta del inventario<select value={assignmentForm.inventory_account_id} onChange={(event) => setAssignmentForm((current) => ({ ...current, inventory_account_id: event.target.value }))} required><option value="">Selecciona una cuenta disponible</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.service} · {account.account_label} · {account.provider}</option>)}</select></label>
      <label>Perfil asignado<input value={assignmentForm.profile_name} onChange={(event) => setAssignmentForm((current) => ({ ...current, profile_name: event.target.value }))} placeholder="Ej. Perfil 2, PIN familiar…" maxLength={80} required /></label>
      <label>Fecha de inicio<input type="date" value={assignmentForm.starts_on} onChange={(event) => setAssignmentForm((current) => ({ ...current, starts_on: event.target.value }))} required /></label>
      <label>Notas (opcional)<input value={assignmentForm.notes} onChange={(event) => setAssignmentForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Observaciones" maxLength={250} /></label>
      {assignmentForm.starts_on && <p className="assignment-expiry-preview">Vence el <strong>{dateLabel(new Date(dateValue(assignmentForm.starts_on).getTime() + 28 * 86400000).toISOString().slice(0, 10))}</strong></p>}
      <button className="clients-button primary" type="submit" disabled={saving}><Plus size={17} />{saving ? "Guardando…" : "Asignar por 28 días"}</button>
    </form>}
    <section className="client-history"><div className="client-history-heading"><div><p className="clients-eyebrow">SEGUIMIENTO</p><h2>Historial de cuentas y vencimientos</h2></div><span>{clientAssignments.length} registros</span></div>
      {clientAssignments.length ? <div className="client-history-list">{clientAssignments.map((row) => { const status = assignmentStatus(row); return <article className="client-history-row" key={row.id}><span className="client-service-mark">{row.inventory?.service?.slice(0, 1) || "C"}</span><div className="client-history-main"><strong>{row.inventory?.service || "Cuenta"} · {row.profile_name}</strong><small>{row.inventory?.account_label || "Cuenta de inventario"} · {row.inventory?.provider || ""}</small><small>Inicio {dateLabel(row.starts_on)} · vence {dateLabel(row.expires_on)} · ciclo de {row.duration_days} días</small>{row.notes && <small>{row.notes}</small>}</div><span className={`client-status ${status.key}`}>{status.label}</span></article>; })}</div> : <div className="clients-empty"><CalendarDays size={24} /><p>Aún no hay cuentas asignadas. Agrega la primera para iniciar el historial.</p></div>}
    </section>
  </main>;

  return <main className="clients-page">
    <header className="clients-heading"><div><p className="clients-eyebrow">RELACIÓN Y RENOVACIONES</p><h1>Clientes</h1><p className="clients-subtitle">Contactos, perfiles, asignaciones y vencimientos en una sola ficha.</p></div>{canEdit && <button className="clients-button primary" type="button" onClick={() => setNewClientOpen(true)}><Plus size={17} /> Nuevo cliente</button>}</header>
    {notice && <p className="clients-notice" role="status">{notice}</p>}
    <section className="clients-stats"><Summary icon={<UserRound />} label="Clientes" value={clients.length} /><Summary icon={<Clock3 />} label="Cuentas por vencer" value={soonCount} tone="amber" /><Summary icon={<AlertTriangle />} label="Cuentas vencidas" value={expiredCount} tone="red" /></section>
    <section className="clients-directory"><div className="clients-toolbar"><label className="clients-search"><Search size={17} /><input aria-label="Buscar clientes" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o teléfono" /></label><div className="clients-filters"><button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}>Todos</button><button className={filter === "soon" ? "selected" : ""} onClick={() => setFilter("soon")}>Por vencer</button><button className={filter === "expired" ? "selected" : ""} onClick={() => setFilter("expired")}>Vencidos</button></div></div>
      {loading ? <div className="clients-empty">Cargando clientes…</div> : visibleClients.length ? <div className="clients-list">{visibleClients.map((client) => { const link = whatsappUrl(client.phone, client.full_name); return <article className="client-card" key={client.id}><button className="client-card-main" onClick={() => { setSelectedId(client.id); setNotice(""); }}><span className="client-avatar">{client.full_name.slice(0, 1).toUpperCase()}</span><span className="client-card-info"><strong>{client.full_name}</strong><small>{client.phone || "Sin teléfono"}</small><small>{client.active} cuentas activas · {client.history.length} en historial</small></span></button><span className="client-card-alerts">{client.soon > 0 && <span className="client-status soon">{client.soon} por vencer</span>}{client.expired > 0 && <span className="client-status expired">{client.expired} vencida(s)</span>}{client.soon === 0 && client.expired === 0 && <span className="client-status active">Al corriente</span>}</span><div className="client-card-actions">{link ? <a className="whatsapp-button" href={link} target="_blank" rel="noreferrer" aria-label={`Escribir por WhatsApp a ${client.full_name}`}><MessageCircle size={17} /> WhatsApp</a> : <span className="phone-missing">Agrega teléfono con WhatsApp</span>}</div></article>; })}</div> : <div className="clients-empty"><UserRound size={25} /><p>{clients.length ? "No hay resultados para ese filtro." : "Aún no hay clientes registrados."}</p>{!clients.length && canEdit && <button className="clients-button primary" onClick={() => setNewClientOpen(true)}><Plus size={17} /> Agregar cliente</button>}</div>}
    </section>
    {newClientOpen && <div className="client-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewClientOpen(false); }}><section className="client-modal" role="dialog" aria-modal="true" aria-labelledby="new-client-title"><header><div><p className="clients-eyebrow">CONTACTO</p><h2 id="new-client-title">Nuevo cliente</h2></div><button className="client-close" aria-label="Cerrar" onClick={() => setNewClientOpen(false)}><X size={19} /></button></header><form onSubmit={createClient}><label>Nombre completo<input autoFocus value={clientForm.full_name} onChange={(event) => setClientForm((current) => ({ ...current, full_name: event.target.value }))} maxLength={120} minLength={2} required placeholder="Nombre del cliente" /></label><label>Teléfono para WhatsApp<input type="tel" value={clientForm.phone} onChange={(event) => setClientForm((current) => ({ ...current, phone: event.target.value }))} maxLength={24} placeholder="10 dígitos o incluye código de país" /></label><small>Los números mexicanos de 10 dígitos se abrirán con el código +52.</small><label>Notas (opcional)<textarea rows="3" value={clientForm.notes} onChange={(event) => setClientForm((current) => ({ ...current, notes: event.target.value }))} maxLength={500} /></label>{notice && <p className="clients-notice">{notice}</p>}<footer><button type="button" className="clients-button secondary" onClick={() => setNewClientOpen(false)} disabled={saving}>Cancelar</button><button type="submit" className="clients-button primary" disabled={saving}>{saving ? "Guardando…" : "Guardar cliente"}</button></footer></form></section></div>}
  </main>;
}

function Summary({ icon, label, value, tone = "blue" }) { return <article className={`clients-summary ${tone}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></article>; }
function WhatsAppLink({ client }) { const link = whatsappUrl(client.phone, client.full_name); return link ? <a className="whatsapp-button" href={link} target="_blank" rel="noreferrer"><MessageCircle size={17} /> Escribir por WhatsApp</a> : <span className="phone-missing">Agrega teléfono para usar WhatsApp</span>; }
