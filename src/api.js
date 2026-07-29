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
  me: () => request("/api/auth/me"),

  getClients: () => request("/api/clients"),
  getClient: (id) => request(`/api/clients/${id}`),
  addClient: (body) => request("/api/clients", { method: "POST", body }),
  patchClient: (id, body) => request(`/api/clients/${id}`, { method: "PATCH", body }),
  resetClientPassword: (id) => request(`/api/clients/${id}/reset-password`, { method: "POST" }),

  getClientCategories: () => request("/api/client-categories"),
  addClientCategory: (body) => request("/api/client-categories", { method: "POST", body }),
  patchClientCategory: (id, body) => request(`/api/client-categories/${id}`, { method: "PATCH", body }),
  deleteClientCategory: (id) => request(`/api/client-categories/${id}`, { method: "DELETE" }),

  getPaymentMethods: () => request("/api/payment-methods"),
  addPaymentMethod: (body) => request("/api/payment-methods", { method: "POST", body }),
  patchPaymentMethod: (id, body) => request(`/api/payment-methods/${id}`, { method: "PATCH", body }),
  deletePaymentMethod: (id) => request(`/api/payment-methods/${id}`, { method: "DELETE" }),

  getClientLinenTypes: (clientId) => request(`/api/clients/${clientId}/linen-types`),
  setClientLinenType: (clientId, typeId, body) => request(`/api/clients/${clientId}/linen-types/${typeId}`, { method: "PUT", body }),
  resetClientLinenType: (clientId, typeId) => request(`/api/clients/${clientId}/linen-types/${typeId}`, { method: "DELETE" }),
  bulkIncreaseClientPrices: (clientId, percent) => request(`/api/clients/${clientId}/linen-types/bulk-increase`, { method: "POST", body: { percent } }),

  inviteProspect: () => request("/api/staff/prospects/invite", { method: "POST" }),
  getProspects: () => request("/api/staff/prospects"),
  approveProspect: (id) => request(`/api/staff/prospects/${id}/approve`, { method: "POST" }),
  rejectProspect: (id) => request(`/api/staff/prospects/${id}/reject`, { method: "POST" }),
  getProspectPublic: (token) => request(`/api/prospects/${token}`),
  submitProspectPublic: (token, body) => request(`/api/prospects/${token}`, { method: "POST", body }),

  getLinenTypes: () => request("/api/linen-types"),
  addLinenType: (body) => request("/api/linen-types", { method: "POST", body }),
  patchLinenType: (id, body) => request(`/api/linen-types/${id}`, { method: "PATCH", body }),
  reorderLinenTypes: (orderedIds) => request("/api/linen-types/reorder", { method: "PATCH", body: { orderedIds } }),
  deleteLinenType: (id) => request(`/api/linen-types/${id}`, { method: "DELETE" }),

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
