const express = require('express');
const QRCode = require('qrcode');
const bodyParser = require('body-parser');
const path = require('path');
const os = require('os');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password';
const MONGO_URI = process.env.MONGO_URI;

// ── MONGODB CONNECTION ─────────────────────────────────────────────────────────
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ── ASSET SCHEMA ───────────────────────────────────────────────────────────────
const assetSchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true },
  companyName: String,
  partNo:      String,
  partName:    String,
  size:        String,
  lotNo:       String,
  quantity:    String,
  packer:      String,
  month:       String,
  woNo:        String,
  createdAt:   String,
  updatedAt:   String,
  scanHistory: [{ timestamp: String, device: String }],
});

const Asset = mongoose.model('Asset', assetSchema);

// ── DB HELPERS (replaces loadAssets / saveAssets) ─────────────────────────────
async function getAllAssets() {
  const docs = await Asset.find({}).lean();
  const map = new Map();
  docs.forEach(d => { map.set(d.name, d); });
  return map;
}

async function upsertAsset(asset) {
  await Asset.findOneAndUpdate(
    { name: asset.name },
    asset,
    { upsert: true, new: true }
  );
}

async function deleteAsset(name) {
  await Asset.deleteOne({ name });
}

async function getAsset(name) {
  return Asset.findOne({ name }).lean();
}

async function pushScanHistory(name, entry) {
  await Asset.updateOne({ name }, { $push: { scanHistory: entry } });
}

// ── HELPERS ────────────────────────────────────────────────────────────────────
function getLocalNetworkIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

function getBaseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  if (req && req.headers.host) return `${req.secure ? 'https' : 'http'}://${req.headers.host}`;
  return `http://${getLocalNetworkIP()}:${port}`;
}

