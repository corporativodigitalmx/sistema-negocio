import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, RefreshCw, Users, CreditCard, Boxes, CircleDollarSign, CalendarDays } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./Operational.css";

const money = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(n || 0));
const formatDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateOnly = (offset = 0, base = new Date()) => { const date = new Date(base); date.setDate(date.getDate() + offset); return formatDate(date); };
const readableDate = (date) => new Date(`${date}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
const sumSales = (sales, start, end) => sales.filter(sale => sale.sale_date >= start && sale.sale_date <= end && sale.status !== "cancelled").reduce((total, sale) => total + Number(sale.amount || 0), 0);
const accountCostsForSales = (sales, accountsById) => {
  const allocations = sales.map(sale => {
    const account = sale.inventory_account_id ? accountsById.get(sale.inventory_account_id) : null;
    const deliveryType = sale.delivery_type || (String(sale.profile_name || "").trim().toLocaleLowerCase("es-MX") === "cuenta completa" ? "full_account" : "profile");
    const accountCost = account?.cost == null || account.cost === "" ? null : Number(account.cost);
    const capacity = Number(account?.profile_capacity);
    const validCost = Number.isFinite(accountCost) && accountCost >= 0;
    const validCapacity = Number.isInteger(capacity) && capacity > 0;
    const allocatedCost = validCost && account && deliveryType === "full_account" ? accountCost :
      validCost && account && deliveryType === "profile" && validCapacity ? accountCost / capacity : null;
    return { sale, allocatedCost };
  });
  return {
    total: allocations.reduce((total, item) => total + (item.allocatedCost ?? 0), 0),
    missingCount: new Set(allocations.filter(item => item.allocatedCost == null).map(({ sale }) => sale.inventory_account_id || `sale:${sale.id}`)).size,
  };
};

export default function Dashboard({ user }) {
  const [loading,setLoading]=useState(true),[error,setError]=useState(""),[data,setData]=useState({clients:[],accounts:[],sales:[],payments:[],procedureSupplierPayments:[]});
  const refresh=useCallback(async()=>{
    setLoading(true);
    const [c,a,s,p,procedureSupplierPayments]=await Promise.all([
      supabase.from("clients").select("id,full_name,created_at"),
      supabase.from("inventario_cuentas").select("id,service,account_label,purchase_date,customers,provider,cost,profile_capacity"),
      supabase.from("sales").select("id,client_name,service,amount,status,sale_date,inventory_account_id,delivery_type,profile_name").order("sale_date",{ascending:false}),
      supabase.from("payments").select("id,amount,paid_at,sale_id"),
      supabase.from("procedure_supplier_payments").select("amount,paid_at").eq("user_id",user.id),
    ]);
    const failed=[c,a,s,p,procedureSupplierPayments].find(result=>result.error);
    if(failed)setError(failed.error.message);
    else{setError("");setData({clients:c.data||[],accounts:a.data||[],sales:s.data||[],payments:p.data||[],procedureSupplierPayments:procedureSupplierPayments.data||[]});}
    setLoading(false);
  },[user.id]);
  useEffect(()=>{queueMicrotask(()=>void refresh());},[refresh]);

  const today=dateOnly();
  const currentDate=new Date();
  const daysSinceMonday=(currentDate.getDay()+6)%7;
  const weekStart=dateOnly(-daysSinceMonday);
  const weekEnd=dateOnly(6-daysSinceMonday);
  const monthStart=`${today.slice(0,7)}-01`;
  const monthEnd=dateOnly(-1,new Date(currentDate.getFullYear(),currentDate.getMonth()+1,1));
  const todaySales=sumSales(data.sales,today,today);
  const weekSalesRows=data.sales.filter(sale=>sale.sale_date>=weekStart&&sale.sale_date<=weekEnd&&sale.status!=="cancelled");
  const monthSalesRows=data.sales.filter(sale=>sale.sale_date>=monthStart&&sale.sale_date<=monthEnd&&sale.status!=="cancelled");
  const weeklySales=sumSales(data.sales,weekStart,weekEnd);
  const monthlySales=sumSales(data.sales,monthStart,monthEnd);
  const accountsById=new Map(data.accounts.map(account=>[account.id,account]));
  const weeklyAccountCosts=accountCostsForSales(weekSalesRows,accountsById);
  const monthlyAccountCosts=accountCostsForSales(monthSalesRows,accountsById);
  const weeklyProcedureSupplierCost=data.procedureSupplierPayments.filter(payment=>payment.paid_at>=weekStart&&payment.paid_at<=weekEnd).reduce((total,payment)=>total+Number(payment.amount||0),0);
  const monthlyProcedureSupplierCost=data.procedureSupplierPayments.filter(payment=>payment.paid_at>=monthStart&&payment.paid_at<=monthEnd).reduce((total,payment)=>total+Number(payment.amount||0),0);
  const weeklyProfit=weeklySales-weeklyAccountCosts.total-weeklyProcedureSupplierCost;
  const monthlyProfit=monthlySales-monthlyAccountCosts.total-monthlyProcedureSupplierCost;
  const paidBySale=new Map(data.payments.reduce((acc,p)=>{acc.set(p.sale_id,(acc.get(p.sale_id)||0)+Number(p.amount));return acc;},new Map()));
  const outstanding=data.sales.filter(s=>s.status==="pending").reduce((a,s)=>a+Math.max(0,Number(s.amount)-(paidBySale.get(s.id)||0)),0);
  const totalPaid=data.payments.reduce((a,p)=>a+Number(p.amount),0);
  const expiring=data.accounts.map(a=>{const d=new Date(`${a.purchase_date}T12:00:00`);d.setDate(d.getDate()+28);return {...a,expires:d.toISOString().slice(0,10)};}).filter(a=>a.expires>=today&&a.expires<=dateOnly(7)).sort((a,b)=>a.expires.localeCompare(b.expires));
  const title=user?.user_metadata?.full_name||user?.email?.split("@")[0]||"tu cuenta";

  return <main className="op-page dashboard-live">
    <header className="op-heading"><div><p className="op-eyebrow">RESUMEN DEL NEGOCIO</p><h1>Hola, {title}</h1><p>{new Date().toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long",year:"numeric"})} · Actividad del sistema</p></div><button type="button" className="op-button secondary" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={16}/> {loading?"Actualizando…":"Actualizar"}</button></header>
    {error&&<p className="op-notice error">No se pudieron cargar todos los indicadores: {error}</p>}
    <div className="op-stats">
      <Metric icon={<CircleDollarSign/>} label="Ventas de hoy" value={loading?"…":money(todaySales)} tone="green"/>
      <Metric icon={<ArrowUpRight/>} label="Ventas de la semana (lun-dom)" value={loading?"…":money(weeklySales)} tone="blue"/>
      <Metric icon={<CalendarDays/>} label="Ventas del mes calendario" value={loading?"…":money(monthlySales)} tone="blue"/>
      <Metric icon={<CircleDollarSign/>} label="Ganancia semanal" value={loading?"…":money(weeklyProfit)} tone={weeklyProfit>=0?"green":"red"}/>
      <Metric icon={<CalendarDays/>} label="Ganancia del mes calendario" value={loading?"…":money(monthlyProfit)} tone={monthlyProfit>=0?"green":"red"}/>
      <Metric icon={<Users/>} label="Clientes" value={loading?"…":data.clients.length}/>
      <Metric icon={<AlertTriangle/>} label="Por cobrar" value={loading?"…":money(outstanding)} tone="amber"/>
      <Metric icon={<CreditCard/>} label="Cuentas" value={loading?"…":data.accounts.length}/>
      <Metric icon={<ArrowDownLeft/>} label="Pagos registrados" value={loading?"…":money(totalPaid)} tone="blue"/>
    </div>
    {!loading&&<p className="dashboard-finance-note">Semana del {readableDate(weekStart)} al {readableDate(weekEnd)} y mes calendario del {readableDate(monthStart)} al {readableDate(monthEnd)}. En ambos periodos, la ganancia resta a cada perfil su parte del costo de la cuenta (costo dividido entre sus perfiles); si se vende la cuenta completa, resta el costo total. También resta los pagos a proveedores de trámites realizados durante cada periodo. Las ventas canceladas no se cuentan.{weeklyAccountCosts.missingCount>0&&<> Falta calcular el costo de {weeklyAccountCosts.missingCount} venta(s) o cuenta(s) de esta semana.</>}{monthlyAccountCosts.missingCount>0&&<> Falta calcular el costo de {monthlyAccountCosts.missingCount} venta(s) o cuenta(s) de este mes.</>}</p>}
    <div className="op-dashboard-grid"><section className="op-table-card"><header><h2>Ventas recientes</h2><Link to="/ventas">Ver ventas <ArrowUpRight size={14}/></Link></header>{loading?<p className="op-empty">Cargando…</p>:data.sales.length?<div className="op-table-wrap"><table><thead><tr><th>Fecha</th><th>Cliente</th><th>Servicio</th><th>Importe</th><th>Estado</th></tr></thead><tbody>{data.sales.map(s=><tr key={s.id}><td data-label="Fecha">{new Date(`${s.sale_date}T12:00:00`).toLocaleDateString("es-MX")}</td><td data-label="Cliente">{s.client_name}</td><td data-label="Servicio">{s.service}</td><td data-label="Importe">{money(s.amount)}</td><td data-label="Estado"><Status value={s.status}/></td></tr>)}</tbody></table></div>:<p className="op-empty">Todavía no hay ventas registradas. <Link to="/ventas">Registrar una venta</Link></p>}</section><section className="op-table-card"><header><h2>Cuentas por vencer</h2><Link to="/cuentas">Ver cuentas <ArrowUpRight size={14}/></Link></header>{loading?<p className="op-empty">Cargando…</p>:expiring.length?<div className="op-table-wrap"><table><thead><tr><th>Servicio</th><th>Cuenta</th><th>Vencimiento</th></tr></thead><tbody>{expiring.map(r=><tr key={r.id}><td data-label="Servicio">{r.service}</td><td data-label="Cuenta">{r.account_label}</td><td data-label="Vencimiento">{new Date(`${r.expires}T12:00:00`).toLocaleDateString("es-MX")}</td></tr>)}</tbody></table></div>:<p className="op-empty">No hay cuentas por vencer en los próximos 7 días.</p>}</section></div>
    <div className="op-quick-links"><Link to="/clientes"><Users/> Clientes</Link><Link to="/inventario"><Boxes/> Inventario</Link><Link to="/ventas"><ArrowUpRight/> Registrar ventas</Link><Link to="/pagos"><CreditCard/> Capturar pagos</Link></div>
  </main>;
}
function Metric({icon,label,value,tone="blue"}){return <article className={`op-metric ${tone}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></article>}
function Status({value}){return <span className={`op-status ${value}`}>{({pending:"Por cobrar",paid:"Pagada",cancelled:"Cancelada"})[value]||value}</span>}
