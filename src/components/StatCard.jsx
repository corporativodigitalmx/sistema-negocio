import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import "./cards.css";

export default function StatCard({ title, value, change, positive, icon }) {
  return (
    <div className="stat-card">

      <div className="stat-top">
        <div className="icon-box">{icon}</div>

        <div className={`change ${positive ? "up" : "down"}`}>
          {positive ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
          {change}
        </div>
      </div>

      <h4>{title}</h4>
      <h2>{value}</h2>

    </div>
  );
}