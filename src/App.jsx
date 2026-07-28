import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  LayoutDashboard, PackageCheck, Truck, AlertTriangle, Building2, Radio, Plus, X, Check,
  Loader2, FileText, Send, Pencil, Trash2, Printer, Lock, LogOut, Eye, Receipt,
} from "lucide-react";
import { api, setToken, getToken } from "./api.js";
import { connectRealtime, onRealtime, disconnectRealtime } from "./realtime.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function genTag() {
  const chars = "0123456789ABCDEF";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return "RFID-" + s;
}
function fmtEUR(n) { return (n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }); }
function fmtTime(ts) { return new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function fmtDate(ts) { return new Date(ts).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }); }
function daysSince(ts) { return Math.floor((Date.now() - ts) / 86400000); }
function uid() { return Math.random().toString(36).slice(2, 10); }
function addDays(ts, days) { return ts + days * 86400000; }
function noteTotal(note, typeById) { return note.items.reduce((s, it) => s + typeById(it.typeId).price, 0); }
function aggregateLines(notes, typeById) {
  const map = new Map();
  notes.forEach((n) => n.items.forEach((it) => {
    const t = typeById(it.typeId);
    const cur = map.get(t.id) || { typeId: t.id, name: t.name, unitPrice: t.price, qty: 0 };
    cur.qty += 1;
    map.set(t.id, cur);
  }));
  return [...map.values()].map((l) => ({ ...l, totalHT: l.qty * l.unitPrice }));
}

/* ------------------------------------------------------------------ */
/*  Normalisation (le backend renvoie du snake_case / SQLite TEXT)      */
/* ------------------------------------------------------------------ */

function normItem(i) {
  return { tag: i.tag, clientId: i.client_id, typeId: i.type_id, status: i.status, receivedAt: i.received_at, shippedAt: i.shipped_at, deliveryNoteId: i.delivery_note_id, invoiced: !!i.invoiced };
}
function normNote(n) {
  return { id: n.id, numero: n.numero, clientId: n.client_id, createdAt: n.created_at, status: n.status, sentAt: n.sent_at, invoiced: !!n.invoiced, invoiceId: n.invoice_id, items: (n.items || []).map((it) => ({ tag: it.tag, typeId: it.type_id })) };
}
function normInvoice(inv) {
  return { id: inv.id, numero: inv.numero, clientId: inv.client_id, periodType: inv.period_type, total: inv.total_ht, createdAt: inv.created_at, deliveryNoteIds: inv.deliveryNoteIds || [] };
}
function normClient(c) { return { id: c.id, name: c.name, address: c.address, email: c.email, createdAt: c.created_at }; }
function normSettings(s) {
  return { ...s, thresholdDays: Number(s.thresholdDays || 5), paymentTermsDays: Number(s.paymentTermsDays || 30), tvaRate: Number(s.tvaRate || 20) };
}

/* ------------------------------------------------------------------ */
/*  Atomes UI (inchangés)                                               */
/* ------------------------------------------------------------------ */

