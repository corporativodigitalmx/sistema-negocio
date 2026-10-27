import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowLeft, CalendarDays, Check, Clock3, Copy,
  CreditCard, FileText, MessageCircle, Pencil, Plus, Search, UserRound, X
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import "./Clientes.css";

const today = () => {
  const date = new Date();
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
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
const money = (value) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(value || 0));
function assignmentStatus(assignment) {
  if (assignment.assignment_status === "replaced") return { key: "replaced", label: "Reemplazada · historial" };
  if (assignment.assignment_status === "ended") return { key: "ended", label: "Finalizada" };
  const days = daysRemaining(assignment.expires_on);
  if (days === null) return { key: "unknown", label: "Sin fecha" };
  if (days < 0) return { key: "expired", label: "Vencida" };
  if (days <= 7) return { key: "soon", label: days === 0 ? "Vence hoy" : "Vence en " + days + " días" };
  return { key: "active", label: "Vigente" };
}
const accessLabel = (assignment) => {
  if (assignment.delivery_type === "full_account") return "Cuenta completa";
  const profile = String(assignment.profile_name || "").trim();
  if (!profile) return "Perfil sin nombre";
  return profile.toLocaleLowerCase("es-MX").startsWith("perfil") ? profile : "Perfil " + profile;
};
function whatsappUrl(phone, name, message) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) digits = "52" + digits;
  if (digits.startsWith("521") && digits.length === 13) digits = "52" + digits.slice(3);
  if (digits.length < 11 || digits.length > 15) return "";
  const text = message || ("Hola " + name + ", te contacto sobre tu cuenta.");
  return "https://wa.me/" + digits + "?text=" + encodeURIComponent(text);
}
function accessListFor(client, assignments) {
  const entries = assignments
    .filter((row) => row.assignment_status !== "replaced")
    .slice()
    .sort((a, b) => (a.expires_on || "").localeCompare(b.expires_on || ""))
    .map((row) => {
      const status = assignmentStatus(row).label;
      const service = row.inventory?.service || "Cuenta";
      const account = row.inventory?.account_username ? " · " + row.inventory.account_username : " · Usuario no guardado";
      return "• " + service + account + " · " + accessLabel(row) + " · vence " + dateLabel(row.expires_on) + " (" + status + ")";
    });
  if (!entries.length) return "";
  return "Cuentas y perfiles de " + client.full_name + "\n" + entries.join("\n");
}
function pendingMessage(client, items, total) {
  const lines = items.map((item) => {
    const title = item.item_type === "procedure"
      ? "Trámite: " + item.label
      : item.label + (item.details ? " · " + item.details : "");
    const date = item.item_date ? " · " + dateLabel(item.item_date) : "";
    return "• " + title + date + " — " + money(item.balance) + " pendiente";
  });
  return "Hola " + client.full_name + ", te comparto el detalle de tu saldo pendiente:\n"
    + lines.join("\n") + "\n\nTotal pendiente: " + money(total) + "\n\nAvísame si tienes alguna duda. ¡Gracias!";
}

