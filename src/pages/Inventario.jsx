import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Boxes, CalendarDays, Check, ClipboardPaste, Download, FileUp, Plus, Search, Trash2, UserRound, UserPlus, X } from "lucide-react";
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
function generateAccountIdentifier(service, recordId = id()) {
  const prefix = String(service || "CUENTA").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10).toUpperCase() || "CUENTA";
  const suffix = recordId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase();
  return `${prefix}-${suffix}`;
}
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function accountKey(service, email) {
  return `${String(service || "").trim().toLocaleLowerCase("es-MX")}\u0000${String(email || "").trim().toLocaleLowerCase("es-MX")}`;
}
function fromDatabase(row) {
  return { id: row.id, ownerId: row.user_id, service: row.service, accountLabel: row.account_label, provider: row.provider,
    purchaseDate: row.purchase_date, duration: row.duration, unit: row.unit,
    profileCapacity: row.profile_capacity ?? 5, customers: Array.isArray(row.customers) ? row.customers : [], cost: row.cost ?? "", notes: row.notes || "",
    storePublished: row.store_published ?? false, storeTitle: row.store_title || row.service, storeDescription: row.store_description || "",
    storePublicProfilePrice: row.store_public_profile_price ?? "", storePublicAccountPrice: row.store_public_account_price ?? "",
    storeResellerProfilePrice: row.store_reseller_profile_price ?? "", storeResellerAccountPrice: row.store_reseller_account_price ?? "",
    operationalStatus: row.inventory_operational_status || "available" };
}
function toDatabase(row, userId) {
  return { id: row.id, user_id: row.ownerId || userId, service: row.service, account_label: row.accountLabel,
    provider: row.provider, purchase_date: row.purchaseDate, duration: 28,
    unit: "days", profile_capacity: Number(row.profileCapacity || 5), customers: row.customers, cost: row.cost === "" ? null : row.cost, notes: row.notes,
    store_published: Boolean(row.storePublished), store_title: row.storeTitle || "", store_description: row.storeDescription || "",
    store_public_profile_price: row.storePublicProfilePrice === "" ? null : Number(row.storePublicProfilePrice),
    store_public_account_price: row.storePublicAccountPrice === "" ? null : Number(row.storePublicAccountPrice),
    store_reseller_profile_price: row.storeResellerProfilePrice === "" ? null : Number(row.storeResellerProfilePrice),
    store_reseller_account_price: row.storeResellerAccountPrice === "" ? null : Number(row.storeResellerAccountPrice) };
}
function blank() {
  return { service: "Netflix", accountLabel: generateAccountIdentifier("Netflix"), accessUsername: "", accessPassword: "", provider: "", purchaseDate: today(), duration: "28", unit: "days", profileCapacity: "5", customers: "", cost: "", notes: "", storePublished: false, storeTitle: "", storeDescription: "", storePublicProfilePrice: "", storePublicAccountPrice: "", storeResellerProfilePrice: "", storeResellerAccountPrice: "" };
}
function formFrom(row) {
  return { service: row.service, accountLabel: row.accountLabel, provider: row.provider, purchaseDate: row.purchaseDate, duration: "28", unit: "days", profileCapacity: String(row.profileCapacity ?? 5), customers: (row.customers || []).join(", "), cost: row.cost ?? "", notes: row.notes || "", storePublished: row.storePublished || false, storeTitle: row.storeTitle || row.service, storeDescription: row.storeDescription || "", storePublicProfilePrice: row.storePublicProfilePrice ?? "", storePublicAccountPrice: row.storePublicAccountPrice ?? "", storeResellerProfilePrice: row.storeResellerProfilePrice ?? "", storeResellerAccountPrice: row.storeResellerAccountPrice ?? "" };
}
function parseInventoryBatch(value, defaults) {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { error: "Pega o escribe al menos una cuenta." };
  if (lines.length > 10) return { error: "Puedes agregar hasta 10 cuentas por lote." };
  const sharedCapacity = Number(defaults.profileCapacity);
  if (!Number.isInteger(sharedCapacity) || sharedCapacity < 1 || sharedCapacity > 20) return { error: "La capacidad debe ser de 1 a 20 perfiles." };
  const rows = [];
  for (const [index, line] of lines.entries()) {
    // Split only the identity columns. Everything after the email belongs to
    // the password, so repeated passwords (and passwords containing '|') are
    // never interpreted as duplicate account identifiers or extra columns.
    const delimiter = line.includes("|") ? "|" : "\t";
    const firstSeparator = line.indexOf(delimiter);
    const secondSeparator = line.indexOf(delimiter, firstSeparator + delimiter.length);
    if (firstSeparator < 0) return { error: `Línea ${index + 1}: usa correo | contraseña, o servicio | correo | contraseña.` };
    const firstField = line.slice(0, firstSeparator).trim();
    const secondField = (secondSeparator < 0
      ? line.slice(firstSeparator + delimiter.length)
      : line.slice(firstSeparator + delimiter.length, secondSeparator)).trim();
    const service = secondSeparator < 0 ? defaults.service : firstField;
    const accessUsername = secondSeparator < 0 ? firstField : secondField;
    const accessPassword = (secondSeparator < 0
      ? line.slice(firstSeparator + delimiter.length)
      : line.slice(secondSeparator + delimiter.length)).trim();
    const recordId = id();
    const row = {
      id: recordId,
      service,
      accountLabel: generateAccountIdentifier(service, recordId),
      accessUsername,
      accessPassword,
      provider: defaults.provider.trim(),
      profileCapacity: sharedCapacity,
      purchaseDate: defaults.purchaseDate,
    };
    if (!row.service || row.service.length > 100) return { error: `Línea ${index + 1}: indica una plataforma válida.` };
    if (!validEmail(row.accessUsername) || row.accessUsername.length > 254) return { error: `Línea ${index + 1}: escribe un correo electrónico válido.` };
    if (!row.accessPassword || row.accessPassword.length > 500) return { error: `Línea ${index + 1}: agrega una contraseña de hasta 500 caracteres.` };
    if (!row.provider) return { error: "Indica el proveedor general del lote." };
    if (row.provider.length > 100) return { error: `Línea ${index + 1}: revisa el largo del proveedor.` };
    const duplicate = rows.some((item) => accountKey(item.service, item.accessUsername) === accountKey(row.service, row.accessUsername));
    if (duplicate) return { error: `Línea ${index + 1}: esta misma combinación de plataforma y correo ya aparece en el lote. Puedes repetir una contraseña si el correo de la cuenta es distinto.` };
    if (!Number.isInteger(row.profileCapacity) || row.profileCapacity < 1 || row.profileCapacity > 20) return { error: "La capacidad debe ser de 1 a 20 perfiles." };
    const date = parseDate(row.purchaseDate);
    if (!date || date.toISOString().slice(0, 10) !== row.purchaseDate) return { error: `Línea ${index + 1}: fecha inválida; usa AAAA-MM-DD.` };
    rows.push(row);
  }
  return { rows };
}

