import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Boxes, Check, CircleDollarSign, Clock3, Copy, CreditCard, MessageCircle, Plus, Search, Truck, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./Operational.css";

const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const money = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(n || 0));
const field = { width: "100%", boxSizing: "border-box", padding: 11, borderRadius: 8, border: "1px solid #334155", background: "#111e32", color: "white", marginTop: 6 };
const normalizePhone = (value) => String(value || "").replace(/\D/g, "");
const duplicatePhoneMessage = "Número ya existe en la base de datos";

export function Suppliers({ userId, canEdit }) {
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(""), [query, setQuery] = useState("");
  const [form, setForm] = useState({ id: "", name: "", contact_name: "", phone: "", email: "", notes: "" });
  const refresh = useCallback(async () => { setLoading(true); const { data, error: e } = await supabase.from("suppliers").select("*").order("name"); if (e) setError(e.message); else { setRows(data || []); setError(""); } setLoading(false); }, []);
  useEffect(() => { queueMicrotask(() => void refresh()); }, [refresh]);
  const visible = rows.filter((r) => `${r.name} ${r.contact_name} ${r.phone} ${r.email}`.toLowerCase().includes(query.trim().toLowerCase()));
  async function toggleActive(row) { const { error: updateError } = await supabase.from("suppliers").update({ active: !row.active, updated_at: new Date().toISOString() }).eq("id", row.id); if (updateError) { setError(updateError.message); return; } await refresh(); }
  async function save(e) { e.preventDefault(); setSaving(true); setError(""); const payload = { user_id: userId, name: form.name.trim(), contact_name: form.contact_name.trim(), phone: form.phone.trim(), email: form.email.trim(), notes: form.notes.trim(), updated_at: new Date().toISOString() }; const req = form.id ? supabase.from("suppliers").update(payload).eq("id", form.id) : supabase.from("suppliers").insert(payload); const { error: e2 } = await req; setSaving(false); if (e2) { setError(e2.message); return; } setForm({ id: "", name: "", contact_name: "", phone: "", email: "", notes: "" }); await refresh(); }
  return <ModuleShell eyebrow="RELACIONES COMERCIALES" title="Proveedores" subtitle="Directorio de proveedores para tus cuentas y operaciones." icon={<Truck/>} action={canEdit ? <button className="op-button" type="button" onClick={() => setForm({ id: "", name: "", contact_name: "", phone: "", email: "", notes: "" })}><Plus size={17}/> Nuevo proveedor</button> : null}>
    <div className="op-stats"><Metric icon={<Truck/>} label="Proveedores" value={rows.length}/><Metric icon={<Check/>} label="Activos" value={rows.filter(x=>x.active).length} tone="green"/><Metric icon={<Boxes/>} label="Cuentas registradas" value="Consulta inventario"/></div>
    {error && <p className="op-notice error">{error}</p>}
    {canEdit && <form className="op-form" onSubmit={save}><h2>{form.id ? "Editar proveedor" : "Registrar proveedor"}</h2><div className="op-form-grid"><label>Empresa o proveedor<input style={field} required maxLength={120} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Persona de contacto<input style={field} maxLength={120} value={form.contact_name} onChange={e=>setForm({...form,contact_name:e.target.value})}/></label><label>Teléfono<input type="tel" style={field} maxLength={30} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label><label>Correo<input type="email" style={field} maxLength={254} value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label className="wide">Notas<input style={field} maxLength={400} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label></div><div className="op-form-actions"><button className="op-button" disabled={saving}>{saving?"Guardando…":form.id?"Guardar cambios":"Guardar proveedor"}</button>{form.id&&<button type="button" className="op-button secondary" onClick={()=>setForm({id:"",name:"",contact_name:"",phone:"",email:"",notes:""})}>Cancelar</button>}</div></form>}
    <DataTable title="Directorio" search={query} setSearch={setQuery} loading={loading} empty="Aún no hay proveedores registrados." hasRows={visible.length > 0}><table><thead><tr><th>Proveedor</th><th>Contacto</th><th>Teléfono</th><th>Correo</th><th>Estado</th>{canEdit&&<th></th>}</tr></thead><tbody>{visible.map(r=><tr key={r.id}><td><strong>{r.name}</strong><small>{r.notes||"Proveedor"}</small></td><td>{r.contact_name||"—"}</td><td>{r.phone||"—"}</td><td>{r.email||"—"}</td><td><Status value={r.active?"active":"cancelled"}/></td>{canEdit&&<td><button className="op-text-button" onClick={()=>toggleActive(r)}>{r.active?"Desactivar":"Activar"}</button><button className="op-text-button" onClick={()=>setForm({id:r.id,name:r.name,contact_name:r.contact_name,phone:r.phone,email:r.email,notes:r.notes})}>Editar</button></td>}</tr>)}</tbody></table></DataTable>
  </ModuleShell>;
}

