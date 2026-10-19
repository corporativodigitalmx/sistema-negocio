import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  ShoppingCart,
  Wallet,
  Truck,
  Boxes,
  BarChart3,
  Settings,
  Headphones
} from "lucide-react";

import "./Sidebar.css";

export default function Sidebar() {
  return (
    <div className="sidebar">

      {/* LOGO */}
      <div className="logo">
        <h2>CD</h2>
        <p>Corporativo Digital MX</p>
      </div>

      {/* MENU */}
      <nav className="menu">

        <NavItem to="/" icon={<LayoutDashboard />} label="Dashboard" />
        <NavItem to="/clientes" icon={<Users />} label="Clientes" />
        <NavItem to="/cuentas" icon={<CreditCard />} label="Cuentas" />
        <NavItem to="/ventas" icon={<ShoppingCart />} label="Ventas" />
        <NavItem to="/pagos" icon={<Wallet />} label="Pagos" />
        <NavItem to="/proveedores" icon={<Truck />} label="Proveedores" />
        <NavItem to="/inventario" icon={<Boxes />} label="Inventario" />
        <NavItem to="/reportes" icon={<BarChart3 />} label="Reportes" />
        <NavItem to="/soporte" icon={<Headphones />} label="Soporte" />
        <NavItem to="/configuracion" icon={<Settings />} label="Configuración" />

      </nav>

      {/* SOPORTE */}
      <div className="support-box">
        <p>Soporte</p>
        <span className="online">● En línea</span>
      </div>

    </div>
  );
}

function NavItem({ to, icon, label }) {
  return (
    <NavLink to={to} className="nav-item">
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}