export default function Inventario({ userId, isSuperadmin = false, canViewAll = isSuperadmin, canEdit = true }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const [query, setQuery] = useState("");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [credentialSearchResult, setCredentialSearchResult] = useState({ query: "", accountIds: new Set(), error: false });
  const [formOpen, setFormOpen] = useState(false);
  const [addChoiceOpen, setAddChoiceOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [batchDefaults, setBatchDefaults] = useState({ service: "Netflix", provider: "", purchaseDate: today(), profileCapacity: "5" });
  const [batchSaving, setBatchSaving] = useState(false);
  const [batchNotice, setBatchNotice] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueSearch, setIssueSearch] = useState("");
  const [issueAccountId, setIssueAccountId] = useState("");
  const [issueDescription, setIssueDescription] = useState("");
  const [issueSaving, setIssueSaving] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignmentAccount, setAssignmentAccount] = useState(null);
  const [assignmentClients, setAssignmentClients] = useState([]);
  const [assignmentStatuses, setAssignmentStatuses] = useState(null);
  const [assignmentClientId, setAssignmentClientId] = useState("");
  const [assignmentType, setAssignmentType] = useState("profile");
  const [assignmentDate, setAssignmentDate] = useState(today());
  const [assignmentNotes, setAssignmentNotes] = useState("");
  const [assignmentAvailability, setAssignmentAvailability] = useState(null);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentNotice, setAssignmentNotice] = useState("");
  const [editingId, setEditingId] = useState(null);
  const credentialsRequest = useRef(0);
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

  useEffect(() => {
    let active = true;
    const search = query.trim().toLocaleLowerCase("es-MX");
    if (!canEdit || !search) return () => { active = false; };
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc("search_inventory_credentials", { p_query: search });
      if (!active) return;
      if (error) {
        setCredentialSearchResult({ query: search, accountIds: new Set(), error: true });
        return;
      }
      setCredentialSearchResult({ query: search, accountIds: new Set((data || []).map((row) => row.inventory_account_id)), error: false });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query, canEdit]);

  useEffect(() => { let active = true; if (canEdit) supabase.from("suppliers").select("name").eq("active", true).order("name").then(({ data }) => { if (active) setSupplierSuggestions(data || []); }); return () => { active = false; }; }, [canEdit]);

  useEffect(() => {
    let active = true;
    if (canEdit) supabase.rpc("list_inventory_assignment_clients").then(({ data, error }) => {
      if (!active) return;
      setAssignmentClients(error ? [] : data || []);
    });
    return () => { active = false; };
  }, [canEdit, userId]);

  useEffect(() => {
    let active = true;
    if (canEdit) supabase.rpc("inventory_assignment_statuses").then(({ data, error }) => {
      if (!active) return;
      setAssignmentStatuses(error ? {} : Object.fromEntries((data || []).map((row) => [row.inventory_account_id, {
        availableProfiles: row.available_profiles,
        occupied: row.account_occupied,
        accountUsername: row.account_username || "",
      }])));
    });
    return () => { active = false; };
  }, [canEdit, userId, accounts]);

  useEffect(() => {
    let active = true;
    if (!assignmentOpen || !assignmentAccount) return () => { active = false; };
    supabase.rpc("inventory_account_assignment_options", {
      p_inventory_account_id: assignmentAccount.id,
      p_starts_on: assignmentDate || today(),
    }).then(({ data, error }) => {
      if (!active) return;
      if (error) setAssignmentNotice(`No se pudo consultar la disponibilidad: ${error.message}`);
      else setAssignmentAvailability(Array.isArray(data) ? data[0] || null : data);
      setAssignmentLoading(false);
    });
    return () => { active = false; };
  }, [assignmentOpen, assignmentAccount, assignmentDate]);

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
    const normalizedQuery = query.trim().toLocaleLowerCase("es-MX");
    const text = [row.service, row.accountLabel, row.provider, ...(row.customers || [])].join(" ").toLocaleLowerCase("es-MX");
    const matchesCredential = canEdit && credentialSearchResult.query === normalizedQuery && credentialSearchResult.accountIds.has(row.id);
    const status = statusFor(row.expirationDate).key;
    return (!normalizedQuery || text.includes(normalizedQuery) || matchesCredential)
      && (serviceFilter === "all" || row.service === serviceFilter)
      && (statusFilter === "all" || (statusFilter === "unassigned" ? !row.customers?.length : status === statusFilter));
  });

  const credentialSearchStatus = !canEdit || !query.trim() ? "idle"
    : credentialSearchResult.query !== query.trim().toLocaleLowerCase("es-MX") ? "searching"
      : credentialSearchResult.error ? "error" : "idle";

  function openNew() {
    credentialsRequest.current += 1;
    setEditingId(null); setForm(blank()); setNotice(""); setFormOpen(true);
  }
  async function openAssignment(row) {
    setAssignmentAccount(row);
    setAssignmentClientId("");
    setAssignmentType("profile");
    setAssignmentDate(today());
    setAssignmentNotes("");
    setAssignmentNotice("");
    setAssignmentAvailability(null);
    setAssignmentLoading(true);
    setAssignmentOpen(true);
  }
  async function assignAccount(event) {
    event.preventDefault();
    if (!assignmentAccount || !assignmentClientId || !assignmentType) return;
    setAssignmentSaving(true);
    setAssignmentNotice("");
    const { data, error } = await supabase.rpc("assign_inventory_account_to_client", {
      p_client_id: assignmentClientId,
      p_inventory_account_id: assignmentAccount.id,
      p_delivery_type: assignmentType,
      p_starts_on: assignmentDate || today(),
      p_notes: assignmentNotes.trim(),
    });
    setAssignmentSaving(false);
    if (error) {
      setAssignmentNotice(`No se pudo asignar: ${error.message}`);
      return;
    }
    const client = assignmentClients.find((item) => item.id === assignmentClientId);
    const remainingProfiles = Math.max(0, Number(assignmentAvailability?.available_profiles || 0) - (assignmentType === "profile" ? 1 : 0));
    const startsTodayOrEarlier = assignmentDate <= today();
    setAssignmentStatuses((current) => ({
      ...(current || {}),
      [assignmentAccount.id]: {
        availableProfiles: startsTodayOrEarlier ? remainingProfiles : assignmentAvailability?.available_profiles || 0,
        occupied: startsTodayOrEarlier && (assignmentType === "full_account" || remainingProfiles === 0),
      },
    }));
    setAssignmentOpen(false);
    setNotice(`${data?.profile_name || (assignmentType === "full_account" ? "Cuenta completa" : "Perfil")} asignado a ${client?.full_name || "cliente"}. Vigencia: 28 días.`);
  }
  async function reportIssue(event) {
    event.preventDefault();
    if (!issueAccountId || issueDescription.trim().length < 3) return;
    setIssueSaving(true);
    const { error } = await supabase.rpc("report_inventory_issue", {
      p_inventory_account_id: issueAccountId, p_description: issueDescription.trim(),
    });
    setIssueSaving(false);
    if (error) { setNotice(`No se pudo registrar el reporte: ${error.message}`); return; }
    setAccounts((current) => current.map((row) => row.id === issueAccountId ? { ...row, operationalStatus: "reported" } : row));
    setIssueOpen(false); setIssueSearch(""); setIssueAccountId(""); setIssueDescription("");
    setNotice("Problema registrado. La cuenta dejó de estar disponible para nuevas asignaciones y la tienda.");
  }
  function chooseAddMode(mode) {
    setAddChoiceOpen(false);
    setNotice("");
    if (mode === "single") { openNew(); return; }
    setBatchText("");
    setBatchNotice("");
    setBatchDefaults({ service: "Netflix", provider: "", purchaseDate: today(), profileCapacity: "5" });
    setBatchOpen(true);
  }
  async function openEdit(row) {
    const requestId = ++credentialsRequest.current;
    setEditingId(row.id); setForm({ ...formFrom(row), accessUsername: "", accessPassword: "" }); setNotice(""); setFormOpen(true);
    const { data, error } = await supabase.rpc("get_inventory_account_credentials", { p_inventory_account_id: row.id });
    if (credentialsRequest.current !== requestId) return;
    if (error) { setNotice(`No se pudieron cargar las credenciales: ${error.message}`); return; }
    setForm((current) => ({ ...current, accessUsername: data?.username || "", accessPassword: data?.password || "" }));
  }
  function closeForm() {
    credentialsRequest.current += 1;
    setFormOpen(false); setEditingId(null); setForm(blank());
  }
  function changeForm(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value, ...(name === "service" && !editingId ? { accountLabel: generateAccountIdentifier(value) } : {}) }));
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
    if (!form.accessUsername.trim() || !validEmail(form.accessUsername.trim()) || !form.accessPassword) {
      setNotice("Agrega el correo electrónico y la contraseña de acceso de la cuenta."); return;
    }
    const existingAccount = editingId ? accounts.find((item) => item.id === editingId) : null;
    const storeFields = isSuperadmin ? {
      storePublished: form.storePublished, storeTitle: form.storeTitle.trim() || form.service,
      storeDescription: form.storeDescription.trim(), storePublicProfilePrice: form.storePublicProfilePrice,
      storePublicAccountPrice: form.storePublicAccountPrice, storeResellerProfilePrice: form.storeResellerProfilePrice,
      storeResellerAccountPrice: form.storeResellerAccountPrice,
    } : {
      storePublished: existingAccount?.storePublished || false, storeTitle: existingAccount?.storeTitle || "",
      storeDescription: existingAccount?.storeDescription || "", storePublicProfilePrice: existingAccount?.storePublicProfilePrice ?? "",
      storePublicAccountPrice: existingAccount?.storePublicAccountPrice ?? "", storeResellerProfilePrice: existingAccount?.storeResellerProfilePrice ?? "",
      storeResellerAccountPrice: existingAccount?.storeResellerAccountPrice ?? "",
    };
    const row = {
      id: editingId || id(), service: form.service, accountLabel: form.accountLabel.trim(),
      provider: form.provider.trim(), purchaseDate: form.purchaseDate, duration: 28, unit: "days",
      profileCapacity,
      customers: form.customers.split(/[,\n]/).map((name) => name.trim()).filter(Boolean),
      cost: form.cost === "" ? "" : Number(form.cost), notes: form.notes.trim(),
      ...storeFields,
    };
    setSaving(true);
    const result = editingId
      ? await supabase.from(TABLE).update(toDatabase({ ...row, ownerId: accounts.find((item) => item.id === editingId)?.ownerId || userId }, userId)).eq("id", editingId).select("*").single()
      : await supabase.from(TABLE).insert(toDatabase({ ...row, ownerId: userId }, userId)).select("*").single();
    if (result.error) { setSaving(false); setNotice(`No se pudo guardar en Supabase: ${result.error.message}`); return; }
    const saved = fromDatabase(result.data);
    setAccounts((current) => editingId ? current.map((item) => item.id === editingId ? saved : item) : [saved, ...current]);
    persistLocal(userId, editingId ? accounts.map((item) => item.id === editingId ? saved : item) : [saved, ...accounts]);
    const { error: credentialsError } = await supabase.rpc("save_inventory_account_credentials", {
      p_inventory_account_id: saved.id, p_username: form.accessUsername.trim(), p_password: form.accessPassword,
    });
    if (credentialsError) {
      if (!editingId) {
        const { error: cleanupError } = await supabase.from(TABLE).delete().eq("id", saved.id);
        if (!cleanupError) {
          const remaining = accounts.filter((item) => item.id !== saved.id);
          setAccounts(remaining); persistLocal(userId, remaining);
        }
      }
      setSaving(false); setNotice(`No se pudieron guardar los accesos: ${credentialsError.message}${!editingId ? " Se intentó retirar la cuenta incompleta del inventario." : " La cuenta conserva sus accesos anteriores."}`); return;
    }
    setSaving(false);
    setNotice(editingId ? "Cuenta actualizada en Supabase." : "Cuenta agregada en Supabase.");
    closeForm();
  }
  async function pasteBatchFromClipboard() {
    try {
      if (!navigator.clipboard?.readText) throw new Error("El navegador no permite leer el portapapeles desde esta página.");
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { setBatchNotice("El portapapeles está vacío."); return; }
      setBatchText(text);
      setBatchNotice("Lista pegada. Revisa las cuentas antes de agregarlas.");
    } catch (error) {
      setBatchNotice(`${error.message || "No se pudo leer el portapapeles."} También puedes pegar con Ctrl+V o el menú del navegador.`);
    }
  }
  async function saveBatch(event) {
    event.preventDefault();
    setBatchNotice("");
    const parsed = parseInventoryBatch(batchText, batchDefaults);
    if (parsed.error) { setBatchNotice(parsed.error); return; }
    setBatchSaving(true);
    const rowsToInsert = parsed.rows.map((row) => toDatabase({
      ...row, ownerId: userId, duration: 28, unit: "days", customers: [], cost: "", notes: "",
      storePublished: false, storeTitle: "", storeDescription: "", storePublicProfilePrice: "",
      storePublicAccountPrice: "", storeResellerProfilePrice: "", storeResellerAccountPrice: "",
    }, userId));
    const { data, error } = await supabase.from(TABLE).insert(rowsToInsert).select("*");
    if (error) { setBatchSaving(false); setBatchNotice(`No se pudo guardar el lote en Supabase: ${error.message}`); return; }
    const savedRows = (data || []).map(fromDatabase);
    const credentialsById = new Map(parsed.rows.map((row) => [row.id, row]));
    const credentialResults = await Promise.all((data || []).map((row) => {
      const credentials = credentialsById.get(row.id);
      return supabase.rpc("save_inventory_account_credentials", {
        p_inventory_account_id: row.id, p_username: credentials.accessUsername, p_password: credentials.accessPassword,
      });
    }));
    const failedCredentials = credentialResults.find((result) => result.error)?.error;
    if (failedCredentials) {
      const insertedIds = (data || []).map((row) => row.id);
      const { error: cleanupError } = await supabase.from(TABLE).delete().in("id", insertedIds);
      setBatchSaving(false);
      setBatchNotice(cleanupError
        ? `No se guardaron todos los accesos (${failedCredentials.message}) y no se pudo retirar todo el lote. Revisa Inventario y elimina las cuentas incompletas.`
        : `No se guardaron los accesos del lote (${failedCredentials.message}); se retiraron las cuentas incompletas. Corrige los datos y vuelve a intentar.`);
      return;
    }
    setBatchSaving(false);
    const merged = [...savedRows, ...accounts];
    setAccounts(merged);
    persistLocal(userId, merged);
    setBatchOpen(false);
    setBatchNotice("");
    setNotice(`Se agregaron ${savedRows.length} cuentas individuales al inventario.`);
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
        {canEdit && <button className="inv-button secondary" type="button" onClick={() => { setIssueOpen(true); setIssueSearch(""); setIssueAccountId(""); setIssueDescription(""); }}><AlertTriangle size={17} /> Reportar problema</button>}
        <button className="inv-button secondary" type="button" onClick={exportBackup} disabled={!accounts.length}><Download size={17} /> Respaldo</button>
        <label className="inv-button secondary upload-button"><FileUp size={17} /> Restaurar<input type="file" accept="application/json,.json" onChange={restoreBackup} /></label>
        {canEdit && <button className="inv-button primary" type="button" onClick={() => setAddChoiceOpen(true)}><Plus size={18} /> Agregar cuentas</button>}
      </div>
    </header>

    <div className="inventory-storage-note"><AlertTriangle size={17} /><span>{loading ? "Conectando con Supabase…" : connectionError ? "Supabase no está disponible; se muestra el respaldo local si existe. Los cambios no se guardarán hasta restablecer la conexión." : "Los accesos se guardan aparte en Supabase y solo se entregan al personal autorizado al registrar una venta. No se incluyen en respaldos descargables."}</span></div>
    
    {notice && <div className="inventory-notice" role="status">{notice}</div>}

    <section className="inventory-stats">
      <Stat icon={<Boxes size={19} />} label="Cuentas registradas" value={accounts.length} tone="blue" />
      <Stat icon={<CalendarDays size={19} />} label="Vencen en 7 días" value={stats.soon} tone="amber" />
      <Stat icon={<AlertTriangle size={19} />} label="Vencidas" value={stats.expired} tone="red" />
      <Stat icon={<UserRound size={19} />} label="Asignaciones a clientes" value={stats.assigned} tone="green" />
    </section>

    <section className="inventory-panel">
      <div className="inventory-toolbar">
        <label className="inventory-search"><Search size={18} /><input aria-label="Buscar inventario" placeholder="Buscar cuenta, proveedor, cliente, correo o contraseña" maxLength={500} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="inventory-filters">
          <label><span>Servicio</span><select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}><option value="all">Todos</option>{SERVICES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>Estado</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos</option><option value="active">Vigentes</option><option value="soon">Por vencer</option><option value="expired">Vencidas</option><option value="unassigned">Sin asignar</option></select></label>
        </div>
      </div>
      {credentialSearchStatus === "searching" && <p className="inventory-search-status" role="status">Buscando también en correos y contraseñas guardados…</p>}
      {credentialSearchStatus === "error" && <p className="inventory-search-status error" role="status">No se pudieron buscar las credenciales guardadas. Verifica tu permiso de inventario e inténtalo de nuevo.</p>}

      <div className="inventory-table-wrap">
        <table className="inventory-table">
          <thead><tr><th>Cuenta / servicio</th><th>Proveedor</th><th>Vencimiento</th><th>Duración</th><th>Clientes</th><th>Costo</th><th></th></tr></thead>
          <tbody>{visible.map((row) => {
            const status = statusFor(row.expirationDate);
            return <tr key={row.id}>
              <td><div className="inventory-account"><span className="service-mark">{row.service.slice(0, 1)}</span><span><strong>{assignmentStatuses?.[row.id]?.accountUsername || "Sin correo o usuario guardado"}</strong><small>{row.service}{row.operationalStatus === "reported" ? " · Con reporte" : row.operationalStatus === "replaced" ? " · Reemplazada" : ""}</small></span></div></td>
              <td>{row.provider}</td>
              <td><span className={`expiry-pill ${status.key}`}>{status.label}</span><small className="table-date">{dateLabel(row.expirationDate)}</small></td>
              <td>{row.duration} {UNITS[row.unit] || "meses"}</td>
              <td>{row.customers?.length ? <div className="customer-list">{row.customers.map((name, index) => <span key={`${name}-${index}`}>{name}</span>)}</div> : <span className="unassigned-label">Sin asignar</span>}</td>
              <td>{row.cost === "" || row.cost == null ? "—" : new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(row.cost))}</td>
              <td><div className="row-actions">{canEdit && <>{row.operationalStatus === "available" && status.key !== "expired" && <button className={`assign-account-button${assignmentStatuses?.[row.id]?.occupied ? " occupied" : ""}`} type="button" onClick={() => !assignmentStatuses?.[row.id]?.occupied && openAssignment(row)} disabled={assignmentStatuses === null || Boolean(assignmentStatuses?.[row.id]?.occupied)} title={assignmentStatuses?.[row.id]?.occupied ? "Esta cuenta ya está ocupada" : "Asignar a un cliente"}>{assignmentStatuses === null ? "Cargando…" : assignmentStatuses?.[row.id]?.occupied ? "Ocupada" : "Asignar"}</button>}<button type="button" onClick={() => openEdit(row)}>Editar</button><button className="delete-row" type="button" aria-label={`Eliminar ${row.accountLabel}`} onClick={() => remove(row)}><Trash2 size={16} /></button></>}</div></td>
            </tr>;
          })}</tbody>
        </table>
        {!loading && !visible.length && <div className="inventory-empty"><span className="empty-icon"><Boxes size={25} /></span><h2>{accounts.length ? "No hay coincidencias" : "Tu inventario empieza aquí"}</h2><p>{accounts.length ? "Prueba con otra búsqueda o filtro." : "Registra una cuenta para controlar su proveedor, vencimiento y clientes."}</p>{!accounts.length && canEdit && <button className="inv-button primary" onClick={() => setAddChoiceOpen(true)}><Plus size={18} /> Agregar cuentas</button>}</div>}
      </div>
      <footer className="inventory-footer"><span>{visible.length} de {accounts.length} cuentas</span><span>Vencimiento calculado desde fecha de compra + duración.</span></footer>
    </section>

    {assignmentOpen && assignmentAccount && <div className="inventory-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !assignmentSaving) setAssignmentOpen(false); }}>
      <section className="inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-assignment-title">
        <header className="modal-heading"><div><p className="inventory-eyebrow">ASIGNACIÓN DESDE INVENTARIO</p><h2 id="inventory-assignment-title">Entregar a un cliente</h2></div><button type="button" className="modal-close" aria-label="Cerrar" onClick={() => !assignmentSaving && setAssignmentOpen(false)}><X size={20} /></button></header>
        <form className="inventory-form" onSubmit={assignAccount}>
          <p className="assignment-account-summary span-two"><strong>{assignmentAccount.service}</strong><span>{assignmentAccount.accountLabel} · vence {dateLabel(expiration(assignmentAccount.purchaseDate, assignmentAccount.duration, assignmentAccount.unit))}</span></p>
          <label className="span-two">Cliente registrado<select value={assignmentClientId} onChange={(event) => setAssignmentClientId(event.target.value)} required><option value="">Selecciona un cliente</option>{assignmentClients.map((client) => <option key={client.id} value={client.id}>{client.full_name}{client.phone ? ` · ${client.phone}` : ""}</option>)}</select></label>
          <label className="span-two">Tipo de entrega<select value={assignmentType} onChange={(event) => setAssignmentType(event.target.value)} disabled={assignmentLoading}>
            <option value="profile" disabled={Boolean(assignmentAvailability && assignmentAvailability.available_profiles < 1)}>Un perfil{assignmentAvailability ? ` · ${assignmentAvailability.available_profiles} disponible(s)` : ""}</option>
            <option value="full_account" disabled={Boolean(assignmentAvailability && !assignmentAvailability.full_account_available)}>Cuenta completa</option>
          </select></label>
          <label>Fecha de inicio<input type="date" value={assignmentDate} onChange={(event) => { setAssignmentDate(event.target.value); setAssignmentLoading(true); setAssignmentAvailability(null); }} required /></label>
          <label>Vigencia<input value="28 días" readOnly /></label>
          <label className="span-two">Notas (opcional)<textarea value={assignmentNotes} onChange={(event) => setAssignmentNotes(event.target.value)} maxLength={500} rows="2" placeholder="Instrucciones o detalles de la asignación" /></label>
          {assignmentLoading && <p className="form-notice span-two">Consultando perfiles disponibles…</p>}
          {!assignmentLoading && !assignmentClients.length && <p className="form-notice span-two">No se encontraron clientes para esta cuenta de usuario.</p>}
          {assignmentNotice && <p className="form-notice span-two" role="status">{assignmentNotice}</p>}
          <small className="span-two">La disponibilidad se vuelve a comprobar al guardar. La asignación aparecerá en el historial del cliente.</small>
          <footer className="form-actions"><button className="inv-button secondary" type="button" onClick={() => setAssignmentOpen(false)} disabled={assignmentSaving}>Cancelar</button><button className="inv-button primary" type="submit" disabled={assignmentSaving || assignmentLoading || !assignmentAvailability || !assignmentClientId || (assignmentType === "profile" && assignmentAvailability.available_profiles < 1) || (assignmentType === "full_account" && !assignmentAvailability.full_account_available)}><UserPlus size={17} /> {assignmentSaving ? "Asignando…" : "Asignar 28 días"}</button></footer>
        </form>
      </section>
    </div>}

    {issueOpen && <div className="inventory-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !issueSaving) setIssueOpen(false); }}>
      <section className="inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-issue-title">
        <header className="modal-heading"><div><p className="inventory-eyebrow">INCIDENCIA DE CUENTA</p><h2 id="inventory-issue-title">Reportar un problema</h2></div><button type="button" className="modal-close" aria-label="Cerrar" onClick={() => !issueSaving && setIssueOpen(false)}><X size={20} /></button></header>
        <form className="inventory-form" onSubmit={reportIssue}>
          <label className="span-two">Buscar cuenta<input value={issueSearch} onChange={(event) => { setIssueSearch(event.target.value); setIssueAccountId(""); }} placeholder="Servicio, identificador o proveedor" autoFocus /></label>
          <label className="span-two">Selecciona la cuenta<select value={issueAccountId} onChange={(event) => setIssueAccountId(event.target.value)} required><option value="">Elige una cuenta disponible</option>{rows.filter((row) => row.operationalStatus === "available" && `${row.service} ${row.accountLabel} ${row.provider}`.toLocaleLowerCase("es-MX").includes(issueSearch.trim().toLocaleLowerCase("es-MX"))).map((row) => <option key={row.id} value={row.id}>{row.service} · {row.accountLabel} · {row.provider}</option>)}</select></label>
          <label className="span-two">¿Qué problema presenta?<textarea value={issueDescription} onChange={(event) => setIssueDescription(event.target.value)} minLength={3} maxLength={1000} rows="4" placeholder="Ej.: contraseña rechazada, cuenta suspendida, perfil sin acceso…" required /></label>
          <small className="span-two">Al guardar, se retirará de nuevas ventas y de la tienda hasta que se reactive o reemplace.</small>
          <footer className="form-actions"><button className="inv-button secondary" type="button" onClick={() => setIssueOpen(false)} disabled={issueSaving}>Cancelar</button><button className="inv-button primary" type="submit" disabled={issueSaving || !issueAccountId || issueDescription.trim().length < 3}><AlertTriangle size={17} /> {issueSaving ? "Registrando…" : "Registrar problema"}</button></footer>
        </form>
      </section>
    </div>}

    {addChoiceOpen && <div className="inventory-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAddChoiceOpen(false); }}>
      <section className="inventory-modal inventory-add-choice" role="dialog" aria-modal="true" aria-labelledby="inventory-add-choice-title">
        <header className="modal-heading"><div><p className="inventory-eyebrow">AGREGAR AL INVENTARIO</p><h2 id="inventory-add-choice-title">¿Cómo quieres agregar?</h2></div><button type="button" className="modal-close" aria-label="Cerrar" onClick={() => setAddChoiceOpen(false)}><X size={20} /></button></header>
        <div className="inventory-mode-options">
          <button type="button" className="inventory-mode-option" onClick={() => chooseAddMode("single")}><span className="inventory-mode-icon"><Plus size={20} /></span><strong>Una cuenta</strong><small>Completa el formulario para agregar una cuenta individual.</small></button>
          <button type="button" className="inventory-mode-option" onClick={() => chooseAddMode("batch")}><span className="inventory-mode-icon"><Boxes size={20} /></span><strong>Un lote</strong><small>Pega una lista de hasta 10 cuentas y se guardarán por separado.</small></button>
        </div>
      </section>
    </div>}

    {batchOpen && <div className="inventory-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !batchSaving) setBatchOpen(false); }}>
      <section className="inventory-modal inventory-batch-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-batch-title">
        <header className="modal-heading"><div><p className="inventory-eyebrow">CARGA POR LOTE · HASTA 10</p><h2 id="inventory-batch-title">Pega las cuentas</h2></div><button type="button" className="modal-close" aria-label="Cerrar" onClick={() => !batchSaving && setBatchOpen(false)}><X size={20} /></button></header>
        <form className="inventory-form" onSubmit={saveBatch}>
          <label>Servicio general<select value={batchDefaults.service} onChange={(event) => setBatchDefaults((current) => ({ ...current, service: event.target.value }))}>{SERVICES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Proveedor general<input value={batchDefaults.provider} onChange={(event) => setBatchDefaults((current) => ({ ...current, provider: event.target.value }))} placeholder="Nombre del proveedor" maxLength={100} required /></label>
          <label>Fecha de compra general<input type="date" value={batchDefaults.purchaseDate} onChange={(event) => setBatchDefaults((current) => ({ ...current, purchaseDate: event.target.value }))} required /></label>
          <label>Perfiles por cuenta<input type="number" min="1" max="20" value={batchDefaults.profileCapacity} onChange={(event) => setBatchDefaults((current) => ({ ...current, profileCapacity: event.target.value }))} required /></label>
          <div className="inventory-batch-input span-two">
            <div className="inventory-batch-input-heading"><label htmlFor="inventory-batch-list">Lista de cuentas</label><button className="inv-button secondary" type="button" onClick={pasteBatchFromClipboard}><ClipboardPaste size={16} /> Pegar portapapeles</button></div>
            <textarea id="inventory-batch-list" value={batchText} onChange={(event) => { setBatchText(event.target.value); setBatchNotice(""); }} rows="8" placeholder={"Una cuenta por línea:\ncorreo1@email.com | contraseña1\ncorreo2@email.com | contraseña2\n\nO especifica servicio: Max | correo@email.com | contraseña"} required />
            <small>{batchText.split(/\r?\n/).filter((line) => line.trim()).length} / 10 cuentas. Las líneas vacías se ignoran. Puedes repetir contraseñas: el sistema distingue las cuentas por plataforma y correo.</small>
          </div>
          {batchNotice && <p className="form-notice span-two" role="status">{batchNotice}</p>}
          <footer className="form-actions"><button className="inv-button secondary" type="button" onClick={() => setBatchOpen(false)} disabled={batchSaving}>Cancelar</button><button className="inv-button primary" type="submit" disabled={batchSaving || !batchText.trim()}><Check size={17} /> {batchSaving ? "Guardando lote…" : "Agregar cuentas al inventario"}</button></footer>
        </form>
      </section>
    </div>}

    {formOpen && <div className="inventory-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}>
      <section className="inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-form-title">
        <header className="modal-heading"><div><p className="inventory-eyebrow">{editingId ? "ACTUALIZAR REGISTRO" : "NUEVO REGISTRO"}</p><h2 id="inventory-form-title">{editingId ? "Editar cuenta" : "Agregar cuenta"}</h2></div><button type="button" className="modal-close" aria-label="Cerrar" onClick={closeForm}><X size={20} /></button></header>
        <form className="inventory-form" onSubmit={save}>
          <label>Servicio<select name="service" value={form.service} onChange={changeForm}>{SERVICES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="span-two">Identificador generado automáticamente<input name="accountLabel" value={form.accountLabel} readOnly aria-readonly="true" /></label>
          <div className="inventory-access-fields span-two"><strong>Accesos de la cuenta</strong><p>El correo y la contraseña se guardan aparte del inventario y no aparecen en el catálogo público.</p><label>Correo electrónico<input name="accessUsername" type="email" value={form.accessUsername} onChange={changeForm} autoComplete="off" maxLength={254} placeholder="correo@ejemplo.com" required /></label><label>Contraseña<input name="accessPassword" type="password" value={form.accessPassword} onChange={changeForm} autoComplete="new-password" maxLength={500} placeholder={editingId ? "Contraseña guardada o escribe una nueva" : "Contraseña de la cuenta"} required /></label></div>
          <label>Proveedor<input name="provider" list="inventory-provider-options" value={form.provider} onChange={changeForm} placeholder="Nombre del proveedor" maxLength={100} required /><datalist id="inventory-provider-options">{supplierSuggestions.map((supplier)=><option key={supplier.name} value={supplier.name}/>)}</datalist></label>
          <label>Fecha de compra<input name="purchaseDate" type="date" value={form.purchaseDate} onChange={changeForm} required /></label>
          <label>Perfiles disponibles<input name="profileCapacity" type="number" min="1" max="20" value={form.profileCapacity} onChange={changeForm} required /><small>Cuántos perfiles puede compartir esta cuenta.</small></label>
          <label>Duración del ciclo<input value="28 días" readOnly /></label>
          <label>Vencimiento calculado<input value={dateLabel(expiration(form.purchaseDate, form.duration, form.unit))} readOnly /></label>
          <label className="span-two">Cliente o clientes<textarea name="customers" value={form.customers} onChange={changeForm} placeholder="Nombres separados por coma; déjalo vacío si aún está libre." rows="2" maxLength={500} /></label>
          <label>Costo de compra (opcional)<span className="currency-field"><b>$</b><input name="cost" type="number" min="0" step="0.01" value={form.cost} onChange={changeForm} placeholder="0.00" /></span></label>
          <label>Notas (opcional)<input name="notes" value={form.notes} onChange={changeForm} placeholder="Perfil, renovación u observaciones" maxLength={300} /></label>
            {isSuperadmin && <div className="inventory-store-fields span-two">
            <label className="inventory-store-toggle"><input type="checkbox" name="storePublished" checked={form.storePublished} onChange={(event) => setForm((current) => ({ ...current, storePublished: event.target.checked }))} /> Publicar esta cuenta en la tienda</label>
            <label>Nombre visible<input name="storeTitle" value={form.storeTitle} onChange={changeForm} placeholder={form.service} maxLength={100} /></label>
            <label>Descripción para el cliente<textarea name="storeDescription" value={form.storeDescription} onChange={changeForm} rows="2" maxLength={300} placeholder="Detalles visibles en la tienda" /></label>
            <div className="inventory-store-prices">
              <label>Perfil · precio público<input name="storePublicProfilePrice" type="number" min="0" step="0.01" value={form.storePublicProfilePrice} onChange={changeForm} placeholder="0.00" /></label>
              <label>Perfil · precio revendedor<input name="storeResellerProfilePrice" type="number" min="0" step="0.01" value={form.storeResellerProfilePrice} onChange={changeForm} placeholder="0.00" /></label>
              <label>Cuenta completa · público<input name="storePublicAccountPrice" type="number" min="0" step="0.01" value={form.storePublicAccountPrice} onChange={changeForm} placeholder="0.00" /></label>
              <label>Cuenta completa · revendedor<input name="storeResellerAccountPrice" type="number" min="0" step="0.01" value={form.storeResellerAccountPrice} onChange={changeForm} placeholder="0.00" /></label>
            </div>
            <small>Solo se publica si hay precio configurado y existencia disponible. Los datos de acceso de la cuenta nunca se muestran.</small>
          </div>}
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
