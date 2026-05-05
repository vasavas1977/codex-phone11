import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Dashboard from "./pages/admin/Dashboard";
import UsersPage from "./pages/admin/UsersPage";
import DIDsPage from "./pages/admin/DIDsPage";
import IVRPage from "./pages/admin/IVRPage";
import CallsPage from "./pages/admin/CallsPage";
import SystemPage from "./pages/admin/SystemPage";
import SecurityPage from "./pages/admin/SecurityPage";
import SettingsPage from "./pages/admin/SettingsPage";


function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      {/* Admin Portal Routes */}
      <Route path={"/admin"} component={Dashboard} />
      <Route path={"/admin/users"} component={UsersPage} />
      <Route path={"/admin/dids"} component={DIDsPage} />
      <Route path={"/admin/ivr"} component={IVRPage} />
      <Route path={"/admin/calls"} component={CallsPage} />
      <Route path={"/admin/system"} component={SystemPage} />
      <Route path={"/admin/security"} component={SecurityPage} />
      <Route path={"/admin/settings"} component={SettingsPage} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="dark"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
