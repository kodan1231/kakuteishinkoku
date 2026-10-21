import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth } from "./components/RequireAuth";
import "./index.css";
import { Admin } from "./pages/Admin";
import { AuthCallback } from "./pages/AuthCallback";
import { Home } from "./pages/Home";
import { Invite } from "./pages/Invite";
import { Login } from "./pages/Login";
import { OcrLab } from "./pages/OcrLab";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/invite/:token" element={<Invite />} />
          <Route path="/lab/ocr" element={<OcrLab />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Home />
              </RequireAuth>
            }
          />
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