export function Sales({ canEdit, canCreateClient = false }) {
  const [clients,setClients]=useState([]),[rows,setRows]=useState([]),[services,setServices]=useState([]);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[notice,setNotice]=useState(""),[query,setQuery]=useState("");
  const [clientMode,setClientMode]=useState("existing"),[clientForm,setClientForm]=useState({full_name:"",phone:""}),[clientSearch,setClientSearch]=useState("");
  const [manualSelection,setManualSelection]=useState(false),[accountOptionsResult,setAccountOptionsResult]=useState({key:"",accounts:[],error:""});
  const [delivery,setDelivery]=useState(null),[copyNotice,setCopyNotice]=useState("");
  const [form,setForm]=useState({client_id:"",service:"",inventory_account_id:"",delivery_type:"profile",sale_date:today(),amount:"",payment_status:"pending",notes:""});
  const refresh=useCallback(async()=>{setLoading(true);const [s,c]=await Promise.all([
    supabase.from("sales").select("*").order("sale_date",{ascending:false}),
    supabase.from("clients").select("id,full_name,phone").order("full_name"),
  ]);if(s.error)setNotice(s.error.message);else{setRows(s.data||[]);setNotice("");}if(!c.error)setClients(c.data||[]);setLoading(false);},[]);
  useEffect(()=>{queueMicrotask(()=>void refresh());},[refresh]);
  useEffect(()=>{if(!canEdit)return undefined;let active=true;supabase.rpc("available_inventory_services",{p_sale_date:form.sale_date,p_delivery_type:form.delivery_type}).then(({data,error})=>{if(!active)return;if(error){setServices([]);setNotice(error.message);}else setServices(data||[]);});return()=>{active=false;};},[form.sale_date,form.delivery_type,canEdit]);
  const accountOptionsKey=`${form.service}|${form.sale_date}|${form.delivery_type}`;
  useEffect(()=>{if(!canEdit||!manualSelection||!form.service)return undefined;let active=true;const key=`${form.service}|${form.sale_date}|${form.delivery_type}`;const timer=setTimeout(async()=>{const {data,error}=await supabase.rpc("available_inventory_accounts",{p_service:form.service,p_sale_date:form.sale_date,p_delivery_type:form.delivery_type});if(active)setAccountOptionsResult({key,accounts:data||[],error:error?.message||""});},0);return()=>{active=false;clearTimeout(timer);};},[canEdit,manualSelection,form.service,form.sale_date,form.delivery_type]);
  const selectedService=services.find(item=>item.service===form.service);
  const accountOptionsCurrent=accountOptionsResult.key===accountOptionsKey;
  const selectedAccount=accountOptionsCurrent?accountOptionsResult.accounts.find(account=>account.inventory_account_id===form.inventory_account_id):null;
  const clientSearchDigits=normalizePhone(clientSearch);
  const matchingClients=clientSearchDigits?clients.filter(client=>normalizePhone(client.phone).includes(clientSearchDigits)):[];
  const selectedClient=clients.find(client=>client.id===form.client_id);
  const clientPhoneDigits=normalizePhone(clientForm.phone);
  const duplicateClient=clientMode==="new"&&clientPhoneDigits?clients.find(client=>normalizePhone(client.phone)===clientPhoneDigits):null;
  const visible=rows.filter(r=>`${r.client_name} ${r.service} ${r.profile_name} ${r.status}`.toLocaleLowerCase("es-MX").includes(query.trim().toLocaleLowerCase("es-MX")));
  const total=rows.filter(r=>r.status!=="cancelled").reduce((s,r)=>s+Number(r.amount),0);
  const accessMessage=delivery?[
    `Hola ${delivery.client_name}, aquí están tus accesos:`,
    `Plataforma: ${delivery.service}`,
    `Entrega: ${delivery.delivery_type==="full_account"?"Cuenta completa":delivery.profile_name}`,
    `Usuario/correo: ${delivery.access_username||delivery.account_label}`,
    `Contraseña: ${delivery.access_password}`,
    `Vigencia hasta: ${new Date(`${delivery.expires_on}T12:00:00`).toLocaleDateString("es-MX")}`,
  ].join("\n"):"";
  const phoneDigits=delivery?.client_phone?.replace(/\D/g,"")||"";
  const whatsappNumber=phoneDigits.length===10?`52${phoneDigits}`:phoneDigits;
  const whatsappLink=whatsappNumber.length>=10?`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(accessMessage)}`:"";
  async function copyAccess(){try{await navigator.clipboard.writeText(accessMessage);setCopyNotice("Accesos copiados al portapapeles.");}catch{setCopyNotice("No se pudo copiar automáticamente. Selecciona y copia el texto mostrado.");}}
  async function save(e){
    e.preventDefault();
    if(duplicateClient){setNotice(duplicatePhoneMessage);return;}
    if((clientMode==="existing"&&!form.client_id)||(clientMode==="new"&&(!canCreateClient||clientForm.full_name.trim().length<2))||!form.service){setNotice("Completa el cliente y elige una plataforma con cuentas disponibles.");return;}
    if(manualSelection&&(!selectedAccount||!accountOptionsCurrent)){setNotice("Elige una cuenta vigente y libre de la lista para esta plataforma.");return;}
    setSaving(true);setNotice("");setCopyNotice("");setDelivery(null);
    const rpc=manualSelection?"create_inventory_sale_with_selected_account":"create_inventory_sale_with_payment";
    const payload={p_client_id:clientMode==="existing"?form.client_id:null,p_client_name:clientMode==="new"?clientForm.full_name.trim():"",p_client_phone:clientMode==="new"?clientForm.phone.trim():"",p_service:form.service,p_delivery_type:form.delivery_type,p_sale_date:form.sale_date,p_amount:Number(form.amount||0),p_notes:form.notes.trim(),p_payment_status:form.payment_status};
    if(manualSelection)payload.p_inventory_account_id=form.inventory_account_id;
    const {data,error}=await supabase.rpc(rpc,payload);setSaving(false);
    if(error){setNotice(error.message);return;}
    setDelivery(data);setForm({client_id:"",service:"",inventory_account_id:"",delivery_type:"profile",sale_date:today(),amount:"",payment_status:"pending",notes:""});setManualSelection(false);setClientMode("existing");setClientForm({full_name:"",phone:""});setClientSearch("");await refresh();
    setNotice(`${data?.service||"Plataforma"} ${manualSelection?`de la cuenta ${data?.account_label||"seleccionada"}`:"asignada automáticamente"} a ${data?.client_name||"el cliente"}. La venta quedó registrada por 28 días.`);
  }
  return <ModuleShell eyebrow="ASIGNACIONES E INGRESOS" title="Ventas" subtitle="Elige la plataforma y asigna una cuenta disponible automáticamente o selecciona una en particular." icon={<ArrowUpRight/>}>
    <div className="op-stats"><Metric icon={<ArrowUpRight/>} label="Entregas registradas" value={rows.length}/><Metric icon={<CircleDollarSign/>} label="Importe no cancelado" value={money(total)} tone="green"/><Metric icon={<Clock3/>} label="Pendientes de cobro" value={rows.filter(r=>r.status==="pending").length} tone="amber"/></div>
    {notice&&<p className={`op-notice ${notice.includes("La venta quedó registrada")?"":"error"}`}>{notice}</p>}
    {canEdit&&<form className="op-form" onSubmit={save}><h2>Nueva entrega</h2><div className="op-form-grid">
      <div className="sales-client-field"><label>{clientMode==="new"?"Nuevo cliente":"Cliente registrado"}</label>{clientMode==="existing"?(selectedClient?<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginTop:6,padding:11,border:"1px solid #334155",borderRadius:8,background:"#111e32"}}><span><strong>{selectedClient.full_name}</strong><small style={{display:"block",color:"#94a3b8",marginTop:3}}>{selectedClient.phone||"Sin número registrado"}</small></span><button type="button" className="op-text-button" onClick={()=>{setForm({...form,client_id:""});setClientSearch("");}}>Cambiar</button></div>:<><input type="tel" style={field} aria-label="Buscar cliente por número" placeholder="Buscar cliente por número de WhatsApp" value={clientSearch} onChange={e=>{setClientSearch(e.target.value);setForm({...form,client_id:""});}}/><div style={{display:"grid",gap:6,marginTop:8}}>{clientSearchDigits.length>0&&matchingClients.map(client=><button key={client.id} type="button" className="op-button secondary" style={{justifyContent:"space-between",textAlign:"left"}} onClick={()=>{setForm({...form,client_id:client.id});setNotice("");}}><span>{client.full_name}<small style={{display:"block",color:"#94a3b8"}}>{client.phone}</small></span><span>Elegir</span></button>)}{clientSearchDigits.length>0&&!matchingClients.length&&<small className="op-hint">No encontramos un cliente con ese número. Puedes registrarlo si aún no existe.</small>}</div></>):<><div className="sales-client-inputs"><input style={field} aria-label="Nombre del cliente" placeholder="Nombre completo" value={clientForm.full_name} onChange={e=>setClientForm({...clientForm,full_name:e.target.value})} minLength="2" maxLength="120" required/><input type="tel" style={field} aria-label="WhatsApp del cliente" placeholder="WhatsApp para enviar accesos" value={clientForm.phone} onChange={e=>setClientForm({...clientForm,phone:e.target.value})} maxLength="24" required/></div>{duplicateClient&&<div className="op-notice error" role="alert" style={{margin:"8px 0 0",padding:10}}>{duplicatePhoneMessage}. <button type="button" className="op-text-button" onClick={()=>{setForm({...form,client_id:duplicateClient.id});setClientSearch(duplicateClient.phone||clientForm.phone);setClientMode("existing");setClientForm({full_name:"",phone:""});setNotice("");}}>Usar cliente existente</button></div>}</>}</div>
      {canCreateClient&&<div className="sales-new-client"><span>{clientMode==="existing"?"¿Es cliente nuevo?":"¿Ya está registrado?"}</span><button type="button" className="op-text-button" onClick={()=>{setClientMode(clientMode==="existing"?"new":"existing");setNotice("");}}><UserRound size={14}/>{clientMode==="existing"?"Agregar nuevo cliente":"Elegir cliente registrado"}</button></div>}
      <label>Tipo de entrega<select style={field} value={form.delivery_type} onChange={e=>setForm({...form,delivery_type:e.target.value,service:"",inventory_account_id:""})}><option value="profile">Un perfil</option><option value="full_account">Cuenta completa</option></select></label>
      <div className="sales-platform-field"><label>Plataforma<select style={field} value={form.service} onChange={e=>setForm({...form,service:e.target.value,inventory_account_id:""})} required><option value="">Selecciona una plataforma</option>{services.map(item=><option key={item.service} value={item.service}>{item.service} · {item.accounts_available} cuenta(s) disponible(s){item.accounts_with_credentials===0?" · faltan accesos":""}</option>)}</select>{!services.length&&<small className="op-hint">No hay cuentas disponibles para esta fecha y tipo de entrega. Revisa el estado y la vigencia de las cuentas en Inventario.</small>}{selectedService&&selectedService.accounts_with_credentials===0&&<small className="op-hint">Hay inventario de esta plataforma, pero falta guardar usuario y contraseña en Inventario antes de registrar la venta.</small>}</label>
        <button type="button" className="op-text-button sales-account-toggle" disabled={!form.service} onClick={()=>{setManualSelection(value=>!value);setAccountOptionsResult({key:"",accounts:[],error:""});setForm(current=>({...current,inventory_account_id:""}));}}>{manualSelection?"Volver a asignación automática":"Elegir cuenta específica"}</button>
        {manualSelection&&<><label>Cuenta disponible<select style={field} value={form.inventory_account_id} onChange={e=>setForm({...form,inventory_account_id:e.target.value})} disabled={!accountOptionsCurrent||Boolean(accountOptionsResult.error)||!accountOptionsResult.accounts.length} required><option value="">{!accountOptionsCurrent?"Buscando cuentas…":"Selecciona una cuenta libre"}</option>{accountOptionsCurrent&&accountOptionsResult.accounts.map(account=><option key={account.inventory_account_id} value={account.inventory_account_id}>{account.account_username||"Sin usuario guardado"}{form.delivery_type==="profile"?` · ${account.available_profiles} perfil(es) libre(s)`:" · Cuenta completa libre"}</option>)}</select></label>
          {!accountOptionsCurrent&&<small className="op-hint sales-account-hint">Buscando cuentas vigentes y libres de {form.service}…</small>}
          {accountOptionsCurrent&&accountOptionsResult.error&&<small className="op-hint sales-account-hint error">No se pudieron consultar las cuentas disponibles: {accountOptionsResult.error}</small>}
          {accountOptionsCurrent&&!accountOptionsResult.error&&!accountOptionsResult.accounts.length&&<small className="op-hint sales-account-hint">No hay cuentas vigentes, libres y con accesos guardados para esta plataforma y tipo de entrega.</small>}
        </>}
      </div>
      <label>Fecha de entrega<input type="date" style={field} value={form.sale_date} onChange={e=>setForm({...form,sale_date:e.target.value,service:"",inventory_account_id:""})} required/></label>
      <label>Importe de venta (MXN, opcional)<input type="number" min="0" step="0.01" style={field} value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label>
      <label>Estado de pago<select style={field} value={form.payment_status} onChange={e=>setForm({...form,payment_status:e.target.value})} required><option value="pending">Pendiente de pago</option><option value="paid">Pagado</option></select></label>
      <label className="wide">Notas<input style={field} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} maxLength={400}/></label>
    </div><button className="op-button" disabled={saving||Boolean(duplicateClient)||!selectedService||selectedService.accounts_with_credentials===0||(manualSelection&&!selectedAccount)}>{saving?"Asignando cuenta…":"Asignar cuenta y registrar venta"}</button></form>}
    {delivery&&<section className="sales-delivery-card"><header><div><span className="op-status active">Entrega registrada</span><h2>Accesos para {delivery.client_name}</h2><p>{delivery.service} · {delivery.account_label||"Cuenta asignada"} · {delivery.delivery_type==="full_account"?"Cuenta completa":delivery.profile_name} · Vence {new Date(`${delivery.expires_on}T12:00:00`).toLocaleDateString("es-MX")}</p></div></header><pre>{accessMessage}</pre>{copyNotice&&<small>{copyNotice}</small>}<div className="sales-delivery-actions"><button type="button" className="op-button" onClick={copyAccess}><Copy size={16}/> Copiar accesos</button>{whatsappLink?<a className="op-button secondary" href={whatsappLink} target="_blank" rel="noreferrer"><MessageCircle size={16}/> Enviar por WhatsApp</a>:<small>Agrega un teléfono de WhatsApp para abrir el mensaje al cliente.</small>}</div><small>WhatsApp abrirá el mensaje para que lo revises y lo envíes. Los accesos solo aparecen aquí después de una venta autorizada.</small></section>}
    <DataTable title="Registro de entregas y ventas" search={query} setSearch={setQuery} loading={loading} empty="Aún no hay entregas registradas." hasRows={visible.length > 0}><table><thead><tr><th>Fecha</th><th>Cliente</th><th>Cuenta / perfil</th><th>Importe</th><th>Cobro</th><th>Disponibilidad</th></tr></thead><tbody>{visible.map(r=><tr key={r.id}><td>{new Date(`${r.sale_date}T12:00:00`).toLocaleDateString("es-MX")}</td><td><strong>{r.client_name}</strong></td><td>{r.service}<small>{r.delivery_type==="full_account"?"Cuenta completa":r.profile_name||"Entrega"}</small></td><td>{money(r.amount)}</td><td><Status value={r.status}/></td><td>{r.delivery_type==="full_account"?"Ocupada":"Perfil asignado"}</td></tr>)}</tbody></table></DataTable>
  </ModuleShell>;
}

