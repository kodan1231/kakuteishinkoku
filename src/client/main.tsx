import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Outlet, Route, Routes } from "react-router";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth } from "./components/RequireAuth";
import { RequireLedger } from "./components/RequireLedger";
import { LedgerProvider } from "./drive/LedgerProvider";
import "./index.css";
import { Admin } from "./pages/Admin";
import { AuthCallback } from "./pages/AuthCallback";
import { FamilySettings } from "./pages/FamilySettings";
import { Home } from "./pages/Home";
import { Invite } from "./pages/Invite";
import { Login } from "./pages/Login";
import { OcrLab } from "./pages/OcrLab";
import { Privacy } from "./pages/Privacy";
import { RecordEdit } from "./pages/RecordEdit";
import { Records } from "./pages/Records";
import { Reimbursements } from "./pages/Reimbursements";
import { Settings } from "./pages/Settings";
import { Setup } from "./pages/Setup";
import { Terms } from "./pages/Terms";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/invite/:token" element={<Invite />} />
          <Route path="/lab/ocr" element={<OcrLab />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route
            element={
              <RequireAuth>
                <LedgerProvider>
                  <Outlet />
                </LedgerProvider>
              </RequireAuth>
            }
          >
            <Route path="/setup" element={<Setup />} />
            <Route element={<RequireLedger />}>
              <Route path="/" element={<Home />} />
              <Route path="/records" element={<Records />} />
              <Route path="/records/new" element={<RecordEdit />} />
              <Route path="/records/:id" element={<RecordEdit />} />
              <Route path="/reimbursements" element={<Reimbursements />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/family" element={<FamilySettings />} />
            </Route>
          </Route>
          <Route
            path="/admin"
            element={
              <RequireAuth admin>
                <Admin />
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
