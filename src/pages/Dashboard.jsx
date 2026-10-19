import StatCard from "../components/StatCard";
import {
  DollarSign,
  Users,
  UserPlus,
  AlertTriangle,
  CreditCard
} from "lucide-react";

import "./Dashboard.css";

export default function Dashboard() {
  return (
    <div className="dashboard">

      {/* HEADER */}
      <div className="header">
        <div>
          <h1>¡Hola, David! 👋</h1>
          <p>Resumen general de tu sistema</p>
        </div>

        <div className="date-box">
          Hoy
        </div>
      </div>

      {/* 🔥 CARDS PRO */}
      <div className="cards">

        <StatCard
          title="Ventas del día"
          value="8"
          change="+12%"
          positive={true}
          icon={<CreditCard size={18} />}
        />

        <StatCard
          title="Ganancias"
          value="$2,450"
          change="+18%"
          positive={true}
          icon={<DollarSign size={18} />}
        />

        <StatCard
          title="Clientes nuevos"
          value="3"
          change="+5%"
          positive={true}
          icon={<UserPlus size={18} />}
        />

        <StatCard
          title="Clientes frecuentes"
          value="18"
          change="+10%"
          positive={true}
          icon={<Users size={18} />}
        />

        <StatCard
          title="Morosos"
          value="5"
          change="-2%"
          positive={false}
          icon={<AlertTriangle size={18} />}
        />

      </div>

      {/* 📊 GRAFICAS */}
      <div className="charts">

        <div className="chart-box">
          <h3>Ventas de la semana</h3>
          <div className="fake-chart">📊</div>
        </div>

        <div className="chart-box">
          <h3>Ganancias</h3>
          <div className="fake-chart">📈</div>
        </div>

        <div className="chart-box">
          <h3>Cuentas activas</h3>
          <div className="fake-chart">🎯</div>
        </div>

      </div>

      {/* 📱 APPS STREAMING */}
      <div className="apps">
        <AppCard name="Netflix" count="98 cuentas" />
        <AppCard name="Disney+" count="64 cuentas" />
        <AppCard name="Max" count="52 cuentas" />
        <AppCard name="Prime Video" count="40 cuentas" />
        <AppCard name="VIX" count="32 cuentas" />
        <AppCard name="Crunchyroll" count="26 cuentas" />
        <AppCard name="Spotify" count="18 cuentas" />
      </div>

      {/* 📋 TABLAS */}
      <div className="tables">

        {/* VENTAS */}
        <div className="table-box">
          <h3>Últimas ventas</h3>

          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Cliente</th>
                <th>Servicio</th>
                <th>Monto</th>
                <th>Estado</th>
              </tr>
            </thead>

            <tbody>
              <tr>
                <td>#1042</td>
                <td>Ana López</td>
                <td>Netflix</td>
                <td>$40</td>
                <td className="ok">Pagado</td>
              </tr>

              <tr>
                <td>#1043</td>
                <td>Carlos Ruiz</td>
                <td>Disney+</td>
                <td>$16</td>
                <td className="pending">Pendiente</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* VENCIMIENTOS */}
        <div className="table-box">
          <h3>Cuentas por vencer</h3>

          <table>
            <tbody>
              <tr>
                <td>Netflix</td>
                <td>05 Oct</td>
                <td className="danger">1 día</td>
              </tr>

              <tr>
                <td>Spotify</td>
                <td>06 Oct</td>
                <td className="warning">2 días</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* PROVEEDORES */}
        <div className="table-box">
          <h3>Pagos a proveedores</h3>

          <table>
            <tbody>
              <tr>
                <td>Netflix LAT</td>
                <td>$1,900</td>
                <td className="danger">Pendiente</td>
              </tr>

              <tr>
                <td>Disney Distribuidor</td>
                <td>$1,200</td>
                <td className="ok">Pagado</td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>

    </div>
  );
}

/* COMPONENTE APP */
function AppCard({ name, count }) {
  return (
    <div className="app-card">
      <h4>{name}</h4>
      <p>{count}</p>
    </div>
  );
}