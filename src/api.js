const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

let token = localStorage.getItem("tracalinge_token") || null;

export function setToken(t) {
  token = t;
  if (t) localStorage.setItem("tracalinge_token", t);
  else localStorage.removeItem("tracalinge_token");
}
export function getToken() {
  return token;
}

function qs(params) {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

async function request(path, opts = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let message = res.statusText;
    try { message = (await res.json()).error || message; } catch { /* réponse non JSON */ }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  apiUrl: API_URL,
  staffLogin: (email, password) => request("/api/auth/staff/login", { method: "POST", body: { email, password } }),
  portalLogin: (email, password) => request("/api/auth/portal/login", { method: "POST", body: { email, password } }),

  getClients: () => request("/api/clients"),
  addClient: (body) => request("/api/clients", { method: "POST", body }),
  resetClientPassword: (id) => request(`/api/clients/${id}/reset-password`, { method: "POST" }),

  getLinenTypes: () => request("/api/linen-types"),

  scanReception: (body) => request("/api/scan/reception", { method: "POST", body }),
  scanCheck: (body) => request("/api/scan/check", { method: "POST", body }),

  getDeliveryNotes: (params) => request(`/api/delivery-notes${qs(params)}`),
  createDeliveryNote: (body) => request("/api/delivery-notes", { method: "POST", body }),
  sendDeliveryNote: (id) => request(`/api/delivery-notes/${id}/send`, { method: "POST" }),
  removeDeliveryNoteItem: (id, tag) => request(`/api/delivery-notes/${id}/remove-item`, { method: "PATCH", body: { tag } }),
  deleteDeliveryNote: (id) => request(`/api/delivery-notes/${id}`, { method: "DELETE" }),

  getInvoices: (params) => request(`/api/invoices${qs(params)}`),
  createInvoice: (body) => request("/api/invoices", { method: "POST", body }),

  getItems: (params) => request(`/api/items${qs(params)}`),
  getOverdue: (days) => request(`/api/items/overdue${qs({ days })}`),
  declareLost: (tag) => request(`/api/items/${tag}/declare-lost`, { method: "POST" }),

  getSettings: () => request("/api/settings"),
  patchSettings: (body) => request("/api/settings", { method: "PATCH", body }),

  portalNotes: () => request("/api/portal/delivery-notes"),
  portalInvoices: () => request("/api/portal/invoices"),
  portalLinenTypes: () => request("/api/portal/linen-types"),
  portalSettings: () => request("/api/portal/settings"),
};
