import { useEffect, useState } from "react";
import { BarChart3, Check, Globe, ShieldCheck, Users } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

const MODULES = [
  ["dashboard_view", "Panel principal"],
  ["clients_view", "Clientes · ver"],
  ["clients_edit", "Clientes · editar"],
  ["accounts_view", "Cuentas · consultar"],
  ["sales_view", "Ventas · consultar"],
  ["sales_edit", "Ventas · registrar"],
  ["payments_view", "Pagos · consultar"],
  ["payments_edit", "Pagos · registrar"],
  ["suppliers_view", "Proveedores · consultar"],
  ["suppliers_edit", "Proveedores · editar"],
  ["inventory_view", "Ver inventario propio"],
  ["inventory_edit", "Editar inventario propio"],
  ["tasks_view", "Ver tareas asignadas"],
  ["tasks_manage", "Crear y asignar tareas"],
  ["reports_view", "Reportes"],
  ["support_view", "Soporte"],
  ["support_manage", "Administrar soporte"],
  ["settings_view", "Configuración"],
];

const card = {
  background: "#0f172a",
  border: "1px solid #263449",
  borderRadius: 14,
  padding: 20,
  color: "#e2e8f0",
};

const buttonStyle = {
  marginTop: 14,
  padding: "10px 16px",
  border: 0,
  borderRadius: 8,
  background: "#0284c7",
  color: "white",
  cursor: "pointer",
};

