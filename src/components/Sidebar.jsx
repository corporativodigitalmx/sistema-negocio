import { NavLink } from "react-router-dom";
import { LayoutDashboard, Users, CreditCard, ShoppingCart, Wallet, Truck, Boxes, ClipboardList, ShieldCheck, BarChart3, Headphones, Settings } from "lucide-react";
import "./Sidebar.css";
export default function Sidebar({access}) { const admin=access?.role==="superadmin"; const can=key=>admin||Boolean(access?.permissions?.[key]||(key==="clients_view"&&(access?.permissions?.clients_edit||access?.permissions?.clients_all))||(key==="inventory_view"&&access?.permissions?.inventory_all)||(key==="tasks_view"&&access?.permissions?.tasks_manage)||(key==="accounts_view"&&access?.permissions?.accounts_edit)||(key==="sales_view"&&access?.permissions?.sales_edit)||(key==="payments_view"&&access?.permissions?.payments_edit)||(key==="suppliers_view"&&access?.permissions?.suppliers_edit)||(key==="support_view"&&access?.permissions?.support_manage)); return <div className="sidebar"><div className="logo"><h2>CD</h2><p>Corporativo Digital MX</p></div><nav className="menu">
{can("dashboard_view")&&<NavItem to="/" icon={<LayoutDashboard/>} label="Dashboard"/>}
{can("clients_view")&&<NavItem to="/clientes" icon={<Users/>} label="Clientes"/>}
{can("accounts_view")&&<NavItem to="/cuentas" icon={<CreditCard/>} label="Cuentas"/>}
{can("sales_view")&&<NavItem to="/ventas" icon={<ShoppingCart/>} label="Ventas"/>}
{can("payments_view")&&<NavItem to="/pagos" icon={<Wallet/>} label="Pagos"/>}
{can("suppliers_view")&&<NavItem to="/proveedores" icon={<Truck/>} label="Proveedores"/>}
{can("inventory_view")&&<NavItem to="/inventario" icon={<Boxes/>} label="Inventario"/>}
{can("reports_view")&&<NavItem to="/reportes" icon={<BarChart3/>} label="Reportes"/>}
{can("support_view")&&<NavItem to="/soporte" icon={<Headphones/>} label="Soporte"/>}
{can("settings_view")&&<NavItem to="/configuracion" icon={<Settings/>} label="Configuración"/>}

{can("tasks_view")&&<NavItem to="/tareas" icon={<ClipboardList/>} label="Tareas"/>}
{admin&&<NavItem to="/administracion" icon={<ShieldCheck/>} label="Administración"/>}

</nav></div> }
function NavItem({to,icon,label}) { return <NavLink to={to} className="nav-item" title={label} aria-label={label}>{icon}<span>{label}</span></NavLink> }