export function Payments({ userId, canEdit }) {
  const [rows, setRows] = useState([]);
  const [sales, setSales] = useState([]);
  const [procedurePayments, setProcedurePayments] = useState([]);
  const [supplierPayments, setSupplierPayments] = useState([]);
  const [procedureOrders, setProcedureOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({ sale_id: "", amount: "", method: "transferencia", paid_at: today(), reference: "", notes: "" });
  const [supplierForm, setSupplierForm] = useState({ procedure_order_id: "", supplier_id: "", supplier_name: "", amount: "", method: "transferencia", paid_at: today(), reference: "", notes: "" });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [p, s, pp, sp, orders, supplierList] = await Promise.all([
      supabase.from("payments").select("*").eq("user_id", userId).order("paid_at", { ascending: false }),
      supabase.from("sales").select("id,client_name,service,amount,status,sale_date,procedure_order_id").eq("user_id", userId).order("sale_date", { ascending: false }),
      supabase.from("client_procedure_payments").select("id,procedure_order_id,sale_id,amount,paid_at,method").eq("user_id", userId).order("paid_at", { ascending: false }),
      supabase.from("procedure_supplier_payments").select("id,procedure_order_id,supplier_id,supplier_name,amount,paid_at,method,reference,notes").eq("user_id", userId).order("paid_at", { ascending: false }),
      supabase.rpc("get_procedure_payment_orders"),
      supabase.rpc("get_procedure_payment_suppliers"),
    ]);
    const failed = [p, s, pp, sp, orders, supplierList].find((result) => result.error);
    if (failed) setNotice("No se pudieron cargar los pagos: " + failed.error.message);
    else setNotice("");
    if (!p.error) setRows(p.data || []);
    if (!s.error) setSales(s.data || []);
    if (!pp.error) setProcedurePayments(pp.data || []);
    if (!sp.error) setSupplierPayments(sp.data || []);
    if (!orders.error) setProcedureOrders(orders.data || []);
    if (!supplierList.error) setSuppliers(supplierList.data || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { queueMicrotask(() => void refresh()); }, [refresh]);

  const selectedSale = sales.find((sale) => sale.id === form.sale_id);
  const paidForSale = rows.filter((payment) => payment.sale_id === form.sale_id).reduce((total, payment) => total + Number(payment.amount), 0);
  const saleBalance = selectedSale ? Math.max(0, Number(selectedSale.amount) - paidForSale) : null;
  const paymentNames = new Map(sales.map((sale) => [sale.id, sale.client_name + " · " + sale.service]));
  const visiblePayments = rows.filter((payment) => [paymentNames.get(payment.sale_id) || "Venta", payment.method, payment.reference].join(" ").toLocaleLowerCase("es-MX").includes(query.trim().toLocaleLowerCase("es-MX")));
  const orderById = new Map(procedureOrders.map((order) => [order.procedure_order_id, order]));
  const revenueByOrder = procedurePayments.reduce((totals, payment) => {
    totals.set(payment.procedure_order_id, (totals.get(payment.procedure_order_id) || 0) + Number(payment.amount));
    return totals;
  }, new Map());
  const costByOrder = supplierPayments.reduce((totals, payment) => {
    totals.set(payment.procedure_order_id, (totals.get(payment.procedure_order_id) || 0) + Number(payment.amount));
    return totals;
  }, new Map());
  const procedureRevenue = procedurePayments.reduce((total, payment) => total + Number(payment.amount), 0);
  const supplierTotal = supplierPayments.reduce((total, payment) => total + Number(payment.amount), 0);
  const procedureProfit = procedureRevenue - supplierTotal;
  const selectedOrder = procedureOrders.find((order) => order.procedure_order_id === supplierForm.procedure_order_id);
  const selectedOrderRevenue = selectedOrder ? revenueByOrder.get(selectedOrder.procedure_order_id) || 0 : 0;
  const selectedOrderCosts = selectedOrder ? costByOrder.get(selectedOrder.procedure_order_id) || 0 : 0;
  const supplierHistory = supplierPayments.filter((payment) => {
    const order = orderById.get(payment.procedure_order_id);
    return [order?.client_name || "", order?.procedure_name || "", payment.supplier_name, payment.method, payment.reference].join(" ").toLocaleLowerCase("es-MX").includes(query.trim().toLocaleLowerCase("es-MX"));
  });

  async function saveSalePayment(event) {
    event.preventDefault();
    setSaving(true);
    setNotice("");
    const { error } = await supabase.rpc("register_sale_payment", {
      p_sale_id: form.sale_id,
      p_amount: Number(form.amount),
      p_method: form.method,
      p_paid_at: form.paid_at,
      p_reference: form.reference.trim(),
      p_notes: form.notes.trim(),
    });
    setSaving(false);
    if (error) { setNotice(error.message); return; }
    setForm({ sale_id: "", amount: "", method: "transferencia", paid_at: today(), reference: "", notes: "" });
    setNotice("Pago registrado.");
    await refresh();
  }

  async function saveSupplierPayment(event) {
    event.preventDefault();
    const amount = Number(supplierForm.amount);
    if (!supplierForm.procedure_order_id || !supplierForm.supplier_name.trim() || !Number.isFinite(amount) || amount <= 0) {
      setNotice("Selecciona el trámite y registra el proveedor y un importe mayor a cero.");
      return;
    }
    setSaving(true);
    setNotice("");
    const { error } = await supabase.from("procedure_supplier_payments").insert({
      user_id: userId,
      procedure_order_id: supplierForm.procedure_order_id,
      supplier_id: supplierForm.supplier_id || null,
      supplier_name: supplierForm.supplier_name.trim(),
      amount,
      method: supplierForm.method,
      paid_at: supplierForm.paid_at,
      reference: supplierForm.reference.trim(),
      notes: supplierForm.notes.trim(),
    });
    setSaving(false);
    if (error) { setNotice("No se pudo guardar el pago al proveedor: " + error.message); return; }
    setSupplierForm({ procedure_order_id: "", supplier_id: "", supplier_name: "", amount: "", method: "transferencia", paid_at: today(), reference: "", notes: "" });
    setNotice("Pago al proveedor registrado. La ganancia del trámite se actualizó.");
    await refresh();
  }

  const noticeError = notice.startsWith("No se") || notice.startsWith("No tienes") || notice.startsWith("Selecciona");
  return <ModuleShell eyebrow="COBROS Y MOVIMIENTOS" title="Pagos" subtitle="Registra cobros, abonos y pagos a proveedores de trámites." icon={<CreditCard />}>
    <div className="op-stats">
      <Metric icon={<CreditCard />} label="Pagos registrados" value={rows.length} />
      <Metric icon={<ArrowDownLeft />} label="Total cobrado" value={money(rows.reduce((total, row) => total + Number(row.amount), 0))} tone="green" />
      <Metric icon={<Clock3 />} label="Ventas por cobrar" value={sales.filter((sale) => sale.status === "pending").length} tone="amber" />
    </div>
    {notice && <p className={"op-notice " + (noticeError ? "error" : "")} role="status">{notice}</p>}
    {canEdit && <form className="op-form" onSubmit={saveSalePayment}>
      <h2>Registrar pago o abono de venta</h2>
      <div className="op-form-grid">
        <label className="wide">Venta
          <select style={field} value={form.sale_id} onChange={(event) => setForm({ ...form, sale_id: event.target.value })} required>
            <option value="">Selecciona una venta</option>
            {sales.filter((sale) => sale.status === "pending").map((sale) => <option value={sale.id} key={sale.id}>{sale.client_name} · {sale.service} · {money(sale.amount)}</option>)}
          </select>
        </label>
        {selectedSale && <p className="op-balance wide">Saldo de la venta: <strong>{money(saleBalance)}</strong></p>}
        <label>Importe recibido<input type="number" min="0.01" max={saleBalance ?? undefined} step="0.01" style={field} value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} required /></label>
        <label>Método<select style={field} value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })}><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="otro">Otro</option></select></label>
        <label>Fecha de pago<input type="date" style={field} value={form.paid_at} onChange={(event) => setForm({ ...form, paid_at: event.target.value })} required /></label>
        <label>Referencia (opcional)<input style={field} maxLength="120" value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} /></label>
        <label className="wide">Notas<input style={field} maxLength="300" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
      </div>
      <button className="op-button" disabled={saving || !sales.some((sale) => sale.status === "pending")}>{saving ? "Guardando…" : "Guardar pago"}</button>
      {!sales.some((sale) => sale.status === "pending") && <small className="op-hint">No hay ventas pendientes por cobrar.</small>}
    </form>}
    <section className="op-table-card procedure-supplier-section">
      <header><div><h2>Ganancia de trámites</h2><p>Ganancia acumulada a partir de los pagos recibidos y los costos pagados a proveedores.</p></div></header>
      <div className="op-stats">
        <Metric icon={<ArrowDownLeft />} label="Cobrado por trámites" value={money(procedureRevenue)} tone="green" />
        <Metric icon={<Truck />} label="Pagado a proveedores" value={money(supplierTotal)} tone="amber" />
        <Metric icon={<CircleDollarSign />} label="Ganancia neta acumulada" value={money(procedureProfit)} tone={procedureProfit >= 0 ? "green" : "red"} />
      </div>
      {canEdit && <form className="op-form procedure-supplier-form" onSubmit={saveSupplierPayment}>
        <h2>Registrar pago a proveedor de trámite</h2>
        <div className="op-form-grid">
          <label className="wide">Trámite y cliente
            <select style={field} value={supplierForm.procedure_order_id} onChange={(event) => setSupplierForm({ ...supplierForm, procedure_order_id: event.target.value })} required>
              <option value="">Selecciona un trámite</option>
              {procedureOrders.map((order) => <option value={order.procedure_order_id} key={order.procedure_order_id}>{order.client_name} · {order.procedure_name} · pedido {new Date(String(order.order_date) + "T12:00:00").toLocaleDateString("es-MX")}</option>)}
            </select>
          </label>
          <label>Proveedor registrado (opcional)
            <select style={field} value={supplierForm.supplier_id} onChange={(event) => {
              const supplier = suppliers.find((item) => item.supplier_id === event.target.value);
              setSupplierForm({ ...supplierForm, supplier_id: event.target.value, supplier_name: supplier?.name || supplierForm.supplier_name });
            }}>
              <option value="">Capturar nombre manualmente</option>
              {suppliers.filter((supplier) => supplier.active).map((supplier) => <option value={supplier.supplier_id} key={supplier.supplier_id}>{supplier.name}</option>)}
            </select>
          </label>
          <label>Nombre del proveedor
            <input style={field} maxLength="120" value={supplierForm.supplier_name} onChange={(event) => setSupplierForm({ ...supplierForm, supplier_name: event.target.value })} required />
          </label>
          <label>Importe pagado<input type="number" min="0.01" step="0.01" style={field} value={supplierForm.amount} onChange={(event) => setSupplierForm({ ...supplierForm, amount: event.target.value })} required /></label>
          <label>Método<select style={field} value={supplierForm.method} onChange={(event) => setSupplierForm({ ...supplierForm, method: event.target.value })}><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="otro">Otro</option></select></label>
          <label>Fecha de pago<input type="date" style={field} value={supplierForm.paid_at} onChange={(event) => setSupplierForm({ ...supplierForm, paid_at: event.target.value })} required /></label>
          <label>Referencia (opcional)<input style={field} maxLength="120" value={supplierForm.reference} onChange={(event) => setSupplierForm({ ...supplierForm, reference: event.target.value })} /></label>
          <label className="wide">Notas<input style={field} maxLength="300" value={supplierForm.notes} onChange={(event) => setSupplierForm({ ...supplierForm, notes: event.target.value })} /></label>
          {selectedOrder && <p className="op-balance wide">Trámite: {money(selectedOrder.amount)} · cobrado: {money(selectedOrderRevenue)} · costos de proveedor: {money(selectedOrderCosts)} · ganancia actual: <strong>{money(selectedOrderRevenue - selectedOrderCosts)}</strong></p>}
        </div>
        <button className="op-button" disabled={saving || !procedureOrders.length}>{saving ? "Guardando…" : "Guardar pago al proveedor"}</button>
        {!procedureOrders.length && <small className="op-hint">Agrega primero un pedido de trámite en la ficha de un cliente.</small>}
      </form>}
    </section>
    <DataTable title="Historial de pagos a proveedores de trámites" search={query} setSearch={setQuery} loading={loading} empty="Aún no hay pagos a proveedores de trámites." hasRows={supplierHistory.length > 0}>
      <table><thead><tr><th>Fecha</th><th>Trámite / cliente</th><th>Proveedor</th><th>Pago</th><th>Cobrado al cliente</th><th>Ganancia neta actual</th></tr></thead>
        <tbody>{supplierHistory.map((payment) => {
          const order = orderById.get(payment.procedure_order_id);
          const received = revenueByOrder.get(payment.procedure_order_id) || 0;
          const costs = costByOrder.get(payment.procedure_order_id) || 0;
          return <tr key={payment.id}>
            <td>{new Date(String(payment.paid_at) + "T12:00:00").toLocaleDateString("es-MX")}</td>
            <td><strong>{order?.procedure_name || "Trámite"}</strong><small>{order?.client_name || "Cliente"}</small></td>
            <td>{payment.supplier_name}</td>
            <td><strong>{money(payment.amount)}</strong><small>{payment.method}</small></td>
            <td>{money(received)}</td>
            <td><strong>{money(received - costs)}</strong></td>
          </tr>;
        })}</tbody>
      </table>
    </DataTable>
    <DataTable title="Historial de cobros de clientes" search={query} setSearch={setQuery} loading={loading} empty="Aún no hay pagos registrados." hasRows={visiblePayments.length > 0}>
      <table><thead><tr><th>Fecha</th><th>Venta / cliente</th><th>Método</th><th>Referencia</th><th>Importe</th></tr></thead>
        <tbody>{visiblePayments.map((payment) => <tr key={payment.id}>
          <td>{new Date(String(payment.paid_at) + "T12:00:00").toLocaleDateString("es-MX")}</td>
          <td>{paymentNames.get(payment.sale_id) || "Venta"}</td>
          <td>{payment.method}</td><td>{payment.reference || "—"}</td><td><strong>{money(payment.amount)}</strong></td>
        </tr>)}</tbody>
      </table>
    </DataTable>
  </ModuleShell>;
}
export function Accounts({ canEdit, canNotifyClients = false }) {
  const [rows,setRows]=useState([]),[assignments,setAssignments]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(""),[query,setQuery]=useState("");
  const refresh=useCallback(async()=>{
    setLoading(true);
    const clientFields=canNotifyClients?"full_name,phone":"full_name";
    const [a,b,u]=await Promise.all([
      supabase.from("inventario_cuentas").select("id,service,account_label,provider,purchase_date,duration,unit,customers,cost,created_at,profile_capacity,inventory_operational_status").order("service"),
      supabase.from("client_account_assignments").select("id,client_id,inventory_account_id,profile_name,delivery_type,starts_on,expires_on,assignment_status,client:clients!client_account_assignments_client_id_fkey(" + clientFields + ")").order("expires_on"),
      supabase.rpc("inventory_account_display_users")
    ]);
    const usernames=new Map((u.data||[]).map(item=>[item.inventory_account_id,item.account_username||""]));
    if(a.error)setError(a.error.message);else{setRows((a.data||[]).map(row=>({...row,account_username:usernames.get(row.id)||""})));setError("");}
    if(b.error)setError(b.error.message);else setAssignments(b.data||[]);
    if(u.error)setError(u.error.message);
    setLoading(false);
  },[canNotifyClients]);
  useEffect(()=>{queueMicrotask(()=>void refresh());},[refresh]);
  const dateNumber=(value)=>{const [year,month,day]=String(value||"").slice(0,10).split("-").map(Number);return Date.UTC(year,month-1,day);};
  const daysFromToday=(value)=>Math.round((dateNumber(value)-dateNumber(today()))/86400000);
  const displayDate=(value)=>new Date(value+"T12:00:00").toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"});
  const result=rows.map(row=>{const end=new Date(row.purchase_date+"T12:00:00");end.setDate(end.getDate()+28);const days=Math.ceil((end-new Date(today()+"T12:00:00"))/86400000);return {...row,expires:end.toISOString().slice(0,10),days};});
  const visible=result.map(r=>{const profiles=assignments.filter(a=>a.inventory_account_id===r.id),active=profiles.filter(a=>a.assignment_status!=="replaced"&&a.starts_on<=today()&&a.expires_on>=today()),profileCount=active.filter(a=>a.delivery_type!=="full_account").length+(r.customers||[]).length,full=active.some(a=>a.delivery_type==="full_account"),capacity=r.profile_capacity||5;return {...r,profiles,profileCount,availableProfiles:full||r.inventory_operational_status!=="available"?0:Math.max(0,capacity-profileCount),accountStatus:r.inventory_operational_status==="reported"?"reported":r.inventory_operational_status==="replaced"?"replaced":full||profileCount>=capacity?"occupied":"available"};}).filter(r=>[r.service,r.account_label,r.account_username,r.provider,(r.customers||[]).join(" "),r.profiles.map(a=>(a.client?.full_name||"")+" "+a.profile_name).join(" ")].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  const serviceByAccount=new Map(rows.map(row=>[row.id,row.service]));
  const usernameByAccount=new Map(rows.map(row=>[row.id,row.account_username]));
  const renewalRows=canNotifyClients?assignments.filter(assignment=>{
    if(assignment.assignment_status!=="active"||!assignment.expires_on||daysFromToday(assignment.expires_on)>7)return false;
    const service=serviceByAccount.get(assignment.inventory_account_id);
    const profile=String(assignment.profile_name||"").trim().toLocaleLowerCase("es-MX");
    const renewed=assignments.some(later=>later.id!==assignment.id&&later.client_id===assignment.client_id&&later.assignment_status==="active"&&later.starts_on>assignment.starts_on&&serviceByAccount.get(later.inventory_account_id)===service&&later.delivery_type===assignment.delivery_type&&String(later.profile_name||"").trim().toLocaleLowerCase("es-MX")===profile);
    return !renewed;
  }).map(assignment=>({...assignment,service:serviceByAccount.get(assignment.inventory_account_id)||"Cuenta",account_username:usernameByAccount.get(assignment.inventory_account_id)||"",daysLeft:daysFromToday(assignment.expires_on)})).sort((a,b)=>a.expires_on.localeCompare(b.expires_on)):[];
  const renewalGroups=Array.from(renewalRows.reduce((groups,assignment)=>{
    const key=assignment.client_id;
    if(!groups.has(key))groups.set(key,{id:key,name:assignment.client?.full_name||"Cliente",phone:assignment.client?.phone||"",items:[]});
    groups.get(key).items.push(assignment);
    return groups;
  },new Map()).values());
  const whatsappLink=(group)=>{
    let digits=normalizePhone(group.phone);
    if(digits.length===10)digits="52"+digits;
    if(digits.startsWith("521")&&digits.length===13)digits="52"+digits.slice(3);
    if(digits.length<11||digits.length>15)return "";
    const items=group.items.map(item=>{
      const access=item.delivery_type==="full_account"?"Cuenta completa":("Perfil "+(item.profile_name||"")).trim();
      const expiry=item.daysLeft<0?"venció el "+displayDate(item.expires_on):item.daysLeft===0?"vence hoy":"vence el "+displayDate(item.expires_on);
      return "• "+item.service+" · "+(item.account_username||"Usuario no guardado")+" · "+access+" — "+expiry;
    }).join("\n");
    const message="Hola "+group.name+", ¿cómo estás? Quería preguntarte si deseas renovar estos accesos:\n"+items+"\n\nAvísame cuáles te gustaría renovar. ¡Gracias!";
    return "https://wa.me/"+digits+"?text="+encodeURIComponent(message);
  };
  return <ModuleShell eyebrow="SERVICIOS Y ACCESOS" title="Cuentas" subtitle="Vista rápida de las cuentas registradas, sus clientes y próximos vencimientos." icon={<CreditCard/>} action={canEdit?<><Link className="op-button secondary" to="/inventario"><Plus size={17}/> Agregar por lote</Link><Link className="op-button" to="/inventario"><Boxes size={17}/> Gestionar inventario</Link></>:null}>
    <div className="op-stats"><Metric icon={<CreditCard/>} label="Cuentas" value={rows.length}/><Metric icon={<Check/>} label="Vigentes" value={result.filter(r=>r.days>7).length} tone="green"/><Metric icon={<Clock3/>} label="Vencen en 7 días" value={result.filter(r=>r.days>=0&&r.days<=7).length} tone="amber"/><Metric icon={<AlertTriangle/>} label="Vencidas" value={result.filter(r=>r.days<0).length} tone="red"/></div>
    {error&&<p className="op-notice error">{error}</p>}
    {canNotifyClients&&<section className="renewal-client-list"><header><div><h2>Renovaciones por WhatsApp</h2><p>Clientes con accesos que vencen en los próximos 7 días o ya vencieron.</p></div><span className="renewal-count">{renewalRows.length}</span></header>{loading?<p className="op-empty">Cargando recordatorios…</p>:renewalGroups.length?<div className="renewal-groups">{renewalGroups.map(group=>{const link=whatsappLink(group);return <article className="renewal-client-row" key={group.id}><div className="renewal-client-main"><strong>{group.name}</strong><small>{group.phone||"Sin teléfono registrado"} · {group.items.length} acceso(s)</small><ul>{group.items.map(item=><li key={item.id}><span>{item.service} · {item.account_username||"Usuario no guardado"} · {item.delivery_type==="full_account"?"Cuenta completa":("Perfil "+(item.profile_name||"")).trim()}</span><small>{item.daysLeft<0?"Venció el "+displayDate(item.expires_on):item.daysLeft===0?"Vence hoy":"Vence el "+displayDate(item.expires_on)}</small></li>)}</ul></div><div className="renewal-client-action">{link?<a className="op-button" href={link} target="_blank" rel="noreferrer"><MessageCircle size={17}/> Enviar por WhatsApp</a>:<span className="phone-missing">Agrega un WhatsApp válido al cliente</span>}</div></article>;})}</div>:<p className="op-empty">No hay accesos próximos a vencer ni vencidos pendientes de renovación.</p>}<p className="renewal-note">Se abre WhatsApp con el mensaje listo para revisar. Solo se envía cuando confirmes desde WhatsApp.</p></section>}
    <DataTable title="Cuentas y perfiles" search={query} setSearch={setQuery} loading={loading} empty="No hay cuentas registradas. Agrega una desde Inventario." hasRows={visible.length > 0}><table><thead><tr><th>Servicio / usuario</th><th>Proveedor</th><th>Perfiles libres</th><th>Clientes / perfiles</th><th>Vence</th><th>Estado</th></tr></thead><tbody>{visible.map(r=><tr key={r.id}><td><strong>{r.service}</strong><small>{r.account_username||"Usuario no guardado"}</small></td><td>{r.provider}</td><td>{r.availableProfiles} / {r.profile_capacity||5}</td><td>{r.profiles.length?r.profiles.map(a=>(a.client?.full_name||"Cliente")+" · "+(a.delivery_type==="full_account"?"Cuenta completa":a.profile_name)+(a.assignment_status==="replaced"?" (reemplazada)":"")).join(", "):(r.customers||[]).length?(r.customers||[]).join(", "):"Sin asignar"}</td><td>{new Date(r.expires+"T12:00:00").toLocaleDateString("es-MX")}</td><td><Status value={r.days<0?"expired":r.days<=7?"soon":r.accountStatus}/></td></tr>)}</tbody></table></DataTable>
  </ModuleShell>;
}
function ModuleShell({eyebrow,title,subtitle,icon,action,children}) { return <main className="op-page"><header className="op-heading"><div><p className="op-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{subtitle}</p></div><div className="op-heading-icon">{icon}</div>{action&&<div className="op-heading-action">{action}</div>}</header>{children}</main>; }
function Metric({icon,label,value,tone="blue"}) {return <article className={`op-metric ${tone}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></article>;}
function DataTable({title,search,setSearch,loading,empty,hasRows,children}) {return <section className="op-table-card"><header><h2>{title}</h2><label className="op-search"><Search size={16}/><input placeholder="Buscar…" aria-label={`Buscar en ${title}`} value={search} onChange={e=>setSearch(e.target.value)}/></label></header>{loading?<p className="op-empty">Cargando…</p>:<div className="op-table-wrap">{children}{!hasRows&&<p className="op-empty">{empty}</p>}</div>}</section>;}
function Status({value}) {const label={pending:"Por cobrar",paid:"Pagada",cancelled:"Cancelada",active:"Vigente",soon:"Por vencer",expired:"Vencida",available:"Disponible",occupied:"Ocupada",reported:"Reportada",replaced:"Reemplazada"}[value]||value;return <span className={`op-status ${value}`}>{label}</span>;}
