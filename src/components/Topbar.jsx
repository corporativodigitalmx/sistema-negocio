import { Bell, Moon } from "lucide-react";
import "./Topbar.css";

export default function Topbar({ user }) {
  const initials = user?.email?.substring(0, 2).toUpperCase() || "US";

  return (
    <div className="topbar">

      {/* BUSCADOR */}
      <div className="search-box">
        <input placeholder="Buscar clientes, cuentas, ventas..." />
      </div>

      {/* DERECHA */}
      <div className="topbar-right">

        {/* NOTIFICACIONES */}
        <div className="icon-btn">
          <Bell size={20} />
          <span className="badge"></span>
        </div>

        {/* MODO */}
        <div className="icon-btn">
          <Moon size={20} />
        </div>

        {/* USUARIO */}
        <div className="user-box">
          <div className="avatar">{initials}</div>

          <div className="user-info">
            <span className="name">David Espinoza</span>
            <span className="role">Administrador</span>
          </div>
        </div>

      </div>
    </div>
  );
}
