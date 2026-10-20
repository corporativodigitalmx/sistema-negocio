import { LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./Topbar.css";
export default function Topbar({ user }) {
  const navigate=useNavigate();
  const name=user?.user_metadata?.full_name||user?.email?.split("@")[0]||"Usuario";
  const initials=name.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();
  async function logout(){await supabase.auth.signOut();navigate("/",{replace:true});}
  return <header className="topbar"><div className="topbar-label">Sistema de gestión</div><div className="topbar-right"><div className="user-box"><div className="avatar">{initials}</div><div className="user-info"><span className="name">{name}</span><span className="role">{user?.email}</span></div></div><button className="logout-button" type="button" onClick={logout}><LogOut size={17}/> Cerrar sesión</button></div></header>;
}
