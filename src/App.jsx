import { BrowserRouter, Route, Routes } from "react-router-dom";
import Storefront from "./modules/storefront/Storefront.jsx";
import AdminApp from "./AdminApp.jsx";
import { ConfirmDialogProvider } from "./modules/storefront/common/ConfirmDialog.jsx";

export default function App() {
  return (
    <ConfirmDialogProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/admin/*" element={<AdminApp />} />
          <Route path="*" element={<Storefront />} />
        </Routes>
      </BrowserRouter>
    </ConfirmDialogProvider>
  );
}