export default function Clientes({ userId, canEdit = true, canRecordPayments = false }) {
  const [clients, setClients] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [serviceOrders, setServiceOrders] = useState([]);
  const [pendingItems, setPendingItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [clientForm, setClientForm] = useState({ full_name: "", phone: "", notes: "" });
  const [clientEditForm, setClientEditForm] = useState({ full_name: "", phone: "" });
  const [editingClient, setEditingClient] = useState(false);
  const [accessListText, setAccessListText] = useState("");
  const [procedureForm, setProcedureForm] = useState({ procedure_name: "", amount: "", order_date: today(), notes: "" });
  const [assignmentForm, setAssignmentForm] = useState({ inventory_account_id: "", profile_name: "", starts_on: today(), notes: "" });
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "transferencia", paid_at: today(), reference: "", notes: "" });

  const reload = useCallback(async () => {
    setLoading(true);
    const [clientsResult, assignmentsResult, accountsResult, availabilityResult, ordersResult, pendingResult, usernamesResult] = await Promise.all([
      supabase.from("clients").select("*").order("full_name"),
      supabase.from("client_account_assignments")
        .select("id,user_id,client_id,inventory_account_id,profile_name,delivery_type,assignment_status,starts_on,duration_days,expires_on,notes,created_at,inventory:inventario_cuentas!client_account_assignments_inventory_account_id_fkey(id,service,account_label,provider,user_id)")
        .order("created_at", { ascending: false }),
      supabase.from("inventario_cuentas").select("id,service,account_label,provider,user_id").order("service"),
      supabase.from("inventory_account_availability").select("inventory_account_id,profile_capacity,available_profiles,has_full_account,status"),
      supabase.from("client_procedure_orders")
        .select("id,user_id,client_id,procedure_name,amount,status,order_date,paid_at,notes,created_at,updated_at")
        .eq("user_id", userId)
        .order("order_date", { ascending: false }),
      supabase.rpc("get_client_pending_items"),
      supabase.rpc("inventory_account_display_users"),
    ]);
    const usernameById = new Map((usernamesResult.data || []).map((item) => [item.inventory_account_id, item.account_username || ""]));
    if (clientsResult.error) setNotice("No se pudieron cargar clientes. Detalle: " + clientsResult.error.message);
    else setClients(clientsResult.data || []);
    if (assignmentsResult.error) setNotice("No se pudo cargar el historial de cuentas: " + assignmentsResult.error.message);
    else setAssignments((assignmentsResult.data || []).map((item) => ({ ...item, inventory: item.inventory ? { ...item.inventory, account_username: usernameById.get(item.inventory_account_id) || "" } : item.inventory })));
    if (accountsResult.error) setNotice("No se pudieron consultar cuentas del inventario: " + accountsResult.error.message);
    else setAccounts((accountsResult.data || []).map((item) => ({ ...item, account_username: usernameById.get(item.id) || "" })));
    if (!availabilityResult.error) setAvailability(availabilityResult.data || []);
    if (ordersResult.error) setNotice("No se pudieron cargar los pedidos de trámites: " + ordersResult.error.message);
    else setServiceOrders(ordersResult.data || []);
    if (pendingResult.error) setNotice("No se pudieron calcular los saldos pendientes: " + pendingResult.error.message);
    else setPendingItems(pendingResult.data || []);
    if (usernamesResult.error) setNotice("No se pudieron cargar los usuarios de las cuentas: " + usernamesResult.error.message);
    if (![clientsResult, assignmentsResult, accountsResult, ordersResult, pendingResult, usernamesResult].some((result) => result.error)) setNotice("");
    setLoading(false);
  }, [userId]);

  useEffect(() => { queueMicrotask(() => void reload()); }, [reload]);

  const selected = clients.find((client) => client.id === selectedId) || null;
  useEffect(() => {
    if (!selected) return;
    setClientEditForm({ full_name: selected.full_name, phone: selected.phone || "" });
    setEditingClient(false);
    setAccessListText("");
  }, [selected?.id, selected?.full_name, selected?.phone]);

  const allStatuses = useMemo(() => assignments.map((assignment) => ({ assignment, status: assignmentStatus(assignment) })), [assignments]);
  const soonCount = allStatuses.filter(({ status }) => status.key === "soon").length;
  const expiredCount = allStatuses.filter(({ status }) => status.key === "expired").length;
  const pendingByClient = useMemo(() => {
    const totals = new Map();
    pendingItems.forEach((item) => totals.set(item.client_id, (totals.get(item.client_id) || 0) + Number(item.balance || 0)));
    return totals;
  }, [pendingItems]);
  const clientRows = useMemo(() => clients.map((client) => {
    const history = assignments.filter((assignment) => assignment.client_id === client.id);
    return {
      ...client,
      history,
      soon: history.filter((row) => assignmentStatus(row).key === "soon").length,
      expired: history.filter((row) => assignmentStatus(row).key === "expired").length,
      active: history.filter((row) => row.assignment_status !== "replaced" && (assignmentStatus(row).key === "active" || assignmentStatus(row).key === "soon")).length,
      balance: pendingByClient.get(client.id) || 0,
    };
  }), [clients, assignments, pendingByClient]);
  const visibleClients = clientRows.filter((client) => {
    const term = (client.full_name + " " + client.phone).toLocaleLowerCase("es-MX");
    return (!query || term.includes(query.trim().toLocaleLowerCase("es-MX")))
      && (filter === "all" || (filter === "soon" ? client.soon > 0 : client.expired > 0));
  });
  const clientAssignments = selected ? assignments.filter((item) => item.client_id === selected.id) : [];
  const selectedPendingItems = selected ? pendingItems.filter((item) => item.client_id === selected.id).slice().sort((a, b) => (a.item_date || "").localeCompare(b.item_date || "")) : [];
  const selectedBalance = selectedPendingItems.reduce((total, item) => total + Number(item.balance || 0), 0);
  const selectedOrders = selected ? serviceOrders.filter((order) => order.client_id === selected.id) : [];
  const selectedBalanceLink = selected && selectedBalance > 0
    ? whatsappUrl(selected.phone, selected.full_name, pendingMessage(selected, selectedPendingItems, selectedBalance))
    : "";

  async function createClient(event) {
    event.preventDefault();
    setNotice("");
    setSaving(true);
    const { data, error } = await supabase.from("clients").insert({
      user_id: userId, full_name: clientForm.full_name.trim(), phone: clientForm.phone.trim(), notes: clientForm.notes.trim(),
    }).select("*").single();
    setSaving(false);
    if (error) {
      setNotice(error.code === "23505" ? "Número ya existe en la base de datos." : "No se pudo guardar el cliente: " + error.message);
      return;
    }
    setClients((current) => [...current, data].sort((a, b) => a.full_name.localeCompare(b.full_name, "es")));
    setSelectedId(data.id);
    setClientForm({ full_name: "", phone: "", notes: "" });
    setNewClientOpen(false);
    setNotice("Cliente registrado.");
  }

  async function saveClientChanges(event) {
    event.preventDefault();
    if (!selected) return;
    setNotice("");
    setSaving(true);
    const { data, error } = await supabase.from("clients")
      .update({ full_name: clientEditForm.full_name.trim(), phone: clientEditForm.phone.trim(), updated_at: new Date().toISOString() })
      .eq("id", selected.id)
      .select("*")
      .single();
    setSaving(false);
    if (error) {
      setNotice(error.code === "23505" || error.message.includes("Número ya existe") ? "Número ya existe en la base de datos." : "No se pudieron guardar los cambios: " + error.message);
      return;
    }
    setClients((current) => current.map((client) => client.id === data.id ? data : client).sort((a, b) => a.full_name.localeCompare(b.full_name, "es")));
    setEditingClient(false);
    setNotice("Datos del cliente actualizados.");
  }

  async function copyAccessList() {
    if (!selected) return;
    const text = accessListFor(selected, clientAssignments);
    if (!text) {
      setNotice("Este cliente aún no tiene perfiles o cuentas asignados.");
      return;
    }
    setAccessListText(text);
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Lista de cuentas y fechas copiada. Ya puedes pegarla donde la necesites.");
    } catch {
      setNotice("No se pudo copiar automáticamente. Selecciona el texto de la lista para copiarlo.");
    }
  }

  async function createProcedureOrder(event) {
    event.preventDefault();
    if (!selected) return;
    const amount = Number(procedureForm.amount);
    if (!procedureForm.procedure_name.trim() || !Number.isFinite(amount) || amount <= 0) {
      setNotice("Escribe el nombre del trámite y un costo mayor a cero.");
      return;
    }
    setNotice("");
    setSaving(true);
    const { error } = await supabase.from("client_procedure_orders").insert({
      user_id: userId,
      client_id: selected.id,
      procedure_name: procedureForm.procedure_name.trim(),
      amount,
      status: "pending",
      order_date: procedureForm.order_date,
      notes: procedureForm.notes.trim(),
    });
    setSaving(false);
    if (error) {
      setNotice("No se pudo guardar el pedido: " + error.message);
      return;
    }
    setProcedureForm({ procedure_name: "", amount: "", order_date: today(), notes: "" });
    setNotice("Trámite agregado como pendiente de pago.");
    await reload();
  }

  async function updateProcedureOrder(order, status) {
    if (!selected || status !== "cancelled") return;
    setNotice("");
    setSaving(true);
    const { error } = await supabase.rpc("cancel_client_procedure_order", { p_order_id: order.id });
    setSaving(false);
    if (error) {
      setNotice("No se pudo cancelar el trámite: " + error.message);
      return;
    }
    setNotice("Pedido de trámite cancelado.");
    await reload();
  }

  async function registerClientPayment(event) {
    event.preventDefault();
    if (!selected) return;
    const amount = Number(paymentForm.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > selectedBalance) {
      setNotice("Escribe un importe mayor a cero y no mayor al saldo pendiente.");
      return;
    }
    setSaving(true);
    setNotice("");
    const { error } = await supabase.rpc("register_client_balance_payment", {
      p_client_id: selected.id,
      p_amount: amount,
      p_method: paymentForm.method,
      p_paid_at: paymentForm.paid_at,
      p_reference: paymentForm.reference.trim(),
      p_notes: paymentForm.notes.trim(),
    });
    setSaving(false);
    if (error) { setNotice("No se pudo registrar el pago: " + error.message); return; }
    setPaymentFormOpen(false);
    setPaymentForm({ amount: "", method: "transferencia", paid_at: today(), reference: "", notes: "" });
    setNotice("Pago registrado y aplicado a los saldos pendientes más antiguos.");
    await reload();
  }

  async function assignAccount(event) {
    event.preventDefault();
    if (!selected || !assignmentForm.inventory_account_id || !assignmentForm.profile_name.trim()) {
      setNotice("Selecciona una cuenta y escribe el perfil asignado."); return;
    }
    setSaving(true); setNotice("");
    const { data, error } = await supabase.rpc("assign_client_account", {
      p_client_id: selected.id, p_inventory_account_id: assignmentForm.inventory_account_id,
      p_profile_name: assignmentForm.profile_name.trim(), p_starts_on: assignmentForm.starts_on,
      p_notes: assignmentForm.notes.trim(),
    });
    setSaving(false);
    if (error) { setNotice("No se pudo asignar la cuenta: " + error.message); return; }
    setAssignmentForm({ inventory_account_id: "", profile_name: "", starts_on: today(), notes: "" });
    setNotice((data?.profile_name || "Perfil") + " asignado por 28 días. La asignación anterior permanece en el historial.");
    await reload();
  }

  if (selected) return <main className="clients-page">
    <button className="clients-back" type="button" onClick={() => { setSelectedId(null); setNotice(""); setEditingClient(false); }}><ArrowLeft size={17} /> Todos los clientes</button>
    <header className="clients-heading"><div><p className="clients-eyebrow">FICHA DE CLIENTE</p><h1>{selected.full_name}</h1><p className="clients-subtitle">{selected.phone || "Sin número registrado"}</p></div><div className="client-heading-actions">{canEdit && <button className="clients-button secondary" type="button" onClick={() => { setClientEditForm({ full_name: selected.full_name, phone: selected.phone || "" }); setEditingClient((value) => !value); }}><Pencil size={16} />{editingClient ? "Cerrar edición" : "Editar cliente"}</button>}<WhatsAppLink client={selected} /></div></header>
    {notice && <p className="clients-notice" role="status">{notice}</p>}
    {editingClient && canEdit && <form className="client-edit-form" onSubmit={saveClientChanges}><div><p className="clients-eyebrow">DATOS DE CONTACTO</p><h2>Editar cliente</h2></div><label>Nombre completo<input value={clientEditForm.full_name} onChange={(event) => setClientEditForm((current) => ({ ...current, full_name: event.target.value }))} minLength={2} maxLength={120} required /></label><label>Número para WhatsApp<input type="tel" value={clientEditForm.phone} onChange={(event) => setClientEditForm((current) => ({ ...current, phone: event.target.value }))} maxLength={24} placeholder="10 dígitos o incluye código de país" /></label><div className="client-edit-actions"><button className="clients-button primary" disabled={saving}><Check size={16} />{saving ? "Guardando…" : "Guardar cambios"}</button><button className="clients-button secondary" type="button" onClick={() => setEditingClient(false)} disabled={saving}>Cancelar</button></div></form>}
    <section className="clients-stats">
      <Summary icon={<UserRound />} label="Cuentas y perfiles" value={clientAssignments.filter((row) => row.assignment_status !== "replaced").length} />
      <Summary icon={<Clock3 />} label="Por vencer" value={clientAssignments.filter((row) => assignmentStatus(row).key === "soon").length} tone="amber" />
      <Summary icon={<AlertTriangle />} label="Vencidas" value={clientAssignments.filter((row) => assignmentStatus(row).key === "expired").length} tone="red" />
      <Summary icon={<FileText />} label="Saldo pendiente" value={money(selectedBalance)} tone={selectedBalance > 0 ? "amber" : "green"} />
    </section>
    <section className="client-access-tools"><div><p className="clients-eyebrow">LISTA PARA COMPARTIR</p><h2>Cuentas, perfiles y vencimientos</h2><p>Genera una lista con las fechas de vencimiento y cópiala para enviarla al cliente.</p></div><button className="clients-button secondary" type="button" onClick={copyAccessList} disabled={loading}><Copy size={16} /> Copiar lista</button>{accessListText && <textarea className="client-copy-preview" readOnly aria-label="Lista de cuentas copiada" value={accessListText} rows={Math.min(8, accessListText.split("\n").length + 1)} />}</section>
    <section className="client-balance-card">
      <header><div><p className="clients-eyebrow">RESUMEN DE COBRO</p><h2>Saldo pendiente por pagar</h2></div><strong>{money(selectedBalance)}</strong></header>
      {selectedPendingItems.length ? <>
        <div className="client-balance-lines">{selectedPendingItems.map((item) => <article key={item.item_type + item.item_id}><div><strong>{item.item_type === "procedure" ? "Trámite: " + item.label : item.label + (item.details ? " · " + item.details : "")}</strong><small>{item.item_type === "sale" ? "Venta del " : "Pedido del "}{dateLabel(item.item_date)}{Number(item.paid) > 0 ? " · abonado " + money(item.paid) : ""}</small></div><b>{money(item.balance)}</b></article>)}</div>
        {canRecordPayments && <div className="client-balance-payment-actions"><button className="clients-button primary" type="button" onClick={() => { setPaymentFormOpen((open) => !open); setPaymentForm((current) => ({ ...current, amount: selectedBalance.toFixed(2) })); }} disabled={saving}><CreditCard size={16} /> Registrar pago o abono</button></div>}
        {paymentFormOpen && canRecordPayments && <form className="client-payment-form" onSubmit={registerClientPayment}>
          <div><strong>Registrar pago de saldo</strong><small>El abono se aplica primero a los saldos más antiguos. Máximo: {money(selectedBalance)}.</small></div>
          <label>Importe recibido<input type="number" min="0.01" max={selectedBalance} step="0.01" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} required /></label>
          <label>Método<select value={paymentForm.method} onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value })}><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="otro">Otro</option></select></label>
          <label>Fecha de pago<input type="date" value={paymentForm.paid_at} onChange={(event) => setPaymentForm({ ...paymentForm, paid_at: event.target.value })} required /></label>
          <label>Referencia (opcional)<input maxLength="120" value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} /></label>
          <label className="client-payment-notes">Notas (opcional)<input maxLength="300" value={paymentForm.notes} onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })} /></label>
          <div className="client-payment-actions"><button className="clients-button primary" disabled={saving}>{saving ? "Guardando…" : "Guardar pago"}</button><button className="clients-button secondary" type="button" onClick={() => setPaymentFormOpen(false)} disabled={saving}>Cancelar</button></div>
        </form>}
        {selectedBalanceLink ? <a className="whatsapp-button" href={selectedBalanceLink} target="_blank" rel="noreferrer"><MessageCircle size={17} /> Preparar saldo por WhatsApp</a> : <p className="phone-missing">Agrega un número válido para preparar el mensaje de WhatsApp.</p>}
        <small className="client-balance-footnote">Incluye ventas pendientes después de abonos y pedidos de trámites pendientes. El mensaje solo se envía cuando lo confirmes en WhatsApp.</small>
      </> : <p className="client-balance-empty">Este cliente no tiene pagos pendientes registrados.</p>}
    </section>
    <section className="client-procedure-panel"><header><div><p className="clients-eyebrow">PEDIDOS Y TRÁMITES</p><h2>Trámites por cliente</h2><p>Registra actas, RFC u otros servicios y su costo pendiente.</p></div></header>{canEdit && <form className="client-procedure-form" onSubmit={createProcedureOrder}><label>Nombre del trámite<input value={procedureForm.procedure_name} onChange={(event) => setProcedureForm((current) => ({ ...current, procedure_name: event.target.value }))} placeholder="Acta de nacimiento, RFC…" maxLength={120} required /></label><label>Costo (MXN)<input type="number" min="0.01" step="0.01" value={procedureForm.amount} onChange={(event) => setProcedureForm((current) => ({ ...current, amount: event.target.value }))} required /></label><label>Fecha del pedido<input type="date" value={procedureForm.order_date} onChange={(event) => setProcedureForm((current) => ({ ...current, order_date: event.target.value }))} required /></label><label className="procedure-notes">Notas (opcional)<input value={procedureForm.notes} onChange={(event) => setProcedureForm((current) => ({ ...current, notes: event.target.value }))} maxLength={300} placeholder="Detalle del trámite" /></label><button className="clients-button primary" disabled={saving}><Plus size={16} />{saving ? "Guardando…" : "Agregar pendiente"}</button></form>}{selectedOrders.length ? <div className="client-procedure-list">{selectedOrders.map((order) => <article key={order.id}><div className="procedure-order-main"><strong>{order.procedure_name}</strong><small>Pedido {dateLabel(order.order_date)}{order.paid_at ? " · pagado " + dateLabel(order.paid_at) : ""}{order.notes ? " · " + order.notes : ""}</small></div><b>{money(order.amount)}</b><span className={"procedure-order-status " + order.status}>{order.status === "pending" ? "Pendiente" : order.status === "paid" ? "Pagado" : "Cancelado"}</span>{canEdit && order.status === "pending" && !selectedPendingItems.some((item) => item.item_type === "procedure" && item.item_id === order.id && Number(item.paid) > 0) && <div className="procedure-order-actions"><span>Registra los abonos desde el saldo pendiente.</span><button className="procedure-cancel-button" type="button" onClick={() => void updateProcedureOrder(order, "cancelled")} disabled={saving}>Cancelar pedido</button></div>}{canEdit && order.status === "pending" && selectedPendingItems.some((item) => item.item_type === "procedure" && item.item_id === order.id && Number(item.paid) > 0) && <small>Este trámite tiene abonos; liquídalo desde el saldo pendiente.</small>}</article>)}</div> : <p className="client-balance-empty">Todavía no hay trámites registrados para este cliente.</p>}</section>
    <section className="client-history"><div className="client-history-heading"><div><p className="clients-eyebrow">SEGUIMIENTO</p><h2>Historial de cuentas y vencimientos</h2></div><span>{clientAssignments.length} registros</span></div>
      {clientAssignments.length ? <div className="client-history-list">{clientAssignments.map((row) => { const status = assignmentStatus(row); return <article className="client-history-row" key={row.id}><span className="client-service-mark">{row.inventory?.service?.slice(0, 1) || "C"}</span><div className="client-history-main"><strong>{row.inventory?.service || "Cuenta"} · {accessLabel(row)}</strong><small>Usuario: {row.inventory?.account_username || "No guardado"} · {row.inventory?.provider || ""}</small><small>Inicio {dateLabel(row.starts_on)} · vence {dateLabel(row.expires_on)} · ciclo de {row.duration_days} días</small>{row.notes && <small>{row.notes}</small>}</div><span className={"client-status " + status.key}>{status.label}</span></article>; })}</div> : <div className="clients-empty"><CalendarDays size={24} /><p>Aún no hay cuentas asignadas. Agrega la primera para iniciar el historial.</p></div>}
    </section>
  </main>;

  return <main className="clients-page">
    <header className="clients-heading"><div><p className="clients-eyebrow">RELACIÓN Y RENOVACIONES</p><h1>Clientes</h1><p className="clients-subtitle">Contactos, perfiles, asignaciones, trámites y saldos en una sola ficha.</p></div>{canEdit && <button className="clients-button primary" type="button" onClick={() => setNewClientOpen(true)}><Plus size={17} /> Nuevo cliente</button>}</header>
    {notice && <p className="clients-notice" role="status">{notice}</p>}
    <section className="clients-stats"><Summary icon={<UserRound />} label="Clientes" value={clients.length} /><Summary icon={<Clock3 />} label="Cuentas por vencer" value={soonCount} tone="amber" /><Summary icon={<AlertTriangle />} label="Cuentas vencidas" value={expiredCount} tone="red" /><Summary icon={<FileText />} label="Saldo pendiente" value={money(Array.from(pendingByClient.values()).reduce((sum, value) => sum + value, 0))} tone="amber" /></section>
    <section className="clients-directory"><div className="clients-toolbar"><label className="clients-search"><Search size={17} /><input aria-label="Buscar clientes" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o teléfono" /></label><div className="clients-filters"><button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}>Todos</button><button className={filter === "soon" ? "selected" : ""} onClick={() => setFilter("soon")}>Por vencer</button><button className={filter === "expired" ? "selected" : ""} onClick={() => setFilter("expired")}>Vencidos</button></div></div>
      {loading ? <div className="clients-empty">Cargando clientes…</div> : visibleClients.length ? <div className="clients-list">{visibleClients.map((client) => { const link = whatsappUrl(client.phone, client.full_name); return <article className="client-card" key={client.id}><button className="client-card-main" type="button" onClick={() => { setSelectedId(client.id); setNotice(""); }}><span className="client-avatar">{client.full_name.slice(0, 1).toUpperCase()}</span><span className="client-card-info"><strong>{client.full_name}</strong><small>{client.phone || "Sin número registrado"}</small><small>{client.active} cuentas activas · {client.history.length} en historial</small><small className={client.balance > 0 ? "client-card-balance due" : "client-card-balance"}>{client.balance > 0 ? "Saldo pendiente: " + money(client.balance) : "Sin saldo pendiente"}</small></span></button><span className="client-card-alerts">{client.soon > 0 && <span className="client-status soon">{client.soon} por vencer</span>}{client.expired > 0 && <span className="client-status expired">{client.expired} vencida(s)</span>}{client.soon === 0 && client.expired === 0 && <span className="client-status active">Accesos vigentes</span>}</span><div className="client-card-actions">{link ? <a className="whatsapp-button" href={link} target="_blank" rel="noreferrer" aria-label={"Escribir por WhatsApp a " + client.full_name}><MessageCircle size={17} /> WhatsApp</a> : <span className="phone-missing">Agrega teléfono con WhatsApp</span>}</div></article>; })}</div> : <div className="clients-empty"><UserRound size={25} /><p>{clients.length ? "No hay resultados para ese filtro." : "Aún no hay clientes registrados."}</p>{!clients.length && canEdit && <button className="clients-button primary" onClick={() => setNewClientOpen(true)}><Plus size={17} /> Agregar cliente</button>}</div>}
    </section>
    {newClientOpen && <div className="client-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewClientOpen(false); }}><section className="client-modal" role="dialog" aria-modal="true" aria-labelledby="new-client-title"><header><div><p className="clients-eyebrow">CONTACTO</p><h2 id="new-client-title">Nuevo cliente</h2></div><button className="client-close" type="button" aria-label="Cerrar" onClick={() => setNewClientOpen(false)}><X size={19} /></button></header><form onSubmit={createClient}><label>Nombre completo<input autoFocus value={clientForm.full_name} onChange={(event) => setClientForm((current) => ({ ...current, full_name: event.target.value }))} maxLength={120} minLength={2} required placeholder="Nombre del cliente" /></label><label>Teléfono para WhatsApp<input type="tel" value={clientForm.phone} onChange={(event) => setClientForm((current) => ({ ...current, phone: event.target.value }))} maxLength={24} placeholder="10 dígitos o incluye código de país" /></label><small>Los números mexicanos de 10 dígitos se abrirán con el código +52.</small><label>Notas (opcional)<textarea rows="3" value={clientForm.notes} onChange={(event) => setClientForm((current) => ({ ...current, notes: event.target.value }))} maxLength={500} /></label>{notice && <p className="clients-notice">{notice}</p>}<footer><button type="button" className="clients-button secondary" onClick={() => setNewClientOpen(false)} disabled={saving}>Cancelar</button><button type="submit" className="clients-button primary" disabled={saving}>{saving ? "Guardando…" : "Guardar cliente"}</button></footer></form></section></div>}
  </main>;
}

function Summary({ icon, label, value, tone = "blue" }) { return <article className={"clients-summary " + tone}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></article>; }
function WhatsAppLink({ client }) {
  const link = whatsappUrl(client.phone, client.full_name);
  return link
    ? <a className="whatsapp-button" href={link} target="_blank" rel="noreferrer"><MessageCircle size={17} /> Escribir por WhatsApp</a>
    : <span className="phone-missing">Agrega teléfono para usar WhatsApp</span>;
}
