import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import Calibration from "@/pages/calibration";
import SlotDrawing from "@/pages/slot-drawing";
import Configuration from "@/pages/configuration";
import Alerts from "@/pages/alerts";
import Analytics from "@/pages/analytics";
import DetectionLogs from "@/pages/detection-logs";
import TemplatePrint from "@/pages/template-print";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/calibration" component={Calibration} />
      <Route path="/slot-drawing" component={SlotDrawing} />
      <Route path="/template-print" component={TemplatePrint} />
      <Route path="/configuration" component={Configuration} />
      <Route path="/alerts" component={Alerts} />
      <Route path="/analytics" component={Analytics} />
      <Route path="/detection-logs" component={DetectionLogs} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div>
          <Router />
          <Toaster />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