function countryName(code) {
  if (code === "XX") return "País no identificado";
  try {
    return new Intl.DisplayNames(["es-MX"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

export default function Admin() {
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [taskCount, setTaskCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [visitCount, setVisitCount] = useState(0);
  const [countries, setCountries] = useState([]);
  const [visitsLoading, setVisitsLoading] = useState(true);
  const [visitsError, setVisitsError] = useState("");
  const [trackingConfigured, setTrackingConfigured] = useState(null);

  useEffect(() => {
    let active = true;

    async function loadAdminData() {
      const [userResult, taskResult, totalResult, countryResult, trackingResult] = await Promise.all([
        supabase.from("user_access").select("user_id,email,full_name,role,permissions,created_at").order("created_at"),
        supabase.from("tasks").select("id", { count: "exact", head: true }),
        supabase.from("site_visit_sessions").select("session_hash", { count: "exact", head: true }),
        supabase.from("site_visit_country_summary").select("country_code,visits").order("visits", { ascending: false }),
        fetch("/api/track-visit", { cache: "no-store" })
          .then((response) => response.ok ? response.json() : null)
          .catch(() => null),
      ]);

      if (!active) return;

      if (userResult.error) setNotice(userResult.error.message);
      else setUsers(userResult.data || []);
      setTaskCount(taskResult.count || 0);

      if (totalResult.error || countryResult.error) {
        setVisitsError("No se pudieron cargar las estadísticas de visitas.");
      } else {
        setVisitCount(totalResult.count || 0);
        setCountries(countryResult.data || []);
      }
      setTrackingConfigured(typeof trackingResult?.configured === "boolean" ? trackingResult.configured : null);
      setLoading(false);
      setVisitsLoading(false);
    }

    void loadAdminData();
    return () => { active = false; };
  }, []);

  function pick(user) {
    setSelected({ ...user, permissions: { ...(user.permissions || {}) } });
  }

  function toggle(key) {
    setSelected((current) => ({
      ...current,
      permissions: { ...current.permissions, [key]: !current.permissions[key] },
    }));
  }

  async function save() {
    setSaving(true);
    setNotice("");
    const { data, error } = await supabase
      .from("user_access")
      .update({ permissions: selected.permissions })
      .eq("user_id", selected.user_id)
      .select("user_id")
      .maybeSingle();

    setSaving(false);
    if (error || !data) {
      setNotice(error?.message || "No se guardaron los cambios.");
      return;
    }

    setUsers((list) => list.map((user) => user.user_id === selected.user_id ? selected : user));
    setNotice("Permisos actualizados.");
  }

  const highestCountryCount = Math.max(1, ...countries.map((row) => Number(row.visits || 0)));

  return (
    <main style={{ color: "#e2e8f0", maxWidth: 1100, margin: "0 auto" }}>
      <header style={{ marginBottom: 22 }}>
        <p style={{ color: "#38bdf8", letterSpacing: 2, fontSize: 12 }}>CONTROL DE ACCESO</p>
        <h1 style={{ margin: "6px 0" }}>Administración</h1>
        <p>El superusuario administra accesos; cada usuario conserva privados sus clientes, ventas e inventario.</p>
      </header>

      {notice && <p role="status" style={{ ...card, marginBottom: 16 }}>{notice}</p>}

      <section style={{ ...card, marginBottom: 18 }}>
        <h2 style={{ fontSize: 18, display: "flex", gap: 8, alignItems: "center", marginTop: 0 }}>
          <BarChart3 size={19} /> Visitas a la tienda
        </h2>
        <p style={{ color: "#94a3b8", marginTop: -6 }}>Conteo histórico, con una visita por sesión del navegador.</p>

        {trackingConfigured === false && (
          <p role="status" style={{ background: "#422006", border: "1px solid #a16207", borderRadius: 10, padding: 12 }}>
            Falta configurar la clave secreta de Supabase en las variables de entorno de Vercel para comenzar a registrar visitas.
          </p>
        )}
        {trackingConfigured === null && !visitsLoading && (
          <p role="status" style={{ color: "#fbbf24" }}>No se pudo comprobar el servicio de registro de visitas.</p>
        )}
        {visitsError && <p role="alert" style={{ color: "#fca5a5" }}>{visitsError}</p>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 14 }}>
          <div style={{ background: "#111e32", border: "1px solid #263449", borderRadius: 12, padding: 16 }}>
            <small style={{ color: "#94a3b8" }}>Visitas</small>
            <strong style={{ display: "block", fontSize: 28, marginTop: 5 }}>{visitsLoading ? "…" : visitCount.toLocaleString("es-MX")}</strong>
          </div>
          <div style={{ background: "#111e32", border: "1px solid #263449", borderRadius: 12, padding: 16 }}>
            <small style={{ color: "#94a3b8" }}>Países detectados</small>
            <strong style={{ display: "block", fontSize: 28, marginTop: 5 }}>{visitsLoading ? "…" : countries.length.toLocaleString("es-MX")}</strong>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <h3 style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 15 }}><Globe size={17} /> Visitas por país</h3>
          {visitsLoading ? <p>Cargando estadísticas…</p> : countries.length === 0 ? (
            <p style={{ color: "#94a3b8" }}>Aún no hay visitas registradas.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {countries.map((row) => {
                const visits = Number(row.visits || 0);
                return (
                  <div key={row.country_code} style={{ display: "grid", gridTemplateColumns: "minmax(130px, 1fr) 2fr auto", gap: 12, alignItems: "center" }}>
                    <span>{countryName(row.country_code)}</span>
                    <div aria-label={`${visits} visitas`} style={{ height: 8, background: "#1e293b", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ width: `${Math.max(3, visits / highestCountryCount * 100)}%`, height: "100%", background: "#38bdf8", borderRadius: 99 }} />
                    </div>
                    <strong>{visits.toLocaleString("es-MX")}</strong>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <small style={{ display: "block", color: "#64748b", marginTop: 16 }}>
          El país es aproximado según la IP de la visita. No se guarda la dirección IP ni se identifica a la persona.
        </small>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(250px,.8fr) minmax(360px,1.2fr)", gap: 18, alignItems: "start" }}>
        <section style={card}>
          <h2 style={{ fontSize: 18, display: "flex", gap: 8, alignItems: "center" }}><Users size={19} /> Usuarios ({users.length})</h2>
          {loading ? <p>Cargando…</p> : users.map((user) => (
            <button
              key={user.user_id}
              onClick={() => pick(user)}
              style={{
                display: "block",
                textAlign: "left",
                width: "100%",
                padding: 13,
                marginTop: 8,
                borderRadius: 10,
                border: selected?.user_id === user.user_id ? "1px solid #38bdf8" : "1px solid #263449",
                background: "#111e32",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              <strong>{user.full_name || user.email}</strong><br />
              <small>{user.email} · {user.role === "superadmin" ? "Superusuario" : "Usuario"}</small>
            </button>
          ))}
        </section>

        <section style={card}>
          <h2 style={{ fontSize: 18, display: "flex", gap: 8, alignItems: "center" }}><ShieldCheck size={19} /> Permisos</h2>
          {!selected ? <p>Selecciona una cuenta para ver o cambiar sus permisos.</p> : (
            <>
              <p>{selected.full_name || selected.email} · {selected.email}</p>
              <p style={{ padding: "10px 0", color: selected.role === "superadmin" ? "#38bdf8" : "#94a3b8" }}>
                Rol: {selected.role === "superadmin" ? "Superusuario" : "Usuario"}
              </p>
              {selected.role !== "superadmin" && MODULES.map(([key, label]) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid #263449" }}>
                  <input type="checkbox" checked={Boolean(selected.permissions[key])} onChange={() => toggle(key)} />
                  {label}
                </label>
              ))}
              {selected.role !== "superadmin" && (
                <button onClick={save} disabled={saving} style={buttonStyle}>
                  <Check size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />
                  {saving ? "Guardando…" : "Guardar permisos"}
                </button>
              )}
            </>
          )}
        </section>
      </div>

      <section style={{ ...card, marginTop: 18 }}>
        <strong>{taskCount}</strong> tareas registradas. Abre <a href="/tareas" style={{ color: "#38bdf8" }}>Tareas</a> para crear y asignar trabajo.
      </section>
    </main>
  );
}