function StatusPill({ status }) {
  const map = {
    recu: { label: "En lavage", cls: "pill-steel" }, expedie: { label: "Expédié", cls: "pill-moss" },
    perdu: { label: "Perdu", cls: "pill-amber" }, brouillon: { label: "Brouillon", cls: "pill-steel" }, envoye: { label: "Envoyé au client", cls: "pill-moss" },
  };
  const s = map[status] || map.recu;
  return <span className={`pill ${s.cls}`}>{s.label}</span>;
}
function KpiCard({ label, value, sub, tone }) {
  return (
    <div className="ubq-card kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value tone-${tone || "ink"}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
function ScanTerminal({ log, listening, title }) {
  const endRef = useRef(null);
  useEffect(() => { if (endRef.current) endRef.current.scrollTop = endRef.current.scrollHeight; }, [log]);
  return (
    <div className="ubq-terminal">
      <div className="term-head"><span className={`dot ${listening ? "dot-live" : ""}`} /><span className="term-title">{title || "LECTEUR RFID"}</span><Radio size={14} style={{ opacity: 0.6 }} /></div>
      <div className="term-body" ref={endRef}>
        {log.length === 0 && <div className="term-line term-muted">En attente de lecture…</div>}
        {log.map((l) => (<div key={l.id} className={`term-line ${l.error ? "term-error" : ""}`}><span className="term-ts">[{fmtTime(l.at)}]</span> {l.text}</div>))}
        <div className="term-cursor">█</div>
      </div>
    </div>
  );
}

function DocumentSheet({ doc, client, settings, onClose }) {
  if (!doc) return null;
  const isFacture = doc.kind === "facture";
  return (
    <div className="print-overlay">
      <div className="print-toolbar no-print">
        <button className="btn btn-steel btn-sm" onClick={() => window.print()}><Printer size={14} /> Imprimer / Enregistrer en PDF</button>
        <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={14} /> Fermer</button>
      </div>
      <div className="print-sheet">
        <div className="sheet-head">
          <div className="sheet-brand">
            <span className="sheet-mark"><i className="mark-a" /><i className="mark-b" /></span>
            <div><div className="sheet-company">{settings.companyName}</div><div className="muted small">{settings.legalForm} au capital de {settings.capitalSocial}</div></div>
          </div>
          <div className="sheet-doc-meta">
            <div className="sheet-doc-title">{isFacture ? "FACTURE" : "Bon de livraison"}</div>
            <div className="mono">{doc.numero}</div>
            <div className="muted small">Émise le {fmtDate(doc.createdAt)}</div>
            {isFacture && <div className="muted small">Échéance le {fmtDate(addDays(doc.createdAt, settings.paymentTermsDays))}</div>}
          </div>
        </div>
        <div className="sheet-legal-strip muted small">{settings.companyAddress} · SIRET {settings.siret} · TVA intracommunautaire {settings.tvaIntra} · {settings.rcs}</div>
        <div className="sheet-parties">
          <div><div className="muted small" style={{ textTransform: "uppercase", letterSpacing: ".04em" }}>Émetteur</div><div style={{ fontWeight: 600, marginTop: 4 }}>{settings.companyName}</div><div className="muted small">{settings.companyAddress}</div><div className="muted small">{settings.companyEmail}</div></div>
          <div><div className="muted small" style={{ textTransform: "uppercase", letterSpacing: ".04em" }}>Client</div><div style={{ fontWeight: 600, marginTop: 4 }}>{client?.name}</div><div className="muted small">{client?.address}</div></div>
        </div>
        {!isFacture && (
          <table className="ubq-table" style={{ marginTop: 18 }}>
            <thead><tr><th>Tag RFID</th><th>Article</th><th style={{ textAlign: "right" }}>Prix unitaire</th></tr></thead>
            <tbody>{doc.items.map((it) => (<tr key={it.tag}><td className="mono">{it.tag}</td><td>{it.typeName}</td><td style={{ textAlign: "right" }}>{fmtEUR(it.price)}</td></tr>))}</tbody>
          </table>
        )}
        {isFacture && (
          <>
            <div className="muted small" style={{ marginTop: 18 }}>Facturation {doc.periodLabel} — bons de livraison : {doc.notes.map((n) => n.numero).join(", ")}</div>
            <table className="ubq-table" style={{ marginTop: 8 }}>
              <thead><tr><th>Désignation</th><th style={{ textAlign: "right" }}>Quantité</th><th style={{ textAlign: "right" }}>PU HT</th><th style={{ textAlign: "right" }}>Total HT</th></tr></thead>
              <tbody>{doc.lines.map((l) => (<tr key={l.typeId}><td>{l.name}</td><td style={{ textAlign: "right" }}>{l.qty}</td><td style={{ textAlign: "right" }}>{fmtEUR(l.unitPrice)}</td><td style={{ textAlign: "right" }}>{fmtEUR(l.totalHT)}</td></tr>))}</tbody>
            </table>
          </>
        )}
        {isFacture ? (
          <div className="sheet-totals">
            <div className="sheet-totals-row"><span>Total HT</span><span className="mono">{fmtEUR(doc.totalHT)}</span></div>
            <div className="sheet-totals-row"><span>TVA ({settings.tvaRate} %)</span><span className="mono">{fmtEUR(doc.totalTVA)}</span></div>
            <div className="sheet-totals-row sheet-totals-final"><span>Total TTC</span><span className="mono">{fmtEUR(doc.totalTTC)}</span></div>
          </div>
        ) : (
          <div className="sheet-total-row"><span>Total</span><span className="sheet-total">{fmtEUR(doc.total)}</span></div>
        )}
        {isFacture && (
          <div className="sheet-footer muted small">
            <p>Conditions de règlement : paiement à {settings.paymentTermsDays} jours, par virement bancaire. Aucun escompte pour paiement anticipé. En cas de retard de paiement, application d'une pénalité au taux de 3 fois le taux d'intérêt légal, ainsi que d'une indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 et D441-5 du Code de commerce).</p>
            <p>TVA acquittée sur les débits.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tabs                                                                */
/* ------------------------------------------------------------------ */

function Dashboard({ db, typeById }) {
  const { items, clients, deliveryNotes, settings } = db;
  const enLavage = items.filter((i) => i.status === "recu" && daysSince(i.receivedAt) <= settings.thresholdDays).length;
  const enRetard = items.filter((i) => i.status === "recu" && daysSince(i.receivedAt) > settings.thresholdDays).length;
  const brouillons = deliveryNotes.filter((n) => n.status === "brouillon").length;
  const aFacturer = deliveryNotes.filter((n) => n.status === "envoye" && !n.invoiced);
  const montantAFacturer = aFacturer.reduce((s, n) => s + noteTotal(n, typeById), 0);
  const clientName = (id) => clients.find((c) => c.id === id)?.name || "—";
  const recentNotes = [...deliveryNotes].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);

  return (
    <div>
      <div className="kpi-grid">
        <KpiCard label="En cours de lavage" value={enLavage} tone="steel" />
        <KpiCard label="En retard (à surveiller)" value={enRetard} sub={`seuil ${settings.thresholdDays} j`} tone="amber" />
        <KpiCard label="Bons à envoyer" value={brouillons} tone="steel" />
        <KpiCard label="À facturer" value={fmtEUR(montantAFacturer)} sub={`${aFacturer.length} bon(s)`} tone="moss" />
      </div>
      <div className="ubq-card">
        <h3 className="card-title">Derniers bons de livraison</h3>
        <div className="activity-list">
          {recentNotes.map((n) => (
            <div className="activity-row" key={n.id}>
              <span className={`dotkind ${n.status === "envoye" ? "dk-moss" : "dk-steel"}`} />
              <span className="mono">{n.numero}</span>
              <span className="act-mid">{clientName(n.clientId)} · {n.items.length} pièce(s)</span>
              <span className="act-time">{fmtDate(n.createdAt)}</span>
            </div>
          ))}
          {recentNotes.length === 0 && <div className="term-muted">Aucun bon pour l'instant.</div>}
        </div>
      </div>
    </div>
  );
}

function Reception({ db, typeById, refresh, notify }) {
  const [clientId, setClientId] = useState(db.clients[0]?.id || "");
  const [typeId, setTypeId] = useState(db.linenTypes[0]?.id || "");
  const [tagInput, setTagInput] = useState("");
  const [log, setLog] = useState([]);
  const [sessionCount, setSessionCount] = useState(0);
  const inputRef = useRef(null);

  async function addTag(rawTag) {
    const tag = rawTag.trim().toUpperCase();
    if (!tag || !clientId || !typeId) return;
    try {
      const res = await api.scanReception({ tag, clientId, typeId, source: "quai" });
      if (res.status === "debounced") {
        setLog((l) => [...l.slice(-30), { id: uid(), at: Date.now(), text: `${tag} relu — doublon ignoré (anti-rebond)` }]);
        return;
      }
      setSessionCount((n) => n + 1);
      setLog((l) => [...l.slice(-30), { id: uid(), at: Date.now(), text: `TAG ${tag} LU — ${typeById(typeId).name}${res.status === "reused" ? " (nouveau cycle, puce déjà connue)" : ""}` }]);
      refresh();
    } catch (err) {
      setLog((l) => [...l.slice(-30), { id: uid(), at: Date.now(), text: `ERREUR — ${err.message}`, error: true }]);
    }
  }

  function scan() { addTag(genTag()); }
  function submitTag(e) { e.preventDefault(); addTag(tagInput); setTagInput(""); inputRef.current?.focus(); }
  const clientName = db.clients.find((c) => c.id === clientId)?.name;

  return (
    <div className="grid-2">
      <div className="ubq-card">
        <h3 className="card-title">Réception du linge sale</h3>
        <label className="field-label">Client</label>
        <select className="ubq-select" value={clientId} onChange={(e) => setClientId(e.target.value)}>{db.clients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</select>
        <label className="field-label">Type de linge scanné</label>
        <select className="ubq-select" value={typeId} onChange={(e) => setTypeId(e.target.value)}>{db.linenTypes.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}</select>
        <label className="field-label">Scanner (tapez/collez le tag, ou générez-en un)</label>
        <form onSubmit={submitTag} style={{ display: "flex", gap: 8 }}>
          <input ref={inputRef} className="ubq-input mono" placeholder="RFID-XXXXXX" value={tagInput} onChange={(e) => setTagInput(e.target.value)} />
          <button className="btn btn-steel" type="submit"><Radio size={16} /></button>
        </form>
        <button className="btn btn-ghost btn-sm" onClick={scan} style={{ marginTop: 8 }}><Radio size={14} /> Générer un scan de test</button>
        <div className="hint">{sessionCount} pièce(s) enregistrée(s) cette session — chaque scan est validé immédiatement, chaque puce n'est comptée qu'une fois.</div>
      </div>
      <ScanTerminal log={log} listening title="RÉCEPTION — LECTEUR QUAI" />
    </div>
  );
}

function Expedition({ db, typeById, refresh, notify }) {
  const [clientId, setClientId] = useState(db.clients[0]?.id || "");
  const [tagInput, setTagInput] = useState("");
  const [pending, setPending] = useState([]);
  const [log, setLog] = useState([]);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  async function submitTag(e) {
    e.preventDefault();
    const tag = tagInput.trim().toUpperCase();
    if (!tag) return;
    const already = pending.find((p) => p.tag === tag);
    if (already) {
      setPending((p) => p.map((x) => (x.tag === tag ? { ...x, reads: x.reads + 1 } : x)));
      setLog((l) => [...l.slice(-30), { id: uid(), at: Date.now(), text: `${tag} relu — doublon ignoré (×${already.reads + 1})` }]);
      setTagInput(""); inputRef.current?.focus();
      return;
    }
    try {
      const res = await api.scanCheck({ tag, clientId });
      if (!res.valid) {
        const messages = { introuvable: "introuvable", autre_client: "n'appartient pas à ce client", deja_expedie: "déjà expédié", perdu: "déjà déclaré perdu" };
        setLog((l) => [...l.slice(-30), { id: uid(), at: Date.now(), text: `ERREUR — ${tag} ${messages[res.reason] || res.reason}`, error: true }]);
      } else {
        setPending((p) => [...p, { tag, typeId: res.item.type_id, reads: 1 }]);
        setLog((l) => [...l.slice(-30), { id: uid(), at: Date.now(), text: `TAG ${tag} LU — ${typeById(res.item.type_id).name} — prêt à expédier` }]);
      }
    } catch (err) {
      setLog((l) => [...l.slice(-30), { id: uid(), at: Date.now(), text: `ERREUR — ${err.message}`, error: true }]);
    }
    setTagInput(""); inputRef.current?.focus();
  }
  function removePending(tag) { setPending((p) => p.filter((x) => x.tag !== tag)); }

  async function validate() {
    if (!clientId || pending.length === 0) return;
    setSaving(true);
    try {
      const note = await api.createDeliveryNote({ clientId, tags: pending.map((p) => p.tag) });
      notify(`Bon de livraison ${note.numero} créé — à envoyer depuis l'onglet "Bons de livraison".`);
      setPending([]);
      refresh();
    } catch (err) {
      notify(`Erreur : ${err.message}`);
    }
    setSaving(false);
  }

  const clientName = db.clients.find((c) => c.id === clientId)?.name;

  return (
    <div className="grid-2">
      <div className="ubq-card">
        <h3 className="card-title">Expédition du linge propre</h3>
        <label className="field-label">Client</label>
        <select className="ubq-select" value={clientId} onChange={(e) => setClientId(e.target.value)}>{db.clients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</select>
        <label className="field-label">Scanner (tapez ou collez le tag puis Entrée)</label>
        <form onSubmit={submitTag} style={{ display: "flex", gap: 8 }}>
          <input ref={inputRef} className="ubq-input mono" placeholder="RFID-XXXXXX" value={tagInput} onChange={(e) => setTagInput(e.target.value)} />
          <button className="btn btn-steel" type="submit"><Radio size={16} /></button>
        </form>
        {pending.length > 0 && (
          <div className="pending-list">
            {pending.map((p) => (
              <div className="pending-row" key={p.tag}>
                <span className="mono">{p.tag}</span><span>{typeById(p.typeId).name}</span>
                {p.reads > 1 && <span className="pill pill-steel">×{p.reads} lectures</span>}
                <span className="mono muted">{fmtEUR(typeById(p.typeId).price)}</span>
                <button className="icon-btn" onClick={() => removePending(p.tag)} aria-label="Retirer"><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
        <button className="btn btn-moss" disabled={pending.length === 0 || saving} onClick={validate} style={{ marginTop: 14, width: "100%" }}>
          {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
          Valider l'expédition{pending.length > 0 ? ` (${pending.length})` : ""}{clientName ? ` — ${clientName}` : ""}
        </button>
        <div className="hint">La validation crée automatiquement un bon de livraison (brouillon) pour ce client.</div>
      </div>
      <ScanTerminal log={log} listening title="EXPÉDITION — LECTEUR QUAI" />
    </div>
  );
}

function LingePerdu({ db, typeById, refresh, notify }) {
  const overdue = db.items.filter((i) => i.status === "recu" && daysSince(i.receivedAt) > db.settings.thresholdDays);
  const clientName = (id) => db.clients.find((c) => c.id === id)?.name || "—";

  async function declare(tag) {
    try { await api.declareLost(tag); notify(`${tag} déclaré perdu.`); refresh(); }
    catch (err) { notify(`Erreur : ${err.message}`); }
  }
  async function setThreshold(v) {
    try { await api.patchSettings({ thresholdDays: v }); refresh(); }
    catch (err) { notify(`Erreur : ${err.message}`); }
  }

  return (
    <div>
      <div className="ubq-card" style={{ marginBottom: 16 }}>
        <div className="row-between">
          <h3 className="card-title" style={{ marginBottom: 0 }}>Seuil de retard</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="number" min={1} className="ubq-input mono" style={{ width: 70 }} defaultValue={db.settings.thresholdDays} onBlur={(e) => setThreshold(Math.max(1, parseInt(e.target.value) || 1))} />
            <span className="muted">jours sans expédition avant alerte</span>
          </div>
        </div>
      </div>
      <div className="ubq-card">
        <h3 className="card-title">À surveiller — reçu mais jamais reparti ({overdue.length})</h3>
        {overdue.length === 0 && <div className="term-muted">Rien à signaler, tout le linge reçu est dans les délais.</div>}
        {overdue.length > 0 && (
          <table className="ubq-table">
            <thead><tr><th>Tag</th><th>Type</th><th>Client</th><th>Reçu il y a</th><th></th></tr></thead>
            <tbody>{overdue.map((i) => (
              <tr key={i.tag}>
                <td className="mono">{i.tag}</td><td>{typeById(i.typeId).name}</td><td>{clientName(i.clientId)}</td>
                <td><span className="pill pill-amber">{daysSince(i.receivedAt)} j</span></td>
                <td style={{ textAlign: "right" }}><button className="btn btn-amber btn-sm" onClick={() => declare(i.tag)}><AlertTriangle size={14} /> Déclarer perdu</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function BonsLivraison({ db, typeById, refresh, notify }) {
  const [filterClient, setFilterClient] = useState("all");
  const [preview, setPreview] = useState(null);
  const [editing, setEditing] = useState(null);
  const clientName = (id) => db.clients.find((c) => c.id === id)?.name || "—";
  const client = (id) => db.clients.find((c) => c.id === id);
  const notes = [...db.deliveryNotes].filter((n) => filterClient === "all" || n.clientId === filterClient).sort((a, b) => b.createdAt - a.createdAt);

  async function sendNote(note) {
    try { await api.sendDeliveryNote(note.id); notify(`${note.numero} envoyé (simulation) à ${client(note.clientId)?.email}.`); refresh(); }
    catch (err) { notify(`Erreur : ${err.message}`); }
  }
  async function deleteNote(note) {
    if (!window.confirm(`Supprimer le bon ${note.numero} ? Les articles repasseront "en lavage".`)) return;
    try { await api.deleteDeliveryNote(note.id); notify(`${note.numero} supprimé.`); refresh(); }
    catch (err) { notify(`Erreur : ${err.message}`); }
  }
  async function removeLine(note, tag) {
    try {
      await api.removeDeliveryNoteItem(note.id, tag);
      notify(`Article ${tag} retiré du bon ${note.numero}.`);
      const updated = await refresh();
      const fresh = updated?.deliveryNotes.find((n) => n.id === note.id);
      setEditing(fresh || null);
    } catch (err) { notify(`Erreur : ${err.message}`); }
  }

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 14 }}>
        <h3 className="card-title" style={{ marginBottom: 0 }}>Bons de livraison</h3>
        <select className="ubq-select" style={{ width: 220 }} value={filterClient} onChange={(e) => setFilterClient(e.target.value)}>
          <option value="all">Tous les clients</option>{db.clients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
      </div>
      <div className="ubq-card">
        <table className="ubq-table">
          <thead><tr><th>Numéro</th><th>Client</th><th>Date</th><th>Pièces</th><th>Total</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            {notes.map((n) => (
              <tr key={n.id}>
                <td className="mono">{n.numero}</td><td>{clientName(n.clientId)}</td><td>{fmtDate(n.createdAt)}</td>
                <td>{n.items.length}</td><td className="mono">{fmtEUR(noteTotal(n, typeById))}</td><td><StatusPill status={n.status} /></td>
                <td>
                  <div className="actions-row">
                    <button className="icon-btn" title="Aperçu / PDF" onClick={() => setPreview(n)}><Eye size={15} /></button>
                    {n.status === "brouillon" && (<>
                      <button className="icon-btn" title="Envoyer par email" onClick={() => sendNote(n)}><Send size={15} /></button>
                      <button className="icon-btn" title="Modifier" onClick={() => setEditing(n)}><Pencil size={15} /></button>
                      <button className="icon-btn" title="Supprimer" onClick={() => deleteNote(n)}><Trash2 size={15} /></button>
                    </>)}
                  </div>
                </td>
              </tr>
            ))}
            {notes.length === 0 && <tr><td colSpan={7} className="term-muted" style={{ padding: 14 }}>Aucun bon de livraison.</td></tr>}
          </tbody>
        </table>
      </div>
      {preview && (
        <DocumentSheet onClose={() => setPreview(null)} settings={db.settings} client={client(preview.clientId)}
          doc={{ kind: "bl", numero: preview.numero, createdAt: preview.createdAt, items: preview.items.map((it) => ({ tag: it.tag, typeName: typeById(it.typeId).name, price: typeById(it.typeId).price })), total: noteTotal(preview, typeById) }} />
      )}
      {editing && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="row-between"><h3 className="card-title" style={{ marginBottom: 0 }}>Modifier {editing.numero}</h3><button className="icon-btn" onClick={() => setEditing(null)}><X size={16} /></button></div>
            <div className="muted small" style={{ margin: "6px 0 12px" }}>Retirer un article le remet automatiquement "en lavage".</div>
            {editing.items.map((it) => (
              <div className="pending-row" key={it.tag}><span className="mono">{it.tag}</span><span>{typeById(it.typeId).name}</span>
                <button className="icon-btn" onClick={() => removeLine(editing, it.tag)}><X size={14} /></button></div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Facturation({ db, typeById, refresh, notify }) {
  const [clientId, setClientId] = useState(db.clients[0]?.id || "");
  const [periodType, setPeriodType] = useState("mois");
  const [selected, setSelected] = useState([]);
  const [preview, setPreview] = useState(null);

  const eligibleNotes = db.deliveryNotes.filter((n) => n.clientId === clientId && n.status === "envoye" && !n.invoiced);
  const clientInvoices = db.invoices.filter((n) => n.clientId === clientId).sort((a, b) => b.createdAt - a.createdAt);
  const client = db.clients.find((c) => c.id === clientId);
  const selectedTotal = eligibleNotes.filter((n) => selected.includes(n.id)).reduce((s, n) => s + noteTotal(n, typeById), 0);

  function toggle(id) { setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])); }
  function selectByPeriod(days) { const from = Date.now() - days * 86400000; setSelected(eligibleNotes.filter((n) => n.createdAt >= from).map((n) => n.id)); }

  async function generate() {
    if (selected.length === 0) return;
    try {
      const inv = await api.createInvoice({ clientId, deliveryNoteIds: selected, periodType });
      notify(`Facture ${inv.numero} générée pour ${fmtEUR(inv.total_ht)}.`);
      setSelected([]); refresh();
    } catch (err) { notify(`Erreur : ${err.message}`); }
  }

  const periodLabel = { ponctuelle: "ponctuelle", quinzaine: "quinzaine", mois: "mensuelle" };

  return (
    <div>
      <div className="ubq-card" style={{ marginBottom: 16 }}>
        <label className="field-label">Client</label>
        <select className="ubq-select" value={clientId} onChange={(e) => { setClientId(e.target.value); setSelected([]); }}>{db.clients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}</select>
        <label className="field-label">Type de facturation</label>
        <div className="seg">{[["ponctuelle", "Ponctuelle"], ["quinzaine", "À la quinzaine"], ["mois", "Au mois"]].map(([v, l]) => (
          <button key={v} className={`seg-btn ${periodType === v ? "seg-active" : ""}`} onClick={() => setPeriodType(v)}>{l}</button>
        ))}</div>
        <div className="row-between" style={{ marginTop: 14 }}>
          <span className="field-label" style={{ margin: 0 }}>Bons de livraison envoyés, non facturés ({eligibleNotes.length})</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-link" onClick={() => selectByPeriod(15)}>15 derniers jours</button>
            <button className="btn-link" onClick={() => selectByPeriod(31)}>30 derniers jours</button>
            <button className="btn-link" onClick={() => setSelected(eligibleNotes.map((n) => n.id))}>Tout</button>
          </div>
        </div>
        {eligibleNotes.length === 0 && <div className="term-muted" style={{ marginTop: 8 }}>Rien à facturer pour ce client pour l'instant.</div>}
        {eligibleNotes.map((n) => (
          <label className="check-row" key={n.id}>
            <input type="checkbox" checked={selected.includes(n.id)} onChange={() => toggle(n.id)} />
            <span className="mono">{n.numero}</span><span className="muted">{fmtDate(n.createdAt)} · {n.items.length} pièce(s)</span>
            <span className="mono" style={{ marginLeft: "auto" }}>{fmtEUR(noteTotal(n, typeById))}</span>
          </label>
        ))}
        <div className="row-between" style={{ marginTop: 16 }}>
          <div className="kpi-value tone-moss" style={{ fontSize: 22 }}>{fmtEUR(selectedTotal)}</div>
          <button className="btn btn-moss" disabled={selected.length === 0} onClick={generate}><Receipt size={16} /> Générer la facture {periodLabel[periodType]}</button>
        </div>
      </div>
      <div className="ubq-card">
        <h3 className="card-title">Factures émises — {client?.name}</h3>
        {clientInvoices.length === 0 && <div className="term-muted">Aucune facture émise pour ce client.</div>}
        {clientInvoices.length > 0 && (
          <table className="ubq-table">
            <thead><tr><th>Numéro</th><th>Date</th><th>Type</th><th>Bons</th><th>Total</th><th></th></tr></thead>
            <tbody>{clientInvoices.map((inv) => (
              <tr key={inv.id}>
                <td className="mono">{inv.numero}</td><td>{fmtDate(inv.createdAt)}</td><td>{periodLabel[inv.periodType]}</td>
                <td>{inv.deliveryNoteIds.length}</td><td className="mono">{fmtEUR(inv.total)}</td>
                <td><button className="icon-btn" title="Aperçu / PDF" onClick={() => setPreview(inv)}><Eye size={15} /></button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {preview && (() => {
        const notes = preview.deliveryNoteIds.map((id) => db.deliveryNotes.find((n) => n.id === id)).filter(Boolean);
        const tvaRate = db.settings.tvaRate / 100;
        return (
          <DocumentSheet onClose={() => setPreview(null)} settings={db.settings} client={client}
            doc={{ kind: "facture", numero: preview.numero, createdAt: preview.createdAt, periodLabel: periodLabel[preview.periodType], notes, lines: aggregateLines(notes, typeById), totalHT: preview.total, totalTVA: preview.total * tvaRate, totalTTC: preview.total * (1 + tvaRate) }} />
        );
      })()}
    </div>
  );
}

function Clients({ db, refresh, notify }) {
  const [name, setName] = useState(""); const [address, setAddress] = useState(""); const [email, setEmail] = useState(""); const [adding, setAdding] = useState(false);

 async function addClient(e) {
    e.preventDefault();
    if (!name.trim()) { notify("Le nom du client est obligatoire."); return; }
    if (!email.trim()) { notify("L'email du client est obligatoire (il sert à se connecter à l'espace client)."); return; }
    try {
      const res = await api.addClient({ name: name.trim(), address: address.trim(), email: email.trim() });
      notify(`Client ajouté — mot de passe espace client (à communiquer au client) : ${res.temporaryPassword}`);
      setName(""); setAddress(""); setEmail(""); setAdding(false); refresh();
    } catch (err) { notify(`Erreur : ${err.message}`); }
  }
  async function resetPassword(clientId) {
    try { const res = await api.resetClientPassword(clientId); notify(`Nouveau mot de passe : ${res.temporaryPassword}`); }
    catch (err) { notify(`Erreur : ${err.message}`); }
  }
  async function saveSettings(field, value) {
    try { await api.patchSettings({ [field]: value }); refresh(); } catch (err) { notify(`Erreur : ${err.message}`); }
  }

  return (
    <div>
      <div className="ubq-card" style={{ marginBottom: 16 }}>
        <div className="row-between"><h3 className="card-title" style={{ marginBottom: 0 }}>Clients</h3><button className="btn btn-steel btn-sm" onClick={() => setAdding((a) => !a)}><Plus size={14} /> Ajouter un client</button></div>
        {adding && (
          <form onSubmit={addClient} className="add-client-form">
            <input className="ubq-input" placeholder="Nom du client" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="ubq-input" placeholder="Adresse" value={address} onChange={(e) => setAddress(e.target.value)} />
            <input className="ubq-input" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn btn-moss btn-sm" type="submit"><Check size={14} /> Enregistrer</button>
          </form>
        )}
      </div>
      {db.clients.map((c) => {
        const clientItems = db.items.filter((i) => i.clientId === c.id);
        const enLavage = clientItems.filter((i) => i.status === "recu").length;
        const aFacturer = db.deliveryNotes.filter((n) => n.clientId === c.id && n.status === "envoye" && !n.invoiced);
        return (
          <div className="ubq-card" key={c.id} style={{ marginBottom: 12 }}>
            <div className="row-between">
              <div>
                <div className="client-name"><Building2 size={16} style={{ opacity: 0.6 }} /> {c.name}</div>
                <div className="muted" style={{ fontSize: 13 }}>{c.address} · {c.email}</div>
                <button className="btn-link" style={{ marginTop: 6 }} onClick={() => resetPassword(c.id)}><Lock size={11} style={{ marginRight: 4, verticalAlign: -1 }} />Réinitialiser le mot de passe espace client</button>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="muted" style={{ fontSize: 12 }}>{aFacturer.length} bon(s) à facturer · {enLavage} en lavage</div>
              </div>
            </div>
          </div>
        );
      })}
      <div className="ubq-card" style={{ marginBottom: 16 }}>
        <h3 className="card-title">Tarifs par type de linge</h3>
        <table className="ubq-table"><thead><tr><th>Type</th><th>Prix unitaire</th></tr></thead>
          <tbody>{db.linenTypes.map((t) => (<tr key={t.id}><td>{t.name}</td><td className="mono">{fmtEUR(t.price)}</td></tr>))}</tbody></table>
        <div className="hint">La modification des tarifs se fait directement en base pour l'instant (table linen_types) — une interface dédiée pourra être ajoutée si besoin.</div>
      </div>
      <div className="ubq-card">
        <h3 className="card-title">Coordonnées sur les documents (bons / factures)</h3>
        <div className="two-col">
          <div>
            <label className="field-label">Nom de la blanchisserie</label><input className="ubq-input" defaultValue={db.settings.companyName} onBlur={(e) => saveSettings("companyName", e.target.value)} />
            <label className="field-label">Forme juridique</label><input className="ubq-input" defaultValue={db.settings.legalForm} onBlur={(e) => saveSettings("legalForm", e.target.value)} />
            <label className="field-label">Capital social</label><input className="ubq-input" defaultValue={db.settings.capitalSocial} onBlur={(e) => saveSettings("capitalSocial", e.target.value)} />
            <label className="field-label">Adresse du siège</label><input className="ubq-input" defaultValue={db.settings.companyAddress} onBlur={(e) => saveSettings("companyAddress", e.target.value)} />
            <label className="field-label">Email</label><input className="ubq-input" defaultValue={db.settings.companyEmail} onBlur={(e) => saveSettings("companyEmail", e.target.value)} />
          </div>
          <div>
            <label className="field-label">SIRET</label><input className="ubq-input" defaultValue={db.settings.siret} onBlur={(e) => saveSettings("siret", e.target.value)} />
            <label className="field-label">N° TVA intracommunautaire</label><input className="ubq-input" defaultValue={db.settings.tvaIntra} onBlur={(e) => saveSettings("tvaIntra", e.target.value)} />
            <label className="field-label">RCS</label><input className="ubq-input" defaultValue={db.settings.rcs} onBlur={(e) => saveSettings("rcs", e.target.value)} />
            <label className="field-label">Taux de TVA (%)</label><input className="ubq-input" type="number" defaultValue={db.settings.tvaRate} onBlur={(e) => saveSettings("tvaRate", parseFloat(e.target.value) || 0)} />
            <label className="field-label">Délai de paiement (jours)</label><input className="ubq-input" type="number" defaultValue={db.settings.paymentTermsDays} onBlur={(e) => saveSettings("paymentTermsDays", parseInt(e.target.value) || 30)} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Espace client                                                       */
/* ------------------------------------------------------------------ */

function ClientPortal({ onExit, onLoggedIn, clientAuth, typeById, settings }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState("");
  const [notes, setNotes] = useState(null); const [invoices, setInvoices] = useState(null); const [preview, setPreview] = useState(null);

  async function login(e) {
    e.preventDefault();
    try {
      const res = await api.portalLogin(email.trim(), password);
      setToken(res.token);
      localStorage.setItem("tracalinge_role", "client");
      localStorage.setItem("tracalinge_client", JSON.stringify(res.client));
      onLoggedIn(res.client);
    } catch { setError("Identifiants incorrects."); }
  }

  const loadData = useCallback(async () => {
    const [n, i] = await Promise.all([api.portalNotes(), api.portalInvoices()]);
    setNotes(n.map((x) => ({ id: x.id, numero: x.numero, createdAt: x.created_at, items: (x.items || []).map((it) => ({ tag: it.tag, typeId: it.type_id })) })));
    setInvoices(i.map((x) => ({ id: x.id, numero: x.numero, periodType: x.period_type, total: x.total_ht, createdAt: x.created_at, deliveryNoteIds: x.deliveryNoteIds })));
  }, []);

  useEffect(() => { if (clientAuth) loadData(); }, [clientAuth, loadData]);

  function logout() {
    setToken(null);
    localStorage.removeItem("tracalinge_role");
    localStorage.removeItem("tracalinge_client");
    onExit();
  }

  if (!clientAuth) {
    return (
      <div className="portal-login">
        <div className="ubq-card" style={{ maxWidth: 380, width: "100%" }}>
          <div className="brand" style={{ color: "var(--ink-900)", padding: "0 0 16px", justifyContent: "center" }}><Lock size={18} /><span>Espace client</span></div>
          <form onSubmit={login}>
            <label className="field-label">Email</label><input className="ubq-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="votre@email.fr" />
            <label className="field-label">Mot de passe</label><input className="ubq-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && <div className="portal-error">{error}</div>}
            <button className="btn btn-steel" type="submit" style={{ width: "100%", marginTop: 14 }}>Se connecter</button>
          </form>
          <button className="btn-link" style={{ marginTop: 14 }} onClick={onExit}>← Retour espace interne</button>
        </div>
      </div>
    );
  }

  if (!notes || !invoices) return <div className="loading-screen"><Loader2 className="spin" size={28} /></div>;

  const periodLabel = { ponctuelle: "ponctuelle", quinzaine: "quinzaine", mois: "mensuelle" };

  return (
    <div className="portal-wrap">
      <header className="portal-top">
        <div className="brand" style={{ padding: 0 }}><Building2 size={18} /><span>{clientAuth.name}</span></div>
        <button className="btn btn-ghost btn-sm" onClick={logout}><LogOut size={14} /> Déconnexion</button>
      </header>
      <div className="portal-body">
        <div className="ubq-card" style={{ marginBottom: 16 }}>
          <h3 className="card-title">Bons de livraison</h3>
          <table className="ubq-table"><thead><tr><th>Numéro</th><th>Date</th><th>Pièces</th><th>Total</th><th></th></tr></thead>
            <tbody>{notes.map((n) => (
              <tr key={n.id}><td className="mono">{n.numero}</td><td>{fmtDate(n.createdAt)}</td><td>{n.items.length}</td>
                <td className="mono">{fmtEUR(noteTotal(n, typeById))}</td>
                <td><button className="icon-btn" onClick={() => setPreview({ kind: "bl", numero: n.numero, createdAt: n.createdAt, items: n.items.map((it) => ({ tag: it.tag, typeName: typeById(it.typeId).name, price: typeById(it.typeId).price })), total: noteTotal(n, typeById) })}><Eye size={15} /></button></td>
              </tr>
            ))}
            {notes.length === 0 && <tr><td colSpan={5} className="term-muted" style={{ padding: 14 }}>Aucun bon disponible.</td></tr>}</tbody>
          </table>
        </div>
        <div className="ubq-card">
          <h3 className="card-title">Factures</h3>
          <table className="ubq-table"><thead><tr><th>Numéro</th><th>Date</th><th>Type</th><th>Total</th><th></th></tr></thead>
            <tbody>{invoices.map((inv) => {
              const invNotes = inv.deliveryNoteIds.map((id) => notes.find((n) => n.id === id)).filter(Boolean);
              const tvaRate = settings.tvaRate / 100;
              return (
                <tr key={inv.id}><td className="mono">{inv.numero}</td><td>{fmtDate(inv.createdAt)}</td><td>{periodLabel[inv.periodType]}</td>
                  <td className="mono">{fmtEUR(inv.total)}</td>
                  <td><button className="icon-btn" onClick={() => setPreview({ kind: "facture", numero: inv.numero, createdAt: inv.createdAt, periodLabel: periodLabel[inv.periodType], notes: invNotes, lines: aggregateLines(invNotes, typeById), totalHT: inv.total, totalTVA: inv.total * tvaRate, totalTTC: inv.total * (1 + tvaRate) })}><Eye size={15} /></button></td>
                </tr>
              );
            })}
            {invoices.length === 0 && <tr><td colSpan={5} className="term-muted" style={{ padding: 14 }}>Aucune facture disponible.</td></tr>}</tbody>
          </table>
        </div>
      </div>
      {preview && <DocumentSheet onClose={() => setPreview(null)} settings={settings} client={clientAuth} doc={preview} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Connexion personnel                                                 */
/* ------------------------------------------------------------------ */

function StaffLogin({ onLoggedIn, onGoPortal }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);

  async function login(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const res = await api.staffLogin(email.trim(), password);
      setToken(res.token);
      localStorage.setItem("tracalinge_role", "staff");
      onLoggedIn();
    } catch { setError("Identifiants incorrects."); }
    setBusy(false);
  }

  return (
    <div className="portal-login">
      <div className="ubq-card" style={{ maxWidth: 380, width: "100%" }}>
        <div className="brand" style={{ color: "var(--ink-900)", padding: "0 0 16px", justifyContent: "center" }}><Radio size={18} /><span>Traçalinge — Connexion</span></div>
        <form onSubmit={login}>
          <label className="field-label">Email</label><input className="ubq-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@votre-entreprise.fr" />
          <label className="field-label">Mot de passe</label><input className="ubq-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <div className="portal-error">{error}</div>}
          <button className="btn btn-steel" type="submit" disabled={busy} style={{ width: "100%", marginTop: 14 }}>{busy ? <Loader2 size={16} className="spin" /> : "Se connecter"}</button>
        </form>
        <button className="btn-link" style={{ marginTop: 14 }} onClick={onGoPortal}>Espace client →</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Root                                                                */
/* ------------------------------------------------------------------ */

const NAV = [
  { id: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { id: "reception", label: "Réception", icon: PackageCheck },
  { id: "expedition", label: "Expédition", icon: Truck },
  { id: "bons", label: "Bons de livraison", icon: FileText },
  { id: "facturation", label: "Facturation", icon: Receipt },
  { id: "perdu", label: "Linge perdu", icon: AlertTriangle },
  { id: "clients", label: "Clients", icon: Building2 },
];

export default function App() {
  const [role, setRole] = useState(() => localStorage.getItem("tracalinge_role") || null);
  const [clientAuth, setClientAuth] = useState(() => { try { return JSON.parse(localStorage.getItem("tracalinge_client")); } catch { return null; } });
  const [tab, setTab] = useState("dashboard");
  const [db, setDb] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [clients, linenTypes, items, deliveryNotes, invoices, settings] = await Promise.all([
        api.getClients(), api.getLinenTypes(), api.getItems(), api.getDeliveryNotes(), api.getInvoices(), api.getSettings(),
      ]);
      const next = {
        clients: clients.map(normClient), linenTypes, items: items.map(normItem),
        deliveryNotes: deliveryNotes.map(normNote), invoices: invoices.map(normInvoice), settings: normSettings(settings),
      };
      setDb(next);
      return next;
    } catch (err) {
      if (err.status === 401) logoutStaff();
      else notify(`Erreur de chargement : ${err.message}`);
      return null;
    }
  }, [notify]);

  function logoutStaff() {
    setToken(null);
    localStorage.removeItem("tracalinge_role");
    disconnectRealtime();
    setRole(null); setDb(null);
  }

  useEffect(() => {
    if (role === "staff" && getToken()) {
      refresh();
      connectRealtime({ role: "staff" });
      const offs = ["item:updated", "deliveryNote:created", "deliveryNote:updated", "deliveryNote:deleted", "invoice:created"].map((ev) => onRealtime(ev, () => refresh()));
      return () => offs.forEach((f) => f());
    }
  }, [role, refresh]);

  if (role === "client") {
    return (
      <div className="ubq-root portal-root">
        <style>{CSS}</style>
        <ClientPortalWithSettings clientAuth={clientAuth} onExit={() => { setToken(null); localStorage.removeItem("tracalinge_role"); setRole(null); }} onLoggedIn={(c) => { setClientAuth(c); }} />
      </div>
    );
  }

  if (role !== "staff") {
    return (
      <div className="ubq-root"><style>{CSS}</style>
        <StaffLogin onLoggedIn={() => setRole("staff")} onGoPortal={() => setRole("client")} />
      </div>
    );
  }

  if (!db) {
    return (<div className="ubq-root loading-screen"><style>{CSS}</style><Loader2 className="spin" size={28} /><div style={{ marginTop: 10 }}>Chargement de Traçalinge…</div></div>);
  }

  const typeById = (id) => db.linenTypes.find((t) => t.id === id) || { id, name: "Article", price: 0 };

  return (
    <div className="ubq-root">
      <style>{CSS}</style>
      <aside className="sidebar no-print">
        <div className="brand"><Radio size={20} /><span>Traçalinge</span></div>
        <nav>{NAV.map((n) => { const Icon = n.icon; return (
          <button key={n.id} className={`nav-item ${tab === n.id ? "active" : ""}`} onClick={() => setTab(n.id)}><Icon size={17} /><span>{n.label}</span></button>
        ); })}</nav>
        <button className="nav-item" onClick={() => setRole("client")}><Lock size={17} /><span>Espace client</span></button>
        <button className="nav-item" onClick={logoutStaff}><LogOut size={17} /><span>Déconnexion</span></button>
      </aside>
      <main className="main">
        <header className="topbar no-print">
          <h1>{NAV.find((n) => n.id === tab)?.label}</h1>
          <div className="muted mono" style={{ fontSize: 13 }}>{db.items.length} pièces suivies · {db.clients.length} clients</div>
        </header>
        <div className="content no-print">
          {tab === "dashboard" && <Dashboard db={db} typeById={typeById} />}
          {tab === "reception" && <Reception db={db} typeById={typeById} refresh={refresh} notify={notify} />}
          {tab === "expedition" && <Expedition db={db} typeById={typeById} refresh={refresh} notify={notify} />}
          {tab === "bons" && <BonsLivraison db={db} typeById={typeById} refresh={refresh} notify={notify} />}
          {tab === "facturation" && <Facturation db={db} typeById={typeById} refresh={refresh} notify={notify} />}
          {tab === "perdu" && <LingePerdu db={db} typeById={typeById} refresh={refresh} notify={notify} />}
          {tab === "clients" && <Clients db={db} refresh={refresh} notify={notify} />}
        </div>
      </main>
      {toast && <div className="toast no-print">{toast}</div>}
    </div>
  );
}

// Petit wrapper : l'espace client a besoin des tarifs/paramètres publics pour afficher les
// montants, mais sans se connecter en staff. On les charge dès que le client est identifié.
function ClientPortalWithSettings({ clientAuth, onExit, onLoggedIn }) {
  const [linenTypes, setLinenTypes] = useState(null);
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    if (!clientAuth) return;
    Promise.all([api.portalLinenTypes(), api.portalSettings()]).then(([types, settings]) => {
      setLinenTypes(types);
      setSettings({ ...settings, paymentTermsDays: Number(settings.paymentTermsDays || 30), tvaRate: Number(settings.tvaRate || 20) });
    });
  }, [clientAuth]);

  const typeById = (id) => (linenTypes || []).find((t) => t.id === id) || { id, name: "Article", price: 0 };

  if (!clientAuth) return <ClientPortal clientAuth={null} onExit={onExit} onLoggedIn={onLoggedIn} typeById={typeById} settings={settings || {}} />;
  if (!linenTypes || !settings) return <div className="loading-screen"><Loader2 className="spin" size={28} /></div>;
  return <ClientPortal clientAuth={clientAuth} onExit={onExit} onLoggedIn={onLoggedIn} typeById={typeById} settings={settings} />;
}

/* ------------------------------------------------------------------ */
/*  Styles (identiques à la version artefact)                          */
/* ------------------------------------------------------------------ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
.ubq-root { --graphite-900:#0F2A43; --graphite-800:#163B5C; --graphite-700:#1F4E76; --paper:#F4F7F8; --surface:#FFFFFF; --steel:#1E5A96; --steel-soft:#E4EDF6; --amber:#EE6A4C; --amber-soft:#FDEAE5; --moss:#159E97; --moss-soft:#E1F5F3; --ink-900:#122130; --ink-500:#5C6B76; --line:#DCE3E6; font-family:'Inter',system-ui,sans-serif; color:var(--ink-900); background:var(--paper); min-height:100vh; display:flex; width:100%; }
.ubq-root * { box-sizing:border-box; }
.mono { font-family:'IBM Plex Mono', monospace; } .muted { color:var(--ink-500); } .small { font-size:12px; }
@media (prefers-reduced-motion: reduce) { .spin, .dot-live { animation:none !important; } }
.loading-screen { flex-direction:column; align-items:center; justify-content:center; width:100%; }
.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
.sidebar { width:220px; background:var(--graphite-900); color:#EDEFEC; display:flex; flex-direction:column; padding:20px 14px; flex-shrink:0; }
.brand { display:flex; align-items:center; gap:8px; font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:18px; letter-spacing:-0.01em; padding:4px 8px 22px; }
.nav-item { display:flex; align-items:center; gap:10px; width:100%; padding:10px 12px; border-radius:8px; background:none; border:none; color:#AFC6D6; font-size:14px; font-weight:500; cursor:pointer; text-align:left; margin-bottom:2px; transition:background .15s,color .15s; }
.nav-item:hover { background:var(--graphite-700); color:#fff; } .nav-item.active { background:var(--moss); color:#fff; }
.nav-item:focus-visible { outline:2px solid #7FA0D8; outline-offset:1px; } .sidebar-foot { margin-top:12px; font-size:11px; padding:8px; color:#6F8CA1; }
.main { flex:1; display:flex; flex-direction:column; min-width:0; }
.topbar { display:flex; align-items:baseline; justify-content:space-between; padding:22px 28px 14px; border-bottom:1px solid var(--line); background:var(--paper); }
.topbar h1 { font-family:'Space Grotesk',sans-serif; font-size:22px; font-weight:600; letter-spacing:-0.01em; margin:0; }
.content { padding:22px 28px 40px; overflow-y:auto; }
.ubq-card { background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:18px 20px; }
.card-title { font-family:'Space Grotesk',sans-serif; font-size:15px; font-weight:600; margin:0 0 14px; }
.kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:18px; }
.kpi { display:flex; flex-direction:column; gap:4px; } .kpi-label { font-size:12px; color:var(--ink-500); font-weight:500; text-transform:uppercase; letter-spacing:.04em; }
.kpi-value { font-family:'Space Grotesk',sans-serif; font-size:28px; font-weight:700; } .kpi-sub { font-size:12px; color:var(--ink-500); }
.tone-steel { color:var(--steel); } .tone-amber { color:var(--amber); } .tone-moss { color:var(--moss); } .tone-ink { color:var(--ink-900); }
.grid-2 { display:grid; grid-template-columns:1.1fr .9fr; gap:16px; }
@media (max-width:900px){ .grid-2 { grid-template-columns:1fr; } .kpi-grid { grid-template-columns:repeat(2,1fr); } .sidebar { width:72px; } .sidebar .nav-item span, .brand span { display:none; } }
.field-label { display:block; font-size:12px; font-weight:600; color:var(--ink-500); margin:12px 0 5px; text-transform:uppercase; letter-spacing:.03em; }
.ubq-select, .ubq-input { width:100%; padding:9px 11px; border:1px solid var(--line); border-radius:7px; background:var(--surface); font-size:14px; font-family:inherit; color:var(--ink-900); }
.ubq-select:focus-visible, .ubq-input:focus-visible, .btn:focus-visible, .icon-btn:focus-visible, .btn-link:focus-visible { outline:2px solid var(--steel); outline-offset:1px; }
.btn { display:inline-flex; align-items:center; gap:7px; padding:10px 16px; border-radius:7px; border:none; font-size:14px; font-weight:600; cursor:pointer; font-family:inherit; }
.btn:disabled { opacity:.45; cursor:not-allowed; } .btn-steel { background:var(--steel); color:#fff; } .btn-moss { background:var(--moss); color:#fff; }
.btn-amber { background:var(--amber); color:#fff; } .btn-ghost { background:var(--surface); color:var(--ink-900); border:1px solid var(--line); } .btn-sm { padding:7px 12px; font-size:13px; }
.btn-link { background:none; border:none; color:var(--steel); font-size:13px; font-weight:600; cursor:pointer; padding:0; }
.icon-btn { background:none; border:none; cursor:pointer; color:var(--ink-500); padding:4px; display:flex; } .icon-btn:hover { color:var(--ink-900); }
.actions-row { display:flex; gap:6px; justify-content:flex-end; }
.pending-list { margin-top:12px; border-top:1px solid var(--line); padding-top:8px; max-height:220px; overflow-y:auto; }
.pending-row { display:flex; align-items:center; gap:10px; padding:6px 2px; font-size:13px; border-bottom:1px dashed var(--line); }
.pending-row > span:nth-child(2) { flex:1; color:var(--ink-500); } .hint { font-size:12px; color:var(--ink-500); margin-top:10px; }
.check-row { display:flex; align-items:center; gap:10px; padding:8px 2px; font-size:13px; border-bottom:1px solid var(--line); cursor:pointer; } .check-row:last-of-type { border-bottom:none; }
.seg { display:flex; gap:6px; margin-top:4px; } .seg-btn { flex:1; padding:8px; border-radius:7px; border:1px solid var(--line); background:var(--surface); font-size:13px; font-weight:600; color:var(--ink-500); cursor:pointer; }
.seg-active { background:var(--steel-soft); border-color:var(--steel); color:var(--steel); }
.ubq-terminal { background:var(--graphite-900); border-radius:10px; padding:16px 16px 12px; color:#CDEBE8; display:flex; flex-direction:column; height:100%; min-height:280px; }
.term-head { display:flex; align-items:center; gap:8px; margin-bottom:10px; font-family:'Space Grotesk',sans-serif; font-size:12px; letter-spacing:.06em; color:#8FB4C9; text-transform:uppercase; }
.term-title { flex:1; } .dot { width:7px; height:7px; border-radius:50%; background:#4A6883; } .dot-live { background:#2FC4BA; animation:pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 0%,100%{ opacity:1; } 50%{ opacity:.35; } }
.term-body { flex:1; overflow-y:auto; font-family:'IBM Plex Mono',monospace; font-size:12.5px; line-height:1.9; } .term-line { white-space:pre-wrap; word-break:break-word; }
.term-ts { color:#4FA39A; } .term-error { color:#F0917A; } .term-muted { color:#5E7C90; font-style:italic; } .term-cursor { color:#2FC4BA; animation:pulse 1s step-start infinite; }
.activity-list { display:flex; flex-direction:column; gap:2px; } .activity-row { display:flex; align-items:center; gap:10px; padding:7px 2px; font-size:13px; border-bottom:1px solid var(--line); }
.activity-row:last-child { border-bottom:none; } .dotkind { width:7px; height:7px; border-radius:50%; flex-shrink:0; } .dk-steel { background:var(--steel); } .dk-moss { background:var(--moss); }
.act-mid { flex:1; color:var(--ink-500); } .act-time { color:var(--ink-500); font-family:'IBM Plex Mono',monospace; font-size:12px; }
.pill { display:inline-block; padding:3px 9px; border-radius:20px; font-size:12px; font-weight:600; } .pill-steel { background:var(--steel-soft); color:var(--steel); }
.pill-amber { background:var(--amber-soft); color:var(--amber); } .pill-moss { background:var(--moss-soft); color:var(--moss); }
.ubq-table { width:100%; border-collapse:collapse; font-size:13.5px; } .ubq-table th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--ink-500); padding:6px 8px; border-bottom:1px solid var(--line); }
.ubq-table td { padding:9px 8px; border-bottom:1px solid var(--line); } .ubq-table tr:last-child td { border-bottom:none; }
.row-between { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; } .client-name { display:flex; align-items:center; gap:8px; font-weight:600; font-size:15px; }
.add-client-form { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; } .add-client-form input { flex:1; min-width:160px; }
.toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:var(--graphite-900); color:#fff; padding:12px 20px; border-radius:8px; font-size:14px; box-shadow:0 8px 24px rgba(0,0,0,.25); z-index:50; max-width:80vw; }
.modal-overlay { position:fixed; inset:0; background:rgba(15,30,45,.55); display:flex; align-items:center; justify-content:center; z-index:60; padding:20px; }
.modal-card { background:var(--surface); border-radius:12px; padding:22px; width:100%; max-width:420px; max-height:80vh; overflow-y:auto; }
.print-overlay { position:fixed; inset:0; background:rgba(15,30,45,.6); z-index:70; display:flex; flex-direction:column; align-items:center; overflow-y:auto; padding:24px; }
.print-toolbar { display:flex; gap:10px; margin-bottom:16px; } .print-sheet { background:#fff; width:100%; max-width:720px; padding:40px; border-radius:4px; box-shadow:0 10px 40px rgba(0,0,0,.3); color:#1A2530; }
.sheet-head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid var(--graphite-900); padding-bottom:16px; margin-bottom:14px; }
.sheet-brand { display:flex; align-items:center; gap:12px; } .sheet-mark { position:relative; width:34px; height:34px; flex-shrink:0; }
.mark-a, .mark-b { position:absolute; width:22px; height:22px; border-radius:50%; top:6px; } .mark-a { background:var(--steel); left:0; } .mark-b { background:var(--moss); left:12px; mix-blend-mode:multiply; opacity:.9; }
.sheet-company { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:19px; } .sheet-doc-meta { text-align:right; }
.sheet-doc-title { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:16px; color:var(--steel); letter-spacing:.04em; }
.sheet-legal-strip { border-bottom:1px solid var(--line); padding-bottom:12px; margin-bottom:16px; } .sheet-parties { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:6px; }
.sheet-total-row { display:flex; justify-content:space-between; align-items:baseline; border-top:2px solid var(--graphite-900); margin-top:18px; padding-top:14px; font-weight:600; } .sheet-total { font-family:'Space Grotesk',sans-serif; font-size:22px; }
.sheet-totals { margin-top:18px; margin-left:auto; width:260px; } .sheet-totals-row { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--line); font-size:13.5px; }
.sheet-totals-final { border-top:2px solid var(--graphite-900); border-bottom:none; margin-top:4px; padding-top:10px; font-weight:700; font-size:17px; font-family:'Space Grotesk',sans-serif; }
.sheet-footer { margin-top:26px; padding-top:14px; border-top:1px solid var(--line); line-height:1.6; }
.two-col { display:grid; grid-template-columns:1fr 1fr; gap:24px; } @media (max-width:700px){ .two-col { grid-template-columns:1fr; } .sheet-parties { grid-template-columns:1fr; } }
.portal-root { background:var(--paper); } .portal-login { width:100%; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
.portal-error { color:var(--amber); font-size:13px; margin-top:8px; } .portal-wrap { width:100%; }
.portal-top { display:flex; align-items:center; justify-content:space-between; padding:20px 28px; border-bottom:1px solid var(--line); background:var(--surface); }
.portal-body { padding:22px 28px 40px; max-width:900px; margin:0 auto; }
@media print { body * { visibility:hidden; } .print-sheet, .print-sheet * { visibility:visible; } .print-sheet { position:absolute; top:0; left:0; width:100%; box-shadow:none; } .no-print, .print-toolbar { display:none !important; } }
`;
