import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { 
  LayoutDashboard, 
  Camera, 
  SquareFunction, 
  Settings, 
  Clock,
  Bell, 
  TrendingUp, 
  Database,
  User,
  Printer
} from "lucide-react";
import logoPath from "@assets/Blue_and_white_bogo_1767655508883.jpg";

const navigation = [
  {
    name: "ダッシュボード",
    href: "/",
    icon: LayoutDashboard,
    id: "dashboard",
  },
  {
    name: "テンプレート設計",
    href: "/slot-drawing", 
    icon: SquareFunction,
    id: "template-design",
  },
  {
    name: "印刷プレビュー",
    href: "/template-print",
    icon: Printer,
    id: "print-preview",
  },
  {
    name: "キャリブレーション", 
    href: "/calibration",
    icon: Camera,
    id: "calibration",
  },
  {
    name: "設定",
    href: "/configuration",
    icon: Settings,
    id: "configuration",
  },
  {
    name: "スケジューラー",
    href: "/scheduler",
    icon: Clock,
    id: "scheduler",
  },
  {
    name: "アラート",
    href: "/alerts",
    icon: Bell,
    badge: 3,
    id: "alerts",
  },
  {
    name: "分析",
    href: "/analytics", 
    icon: TrendingUp,
    id: "analytics",
  },
  {
    name: "検出ログ",
    href: "/detection-logs",
    icon: Database,
    id: "detection-logs",
  },
  {
    name: "作業者",
    href: "/workers",
    icon: User,
    id: "workers",
  },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex flex-col items-center gap-2">
          <img 
            src={logoPath} 
            alt="Fashion Service Naniwa" 
            className="h-8 object-contain"
            data-testid="img-app-logo"
          />
          <h1 className="font-bold text-foreground text-[20px]" data-testid="text-app-title">TanaCheck</h1>
        </div>
      </div>
      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navigation.map((item) => {
          const isActive = location === item.href;
          const Icon = item.icon;
          
          return (
            <Link key={item.id} href={item.href}>
              <div
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors",
                  isActive 
                    ? "bg-primary text-primary-foreground" 
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
                data-testid={`nav-${item.id}`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.name}</span>
                {item.badge && (
                  <Badge 
                    className="ml-auto bg-destructive text-destructive-foreground text-xs px-2 py-1 rounded-full alert-badge"
                    data-testid={`badge-${item.id}`}
                  >
                    {item.badge}
                  </Badge>
                )}
              </div>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