function buildQrContent(asset) {
  return `COMPANY:${asset.companyName},PARTNO:${asset.partNo},LOT:${asset.lotNo},QTY:${asset.quantity},PACKER:${asset.packer}`;
}

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const sessions = new Map();
function isAuthenticated(req) {
  const sid = req.headers.cookie?.split('sessionId=')[1]?.split(';')[0];
  return sid && sessions.has(sid);
}
function generateSessionId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// ── CSS ────────────────────────────────────────────────────────────────────────
const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #1a1a1a; background: #f5f6fa; line-height: 1.5; }
.sidebar { width: 220px; background: #1e293b; min-height: 100vh; position: fixed; top: 0; left: 0; display: flex; flex-direction: column; }
.sidebar-brand { padding: 20px 18px; border-bottom: 1px solid #334155; display: flex; align-items: center; gap: 10px; }
.brand-icon { width: 34px; height: 34px; background: #3b82f6; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.brand-icon svg { width: 18px; height: 18px; color: white; }
.brand-name { font-size: 14px; font-weight: 700; color: #f1f5f9; }
.brand-sub { font-size: 10px; color: #64748b; margin-top: 1px; }
.sidebar-nav { flex: 1; padding: 10px; }
.nav-section { font-size: 10px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.08em; padding: 10px 8px 5px; }
.nav-link { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border-radius: 6px; color: #94a3b8; text-decoration: none; font-size: 13px; font-weight: 500; margin-bottom: 1px; transition: background 0.12s, color 0.12s; }
.nav-link svg { width: 15px; height: 15px; flex-shrink: 0; }
.nav-link:hover { background: #334155; color: #e2e8f0; }
.nav-link.active { background: #3b82f6; color: #fff; }
.nav-link.red { color: #f87171; }
.nav-link.red:hover { background: rgba(239,68,68,0.1); color: #ef4444; }
.sidebar-footer { padding: 12px 10px; border-top: 1px solid #334155; }
.main { margin-left: 220px; padding: 28px 32px; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
.page-title { font-size: 20px; font-weight: 700; color: #0f172a; }
.page-sub { font-size: 13px; color: #64748b; margin-top: 3px; }
.card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; margin-bottom: 20px; }
.card-header { padding: 13px 20px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; background: #f8fafc; }
.card-title { font-size: 13px; font-weight: 600; color: #374151; }
.card-body { padding: 20px; }
.stats-row { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; margin-bottom: 22px; }
.stat-box { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px 20px; }
.stat-label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
.stat-number { font-size: 28px; font-weight: 700; color: #0f172a; line-height: 1; }
.stat-note { font-size: 11px; color: #9ca3af; margin-top: 4px; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; text-decoration: none; border: 1px solid transparent; transition: all 0.12s; white-space: nowrap; font-family: inherit; }
.btn svg { width: 13px; height: 13px; flex-shrink: 0; }
.btn-primary { background: #3b82f6; color: #fff; border-color: #3b82f6; }
.btn-primary:hover { background: #2563eb; }
.btn-secondary { background: #fff; color: #374151; border-color: #d1d5db; }
.btn-secondary:hover { background: #f9fafb; }
.btn-danger { background: #fff; color: #ef4444; border-color: #fca5a5; }
.btn-danger:hover { background: #fef2f2; }
.btn-warning { background: #fff; color: #d97706; border-color: #fcd34d; }
.btn-warning:hover { background: #fffbeb; }
.btn-sm { padding: 5px 10px; font-size: 12px; }
.btn-block { display: flex; width: 100%; justify-content: center; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
.form-1 { margin-bottom: 16px; }
label { display: block; font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 5px; }
input[type=text], input[type=password], input[type=number], select, textarea { width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; font-family: inherit; color: #1a1a1a; transition: border-color 0.12s, box-shadow 0.12s; outline: none; }
input:focus, select:focus, textarea:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
input::placeholder { color: #9ca3af; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th { padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #e5e7eb; background: #f9fafb; }
td { padding: 11px 16px; font-size: 13px; color: #374151; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: #f9fafb; }
td a.link { color: #3b82f6; text-decoration: none; font-weight: 500; }
td a.link:hover { text-decoration: underline; }
.badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }
.badge-blue { background: #eff6ff; color: #3b82f6; }
.badge-green { background: #f0fdf4; color: #16a34a; }
.badge-gray { background: #f3f4f6; color: #6b7280; }
.alert { padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 16px; }
.alert-error { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }
.alert-success { background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.detail-label { font-size: 11px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px; }
.detail-value { font-size: 14px; font-weight: 500; color: #111827; }
.qr-wrap { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; display: inline-block; }
.empty { padding: 48px 24px; text-align: center; color: #9ca3af; }
.empty svg { width: 36px; height: 36px; margin: 0 auto 12px; display: block; opacity: 0.3; }
.empty p { margin-bottom: 16px; }
.status-online { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: #16a34a; font-weight: 500; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
.auth-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f5f6fa; padding: 16px; }
hr { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.grid-aside { display: grid; grid-template-columns: 1fr 280px; gap: 20px; }
.mob-header { display: none; position: fixed; top: 0; left: 0; right: 0; z-index: 200; background: #1e293b; padding: 11px 16px; align-items: center; justify-content: space-between; }
.mob-nav { display: none; position: fixed; bottom: 0; left: 0; right: 0; z-index: 200; background: #fff; border-top: 1px solid #e5e7eb; }
.mob-nav-inner { display: flex; }
.mob-nav-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 4px; color: #9ca3af; text-decoration: none; font-size: 10px; font-weight: 500; }
.mob-nav-item svg { width: 19px; height: 19px; }
.mob-nav-item.active { color: #3b82f6; }
.bulk-bar { display: none; position: sticky; top: 0; z-index: 100; background: #1e293b; color: #fff; padding: 10px 16px; border-radius: 8px; margin-bottom: 16px; align-items: center; justify-content: space-between; gap: 12px; }
.bulk-bar.visible { display: flex; }
.bulk-bar-left { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 600; }
.bulk-bar-count { background: #3b82f6; color: #fff; border-radius: 99px; padding: 2px 10px; font-size: 12px; font-weight: 700; }
.bulk-bar-right { display: flex; gap: 8px; }
.label-card-wrap { position: relative; }
.label-card-wrap.selected-card > div:first-child { outline: 3px solid #3b82f6; outline-offset: 2px; }
.label-select-cb { position: absolute; top: 8px; left: 8px; z-index: 10; width: 20px; height: 20px; cursor: pointer; accent-color: #3b82f6; }
.print-modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; padding: 16px; }
.print-modal-overlay.open { display: flex; }
.print-modal { background: #fff; border-radius: 12px; width: 100%; max-width: 520px; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
.print-modal-header { padding: 18px 20px; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: space-between; }
.print-modal-title { font-size: 15px; font-weight: 700; color: #0f172a; }
.print-modal-close { width: 28px; height: 28px; border-radius: 6px; border: 1px solid #e5e7eb; background: #f9fafb; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; color: #6b7280; line-height: 1; }
.print-modal-close:hover { background: #fee2e2; color: #ef4444; border-color: #fca5a5; }
.print-modal-body { padding: 20px; }
.print-modal-footer { padding: 14px 20px; border-top: 1px solid #e5e7eb; display: flex; gap: 8px; justify-content: flex-end; }
.print-option-group { margin-bottom: 18px; }
.print-option-label { font-size: 11px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 8px; }
.print-option-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 6px; }
.print-option-grid.cols-3 { grid-template-columns: repeat(3,1fr); }
.print-option-grid.cols-2 { grid-template-columns: repeat(2,1fr); }
.print-opt-btn { border: 2px solid #e5e7eb; border-radius: 7px; padding: 8px 6px; text-align: center; cursor: pointer; transition: all 0.12s; background: #fff; font-family: inherit; }
.print-opt-btn:hover { border-color: #93c5fd; background: #eff6ff; }
.print-opt-btn.selected { border-color: #3b82f6; background: #eff6ff; color: #1d4ed8; }
.print-opt-btn .opt-num { font-size: 18px; font-weight: 800; color: #0f172a; line-height: 1; }
.print-opt-btn.selected .opt-num { color: #1d4ed8; }
.print-opt-btn .opt-lbl { font-size: 9px; color: #6b7280; font-weight: 600; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.05em; }
.print-opt-btn.selected .opt-lbl { color: #3b82f6; }
.print-toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
.print-toggle-row:last-child { border-bottom: none; }
.print-toggle-info .ptl { font-size: 13px; font-weight: 500; color: #111; }
.print-toggle-info .pts { font-size: 11px; color: #9ca3af; margin-top: 1px; }
.toggle-switch { position: relative; width: 38px; height: 22px; flex-shrink: 0; }
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-slider { position: absolute; inset: 0; background: #d1d5db; border-radius: 99px; cursor: pointer; transition: background 0.2s; }
.toggle-slider:before { content: ''; position: absolute; width: 16px; height: 16px; background: #fff; border-radius: 50%; top: 3px; left: 3px; transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
.toggle-switch input:checked + .toggle-slider { background: #3b82f6; }
.toggle-switch input:checked + .toggle-slider:before { transform: translateX(16px); }
.print-preview-bar { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; margin-bottom: 18px; }
.print-preview-title { font-size: 11px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 8px; }
.print-preview-grid { display: flex; gap: 3px; flex-wrap: wrap; }
.print-preview-cell { background: #e2e8f0; border-radius: 3px; border: 1px solid #cbd5e1; }
.ami-label { width: 560px; border: 2.5px solid #111; font-family: 'Courier New', Courier, monospace; background: #fff; color: #111; font-size: 12px; }
.ami-label * { box-sizing: border-box; }
.ami-label-header { display: flex; align-items: stretch; border-bottom: 2px solid #111; }
.ami-label-company { flex: 1; padding: 8px 14px; border-right: 2px solid #111; }
.ami-label-company .co-name { font-size: 13px; font-weight: bold; letter-spacing: 0.03em; line-height: 1.3; }
.ami-label-amino { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px 18px; border-right: 2px solid #111; min-width: 80px; text-align: center; }
.ami-label-amino .ami-star { font-size: 10px; font-weight: bold; letter-spacing: 0.12em; }
.ami-label-amino .ami-num { font-size: 26px; font-weight: bold; line-height: 1; }
.ami-label-rohs { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px 14px; min-width: 90px; text-align: center; }
.ami-label-rohs .rohs-box { border: 2px solid #111; padding: 4px 8px; font-size: 10px; font-weight: bold; letter-spacing: 0.06em; line-height: 1.4; text-align: center; }
.ami-field-row { display: grid; border-bottom: 1.5px solid #111; }
.ami-field-row.cols-2 { grid-template-columns: 1fr 1fr; }
.ami-field { padding: 7px 14px; }
.ami-field + .ami-field { border-left: 1.5px solid #111; }
.ami-field .f-label { font-size: 9px; font-weight: bold; letter-spacing: 0.12em; text-transform: uppercase; color: #555; margin-bottom: 3px; }
.ami-field .f-value { font-size: 15px; font-weight: bold; letter-spacing: 0.03em; }
.ami-field .f-value.mono { font-family: 'Courier New', monospace; }
.ami-field .f-value.large { font-size: 18px; }
.ami-label-bottom { display: flex; align-items: stretch; min-height: 130px; }
.ami-qr-cell { border-right: 1.5px solid #111; padding: 10px 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 115px; }
.ami-qr-cell .qr-label-text { font-size: 8px; font-weight: bold; letter-spacing: 0.1em; color: #555; margin-bottom: 5px; text-transform: uppercase; }
.ami-qr-cell img { width: 88px; height: 88px; display: block; }
.ami-qr-cell .qr-scan-text { font-size: 7px; color: #888; margin-top: 4px; letter-spacing: 0.06em; text-align: center; }
.ami-wo-cell { flex: 1; padding: 10px 14px; display: flex; flex-direction: column; justify-content: center; gap: 8px; }
.ami-wo-cell .wo-label { font-size: 9px; font-weight: bold; letter-spacing: 0.1em; color: #555; margin-bottom: 2px; }
.ami-wo-cell .wo-value { font-size: 11px; font-weight: bold; letter-spacing: 0.04em; }
.select-all-row { display: flex; align-items: center; gap: 10px; padding: 10px 0; margin-bottom: 8px; }
.select-all-row label { font-size: 13px; font-weight: 600; color: #374151; cursor: pointer; margin-bottom: 0; }
.scanner-info-banner { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 10px 14px; font-size: 12px; color: #1d4ed8; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
@media (max-width: 768px) {
  .sidebar { display: none; }
  .main { margin-left: 0; padding: 62px 16px 70px; }
  .mob-header { display: flex; }
  .mob-nav { display: block; }
  .stats-row, .grid-2, .grid-aside, .form-row { grid-template-columns: 1fr; }
  .page-header { flex-direction: column; gap: 12px; }
  .detail-grid { grid-template-columns: 1fr 1fr; }
  .ami-label { width: 100%; font-size: 11px; }
  .ami-label-amino .ami-num { font-size: 20px; }
  .print-option-grid { grid-template-columns: repeat(2,1fr); }
}`;

const HEAD = (title) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} &mdash; AMI QR Portal</title>
  <style>${CSS}</style>
</head>`;

const I = {
  qr:`<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/></svg>`,
  dash:`<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
  plus:`<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>`,
  list:`<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>`,
  scan:`<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
  logout:`<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>`,
  box:`<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>`,
  download:`<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>`,
  print:`<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>`,
  trash:`<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>`,
  eye:`<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>`,
  label:`<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"/></svg>`,
  edit:`<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>`,
};

const SIDEBAR_HTML = (active) => `
<aside class="sidebar">
  <div class="sidebar-brand">
    <div class="brand-icon">${I.qr}</div>
    <div><div class="brand-name">AMI QR System</div><div class="brand-sub">Production Portal</div></div>
  </div>
  <nav class="sidebar-nav">
    <div class="nav-section">Menu</div>
    <a href="/" class="nav-link ${active==='home'?'active':''}">${I.dash} Dashboard</a>
    <a href="/generate-form" class="nav-link ${active==='gen'?'active':''}">${I.plus} Generate Label</a>
    <a href="/list" class="nav-link ${active==='list'?'active':''}">${I.list} All Assets</a>
    <a href="/labels" class="nav-link ${active==='labels'?'active':''}">${I.label} Labels</a>
    <a href="/qr/all" class="nav-link ${active==='gallery'?'active':''}">${I.qr} QR Gallery</a>
    <div class="nav-section">Tools</div>
    <a href="/scan" class="nav-link ${active==='scan'?'active':''}">${I.scan} Scan QR Code</a>
  </nav>
  <div class="sidebar-footer"><a href="/logout" class="nav-link red">${I.logout} Sign Out</a></div>
</aside>`;

const MOB_HEADER = () => `<div class="mob-header">
  <div style="display:flex;align-items:center;gap:8px;">
    <div class="brand-icon" style="width:28px;height:28px;border-radius:6px;">${I.qr}</div>
    <span style="font-size:14px;font-weight:700;color:#f1f5f9;">AMI QR System</span>
  </div>
  <a href="/logout" style="color:#f87171;font-size:12px;font-weight:500;text-decoration:none;">Sign Out</a>
</div>`;

const MOB_NAV = (active) => `<div class="mob-nav"><div class="mob-nav-inner">
  <a href="/" class="mob-nav-item ${active==='home'?'active':''}">${I.dash}<span>Home</span></a>
  <a href="/generate-form" class="mob-nav-item ${active==='gen'?'active':''}">${I.plus}<span>New</span></a>
  <a href="/list" class="mob-nav-item ${active==='list'?'active':''}">${I.list}<span>Assets</span></a>
  <a href="/labels" class="mob-nav-item ${active==='labels'?'active':''}">${I.label}<span>Labels</span></a>
  <a href="/scan" class="mob-nav-item ${active==='scan'?'active':''}">${I.scan}<span>Scan</span></a>
</div></div>`;

const LAYOUT = (content, active='') => `${SIDEBAR_HTML(active)}${MOB_HEADER()}${MOB_NAV(active)}<main class="main">${content}</main></body></html>`;

const SCANNER_BANNER = `<div class="scanner-info-banner">
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
  <span><strong>Scanner Ready:</strong> QR encodes full label details &mdash; scan with your barcode scanner to output all fields directly.</span>
</div>`;

// ── PRINT MODAL HTML ───────────────────────────────────────────────────────────
function printModalHTML() {
  return `<div class="print-modal-overlay" id="printModalOverlay">
  <div class="print-modal">
    <div class="print-modal-header">
      <div class="print-modal-title">${I.print} Print Settings</div>
      <button class="print-modal-close" id="closeModal">&#x2715;</button>
    </div>
    <div class="print-modal-body">
      <div class="print-preview-bar">
        <div class="print-preview-title">Page Layout Preview</div>
        <div id="previewGrid" class="print-preview-grid"></div>
        <div id="previewInfo" style="font-size:11px;color:#64748b;margin-top:6px;"></div>
      </div>
      <div class="print-option-group">
        <div class="print-option-label">Labels Per Page</div>
        <div class="print-option-grid" id="perPageGrid">
          <button class="print-opt-btn" data-perpg="1" onclick="setPerPage(1)"><div class="opt-num">1</div><div class="opt-lbl">1&times;1</div></button>
          <button class="print-opt-btn" data-perpg="2" onclick="setPerPage(2)"><div class="opt-num">2</div><div class="opt-lbl">1&times;2</div></button>
          <button class="print-opt-btn selected" data-perpg="4" onclick="setPerPage(4)"><div class="opt-num">4</div><div class="opt-lbl">2&times;2</div></button>
          <button class="print-opt-btn" data-perpg="6" onclick="setPerPage(6)"><div class="opt-num">6</div><div class="opt-lbl">2&times;3</div></button>
          <button class="print-opt-btn" data-perpg="8" onclick="setPerPage(8)"><div class="opt-num">8</div><div class="opt-lbl">2&times;4</div></button>
        </div>
      </div>
      <div class="print-option-group">
        <div class="print-option-label">Total Copies</div>
        <div class="print-option-grid cols-3" id="copiesGrid">
          <button class="print-opt-btn selected" data-copies="auto" onclick="setCopies('auto')"><div class="opt-num">Auto</div><div class="opt-lbl">1 page</div></button>
          <button class="print-opt-btn" data-copies="8" onclick="setCopies(8)"><div class="opt-num">8</div><div class="opt-lbl">copies</div></button>
          <button class="print-opt-btn" data-copies="12" onclick="setCopies(12)"><div class="opt-num">12</div><div class="opt-lbl">copies</div></button>
          <button class="print-opt-btn" data-copies="16" onclick="setCopies(16)"><div class="opt-num">16</div><div class="opt-lbl">copies</div></button>
          <button class="print-opt-btn" data-copies="24" onclick="setCopies(24)"><div class="opt-num">24</div><div class="opt-lbl">copies</div></button>
          <button class="print-opt-btn" data-copies="custom" onclick="setCopies('custom')"><div class="opt-num">&#x270F;</div><div class="opt-lbl">custom</div></button>
        </div>
        <div id="customCopiesWrap" style="display:none;margin-top:8px;">
          <input type="number" id="customCopiesInput" min="1" max="200" value="10" oninput="updatePreview()">
        </div>
      </div>
      <div class="print-option-group">
        <div class="print-option-label">Page Size</div>
        <div class="print-option-grid cols-3" id="pageSizeGrid">
          <button class="print-opt-btn selected" data-pgsz="A4L" onclick="setPageSize('A4L')"><div class="opt-num" style="font-size:12px;">A4</div><div class="opt-lbl">Landscape</div></button>
          <button class="print-opt-btn" data-pgsz="A4" onclick="setPageSize('A4')"><div class="opt-num" style="font-size:12px;">A4</div><div class="opt-lbl">Portrait</div></button>
          <button class="print-opt-btn" data-pgsz="A5L" onclick="setPageSize('A5L')"><div class="opt-num" style="font-size:12px;">A5</div><div class="opt-lbl">Landscape</div></button>
          <button class="print-opt-btn" data-pgsz="A5" onclick="setPageSize('A5')"><div class="opt-num" style="font-size:12px;">A5</div><div class="opt-lbl">Portrait</div></button>
          <button class="print-opt-btn" data-pgsz="Letter" onclick="setPageSize('Letter')"><div class="opt-num" style="font-size:12px;">Ltr</div><div class="opt-lbl">Landscape</div></button>
          <button class="print-opt-btn" data-pgsz="LetterP" onclick="setPageSize('LetterP')"><div class="opt-num" style="font-size:12px;">Ltr</div><div class="opt-lbl">Portrait</div></button>
        </div>
      </div>
      <div class="print-option-group">
        <div class="print-option-label">Label Options</div>
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:0 12px;">
          <div class="print-toggle-row">
            <div class="print-toggle-info"><div class="ptl">Show QR Code</div><div class="pts">Include QR on each label</div></div>
            <label class="toggle-switch"><input type="checkbox" id="togQR" checked onchange="updatePreview()"><span class="toggle-slider"></span></label>
          </div>
          <div class="print-toggle-row">
            <div class="print-toggle-info"><div class="ptl">Show Company Header</div><div class="pts">Company name and AMI number</div></div>
            <label class="toggle-switch"><input type="checkbox" id="togCompany" checked onchange="updatePreview()"><span class="toggle-slider"></span></label>
          </div>
          <div class="print-toggle-row">
            <div class="print-toggle-info"><div class="ptl">Show Border</div><div class="pts">Bold outer border</div></div>
            <label class="toggle-switch"><input type="checkbox" id="togBorder" checked onchange="updatePreview()"><span class="toggle-slider"></span></label>
          </div>
        </div>
      </div>
    </div>
    <div class="print-modal-footer">
      <button class="btn btn-secondary" id="cancelPrintBtn">Cancel</button>
      <button class="btn btn-primary" id="confirmPrintBtn">${I.print} Print Now</button>
    </div>
  </div>
</div>`;
}

function printModalScript(qrDataUrl, assetJSON) {
  return `<script>
(function(){
  var state={perPage:4,cols:2,rows:2,copies:'auto',pageSize:'A4L',showQR:true,showCompany:true,showBorder:true};
  var ASSET=${JSON.stringify(assetJSON)};
  var QR_DATA_URL=${JSON.stringify(qrDataUrl)};
  var LAYOUTS={1:[1,1],2:[1,2],4:[2,2],6:[2,3],8:[2,4]};
  window.setPerPage=function(n){state.perPage=n;var l=LAYOUTS[n]||[2,2];state.cols=l[0];state.rows=l[1];document.querySelectorAll('#perPageGrid .print-opt-btn').forEach(function(b){b.classList.toggle('selected',parseInt(b.dataset.perpg)===n);});updatePreview();};
  window.setCopies=function(v){state.copies=v;document.getElementById('customCopiesWrap').style.display=(v==='custom')?'block':'none';document.querySelectorAll('#copiesGrid .print-opt-btn').forEach(function(b){b.classList.toggle('selected',b.dataset.copies===String(v));});updatePreview();};
  window.setPageSize=function(v){state.pageSize=v;document.querySelectorAll('#pageSizeGrid .print-opt-btn').forEach(function(b){b.classList.toggle('selected',b.dataset.pgsz===v);});updatePreview();};
  window.updatePreview=function(){
    state.showQR=document.getElementById('togQR').checked;
    state.showCompany=document.getElementById('togCompany').checked;
    state.showBorder=document.getElementById('togBorder').checked;
    var tc=state.copies==='auto'?state.perPage:state.copies==='custom'?(parseInt(document.getElementById('customCopiesInput').value)||state.perPage):parseInt(state.copies);
    var pages=Math.ceil(tc/state.perPage);
    var grid=document.getElementById('previewGrid');
    var info=document.getElementById('previewInfo');
    grid.innerHTML='';grid.style.cssText='display:grid;grid-template-columns:repeat('+state.cols+',1fr);gap:3px;max-width:200px;';
    for(var i=0;i<state.perPage;i++){var c=document.createElement('div');c.className='print-preview-cell';c.style.height='20px';grid.appendChild(c);}
    info.textContent=tc+' label'+(tc!==1?'s':'')+' \u2022 '+pages+' page'+(pages!==1?'s':'')+' \u2022 '+state.cols+'\u00D7'+state.rows+' layout';
  };
  function escH(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function buildLabelHTML(a,qr,showQR,showCompany,border,inner){
    var mn=('0'+(a.month||'03')).slice(-2);
    return '<div style="border:'+border+';font-family:Courier New,monospace;background:#fff;color:#111;page-break-inside:avoid;break-inside:avoid;box-sizing:border-box;">'+
      (showCompany?'<div style="display:flex;align-items:stretch;border-bottom:'+inner+';">'+
        '<div style="flex:1;padding:5px 10px;border-right:'+inner+';"><div style="font-size:7px;font-weight:bold;color:#555;">COMPANY</div><div style="font-size:10px;font-weight:bold;">'+escH(a.companyName.toUpperCase())+'</div></div>'+
        '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5px 10px;border-right:'+inner+';min-width:56px;text-align:center;"><div style="font-size:7px;font-weight:bold;letter-spacing:0.1em;">* AMI *</div><div style="font-size:19px;font-weight:bold;line-height:1;">'+mn+'</div></div>'+
        '<div style="display:flex;align-items:center;justify-content:center;padding:5px 9px;"><div style="border:'+inner+';padding:3px 5px;font-size:8px;font-weight:bold;line-height:1.3;text-align:center;">ROHS 2<br>FREE</div></div>'+
      '</div>':'')+
      '<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:'+inner+';"><div style="padding:4px 10px;"><div style="font-size:7px;font-weight:bold;color:#555;">PART NO.</div><div style="font-size:11px;font-weight:bold;font-family:Courier New,monospace;">'+escH(a.partNo)+'</div></div><div style="padding:4px 10px;border-left:'+inner+';"><div style="font-size:7px;font-weight:bold;color:#555;">PART NAME</div><div style="font-size:11px;font-weight:bold;">'+escH(a.partName)+'</div></div></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:'+inner+';"><div style="padding:4px 10px;"><div style="font-size:7px;font-weight:bold;color:#555;">SIZE</div><div style="font-size:11px;font-weight:bold;">'+escH(a.size||'\u2014')+'</div></div><div style="padding:4px 10px;border-left:'+inner+';"><div style="font-size:7px;font-weight:bold;color:#555;">LOT NO.</div><div style="font-size:11px;font-weight:bold;font-family:Courier New,monospace;">'+escH(a.lotNo)+'</div></div></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:'+inner+';"><div style="padding:4px 10px;"><div style="font-size:7px;font-weight:bold;color:#555;">QUANTITY</div><div style="font-size:13px;font-weight:bold;">'+escH(a.quantity)+'</div></div><div style="padding:4px 10px;border-left:'+inner+';"><div style="font-size:7px;font-weight:bold;color:#555;">PACKER</div><div style="font-size:11px;font-weight:bold;">'+escH(a.packer)+'</div></div></div>'+
      '<div style="display:flex;align-items:stretch;min-height:76px;">'+
        (showQR?'<div style="border-right:'+inner+';padding:6px 8px;display:flex;flex-direction:column;align-items:center;justify-content:center;"><div style="font-size:6px;font-weight:bold;color:#555;margin-bottom:3px;">QR CODE</div><img src="'+qr+'" style="width:58px;height:58px;display:block;"><div style="font-size:6px;color:#888;margin-top:2px;">SCAN FOR DETAILS</div></div>':'')+
        '<div style="flex:1;padding:8px 10px;display:flex;flex-direction:column;justify-content:center;gap:4px;"><div style="font-size:7px;font-weight:bold;color:#555;">WO NO.</div><div style="font-size:10px;font-weight:bold;font-family:Courier New,monospace;">'+escH(a.woNo||'\u2014')+'</div></div>'+
      '</div></div>';
  }
  document.getElementById('openPrintModal').addEventListener('click',function(){document.getElementById('printModalOverlay').classList.add('open');updatePreview();});
  document.getElementById('closeModal').addEventListener('click',function(){document.getElementById('printModalOverlay').classList.remove('open');});
  document.getElementById('cancelPrintBtn').addEventListener('click',function(){document.getElementById('printModalOverlay').classList.remove('open');});
  document.getElementById('printModalOverlay').addEventListener('click',function(e){if(e.target===this)this.classList.remove('open');});
  document.getElementById('confirmPrintBtn').addEventListener('click',function(){
    state.showQR=document.getElementById('togQR').checked;
    state.showCompany=document.getElementById('togCompany').checked;
    state.showBorder=document.getElementById('togBorder').checked;
    var tc=state.copies==='auto'?state.perPage:state.copies==='custom'?Math.min(200,Math.max(1,parseInt(document.getElementById('customCopiesInput').value)||state.perPage)):parseInt(state.copies);
    var border=state.showBorder?'2.5px solid #111':'1px solid #ccc';
    var inner=state.showBorder?'1.5px solid #111':'1px solid #ddd';
    var psCSS={'A4':'size:A4 portrait','A4L':'size:A4 landscape','A5':'size:A5 portrait','A5L':'size:A5 landscape','Letter':'size:Letter landscape','LetterP':'size:Letter portrait'}[state.pageSize]||'size:A4 landscape';
    var html='';for(var i=0;i<tc;i++)html+=buildLabelHTML(ASSET,QR_DATA_URL,state.showQR,state.showCompany,border,inner);
    var old=document.getElementById('dynamicPrintStyle');if(old)old.remove();
    var s=document.createElement('style');s.id='dynamicPrintStyle';
    s.innerHTML='@media print{@page{margin:8mm;'+psCSS+';}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}html,body{margin:0!important;padding:0!important;}body *{visibility:hidden!important;}#printSheet,#printSheet *{visibility:visible!important;}#printSheet{position:fixed!important;top:0!important;left:0!important;width:100%!important;display:grid!important;grid-template-columns:repeat('+state.cols+',1fr)!important;gap:6mm!important;box-sizing:border-box!important;padding:0!important;margin:0!important;background:#fff!important;}}';
    document.head.appendChild(s);
    var sheet=document.getElementById('printSheet');if(!sheet){sheet=document.createElement('div');sheet.id='printSheet';document.body.appendChild(sheet);}
    sheet.innerHTML=html;sheet.style.cssText='display:none;';
    document.getElementById('printModalOverlay').classList.remove('open');
    setTimeout(function(){sheet.style.display='grid';sheet.style.gridTemplateColumns='repeat('+state.cols+',1fr)';sheet.style.gap='6mm';requestAnimationFrame(function(){requestAnimationFrame(function(){window.print();setTimeout(function(){sheet.style.display='none';sheet.innerHTML='';},1500);});});},200);
  });
  updatePreview();
})();
<\/script>`;
}

// ── BULK PRINT MODAL ───────────────────────────────────────────────────────────
function bulkPrintModalHTML() {
  return `<div class="print-modal-overlay" id="bulkPrintModalOverlay">
  <div class="print-modal">
    <div class="print-modal-header">
      <div class="print-modal-title">${I.print} Bulk Print Settings</div>
      <button class="print-modal-close" id="closeBulkModal">&#x2715;</button>
    </div>
    <div class="print-modal-body">
      <div id="bulkSelectedSummary" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:7px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:#1d4ed8;font-weight:600;"></div>
      <div class="print-preview-bar">
        <div class="print-preview-title">Layout Preview</div>
        <div id="bulkPreviewGrid" class="print-preview-grid"></div>
        <div id="bulkPreviewInfo" style="font-size:11px;color:#64748b;margin-top:6px;"></div>
      </div>
      <div class="print-option-group">
        <div class="print-option-label">Labels Per Page</div>
        <div class="print-option-grid" id="bulkPerPageGrid">
          <button class="print-opt-btn" data-perpg="1" onclick="bulkSetPerPage(1)"><div class="opt-num">1</div><div class="opt-lbl">1&times;1</div></button>
          <button class="print-opt-btn" data-perpg="2" onclick="bulkSetPerPage(2)"><div class="opt-num">2</div><div class="opt-lbl">1&times;2</div></button>
          <button class="print-opt-btn selected" data-perpg="3" onclick="bulkSetPerPage(3)"><div class="opt-num">3</div><div class="opt-lbl">3&times;1</div></button>
          <button class="print-opt-btn" data-perpg="4" onclick="bulkSetPerPage(4)"><div class="opt-num">4</div><div class="opt-lbl">2&times;2</div></button>
          <button class="print-opt-btn" data-perpg="6" onclick="bulkSetPerPage(6)"><div class="opt-num">6</div><div class="opt-lbl">2&times;3</div></button>
          <button class="print-opt-btn" data-perpg="8" onclick="bulkSetPerPage(8)"><div class="opt-num">8</div><div class="opt-lbl">2&times;4</div></button>
        </div>
      </div>
      <div class="print-option-group">
        <div class="print-option-label">Copies Per Label</div>
        <div class="print-option-grid cols-3" id="bulkCopiesGrid">
          <button class="print-opt-btn selected" data-copies="1" onclick="bulkSetCopies(1)"><div class="opt-num">1</div><div class="opt-lbl">copy</div></button>
          <button class="print-opt-btn" data-copies="2" onclick="bulkSetCopies(2)"><div class="opt-num">2</div><div class="opt-lbl">copies</div></button>
          <button class="print-opt-btn" data-copies="3" onclick="bulkSetCopies(3)"><div class="opt-num">3</div><div class="opt-lbl">copies</div></button>
          <button class="print-opt-btn" data-copies="4" onclick="bulkSetCopies(4)"><div class="opt-num">4</div><div class="opt-lbl">copies</div></button>
          <button class="print-opt-btn" data-copies="6" onclick="bulkSetCopies(6)"><div class="opt-num">6</div><div class="opt-lbl">copies</div></button>
          <button class="print-opt-btn" data-copies="custom" onclick="bulkSetCopies('custom')"><div class="opt-num">&#x270F;</div><div class="opt-lbl">custom</div></button>
        </div>
        <div id="bulkCustomCopiesWrap" style="display:none;margin-top:8px;">
          <input type="number" id="bulkCustomCopiesInput" min="1" max="50" value="2" oninput="bulkUpdatePreview()">
        </div>
      </div>
      <div class="print-option-group">
        <div class="print-option-label">Page Size</div>
        <div class="print-option-grid cols-3" id="bulkPageSizeGrid">
          <button class="print-opt-btn selected" data-pgsz="A4L" onclick="bulkSetPageSize('A4L')"><div class="opt-num" style="font-size:12px;">A4</div><div class="opt-lbl">Landscape</div></button>
          <button class="print-opt-btn" data-pgsz="A4" onclick="bulkSetPageSize('A4')"><div class="opt-num" style="font-size:12px;">A4</div><div class="opt-lbl">Portrait</div></button>
          <button class="print-opt-btn" data-pgsz="A5L" onclick="bulkSetPageSize('A5L')"><div class="opt-num" style="font-size:12px;">A5</div><div class="opt-lbl">Landscape</div></button>
          <button class="print-opt-btn" data-pgsz="A5" onclick="bulkSetPageSize('A5')"><div class="opt-num" style="font-size:12px;">A5</div><div class="opt-lbl">Portrait</div></button>
          <button class="print-opt-btn" data-pgsz="Letter" onclick="bulkSetPageSize('Letter')"><div class="opt-num" style="font-size:12px;">Ltr</div><div class="opt-lbl">Landscape</div></button>
          <button class="print-opt-btn" data-pgsz="LetterP" onclick="bulkSetPageSize('LetterP')"><div class="opt-num" style="font-size:12px;">Ltr</div><div class="opt-lbl">Portrait</div></button>
        </div>
      </div>
      <div class="print-option-group">
        <div class="print-option-label">Label Options</div>
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:0 12px;">
          <div class="print-toggle-row"><div class="print-toggle-info"><div class="ptl">Show QR Code</div></div><label class="toggle-switch"><input type="checkbox" id="bulkTogQR" checked onchange="bulkUpdatePreview()"><span class="toggle-slider"></span></label></div>
          <div class="print-toggle-row"><div class="print-toggle-info"><div class="ptl">Show Company Header</div></div><label class="toggle-switch"><input type="checkbox" id="bulkTogCompany" checked onchange="bulkUpdatePreview()"><span class="toggle-slider"></span></label></div>
          <div class="print-toggle-row"><div class="print-toggle-info"><div class="ptl">Show Border</div></div><label class="toggle-switch"><input type="checkbox" id="bulkTogBorder" checked onchange="bulkUpdatePreview()"><span class="toggle-slider"></span></label></div>
        </div>
      </div>
    </div>
    <div class="print-modal-footer">
      <button class="btn btn-secondary" id="cancelBulkPrintBtn">Cancel</button>
      <button class="btn btn-primary" id="confirmBulkPrintBtn">${I.print} Print Now</button>
    </div>
  </div>
</div>`;
}

function bulkPrintScript(assetsWithQR) {
  return `<script>
(function(){
  var BULK_ASSETS=${JSON.stringify(assetsWithQR)};
  var bulkState={perPage:3,cols:3,rows:1,copies:1,pageSize:'A4L',showQR:true,showCompany:true,showBorder:true};
  var BULK_LAYOUTS={1:[1,1],2:[1,2],3:[3,1],4:[2,2],6:[2,3],8:[2,4]};
  var selectedKeys=[];
  function updateBulkBar(){
    var bar=document.getElementById('bulkBar');
    var countEl=document.getElementById('bulkBarCount');
    selectedKeys=[];
    document.querySelectorAll('.label-select-cb:checked').forEach(function(cb){selectedKeys.push(cb.dataset.key);});
    if(selectedKeys.length>0){bar.classList.add('visible');countEl.textContent=selectedKeys.length+' selected';}
    else bar.classList.remove('visible');
  }
  document.querySelectorAll('.label-select-cb').forEach(function(cb){
    cb.addEventListener('change',function(){
      var wrap=this.closest('.label-card-wrap');
      if(this.checked)wrap.classList.add('selected-card');else wrap.classList.remove('selected-card');
      updateBulkBar();
    });
  });
  var saCb=document.getElementById('selectAllCb');
  if(saCb)saCb.addEventListener('change',function(){
    document.querySelectorAll('.label-select-cb').forEach(function(cb){
      cb.checked=saCb.checked;
      var wrap=cb.closest('.label-card-wrap');
      if(saCb.checked)wrap.classList.add('selected-card');else wrap.classList.remove('selected-card');
    });
    updateBulkBar();
  });
  document.getElementById('bulkPrintBtn').addEventListener('click',function(){
    if(selectedKeys.length===0){alert('Please select at least one label.');return;}
    var names=selectedKeys.map(function(k){var a=BULK_ASSETS[k];return a?(a.partName+' ('+a.partNo+')'):k;});
    document.getElementById('bulkSelectedSummary').innerHTML='&#x2713; Printing <strong>'+selectedKeys.length+' label'+(selectedKeys.length>1?'s':'')+'</strong>: '+names.join(', ');
    document.getElementById('bulkPrintModalOverlay').classList.add('open');
    bulkUpdatePreview();
  });
  document.getElementById('closeBulkModal').addEventListener('click',function(){document.getElementById('bulkPrintModalOverlay').classList.remove('open');});
  document.getElementById('cancelBulkPrintBtn').addEventListener('click',function(){document.getElementById('bulkPrintModalOverlay').classList.remove('open');});
  document.getElementById('bulkPrintModalOverlay').addEventListener('click',function(e){if(e.target===this)this.classList.remove('open');});
  window.bulkSetPerPage=function(n){bulkState.perPage=n;var l=BULK_LAYOUTS[n]||[3,1];bulkState.cols=l[0];bulkState.rows=l[1];document.querySelectorAll('#bulkPerPageGrid .print-opt-btn').forEach(function(b){b.classList.toggle('selected',parseInt(b.dataset.perpg)===n);});bulkUpdatePreview();};
  window.bulkSetCopies=function(v){bulkState.copies=v;document.getElementById('bulkCustomCopiesWrap').style.display=(v==='custom')?'block':'none';document.querySelectorAll('#bulkCopiesGrid .print-opt-btn').forEach(function(b){b.classList.toggle('selected',String(b.dataset.copies)===String(v));});bulkUpdatePreview();};
  window.bulkSetPageSize=function(v){bulkState.pageSize=v;document.querySelectorAll('#bulkPageSizeGrid .print-opt-btn').forEach(function(b){b.classList.toggle('selected',b.dataset.pgsz===v);});bulkUpdatePreview();};
  window.bulkUpdatePreview=function(){
    bulkState.showQR=document.getElementById('bulkTogQR').checked;
    bulkState.showCompany=document.getElementById('bulkTogCompany').checked;
    bulkState.showBorder=document.getElementById('bulkTogBorder').checked;
    var cpl=bulkState.copies==='custom'?(parseInt(document.getElementById('bulkCustomCopiesInput').value)||1):parseInt(bulkState.copies)||1;
    var total=selectedKeys.length*cpl;
    var pages=Math.ceil(total/bulkState.perPage);
    var grid=document.getElementById('bulkPreviewGrid');
    grid.innerHTML='';grid.style.cssText='display:grid;grid-template-columns:repeat('+bulkState.cols+',1fr);gap:3px;max-width:220px;';
    for(var i=0;i<Math.min(bulkState.perPage,8);i++){var c=document.createElement('div');c.className='print-preview-cell';c.style.height='18px';grid.appendChild(c);}
    document.getElementById('bulkPreviewInfo').textContent=selectedKeys.length+' type\u00D7'+cpl+' cop'+(cpl>1?'ies':'y')+' = '+total+' total \u2022 '+pages+' page'+(pages!==1?'s':'')+' \u2022 '+bulkState.cols+'\u00D7'+bulkState.rows+' layout';
  };
  function escH(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function buildLabelHTML(a,qr,showQR,showCompany,border,inner){
    var mn=('0'+(a.month||'03')).slice(-2);
    return '<div style="border:'+border+';font-family:Courier New,monospace;background:#fff;color:#111;page-break-inside:avoid;break-inside:avoid;box-sizing:border-box;">'+
      (showCompany?'<div style="display:flex;align-items:stretch;border-bottom:'+inner+';">'+
        '<div style="flex:1;padding:5px 10px;border-right:'+inner+';"><div style="font-size:7px;font-weight:bold;color:#555;">COMPANY</div><div style="font-size:10px;font-weight:bold;">'+escH(a.companyName.toUpperCase())+'</div></div>'+
        '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5px 10px;border-right:'+inner+';min-width:56px;text-align:center;"><div style="font-size:7px;font-weight:bold;letter-spacing:0.1em;">* AMI *</div><div style="font-size:19px;font-weight:bold;line-height:1;">'+mn+'</div></div>'+
        '<div style="display:flex;align-items:center;justify-content:center;padding:5px 9px;"><div style="border:'+inner+';padding:3px 5px;font-size:8px;font-weight:bold;line-height:1.3;text-align:center;">ROHS 2<br>FREE</div></div>'+
      '</div>':'')+
      '<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:'+inner+';"><div style="padding:4px 10px;"><div style="font-size:7px;font-weight:bold;color:#555;">PART NO.</div><div style="font-size:11px;font-weight:bold;font-family:Courier New,monospace;">'+escH(a.partNo)+'</div></div><div style="padding:4px 10px;border-left:'+inner+';"><div style="font-size:7px;font-weight:bold;color:#555;">PART NAME</div><div style="font-size:11px;font-weight:bold;">'+escH(a.partName)+'</div></div></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:'+inner+';"><div style="padding:4px 10px;"><div style="font-size:7px;font-weight:bold;color:#555;">SIZE</div><div style="font-size:11px;font-weight:bold;">'+escH(a.size||'\u2014')+'</div></div><div style="padding:4px 10px;border-left:'+inner+';"><div style="font-size:7px;font-weight:bold;color:#555;">LOT NO.</div><div style="font-size:11px;font-weight:bold;font-family:Courier New,monospace;">'+escH(a.lotNo)+'</div></div></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:'+inner+';"><div style="padding:4px 10px;"><div style="font-size:7px;font-weight:bold;color:#555;">QUANTITY</div><div style="font-size:13px;font-weight:bold;">'+escH(a.quantity)+'</div></div><div style="padding:4px 10px;border-left:'+inner+';"><div style="font-size:7px;font-weight:bold;color:#555;">PACKER</div><div style="font-size:11px;font-weight:bold;">'+escH(a.packer)+'</div></div></div>'+
      '<div style="display:flex;align-items:stretch;min-height:76px;">'+
        (showQR?'<div style="border-right:'+inner+';padding:6px 8px;display:flex;flex-direction:column;align-items:center;justify-content:center;"><div style="font-size:6px;font-weight:bold;color:#555;margin-bottom:3px;">QR CODE</div><img src="'+qr+'" style="width:58px;height:58px;display:block;"><div style="font-size:6px;color:#888;margin-top:2px;">SCAN FOR DETAILS</div></div>':'')+
        '<div style="flex:1;padding:8px 10px;display:flex;flex-direction:column;justify-content:center;gap:4px;"><div style="font-size:7px;font-weight:bold;color:#555;">WO NO.</div><div style="font-size:10px;font-weight:bold;font-family:Courier New,monospace;">'+escH(a.woNo||'\u2014')+'</div></div>'+
      '</div></div>';
  }
  document.getElementById('confirmBulkPrintBtn').addEventListener('click',function(){
    bulkState.showQR=document.getElementById('bulkTogQR').checked;
    bulkState.showCompany=document.getElementById('bulkTogCompany').checked;
    bulkState.showBorder=document.getElementById('bulkTogBorder').checked;
    var cpl=bulkState.copies==='custom'?Math.max(1,Math.min(50,parseInt(document.getElementById('bulkCustomCopiesInput').value)||1)):parseInt(bulkState.copies)||1;
    var border=bulkState.showBorder?'2.5px solid #111':'1px solid #ccc';
    var inner=bulkState.showBorder?'1.5px solid #111':'1px solid #ddd';
    var psCSS={'A4':'size:A4 portrait','A4L':'size:A4 landscape','A5':'size:A5 portrait','A5L':'size:A5 landscape','Letter':'size:Letter landscape','LetterP':'size:Letter portrait'}[bulkState.pageSize]||'size:A4 landscape';
    var html='';
    selectedKeys.forEach(function(k){var a=BULK_ASSETS[k];if(!a)return;for(var c=0;c<cpl;c++)html+=buildLabelHTML(a,a._qrDataUrl,bulkState.showQR,bulkState.showCompany,border,inner);});
    var old=document.getElementById('dynamicPrintStyle');if(old)old.remove();
    var s=document.createElement('style');s.id='dynamicPrintStyle';
    s.innerHTML='@media print{@page{margin:8mm;'+psCSS+';}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}html,body{margin:0!important;padding:0!important;}body *{visibility:hidden!important;}#printSheet,#printSheet *{visibility:visible!important;}#printSheet{position:fixed!important;top:0!important;left:0!important;width:100%!important;display:grid!important;grid-template-columns:repeat('+bulkState.cols+',1fr)!important;gap:6mm!important;box-sizing:border-box!important;padding:0!important;margin:0!important;background:#fff!important;}}';
    document.head.appendChild(s);
    var sheet=document.getElementById('printSheet');if(!sheet){sheet=document.createElement('div');sheet.id='printSheet';document.body.appendChild(sheet);}
    sheet.innerHTML=html;sheet.style.cssText='display:none;';
    document.getElementById('bulkPrintModalOverlay').classList.remove('open');
    setTimeout(function(){sheet.style.display='grid';sheet.style.gridTemplateColumns='repeat('+bulkState.cols+',1fr)';sheet.style.gap='6mm';requestAnimationFrame(function(){requestAnimationFrame(function(){window.print();setTimeout(function(){sheet.style.display='none';sheet.innerHTML='';},1500);});});},200);
  });
})();
<\/script>`;
}

// ── ROUTES ─────────────────────────────────────────────────────────────────────

app.get('/', async (req, res) => {
  if (!isAuthenticated(req)) return res.send(`${HEAD('Sign In')}<body>
  <div class="auth-wrap"><div style="width:100%;max-width:360px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div class="brand-icon" style="width:42px;height:42px;border-radius:10px;margin:0 auto 12px;">${I.qr}</div>
      <h1 style="font-size:20px;font-weight:700;color:#0f172a;">AMI QR System</h1>
      <p style="font-size:13px;color:#64748b;margin-top:4px;">Sign in to your account</p>
    </div>
    <div class="card"><div class="card-body">
      <form action="/login" method="POST">
        <div class="form-1"><label>Admin ID</label><input type="text" name="id" placeholder="Enter admin ID" required autocomplete="username"></div>
        <div style="margin-bottom:20px;"><label>Password</label><input type="password" name="password" placeholder="Enter password" required autocomplete="current-password"></div>
        <button type="submit" class="btn btn-primary btn-block">Sign In</button>
      </form>
    </div></div>
    <p style="text-align:center;font-size:12px;color:#94a3b8;margin-top:16px;">AMI Manufacturing &middot; Asset QR Tracking</p>
  </div></div></body></html>`);

  const assets = await getAllAssets();
  const all = [...assets.values()];
  const totalScans = all.reduce((s,a)=>s+(a.scanHistory?.length||0),0);
  const today = new Date().toDateString();
  const todayScans = all.reduce((s,a)=>s+(a.scanHistory?.filter(sc=>new Date(sc.timestamp).toDateString()===today).length||0),0);
  const recent = all.slice(-5).reverse();

  const rows = recent.map(a=>`<tr>
    <td><a href="/asset/${a.name}" class="link">${a.partName||'&mdash;'}</a></td>
    <td><span class="badge badge-blue">${a.partNo||'&mdash;'}</span></td>
    <td>${a.companyName||'&mdash;'}</td>
    <td>${a.lotNo||'&mdash;'}</td>
    <td><span class="badge badge-${(a.scanHistory?.length||0)>0?'green':'gray'}">${a.scanHistory?.length||0}</span></td>
    <td><div style="display:flex;gap:5px;">
      <a href="/asset/${a.name}" class="btn btn-secondary btn-sm">${I.eye}</a>
      <a href="/edit/${a.name}" class="btn btn-warning btn-sm">${I.edit}</a>
      <a href="/qr/${a.name}/download" class="btn btn-secondary btn-sm">${I.download}</a>
    </div></td>
  </tr>`).join('');

  res.send(`${HEAD('Dashboard')}<body>${LAYOUT(`
  <div class="page-header">
    <div><h1 class="page-title">Dashboard</h1><p class="page-sub">Welcome back &mdash; AMI QR System</p></div>
    <a href="/generate-form" class="btn btn-primary">${I.plus} New Label</a>
  </div>
  <div class="stats-row">
    <div class="stat-box"><div class="stat-label">Total Assets</div><div class="stat-number" style="color:#3b82f6;">${assets.size}</div><div class="stat-note">registered parts</div></div>
    <div class="stat-box"><div class="stat-label">Total Scans</div><div class="stat-number">${totalScans}</div><div class="stat-note">${todayScans} today</div></div>
    <div class="stat-box"><div class="stat-label">System Status</div><div class="stat-number" style="font-size:14px;padding-top:6px;"><span class="status-online"><span class="dot"></span>Operational</span></div><div class="stat-note">MongoDB connected</div></div>
  </div>
  <div class="grid-2" style="margin-bottom:20px;">
    <div class="card" style="margin-bottom:0;"><div class="card-body">
      <p style="font-size:15px;font-weight:600;color:#111;margin-bottom:6px;">Generate QR Label</p>
      <p style="font-size:13px;color:#6b7280;margin-bottom:14px;">Create a new part label with production details and QR code.</p>
      <a href="/generate-form" class="btn btn-primary">${I.plus} Create Label</a>
    </div></div>
    <div class="card" style="margin-bottom:0;"><div class="card-body">
      <p style="font-size:15px;font-weight:600;color:#111;margin-bottom:6px;">Scan QR Code</p>
      <p style="font-size:13px;color:#6b7280;margin-bottom:14px;">Use your camera to scan an AMI QR label and view part details.</p>
      <a href="/scan" class="btn btn-secondary">${I.scan} Open Scanner</a>
    </div></div>
  </div>
  <div class="card">
    <div class="card-header"><span class="card-title">Recent Assets</span><a href="/list" class="btn btn-secondary btn-sm">View All</a></div>
    ${recent.length>0?`<div class="table-wrap"><table>
      <thead><tr><th>Part Name</th><th>Part No.</th><th>Company</th><th>Lot No.</th><th>Scans</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`:`<div class="empty">${I.box}<p>No assets yet.</p><a href="/generate-form" class="btn btn-primary">${I.plus} Generate First Label</a></div>`}
  </div>
  `,'home')}`);
});

app.post('/login', (req, res) => {
  const { id, password } = req.body;
  if (id===ADMIN_ID && password===ADMIN_PASSWORD) {
    const sid = generateSessionId();
    sessions.set(sid, { authenticated: true });
    res.setHeader('Set-Cookie', `sessionId=${sid}; HttpOnly; Path=/; SameSite=Lax`);
    return res.redirect('/');
  }
  res.status(401).send(`${HEAD('Login Failed')}<body><div class="auth-wrap"><div style="width:100%;max-width:360px;">
    <div class="card card-body"><div class="alert alert-error">Invalid credentials. Please try again.</div><a href="/" class="btn btn-secondary btn-block">&larr; Go Back</a></div>
  </div></div></body></html>`);
});

app.get('/logout', (req, res) => {
  const sid = req.headers.cookie?.split('sessionId=')[1]?.split(';')[0];
  if (sid) sessions.delete(sid);
  res.setHeader('Set-Cookie', 'sessionId=; Max-Age=0; HttpOnly; Path=/; SameSite=Lax');
  res.redirect('/');
});

// ── GENERATE FORM ──────────────────────────────────────────────────────────────
app.get('/generate-form', (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  const currentMonth = new Date().getMonth() + 1;
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthOpts = MONTH_NAMES.map((n,i)=>{
    const v = String(i+1).padStart(2,'0');
    return `<option value="${v}"${i+1===currentMonth?' selected':''}>${v} &mdash; ${n}</option>`;
  }).join('');

  res.send(`${HEAD('Generate Label')}<body>${LAYOUT(`
  <div class="page-header"><div><h1 class="page-title">Generate QR Label</h1><p class="page-sub">Fill in part details to create a new label</p></div></div>
  <div style="max-width:640px;">
    <div class="card">
      <div class="card-header"><span class="card-title">Part Information</span><span style="font-size:11px;color:#9ca3af;">* Required</span></div>
      <div class="card-body">
        <form action="/generate" method="POST">
          <div class="form-1"><label>Company Name *</label><input type="text" name="companyName" placeholder="e.g. AMBER ENTERPRISES INDIA LIMITED" required></div>
          <div class="form-row">
            <div><label>Part No. *</label><input type="text" name="partNo" placeholder="e.g. 93198464460" required></div>
            <div><label>Part Name *</label><input type="text" name="partName" placeholder="e.g. FPE T3 200*100" required></div>
          </div>
          <div class="form-row">
            <div><label>Size</label><input type="text" name="size" placeholder="e.g. 3MMX100MMX200MM"></div>
            <div><label>Lot No. *</label><input type="text" name="lotNo" placeholder="e.g. 28032601" required></div>
          </div>
          <div class="form-row">
            <div><label>Quantity *</label><input type="text" name="quantity" placeholder="e.g. 100 Pcs" required></div>
            <div><label>Packer Name *</label><input type="text" name="packer" placeholder="Packer name or ID" required></div>
          </div>
          <div class="form-row" style="margin-bottom:20px;">
            <div><label>Month * <span style="font-weight:400;color:#9ca3af;">(AMI number)</span></label>
              <select name="month" required>${monthOpts}</select></div>
            <div><label>WO No. *</label><input type="text" name="woNo" placeholder="e.g. MFG-WO-2026-28032" required></div>
          </div>
          <button type="submit" class="btn btn-primary btn-block">${I.qr} Generate QR Label</button>
        </form>
      </div>
    </div>
  </div>
  `,'gen')}`);
});

// ── GENERATE POST ──────────────────────────────────────────────────────────────
app.post('/generate', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  const { companyName, partNo, partName, size, lotNo, quantity, packer, month, woNo } = req.body;
  if (!companyName||!partNo||!partName||!lotNo||!quantity||!packer||!month||!woNo) {
    return res.status(400).send(`${HEAD('Error')}<body><div class="auth-wrap"><div style="max-width:380px;width:100%;"><div class="card card-body">
      <div class="alert alert-error">Please fill in all required fields.</div>
      <a href="/generate-form" class="btn btn-secondary btn-block">&larr; Go Back</a>
    </div></div></div></body></html>`);
  }
  const assetKey = partNo.trim()+'-'+lotNo.trim();
  const existing = await getAsset(assetKey);
  if (existing) return res.status(400).send(`${HEAD('Duplicate')}<body><div class="auth-wrap"><div style="max-width:380px;width:100%;"><div class="card card-body">
    <div class="alert alert-error">Part No. "${partNo}" + Lot No. "${lotNo}" already exists.</div>
    <a href="/generate-form" class="btn btn-primary btn-block">Try Again</a>
  </div></div></div></body></html>`);

  const asset = {
    name: assetKey, companyName: companyName.trim(), partNo: partNo.trim(),
    partName: partName.trim(), size: size?.trim()||'', lotNo: lotNo.trim(),
    quantity: quantity.trim(), packer: packer.trim(),
    month: String(month).padStart(2,'0'), woNo: woNo.trim(),
    createdAt: new Date().toISOString(), scanHistory: []
  };
  await upsertAsset(asset);

  const qrText = buildQrContent(asset);
  try {
    const qrDataUrl = await QRCode.toDataURL(qrText, { width:300, margin:1, color:{dark:'#000000',light:'#ffffff'}, errorCorrectionLevel:'M' });
    res.send(`${HEAD('Label Created')}<body>${LAYOUT(`
    <div class="page-header">
      <div><h1 class="page-title">Label Created</h1><p class="page-sub">Saved to MongoDB &mdash; data is permanent</p></div>
      <div style="display:flex;gap:8px;">
        <a href="/edit/${assetKey}" class="btn btn-warning">${I.edit} Edit Label</a>
        <button id="openPrintModal" class="btn btn-secondary">${I.print} Print Label</button>
        <a href="/qr/${assetKey}/download" class="btn btn-primary">${I.download} Download QR</a>
      </div>
    </div>
    ${SCANNER_BANNER}
    <div style="overflow-x:auto;">
      <div class="ami-label">
        <div class="ami-label-header">
          <div class="ami-label-company"><div style="font-size:9px;font-weight:bold;letter-spacing:0.1em;color:#555;margin-bottom:3px;">COMPANY</div><div class="co-name">${companyName.toUpperCase()}</div></div>
          <div class="ami-label-amino"><div class="ami-star">* AMI *</div><div class="ami-num">${String(month).padStart(2,'0')}</div></div>
          <div class="ami-label-rohs"><div class="rohs-box">ROHS 2<br>FREE</div></div>
        </div>
        <div class="ami-field-row cols-2">
          <div class="ami-field"><div class="f-label">Part No.</div><div class="f-value mono">${partNo.trim()}</div></div>
          <div class="ami-field"><div class="f-label">Part Name</div><div class="f-value">${partName.trim()}</div></div>
        </div>
        <div class="ami-field-row cols-2">
          <div class="ami-field"><div class="f-label">Size</div><div class="f-value">${size?.trim()||'&mdash;'}</div></div>
          <div class="ami-field"><div class="f-label">Lot No.</div><div class="f-value mono">${lotNo.trim()}</div></div>
        </div>
        <div class="ami-field-row cols-2">
          <div class="ami-field"><div class="f-label">Quantity</div><div class="f-value large">${quantity.trim()}</div></div>
          <div class="ami-field"><div class="f-label">Packer</div><div class="f-value">${packer.trim()}</div></div>
        </div>
        <div class="ami-label-bottom">
          <div class="ami-qr-cell"><div class="qr-label-text">QR CODE</div><img src="${qrDataUrl}" alt="QR"><div class="qr-scan-text">SCAN FOR DETAILS</div></div>
          <div class="ami-wo-cell">
            <div><div class="wo-label">WO NO.</div><div class="wo-value">${woNo.trim()}</div></div>
          </div>
        </div>
      </div>
    </div>
    <p style="font-size:12px;color:#64748b;margin-top:8px;">Click <strong>Print Label</strong> to choose layout &amp; copies.</p>
    <div class="grid-2" style="margin-top:16px;max-width:560px;">
      <a href="/generate-form" class="btn btn-secondary btn-block">${I.plus} New Label</a>
      <a href="/labels" class="btn btn-secondary btn-block">${I.label} View Labels</a>
    </div>
    ${printModalHTML()}
    `,'gen')}${printModalScript(qrDataUrl, asset)}`);
  } catch(err) { console.error(err); res.status(500).send('Error generating QR'); }
});

// ── EDIT LABEL GET ─────────────────────────────────────────────────────────────
app.get('/edit/:id', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  const asset = await getAsset(req.params.id);
  if (!asset) return res.redirect('/labels');
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthOpts = MONTH_NAMES.map((n,i)=>{
    const v = String(i+1).padStart(2,'0');
    return `<option value="${v}"${v===asset.month?' selected':''}>${v} &mdash; ${n}</option>`;
  }).join('');
  const successMsg = req.query.success ? `<div class="alert alert-success" style="margin-bottom:16px;">&#x2713; Label updated! <a href="/labels" style="color:#15803d;font-weight:600;">View Labels</a></div>` : '';

  res.send(`${HEAD('Edit Label')}<body>${LAYOUT(`
  <div class="page-header">
    <div><h1 class="page-title">Edit Label</h1><p class="page-sub">${asset.partName} &middot; <span class="badge badge-blue">${asset.partNo}</span></p></div>
    <div style="display:flex;gap:8px;">
      <a href="/asset/${req.params.id}" class="btn btn-secondary">${I.eye} View</a>
      <a href="/labels" class="btn btn-secondary">&larr; Labels</a>
    </div>
  </div>
  <div style="max-width:640px;">
    ${successMsg}
    <div class="card">
      <div class="card-header"><span class="card-title">Edit Part Information</span></div>
      <div class="card-body">
        <form action="/edit/${req.params.id}" method="POST">
          <div class="form-1"><label>Company Name *</label><input type="text" name="companyName" value="${asset.companyName}" required></div>
          <div class="form-row">
            <div><label>Part No. *</label><input type="text" name="partNo" value="${asset.partNo}" required></div>
            <div><label>Part Name *</label><input type="text" name="partName" value="${asset.partName}" required></div>
          </div>
          <div class="form-row">
            <div><label>Size</label><input type="text" name="size" value="${asset.size||''}"></div>
            <div><label>Lot No. *</label><input type="text" name="lotNo" value="${asset.lotNo}" required></div>
          </div>
          <div class="form-row">
            <div><label>Quantity *</label><input type="text" name="quantity" value="${asset.quantity}" required></div>
            <div><label>Packer Name *</label><input type="text" name="packer" value="${asset.packer}" required></div>
          </div>
          <div class="form-row" style="margin-bottom:20px;">
            <div><label>Month *</label><select name="month" required>${monthOpts}</select></div>
            <div><label>WO No. *</label><input type="text" name="woNo" value="${asset.woNo||''}" required></div>
          </div>
          <div style="display:flex;gap:10px;">
            <button type="submit" class="btn btn-primary" style="flex:1;">${I.edit} Save Changes</button>
            <a href="/labels" class="btn btn-secondary">Cancel</a>
          </div>
        </form>
      </div>
    </div>
  </div>
  `,'labels')}`);
});

// ── EDIT LABEL POST ────────────────────────────────────────────────────────────
app.post('/edit/:id', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  const oldKey = req.params.id;
  const oldAsset = await getAsset(oldKey);
  if (!oldAsset) return res.redirect('/labels');
  const { companyName, partNo, partName, size, lotNo, quantity, packer, month, woNo } = req.body;
  if (!companyName||!partNo||!partName||!lotNo||!quantity||!packer||!month||!woNo) return res.redirect(`/edit/${oldKey}`);
  const newKey = partNo.trim()+'-'+lotNo.trim();
  if (newKey!==oldKey) {
    const clash = await getAsset(newKey);
    if (clash) return res.status(400).send(`${HEAD('Duplicate')}<body><div class="auth-wrap"><div style="max-width:400px;width:100%;">
      <div class="card card-body"><div class="alert alert-error">Another asset with that Part No. + Lot No. already exists.</div>
      <a href="/edit/${oldKey}" class="btn btn-secondary btn-block">&larr; Go Back</a></div>
    </div></div></body></html>`);
    await deleteAsset(oldKey);
  }
  const updated = { ...oldAsset, name:newKey, companyName:companyName.trim(), partNo:partNo.trim(), partName:partName.trim(),
    size:size?.trim()||'', lotNo:lotNo.trim(), quantity:quantity.trim(), packer:packer.trim(),
    month:String(month).padStart(2,'0'), woNo:woNo.trim(), updatedAt:new Date().toISOString() };
  await upsertAsset(updated);
  res.redirect(`/edit/${newKey}?success=1`);
});

// ── ALL ASSETS LIST ────────────────────────────────────────────────────────────
app.get('/list', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  const assets = await getAllAssets();
  const rows = [...assets.entries()].map(([key,a])=>`<tr>
    <td><a href="/asset/${key}" class="link">${a.partName||'&mdash;'}</a></td>
    <td><span class="badge badge-blue">${a.partNo||'&mdash;'}</span></td>
    <td>${a.companyName||'&mdash;'}</td>
    <td>${a.lotNo||'&mdash;'}</td>
    <td>${a.size||'&mdash;'}</td>
    <td>${a.quantity||'&mdash;'}</td>
    <td>${a.packer||'&mdash;'}</td>
    <td style="font-family:monospace;font-size:12px;">${a.woNo||'&mdash;'}</td>
    <td><span class="badge badge-${(a.scanHistory?.length||0)>0?'green':'gray'}">${a.scanHistory?.length||0}</span></td>
    <td><div style="display:flex;gap:5px;">
      <a href="/qr/${key}" class="btn btn-secondary btn-sm">${I.qr}</a>
      <a href="/edit/${key}" class="btn btn-warning btn-sm">${I.edit}</a>
      <a href="/qr/${key}/download" class="btn btn-secondary btn-sm">${I.download}</a>
      <a href="/delete/${key}" onclick="return confirm('Delete ${a.partName}?')" class="btn btn-danger btn-sm">${I.trash}</a>
    </div></td>
  </tr>`).join('');

  res.send(`${HEAD('All Assets')}<body>${LAYOUT(`
  <div class="page-header">
    <div><h1 class="page-title">All Assets</h1><p class="page-sub">${assets.size} total record${assets.size!==1?'s':''}</p></div>
    <a href="/generate-form" class="btn btn-primary">${I.plus} New Label</a>
  </div>
  <div class="card">
    ${assets.size===0?`<div class="empty">${I.box}<p>No assets yet.</p><a href="/generate-form" class="btn btn-primary">Generate First Label</a></div>`
    :`<div class="table-wrap"><table>
      <thead><tr><th>Part Name</th><th>Part No.</th><th>Company</th><th>Lot No.</th><th>Size</th><th>Qty</th><th>Packer</th><th>WO No.</th><th>Scans</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`}
  </div>
  `,'list')}`);
});

// ── LABELS (with bulk print) ───────────────────────────────────────────────────
app.get('/labels', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  const assets = await getAllAssets();
  let cards = '';
  const assetsWithQR = {};

  for (const [key, a] of assets) {
    const qrText = buildQrContent(a);
    try {
      const qrDataUrl = await QRCode.toDataURL(qrText, { width:200, margin:1, errorCorrectionLevel:'M' });
      assetsWithQR[key] = { ...a, _qrDataUrl: qrDataUrl };
      const monthNum = String(a.month||'03').padStart(2,'0');
      cards += `<div class="label-card-wrap" data-key="${key}">
        <input type="checkbox" class="label-select-cb" data-key="${key}" title="Select for bulk print">
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
          <div style="padding:12px;background:#fafafa;border-bottom:1px solid #e5e7eb;">
            <div style="border:2px solid #111;font-family:'Courier New',monospace;font-size:10px;background:#fff;">
              <div style="display:flex;align-items:stretch;border-bottom:1.5px solid #111;">
                <div style="flex:1;padding:5px 8px;border-right:1.5px solid #111;">
                  <div style="font-size:7px;font-weight:bold;color:#555;">COMPANY</div>
                  <div style="font-size:9px;font-weight:bold;">${a.companyName.toUpperCase()}</div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5px 8px;border-right:1.5px solid #111;min-width:44px;text-align:center;">
                  <div style="font-size:6px;font-weight:bold;letter-spacing:0.1em;">* AMI *</div>
                  <div style="font-size:16px;font-weight:bold;line-height:1;">${monthNum}</div>
                </div>
                <div style="display:flex;align-items:center;justify-content:center;padding:5px 7px;">
                  <div style="border:1.5px solid #111;padding:2px 4px;font-size:7px;font-weight:bold;line-height:1.3;text-align:center;">ROHS 2<br>FREE</div>
                </div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1.5px solid #111;">
                <div style="padding:3px 8px;"><div style="font-size:6px;font-weight:bold;color:#555;">PART NO.</div><div style="font-size:9px;font-weight:bold;">${a.partNo}</div></div>
                <div style="padding:3px 8px;border-left:1.5px solid #111;"><div style="font-size:6px;font-weight:bold;color:#555;">PART NAME</div><div style="font-size:9px;font-weight:bold;">${a.partName}</div></div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1.5px solid #111;">
                <div style="padding:3px 8px;"><div style="font-size:6px;font-weight:bold;color:#555;">SIZE</div><div style="font-size:9px;font-weight:bold;">${a.size||'&mdash;'}</div></div>
                <div style="padding:3px 8px;border-left:1.5px solid #111;"><div style="font-size:6px;font-weight:bold;color:#555;">LOT NO.</div><div style="font-size:9px;font-weight:bold;">${a.lotNo}</div></div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1.5px solid #111;">
                <div style="padding:3px 8px;"><div style="font-size:6px;font-weight:bold;color:#555;">QUANTITY</div><div style="font-size:10px;font-weight:bold;">${a.quantity}</div></div>
                <div style="padding:3px 8px;border-left:1.5px solid #111;"><div style="font-size:6px;font-weight:bold;color:#555;">PACKER</div><div style="font-size:9px;font-weight:bold;">${a.packer}</div></div>
              </div>
              <div style="display:flex;align-items:stretch;min-height:56px;">
                <div style="border-right:1.5px solid #111;padding:5px 6px;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                  <div style="font-size:6px;font-weight:bold;color:#555;margin-bottom:2px;">QR CODE</div>
                  <img src="${qrDataUrl}" style="width:44px;height:44px;display:block;">
                  <div style="font-size:5px;color:#888;margin-top:1px;">SCAN FOR DETAILS</div>
                </div>
                <div style="flex:1;padding:6px 8px;display:flex;flex-direction:column;justify-content:center;">
                  <div style="font-size:6px;font-weight:bold;color:#555;">WO NO.</div>
                  <div style="font-size:8px;font-weight:bold;">${a.woNo||'&mdash;'}</div>
                </div>
              </div>
            </div>
          </div>
          <div style="padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div>
              <div style="font-size:12px;font-weight:700;color:#111;">${a.partName}</div>
              <div style="font-size:11px;color:#9ca3af;font-family:monospace;">${a.partNo} &middot; ${a.lotNo}</div>
            </div>
            <div style="display:flex;gap:5px;flex-shrink:0;">
              <a href="/asset/${key}" class="btn btn-secondary btn-sm">${I.eye}</a>
              <a href="/edit/${key}" class="btn btn-warning btn-sm">${I.edit}</a>
              <a href="/print-label/${key}" class="btn btn-primary btn-sm">${I.print}</a>
            </div>
          </div>
        </div>
      </div>`;
    } catch{}
  }

  res.send(`${HEAD('Labels')}<body>${LAYOUT(`
  <div class="page-header">
    <div><h1 class="page-title">Labels</h1><p class="page-sub">${assets.size} label${assets.size!==1?'s':''} stored</p></div>
    <a href="/generate-form" class="btn btn-primary">${I.plus} New Label</a>
  </div>
  ${SCANNER_BANNER}
  ${assets.size>0?`
  <div class="bulk-bar" id="bulkBar">
    <div class="bulk-bar-left">${I.print}<span id="bulkBarCount" class="bulk-bar-count">0 selected</span><span style="color:#94a3b8;">labels selected</span></div>
    <div class="bulk-bar-right">
      <button class="btn btn-secondary btn-sm" onclick="document.querySelectorAll('.label-select-cb').forEach(function(cb){cb.checked=false;cb.closest('.label-card-wrap').classList.remove('selected-card');});document.getElementById('bulkBar').classList.remove('visible');document.getElementById('selectAllCb').checked=false;">Clear</button>
      <button class="btn btn-primary btn-sm" id="bulkPrintBtn">${I.print} Print Selected</button>
    </div>
  </div>
  <div class="select-all-row">
    <input type="checkbox" id="selectAllCb" style="width:16px;height:16px;accent-color:#3b82f6;cursor:pointer;">
    <label for="selectAllCb">Select All for Bulk Print</label>
    <span style="font-size:11px;color:#9ca3af;">&mdash; or select individually</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;">${cards}</div>
  ${bulkPrintModalHTML()}
  `:`<div class="card"><div class="empty">${I.label}<p>No labels yet.</p><a href="/generate-form" class="btn btn-primary">Create First Label</a></div></div>`}
  `,'labels')}
  ${assets.size>0?bulkPrintScript(assetsWithQR):''}`);
});

// ── PRINT LABEL (single) ───────────────────────────────────────────────────────
app.get('/print-label/:id', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  const asset = await getAsset(req.params.id);
  if (!asset) return res.status(404).send('Not found');
  const qrDataUrl = await QRCode.toDataURL(buildQrContent(asset), { width:300, margin:1, errorCorrectionLevel:'M' });

  res.send(`${HEAD('Print &mdash; '+asset.partName)}<body>${LAYOUT(`
  <div class="page-header">
    <div><h1 class="page-title">Print Label</h1><p class="page-sub">${asset.partName} &middot; ${asset.partNo}</p></div>
    <div style="display:flex;gap:8px;">
      <a href="/edit/${req.params.id}" class="btn btn-warning">${I.edit} Edit</a>
      <button id="openPrintModal" class="btn btn-primary">${I.print} Print Labels</button>
      <a href="/labels" class="btn btn-secondary">&larr; Back</a>
    </div>
  </div>
  ${SCANNER_BANNER}
  <div style="overflow-x:auto;">
    <div class="ami-label">
      <div class="ami-label-header">
        <div class="ami-label-company"><div style="font-size:9px;font-weight:bold;letter-spacing:0.1em;color:#555;margin-bottom:3px;">COMPANY</div><div class="co-name">${asset.companyName.toUpperCase()}</div></div>
        <div class="ami-label-amino"><div class="ami-star">* AMI *</div><div class="ami-num">${String(asset.month||'03').padStart(2,'0')}</div></div>
        <div class="ami-label-rohs"><div class="rohs-box">ROHS 2<br>FREE</div></div>
      </div>
      <div class="ami-field-row cols-2">
        <div class="ami-field"><div class="f-label">Part No.</div><div class="f-value mono">${asset.partNo}</div></div>
        <div class="ami-field"><div class="f-label">Part Name</div><div class="f-value">${asset.partName}</div></div>
      </div>
      <div class="ami-field-row cols-2">
        <div class="ami-field"><div class="f-label">Size</div><div class="f-value">${asset.size||'&mdash;'}</div></div>
        <div class="ami-field"><div class="f-label">Lot No.</div><div class="f-value mono">${asset.lotNo}</div></div>
      </div>
      <div class="ami-field-row cols-2">
        <div class="ami-field"><div class="f-label">Quantity</div><div class="f-value large">${asset.quantity}</div></div>
        <div class="ami-field"><div class="f-label">Packer</div><div class="f-value">${asset.packer}</div></div>
      </div>
      <div class="ami-label-bottom">
        <div class="ami-qr-cell"><div class="qr-label-text">QR CODE</div><img src="${qrDataUrl}" alt="QR"><div class="qr-scan-text">SCAN FOR DETAILS</div></div>
        <div class="ami-wo-cell"><div><div class="wo-label">WO NO.</div><div class="wo-value">${asset.woNo}</div></div></div>
      </div>
    </div>
  </div>
  <p style="font-size:12px;color:#64748b;margin-top:8px;">Click <strong>Print Labels</strong> to set layout and print.</p>
  ${printModalHTML()}
  `,'labels')}${printModalScript(qrDataUrl, asset)}`);
});

// ── QR GALLERY ─────────────────────────────────────────────────────────────────
app.get('/qr/all', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  const assets = await getAllAssets();
  let cards = '';
  for (const [key, a] of assets) {
    try {
      const qr = await QRCode.toDataURL(buildQrContent(a), { width:200, margin:2, errorCorrectionLevel:'M' });
      cards += `<div class="card" style="margin-bottom:0;text-align:center;padding:20px;">
        <div style="font-weight:600;color:#111;font-size:13px;margin-bottom:2px;">${a.partName}</div>
        <div style="font-size:11px;color:#9ca3af;margin-bottom:14px;font-family:monospace;">${a.partNo} &middot; ${a.lotNo}</div>
        <div class="qr-wrap" style="display:inline-block;margin-bottom:14px;"><img src="${qr}" style="width:130px;height:130px;display:block;"></div>
        <div style="display:flex;gap:8px;justify-content:center;">
          <a href="/qr/${key}/download" class="btn btn-primary btn-sm">${I.download}</a>
          <a href="/asset/${key}" class="btn btn-secondary btn-sm">${I.eye}</a>
          <a href="/edit/${key}" class="btn btn-warning btn-sm">${I.edit}</a>
        </div>
      </div>`;
    } catch{}
  }
  res.send(`${HEAD('QR Gallery')}<body>${LAYOUT(`
  <div class="page-header"><div><h1 class="page-title">QR Gallery</h1><p class="page-sub">${assets.size} label${assets.size!==1?'s':''}</p></div></div>
  ${SCANNER_BANNER}
  ${cards?`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px;">${cards}</div>`
  :`<div class="card"><div class="empty">${I.qr}<p>No QR codes yet.</p><a href="/generate-form" class="btn btn-primary">Create First Label</a></div></div>`}
  `,'gallery')}`);
});

// ── ASSET DETAIL ───────────────────────────────────────────────────────────────
app.get('/asset/:id', async (req, res) => {
  const asset = await getAsset(req.params.id);
  if (!asset) return res.status(404).send(`${HEAD('Not Found')}<body><div class="auth-wrap">
    <div class="card card-body" style="max-width:320px;text-align:center;">
      <p style="color:#ef4444;font-weight:600;margin-bottom:12px;">Asset not found</p>
      <a href="/" class="btn btn-secondary btn-block">Go Home</a>
    </div></div></body></html>`);

  const isAdmin = isAuthenticated(req);
  if (!isAdmin) {
    await pushScanHistory(req.params.id, { timestamp: new Date().toISOString(), device: req.headers['user-agent']||'Unknown' });
  }

  const freshAsset = await getAsset(req.params.id);
  const qrText = buildQrContent(freshAsset);
  const qrDataUrl = await QRCode.toDataURL(qrText, { width:200, margin:2, errorCorrectionLevel:'M' });
  const scans = freshAsset.scanHistory?.length||0;
  const monthNum = String(freshAsset.month||'03').padStart(2,'0');
  const woNum = freshAsset.woNo||'&mdash;';

  const scanRows = (freshAsset.scanHistory||[]).slice(-10).reverse().map(s=>`<tr>
    <td style="font-family:monospace;font-size:12px;">${new Date(s.timestamp).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
    <td style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${(s.device||'Unknown').substring(0,80)}</td>
  </tr>`).join('');

  if (isAdmin) {
    const printQrUrl = await QRCode.toDataURL(qrText, { width:300, margin:1, errorCorrectionLevel:'M' });
    return res.send(`${HEAD(freshAsset.partName)}<body>${LAYOUT(`
    <div class="page-header">
      <div><h1 class="page-title">${freshAsset.partName}</h1><p class="page-sub">${freshAsset.companyName} &middot; <span class="badge badge-blue">${freshAsset.partNo}</span></p></div>
      <div style="display:flex;gap:8px;">
        <a href="/edit/${req.params.id}" class="btn btn-warning">${I.edit} Edit</a>
        <a href="/qr/${req.params.id}/download" class="btn btn-secondary">${I.download} QR</a>
        <button id="openPrintModal" class="btn btn-secondary">${I.print} Print</button>
        <a href="/delete/${req.params.id}" onclick="return confirm('Delete?')" class="btn btn-danger">${I.trash}</a>
      </div>
    </div>
    ${SCANNER_BANNER}
    <div class="grid-aside">
      <div>
        <div class="card">
          <div class="card-header"><span class="card-title">Part Details</span><span class="badge badge-${scans>0?'green':'gray'}">${scans} scan${scans!==1?'s':''}</span></div>
          <div class="card-body"><div class="detail-grid">
            <div style="grid-column:1/-1;"><div class="detail-label">Company</div><div class="detail-value">${freshAsset.companyName}</div></div>
            <div><div class="detail-label">Part No.</div><div class="detail-value" style="font-family:monospace;font-size:13px;">${freshAsset.partNo}</div></div>
            <div><div class="detail-label">Part Name</div><div class="detail-value">${freshAsset.partName}</div></div>
            <div><div class="detail-label">Lot No.</div><div class="detail-value" style="font-family:monospace;font-size:13px;">${freshAsset.lotNo}</div></div>
            <div><div class="detail-label">Size</div><div class="detail-value">${freshAsset.size||'&mdash;'}</div></div>
            <div><div class="detail-label">Quantity</div><div class="detail-value">${freshAsset.quantity}</div></div>
            <div><div class="detail-label">Packer</div><div class="detail-value">${freshAsset.packer}</div></div>
            <div><div class="detail-label">Month (AMI)</div><div class="detail-value">${monthNum}</div></div>
            <div><div class="detail-label">WO No.</div><div class="detail-value" style="font-family:monospace;font-size:13px;">${woNum}</div></div>
            <div><div class="detail-label">Created</div><div class="detail-value" style="font-size:13px;">${new Date(freshAsset.createdAt).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</div></div>
          </div></div>
        </div>
        ${scans>0?`<div class="card">
          <div class="card-header"><span class="card-title">Scan History</span><span class="badge badge-green">${scans} total</span></div>
          <div class="table-wrap"><table><thead><tr><th>Timestamp</th><th>Device</th></tr></thead><tbody>${scanRows}</tbody></table></div>
        </div>`:''}
      </div>
      <div>
        <div class="card">
          <div class="card-header"><span class="card-title">QR Code</span></div>
          <div class="card-body" style="text-align:center;">
            <div class="qr-wrap" style="margin:0 auto 14px;display:inline-block;"><img src="${qrDataUrl}" style="width:160px;height:160px;display:block;"></div>
            <p style="font-size:11px;color:#94a3b8;margin-bottom:14px;">Scan with barcode scanner</p>
            <a href="/qr/${req.params.id}/download" class="btn btn-primary btn-block btn-sm">${I.download} Download PNG</a>
          </div>
        </div>
      </div>
    </div>
    ${printModalHTML()}
    `,'list')}${printModalScript(printQrUrl, freshAsset)}`);
  }

  // Public view
  res.send(`<!DOCTYPE html><html lang="en"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${freshAsset.partName} &mdash; AMI</title>
  <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:-apple-system,sans-serif;background:#f5f6fa;}
  .sw{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:24px 16px 40px;}
  .tb{width:100%;max-width:600px;display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;}
  .bd{width:28px;height:28px;background:#3b82f6;border-radius:7px;display:flex;align-items:center;justify-content:center;}
  .bd svg{width:15px;height:15px;color:white;}
  .sb{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:99px;font-size:11px;font-weight:600;padding:3px 10px;display:flex;align-items:center;gap:5px;}
  .sd{width:6px;height:6px;background:#22c55e;border-radius:50%;animation:pulse 2s infinite;}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
  .ami-label{width:100%;max-width:560px;border:2.5px solid #111;font-family:'Courier New',monospace;background:#fff;color:#111;}
  .ami-label *{box-sizing:border-box;}
  .ami-label-header{display:flex;align-items:stretch;border-bottom:2px solid #111;}
  .ami-label-company{flex:1;padding:8px 14px;border-right:2px solid #111;}
  .ami-label-company .co-name{font-size:13px;font-weight:bold;line-height:1.3;}
  .ami-label-amino{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px 18px;border-right:2px solid #111;min-width:80px;text-align:center;}
  .ami-label-amino .ami-star{font-size:10px;font-weight:bold;letter-spacing:0.12em;}
  .ami-label-amino .ami-num{font-size:26px;font-weight:bold;line-height:1;}
  .ami-label-rohs{display:flex;align-items:center;justify-content:center;padding:8px 14px;min-width:90px;}
  .ami-label-rohs .rohs-box{border:2px solid #111;padding:4px 8px;font-size:10px;font-weight:bold;line-height:1.4;text-align:center;}
  .ami-field-row{display:grid;border-bottom:1.5px solid #111;}
  .ami-field-row.cols-2{grid-template-columns:1fr 1fr;}
  .ami-field{padding:7px 14px;}
  .ami-field+.ami-field{border-left:1.5px solid #111;}
  .ami-field .f-label{font-size:9px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;color:#555;margin-bottom:3px;}
  .ami-field .f-value{font-size:15px;font-weight:bold;}
  .ami-field .f-value.mono{font-family:'Courier New',monospace;}
  .ami-field .f-value.large{font-size:18px;}
  .ami-label-bottom{display:flex;align-items:stretch;min-height:110px;}
  .ami-qr-cell{border-right:1.5px solid #111;padding:10px 12px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:115px;}
  .ami-qr-cell .qr-label-text{font-size:8px;font-weight:bold;letter-spacing:0.1em;color:#555;margin-bottom:5px;}
  .ami-qr-cell img{width:88px;height:88px;display:block;}
  .ami-qr-cell .qr-scan-text{font-size:7px;color:#888;margin-top:4px;}
  .ami-wo-cell{flex:1;padding:12px 16px;display:flex;flex-direction:column;justify-content:center;gap:4px;}
  .wo-label{font-size:9px;font-weight:bold;letter-spacing:0.1em;color:#555;}
  .wo-value{font-size:13px;font-weight:bold;font-family:'Courier New',monospace;}
  </style></head><body>
  <div class="sw">
    <div class="tb">
      <div style="font-size:13px;font-weight:700;color:#1e293b;display:flex;align-items:center;gap:8px;">
        <div class="bd"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/></svg></div>
        AMI QR System
      </div>
      <div class="sb"><span class="sd"></span>${scans} scan${scans!==1?'s':''}</div>
    </div>
    <div class="ami-label">
      <div class="ami-label-header">
        <div class="ami-label-company"><div style="font-size:8px;font-weight:bold;color:#555;margin-bottom:2px;">COMPANY</div><div class="co-name">${freshAsset.companyName.toUpperCase()}</div></div>
        <div class="ami-label-amino"><div class="ami-star">* AMI *</div><div class="ami-num">${monthNum}</div></div>
        <div class="ami-label-rohs"><div class="rohs-box">ROHS 2<br>FREE</div></div>
      </div>
      <div class="ami-field-row cols-2">
        <div class="ami-field"><div class="f-label">Part No.</div><div class="f-value mono">${freshAsset.partNo}</div></div>
        <div class="ami-field"><div class="f-label">Part Name</div><div class="f-value">${freshAsset.partName}</div></div>
      </div>
      <div class="ami-field-row cols-2">
        <div class="ami-field"><div class="f-label">Size</div><div class="f-value">${freshAsset.size||'&mdash;'}</div></div>
        <div class="ami-field"><div class="f-label">Lot No.</div><div class="f-value mono">${freshAsset.lotNo}</div></div>
      </div>
      <div class="ami-field-row cols-2">
        <div class="ami-field"><div class="f-label">Quantity</div><div class="f-value large">${freshAsset.quantity}</div></div>
        <div class="ami-field"><div class="f-label">Packer</div><div class="f-value">${freshAsset.packer}</div></div>
      </div>
      <div class="ami-label-bottom">
        <div class="ami-qr-cell"><div class="qr-label-text">QR CODE</div><img src="${qrDataUrl}" alt="QR"><div class="qr-scan-text">SCAN FOR DETAILS</div></div>
        <div class="ami-wo-cell"><div class="wo-label">WO NO.</div><div class="wo-value">${woNum}</div></div>
      </div>
    </div>
  </div>
</body></html>`);
});

app.get('/qr/:id', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  const asset = await getAsset(req.params.id);
  if (!asset) return res.status(404).send('Not found');
  const qr = await QRCode.toDataURL(buildQrContent(asset), { width:300, margin:2, errorCorrectionLevel:'M' });
  res.send(`${HEAD('QR &mdash; '+asset.partName)}<body>${LAYOUT(`
  <div class="page-header"><div><h1 class="page-title">QR Code</h1><p class="page-sub">${asset.partName} &middot; ${asset.partNo}</p></div></div>
  ${SCANNER_BANNER}
  <div style="max-width:300px;">
    <div class="card" style="text-align:center;"><div class="card-body">
      <div class="qr-wrap" style="display:inline-block;margin-bottom:16px;"><img src="${qr}" style="width:200px;height:200px;display:block;"></div>
      <div style="font-weight:600;color:#111;margin-bottom:3px;">${asset.partName}</div>
      <div style="font-size:12px;color:#9ca3af;font-family:monospace;margin-bottom:16px;">${asset.partNo} &middot; ${asset.lotNo}</div>
      <a href="/qr/${req.params.id}/download" class="btn btn-primary btn-block">${I.download} Download PNG</a>
    </div></div>
  </div>
  `,'gallery')}`);
});

app.get('/qr/:id/download', async (req, res) => {
  const asset = await getAsset(req.params.id);
  if (!asset) return res.status(404).send('Not found');
  try {
    const buf = await QRCode.toBuffer(buildQrContent(asset), { width:600, margin:3, errorCorrectionLevel:'M' });
    res.setHeader('Content-Disposition', `attachment; filename=qr-${asset.partNo}-${asset.lotNo}.png`);
    res.type('image/png').send(buf);
  } catch { res.status(500).send('Error'); }
});

app.get('/delete/:id', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  await deleteAsset(req.params.id);
  res.redirect('/list');
});

app.get('/scan', (req, res) => {
  res.send(`${HEAD('Scan QR')}<body style="background:#f5f6fa;">
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;">
    <div style="width:100%;max-width:420px;">
      <div style="text-align:center;margin-bottom:20px;">
        <div class="brand-icon" style="width:40px;height:40px;border-radius:10px;margin:0 auto 10px;background:#3b82f6;display:flex;align-items:center;justify-content:center;">${I.scan}</div>
        <div style="font-size:18px;font-weight:700;color:#0f172a;">Scan QR Code</div>
        <div style="font-size:13px;color:#64748b;margin-top:4px;">Point your camera at an AMI QR label</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        <div style="position:relative;background:#000;min-height:280px;">
          <video id="video" style="width:100%;display:block;min-height:280px;" autoplay playsinline muted></video>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
            <div style="width:200px;height:200px;position:relative;">
              <div style="position:absolute;top:0;left:0;width:24px;height:24px;border-top:3px solid #3b82f6;border-left:3px solid #3b82f6;border-radius:2px 0 0 0;"></div>
              <div style="position:absolute;top:0;right:0;width:24px;height:24px;border-top:3px solid #3b82f6;border-right:3px solid #3b82f6;border-radius:0 2px 0 0;"></div>
              <div style="position:absolute;bottom:0;left:0;width:24px;height:24px;border-bottom:3px solid #3b82f6;border-left:3px solid #3b82f6;border-radius:0 0 0 2px;"></div>
              <div style="position:absolute;bottom:0;right:0;width:24px;height:24px;border-bottom:3px solid #3b82f6;border-right:3px solid #3b82f6;border-radius:0 0 2px 0;"></div>
              <div style="position:absolute;left:12px;right:12px;height:2px;background:linear-gradient(90deg,transparent,#3b82f6,transparent);animation:scanAnim 2s ease-in-out infinite;top:50%;"></div>
            </div>
          </div>
        </div>
        <div style="padding:14px 16px;text-align:center;background:#fafafa;">
          <p id="statusMsg" style="font-size:13px;color:#64748b;">Initializing camera...</p>
          <div id="resultBox" style="display:none;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin-top:10px;text-align:left;">
            <div style="font-size:11px;font-weight:700;color:#15803d;margin-bottom:6px;">&#x2713; Label Decoded</div>
            <pre id="resultText" style="font-family:'Courier New',monospace;font-size:11px;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto;color:#111;line-height:1.6;"></pre>
          </div>
          <button id="retryBtn" onclick="resetScan()" style="display:none;margin-top:10px;width:100%;padding:9px;background:#3b82f6;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">&#x21BA; Scan Another</button>
        </div>
      </div>
      <a href="/" style="display:block;text-align:center;color:#94a3b8;font-size:13px;margin-top:16px;text-decoration:none;">&larr; Back to Dashboard</a>
    </div>
  </div>
  <canvas id="canvas" style="display:none;"></canvas>
  <style>@keyframes scanAnim{0%{top:12px}50%{top:calc(100% - 12px)}100%{top:12px}}</style>
  <script src="https://unpkg.com/jsqr/dist/jsQR.js"></script>
  <script>
    var stopped=false;
    var video=document.getElementById('video'),canvas=document.getElementById('canvas'),ctx=canvas.getContext('2d');
    var statusMsg=document.getElementById('statusMsg'),resultBox=document.getElementById('resultBox'),resultText=document.getElementById('resultText'),retryBtn=document.getElementById('retryBtn');
    function resetScan(){stopped=false;resultBox.style.display='none';resultText.textContent='';retryBtn.style.display='none';statusMsg.textContent='Scanning...';statusMsg.style.color='#64748b';scan();}
    function onDetected(data){
      stopped=true;
      if(data.startsWith('COMPANY:')){statusMsg.textContent='\u2713 Label decoded!';statusMsg.style.color='#16a34a';resultBox.style.display='block';resultText.textContent=data.replace(/,/g,'\n');}
      else{statusMsg.textContent='QR detected! Redirecting\u2026';statusMsg.style.color='#16a34a';setTimeout(function(){window.location.href=data;},600);return;}
      retryBtn.style.display='block';
    }
    function scan(){
      if(stopped)return;
      if(video.readyState===video.HAVE_ENOUGH_DATA){
        canvas.width=video.videoWidth;canvas.height=video.videoHeight;ctx.drawImage(video,0,0);
        var code=jsQR(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,{inversionAttempts:'dontInvert'});
        if(code){onDetected(code.data);return;}
      }
      requestAnimationFrame(scan);
    }
    navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}})
      .then(function(s){video.srcObject=s;video.play();statusMsg.textContent='Scanning for QR codes...';scan();})
      .catch(function(){statusMsg.textContent='Camera access denied.';statusMsg.style.color='#dc2626';});
  </script></body></html>`);
});

app.get('/api/asset/:id', async (req, res) => {
  const asset = await getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Not found' });
  res.json(asset);
});

app.get('/api/network-info', (req, res) => {
  res.json({ detectedIP: getLocalNetworkIP(), port, localUrl: `http://${getLocalNetworkIP()}:${port}`, resolvedBaseUrl: getBaseUrl(req) });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`\nAMI QR System running on port ${port}\n`);
});