import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BarChart3, Download, MessageCircle, RefreshCw, RotateCcw, Search, ShieldCheck, UserRound } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import "./Operational.css";

const cash = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(n || 0));

function whatsappUrl(phone, name, service) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) digits = `52${digits}`;
  if (digits.startsWith("521") && digits.length === 13) digits = `52${digits.slice(3)}`;
  if (digits.length < 11 || digits.length > 15) return "";
  const message = encodeURIComponent(`Hola ${name}, detectamos un problema con tu cuenta de ${service}. Ya está atendido. Escríbeme por aquí para coordinar los datos actualizados.`);
  return `https://wa.me/${digits}?text=${message}`;
}

export default function Reports({ canManageIssues = false, canNotifyCustomers = false }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [data, setData] = useState({ sales: [], payments: [], inventory: [], clients: [], assignments: [], suppliers: [], issues: [] });
  const [replacementChoices, setReplacementChoices] = useState({});
  const [savingIssue, setSavingIssue] = useState("");
  const [issueQuery, setIssueQuery] = useState("");
  const [accountUsernames, setAccountUsernames] = useState({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const requests = [
      supabase.from("sales").select("id,client_name,service,amount,status,sale_date"),
      supabase.from("payments").select("sale_id,amount,paid_at"),
      supabase.from("inventario_cuentas").select("id,service,account_label,purchase_date,customers,provider,inventory_operational_status"),
      supabase.from("clients").select("id,full_name,created_at"),
      supabase.from("client_account_assignments").select("id,client_id,inventory_account_id,expires_on,assignment_status,client:clients!client_account_assignments_client_id_fkey(id,full_name,phone)"),
      supabase.from("suppliers").select("id,active"),
      supabase.from("inventory_issue_reports").select("id,user_id,inventory_account_id,description,status,replacement_account_id,created_at,resolved_at,inventory:inventario_cuentas!inventory_issue_reports_inventory_account_id_fkey(id,service,account_label,provider),replacement:inventario_cuentas!inventory_issue_reports_replacement_account_id_fkey(id,service,account_label)").order("created_at", { ascending: false }),
      supabase.rpc("inventory_account_display_users"),
    ];
    const [s, p, i, c, a, v, issues, usernames] = await Promise.all(requests);
    const failed = [s, p, i, c, a, v].find((x) => x.error);
    if (!usernames.error) setAccountUsernames(Object.fromEntries((usernames.data || []).map((row) => [row.inventory_account_id, row.account_username || ""])));
    if (failed) setError(failed.error.message);
    else {
      setError("");
      setData({ sales: s.data || [], payments: p.data || [], inventory: i.data || [], clients: c.data || [], assignments: a.error ? [] : (a.data || []), suppliers: v.data || [], issues: issues.error ? [] : (issues.data || []) });
      if (issues.error) setNotice(`No se pudo cargar el módulo de incidencias. Aplica la migración 0010 en Supabase. Detalle: ${issues.error.message}`);
      else if (usernames.error) setNotice("No se pudieron consultar los usuarios de cuenta: " + usernames.error.message);
      else setNotice("");
    }
    setLoading(false);
  }, []);
  useEffect(() => { queueMicrotask(() => void refresh()); }, [refresh]);

  const issueClients = (issue) => {
    const found = new Map();
    const accountIds = [issue.inventory_account_id, issue.replacement_account_id].filter(Boolean);
    data.assignments.filter((assignment) => accountIds.includes(assignment.inventory_account_id) && assignment.assignment_status !== "replaced" && assignment.client).forEach((assignment) => found.set(assignment.client_id, assignment.client));
    return [...found.values()];
  };
  const activeIssues = data.issues.filter((issue) => issue.status === "open");
  const visibleIssues = data.issues.filter((issue) => [issue.inventory?.service || "", accountUsernames[issue.inventory_account_id] || "", issue.inventory?.account_label || "", issue.description].join(" ").toLocaleLowerCase("es-MX").includes(issueQuery.trim().toLocaleLowerCase("es-MX")));

  async function resolveIssue(issue, action) {
    const replacementId = replacementChoices[issue.id] || "";
    if (action === "replace" && !replacementId) { setNotice("Selecciona primero una cuenta de reemplazo disponible."); return; }
    setSavingIssue(issue.id); setNotice("");
    const { error: resolveError } = await supabase.rpc("resolve_inventory_issue", {
      p_issue_id: issue.id, p_action: action, p_replacement_account_id: action === "replace" ? replacementId : null,
    });
    setSavingIssue("");
    if (resolveError) { setNotice(`No se pudo resolver la incidencia: ${resolveError.message}`); return; }
    setNotice(action === "replace" ? "Cuenta reemplazada. Las asignaciones activas se movieron conservando sus fechas de vencimiento." : "Cuenta reactivada y disponible para asignaciones y tienda.");
    await refresh();
  }

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthly = data.sales.filter((s) => s.sale_date?.startsWith(month) && s.status !== "cancelled").reduce((n, s) => n + Number(s.amount), 0);
  const paidBySale = new Map(data.payments.reduce((m, p) => { m.set(p.sale_id, (m.get(p.sale_id) || 0) + Number(p.amount)); return m; }, new Map()));
  const due = data.sales.filter((s) => s.status === "pending").reduce((n, s) => n + Math.max(0, Number(s.amount) - (paidBySale.get(s.id) || 0)), 0);
  const byService = Object.entries(data.sales.filter((s) => s.status !== "cancelled").reduce((m, s) => { m[s.service] = (m[s.service] || 0) + Number(s.amount); return m; }, {})).sort((a, b) => b[1] - a[1]);

  async function loadReplacementChoices(issue) {
    if (replacementChoices[`${issue.id}:loaded`]) return;
    const { data: accounts, error: accountsError } = await supabase.from("inventario_cuentas")
      .select("id,service,account_label,inventory_operational_status,profile_capacity")
      .eq("user_id", issue.user_id).eq("service", issue.inventory?.service || "").eq("inventory_operational_status", "available")
      .order("account_label");
    if (accountsError) { setNotice(`No se pudieron consultar las cuentas disponibles: ${accountsError.message}`); return; }
    setReplacementChoices((current) => ({ ...current, [`${issue.id}:loaded`]: true, [`${issue.id}:accounts`]: (accounts || []).filter((account) => account.id !== issue.inventory_account_id) }));
  }
  function exportCsv() {
    const lines = [["Fecha", "Cliente", "Servicio", "Importe MXN", "Estado"], ...data.sales.map((s) => [s.sale_date, s.client_name, s.service, s.amount, s.status])];
    const blob = new Blob(["\ufeff" + lines.map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `reporte-ventas-${month}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  return <main className="op-page">
    <header className="op-heading"><div><p className="op-eyebrow">ANÁLISIS DEL NEGOCIO</p><h1>Reportes</h1><p>Resumen de ventas e incidencias de cuentas.</p></div><button className="op-button secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} /> Actualizar</button></header>
    {error && <p className="op-notice error">{error}</p>}
    {notice && <p className={`op-notice ${notice.startsWith("No se") || notice.startsWith("Selecciona") ? "error" : ""}`} role="status">{notice}</p>}

    <section className="op-table-card issue-report-panel">
      <header><h2><AlertTriangle size={18} /> Incidencias de cuentas <span className="issue-count">{activeIssues.length} abiertas</span></h2><label className="op-search"><Search size={16} /><input placeholder="Buscar cuenta o problema" aria-label="Buscar incidencias" value={issueQuery} onChange={(event) => setIssueQuery(event.target.value)} /></label></header>
      {loading ? <p className="op-empty">Cargando incidencias…</p> : visibleIssues.length ? <div className="issue-report-list">{visibleIssues.map((issue) => {
        const clients = issueClients(issue);
        const choices = replacementChoices[`${issue.id}:accounts`] || [];
        return <article className="issue-report-card" key={issue.id}>
          <div className="issue-report-heading"><div><span className={`op-status ${issue.status === "open" ? "pending" : "active"}`}>{issue.status === "open" ? "Problema abierto" : issue.status === "replaced" ? "Cuenta reemplazada" : "Cuenta reactivada"}</span><h3>{issue.inventory?.service || "Cuenta"} · {accountUsernames[issue.inventory_account_id] || "Usuario no guardado"}</h3><small>{issue.inventory?.provider || ""} · Reportado {new Date(issue.created_at).toLocaleString("es-MX")}</small>{issue.replacement && <small>Reemplazo: {issue.replacement.service || "Cuenta"} · {accountUsernames[issue.replacement_account_id] || "Usuario no guardado"}</small>}</div><strong>{clients.length} cliente(s)</strong></div>
          <p className="issue-description">{issue.description}</p>
          {canNotifyCustomers && <div className="issue-clients"><strong><UserRound size={15} /> Clientes con asignación</strong>{clients.length ? clients.map((client) => {
            const href = whatsappUrl(client.phone, client.full_name, issue.inventory?.service || "tu servicio");
            return <span key={client.id}>{client.full_name}{href ? <a className="op-text-button" href={href} target="_blank" rel="noreferrer"><MessageCircle size={14} /> WhatsApp</a> : <small>Sin teléfono válido</small>}</span>;
          }) : <small>No hay clientes con asignaciones vinculadas.</small>}<small>Se abrirá un borrador de WhatsApp; las nuevas credenciales se comparten manualmente y no se guardan en el sistema.</small></div>}
          {canManageIssues && issue.status === "open" && <div className="issue-actions">
            <button className="op-button secondary" onClick={() => void resolveIssue(issue, "reenable")} disabled={savingIssue === issue.id}><RotateCcw size={16} /> Reactivar</button>
            <div className="issue-replacement">
              <select aria-label={`Cuenta para reemplazar ${issue.inventory?.account_label || ""}`} value={replacementChoices[issue.id] || ""} onFocus={() => void loadReplacementChoices(issue)} onChange={(event) => setReplacementChoices((current) => ({ ...current, [issue.id]: event.target.value }))}>
                <option value="">Elegir reemplazo</option>{choices.map((account) => <option value={account.id} key={account.id}>{account.service} · {accountUsernames[account.id] || "Usuario no guardado"}</option>)}
              </select>
              <button className="op-button" onClick={() => void resolveIssue(issue, "replace")} disabled={savingIssue === issue.id || !replacementChoices[issue.id]}><ShieldCheck size={16} /> {savingIssue === issue.id ? "Guardando…" : "Reemplazar"}</button>
            </div>
          </div>}
        </article>;
      })}</div> : <p className="op-empty">{activeIssues.length ? "No hay incidencias con esa búsqueda." : "No hay cuentas reportadas. Las cuentas con problema aparecerán aquí."}</p>}
      {!canManageIssues && <p className="op-hint">Tu usuario puede consultar incidencias; solicita permiso de edición de inventario para resolverlas.</p>}
    </section>

    <div className="op-stats"><Metric label="Ventas del mes" value={loading ? "…" : cash(monthly)} /><Metric label="Saldo por cobrar" value={loading ? "…" : cash(due)} tone="amber" /><Metric label="Pagos recibidos" value={loading ? "…" : cash(data.payments.reduce((n, p) => n + Number(p.amount), 0))} tone="green" /><Metric label="Clientes" value={loading ? "…" : data.clients.length} /><Metric label="Perfiles asignados" value={loading ? "…" : data.assignments.filter((a) => a.assignment_status !== "replaced").length} /><Metric label="Proveedores activos" value={loading ? "…" : data.suppliers.filter((s) => s.active).length} tone="blue" /></div>
    <section className="op-table-card"><header><h2>Ventas por servicio</h2><button className="op-text-button" onClick={exportCsv} disabled={loading || !data.sales.length}><Download size={15} /> Exportar CSV</button></header>{loading ? <p className="op-empty">Cargando…</p> : byService.length ? <div className="op-table-wrap"><table><thead><tr><th>Servicio</th><th>Ventas</th><th>Participación</th></tr></thead><tbody>{byService.map(([name, total]) => <tr key={name}><td><strong>{name}</strong></td><td>{cash(total)}</td><td>{data.sales.length ? `${Math.round(total / Math.max(1, data.sales.filter((s) => s.status !== "cancelled").reduce((n, s) => n + Number(s.amount), 0)) * 100)}%` : "—"}</td></tr>)}</tbody></table></div> : <p className="op-empty">No hay ventas para resumir todavía.</p>}</section>
    <section className="op-table-card"><header><h2><BarChart3 size={18} /> Inventario por servicio</h2></header>{loading ? <p className="op-empty">Cargando…</p> : <div className="op-table-wrap"><table><thead><tr><th>Servicio</th><th>Cuentas</th><th>Perfiles en inventario</th></tr></thead><tbody>{Object.entries(data.inventory.reduce((m, r) => { if (!m[r.service]) m[r.service] = { count: 0, profiles: 0 }; if (r.inventory_operational_status !== "replaced") { m[r.service].count++; m[r.service].profiles += (r.customers || []).length; } return m; }, {})).map(([name, result]) => <tr key={name}><td>{name}</td><td>{result.count}</td><td>{result.profiles}</td></tr>)}</tbody></table></div>}</section>
  </main>;
}

function Metric({ label, value, tone = "blue" }) { return <article className={`op-metric ${tone}`}><span><BarChart3 size={18} /></span><div><small>{label}</small><strong>{value}</strong></div></article>; }
