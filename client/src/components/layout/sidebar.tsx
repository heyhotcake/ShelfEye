import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { 
  LayoutDashboard, 
  Camera, 
  SquareFunction, 
  Settings, 
  QrCode, 
  Bell, 
  TrendingUp, 
  Database,
  Bolt,
  LogOut,
  User
} from "lucide-react";

const navigation = [
  {
    name: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
  },
  {
    name: "Calibration", 
    href: "/calibration",
    icon: Camera,
  },
  {
    name: "Slot Drawing",
    href: "/slot-drawing", 
    icon: SquareFunction,
  },
  {
    name: "Configuration",
    href: "/configuration",
    icon: Settings,
  },
  {
    name: "QR Generator",
    href: "/qr-generator",
    icon: QrCode,
  },
  {
    name: "Alerts",
    href: "/alerts",
    icon: Bell,
    badge: 3,
  },
  {
    name: "Analytics",
    href: "/analytics", 
    icon: TrendingUp,
  },
  {
    name: "Detection Logs",
    href: "/detection-logs",
    icon: Database,
  },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
            <Bolt className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground" data-testid="text-app-title">Tool Tracker</h1>
            <p className="text-xs text-muted-foreground">v2.1.0</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navigation.map((item) => {
          const isActive = location === item.href;
          const Icon = item.icon;
          
          return (
            <Link key={item.name} href={item.href}>
              <div
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors",
                  isActive 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
                data-testid={`nav-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.name}</span>
                {item.badge && (
                  <Badge 
                    className="ml-auto bg-destructive text-destructive-foreground text-xs px-2 py-1 rounded-full alert-badge"
                    data-testid={`badge-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {item.badge}
                  </Badge>
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* User Section */}
      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
            <User className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground" data-testid="text-user-name">Admin User</p>
            <p className="text-xs text-muted-foreground">admin@factory.com</p>
          </div>
          <button 
            className="text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
