const express = require('express');
const QRCode = require('qrcode');
const bodyParser = require('body-parser');
const path = require('path');
const os = require('os');
const mongoose = require('mongoose');
const multer = require('multer');
const XLSX = require('xlsx');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password';
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

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

const partCatalogSchema = new mongoose.Schema({
  companyName: String,
  partNo:      { type: String, required: true },
  partName:    String,
  size:        String,
  lotNo:       String,
  quantity:    String,
  woNo:        String,
  month:       String,
  uploadedAt:  String,
  source:      { type: String, default: 'excel' },
});
const PartCatalog = mongoose.model('PartCatalog', partCatalogSchema);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.originalname.match(/\.(xlsx|xls|csv)$/i);
    if (ok) { cb(null, true); } else { cb(new Error('Only Excel/CSV files allowed'), false); }
  }
});

async function getAllAssets() {
  const docs = await Asset.find({}).lean();
  const map = new Map();
  docs.forEach(d => { map.set(d.name, d); });
  return map;
}
async function upsertAsset(asset) {
  await Asset.findOneAndUpdate({ name: asset.name }, asset, { upsert: true, new: true });
}
async function deleteAsset(name) { await Asset.deleteOne({ name }); }
async function getAsset(name) { return Asset.findOne({ name }).lean(); }
async function pushScanHistory(name, entry) {
  await Asset.updateOne({ name }, { $push: { scanHistory: entry } });
}
async function getAllCatalog() { return PartCatalog.find({}).lean(); }
async function deleteCatalogItem(id) { await PartCatalog.deleteOne({ _id: id }); }
async function clearCatalog() { await PartCatalog.deleteMany({}); }

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
function generateAssetKey(partNo, lotNo) {
  const base = partNo.trim() + '-' + lotNo.trim();
  const ts = Date.now().toString(36).toUpperCase();
  return `${base}-${ts}`;
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
.btn-success { background: #16a34a; color: #fff; border-color: #16a34a; }
.btn-success:hover { background: #15803d; }
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
.badge-orange { background: #fff7ed; color: #ea580c; }
.alert { padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 16px; }
.alert-error { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }
.alert-success { background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; }
.alert-info { background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; }
.alert-warning { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.detail-label { font-size: 11px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px; }
.detail-value { font-size: 14px; font-weight: 500; color: #111827; }
.qr-wrap { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; display: inline-block; }
.empty { padding: 48px 24px; text-align: center; color: #9ca3af; }
.empty svg { width: 36px; height: 36px; margin: 0 auto 12px; display: block; opacity: 0.3; }
.empty p { margin-bottom: 16px; }
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
.print-modal { background: #fff; border-radius: 12px; width: 100%; max-width: 540px; max-height: 92vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
.print-modal-header { padding: 18px 20px; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; background: #fff; z-index: 10; }
.print-modal-title { font-size: 15px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 8px; }
.print-modal-close { width: 28px; height: 28px; border-radius: 6px; border: 1px solid #e5e7eb; background: #f9fafb; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; color: #6b7280; line-height: 1; }
.print-modal-close:hover { background: #fee2e2; color: #ef4444; border-color: #fca5a5; }
.print-modal-body { padding: 20px; }
.print-modal-footer { padding: 14px 20px; border-top: 1px solid #e5e7eb; display: flex; gap: 8px; justify-content: flex-end; position: sticky; bottom: 0; background: #fff; }
.print-option-group { margin-bottom: 20px; }
.print-option-label { font-size: 11px; font-weight: 700; color: #374151; text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 8px; }
.print-option-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; }
.print-opt-btn { border: 2px solid #e5e7eb; border-radius: 7px; padding: 8px 6px; text-align: center; cursor: pointer; transition: all 0.12s; background: #fff; font-family: inherit; }
.print-opt-btn:hover { border-color: #93c5fd; background: #eff6ff; }
.print-opt-btn.selected { border-color: #3b82f6; background: #eff6ff; color: #1d4ed8; }
.print-opt-btn .opt-num { font-size: 16px; font-weight: 800; color: #0f172a; line-height: 1; }
.print-opt-btn.selected .opt-num { color: #1d4ed8; }
.print-opt-btn .opt-lbl { font-size: 9px; color: #6b7280; font-weight: 600; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.05em; }
.print-opt-btn.selected .opt-lbl { color: #3b82f6; }
.print-toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid #f1f5f9; }
.print-toggle-row:last-child { border-bottom: none; }
.print-toggle-info .ptl { font-size: 13px; font-weight: 500; color: #111; }
.print-toggle-info .pts { font-size: 11px; color: #9ca3af; margin-top: 1px; }
.toggle-switch { position: relative; width: 38px; height: 22px; flex-shrink: 0; }
.toggle-switch input { opacity: 0; width: 0; height: 0; }
.toggle-slider { position: absolute; inset: 0; background: #d1d5db; border-radius: 99px; cursor: pointer; transition: background 0.2s; }
.toggle-slider:before { content: ''; position: absolute; width: 16px; height: 16px; background: #fff; border-radius: 50%; top: 3px; left: 3px; transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
.toggle-switch input:checked + .toggle-slider { background: #3b82f6; }
.toggle-switch input:checked + .toggle-slider:before { transform: translateX(16px); }
.preview-paper { background: #fff; border: 1px solid #aaa; display: grid; margin: 0 auto; }
.preview-cell { border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; }
.preview-cell.filled { background: #B5D4F4; border: 1px solid #378ADD; color: #185FA5; }
.preview-cell.empty { background: #f3f4f6; border: 1px dashed #d1d5db; }
.margin-input { width: 100%; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; text-align: center; }
.margin-preset { font-size: 11px; padding: 3px 8px; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; cursor: pointer; font-family: inherit; }
.margin-preset:hover { background: #eff6ff; border-color: #93c5fd; }
.scanner-info-banner { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 10px 14px; font-size: 12px; color: #1d4ed8; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
.upload-zone { border: 2px dashed #cbd5e1; border-radius: 10px; padding: 36px 20px; text-align: center; cursor: pointer; transition: all 0.2s; background: #f8fafc; }
.upload-zone:hover, .upload-zone.drag-over { border-color: #3b82f6; background: #eff6ff; }
.upload-zone svg { width: 40px; height: 40px; color: #94a3b8; margin: 0 auto 12px; display: block; }
.upload-zone p { font-size: 14px; color: #64748b; margin-bottom: 6px; }
.upload-zone small { font-size: 12px; color: #94a3b8; }
.step-badge { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; background: #3b82f6; color: #fff; border-radius: 50%; font-size: 12px; font-weight: 700; flex-shrink: 0; }
.step-row { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 20px; }
.step-content .step-title { font-size: 13px; font-weight: 700; color: #111; margin-bottom: 3px; }
.step-content .step-desc { font-size: 12px; color: #64748b; }
.autocomplete-list { display: none; position: absolute; top: 100%; left: 0; right: 0; background: #fff; border: 1px solid #d1d5db; border-top: none; border-radius: 0 0 8px 8px; max-height: 260px; overflow-y: auto; z-index: 500; box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
.autocomplete-list.open { display: block; }
.autocomplete-item { padding: 10px 14px; font-size: 13px; cursor: pointer; border-bottom: 1px solid #f1f5f9; display: flex; align-items: flex-start; gap: 10px; }
.autocomplete-item:last-child { border-bottom: none; }
.autocomplete-item:hover, .autocomplete-item.highlighted { background: #eff6ff; }
.autocomplete-item .ac-icon { width: 28px; height: 28px; background: #dbeafe; border-radius: 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 11px; font-weight: 700; color: #3b82f6; margin-top: 1px; }
.autocomplete-item:hover .ac-icon, .autocomplete-item.highlighted .ac-icon { background: #3b82f6; color: #fff; }
.autocomplete-item .ac-body { flex: 1; min-width: 0; }
.autocomplete-item .ac-main { font-weight: 700; color: #111; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.autocomplete-item:hover .ac-main, .autocomplete-item.highlighted .ac-main { color: #1d4ed8; }
.autocomplete-item .ac-sub { font-size: 11px; color: #6b7280; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.autocomplete-item .ac-tags { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
.autocomplete-item .ac-tag { background: #f1f5f9; color: #475569; font-size: 10px; padding: 1px 6px; border-radius: 4px; font-family: monospace; }
.autocomplete-item:hover .ac-tag, .autocomplete-item.highlighted .ac-tag { background: #dbeafe; color: #1d4ed8; }
.ac-no-results { padding: 16px 14px; text-align: center; color: #9ca3af; font-size: 12px; }
.ac-header { padding: 6px 14px 4px; font-size: 10px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.08em; background: #f8fafc; border-bottom: 1px solid #f1f5f9; }
.form-filled { border-color: #22c55e !important; box-shadow: 0 0 0 3px rgba(34,197,94,0.1) !important; background: #f0fdf4 !important; }
.mini-upload-bar { background: linear-gradient(135deg,#eff6ff,#f0fdf4); border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.mini-upload-bar .mu-info { font-size: 12px; color: #1d4ed8; font-weight: 600; }
.mini-upload-bar .mu-sub { font-size: 11px; color: #64748b; margin-top: 1px; }
.catalog-fill-banner { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 10px; animation: fadeIn 0.2s ease; }
@keyframes fadeIn { from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)} }
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
  .mini-upload-bar { flex-direction: column; align-items: flex-start; }
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
  excel:`<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`,
  upload:`<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>`,
  check:`<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
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
    <div class="nav-section">Import</div>
    <a href="/excel-import" class="nav-link ${active==='excel'?'active':''}">${I.excel} Excel Import</a>
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
  <a href="/excel-import" class="mob-nav-item ${active==='excel'?'active':''}">${I.excel}<span>Import</span></a>
  <a href="/scan" class="mob-nav-item ${active==='scan'?'active':''}">${I.scan}<span>Scan</span></a>
</div></div>`;

const LAYOUT = (content, active='') => `${SIDEBAR_HTML(active)}${MOB_HEADER()}${MOB_NAV(active)}<main class="main">${content}</main></body></html>`;

const SCANNER_BANNER = `<div class="scanner-info-banner">
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
  <span><strong>Scanner Ready:</strong> QR encodes full label details &mdash; scan with your barcode scanner to output all fields directly.</span>
</div>`;

// ══════════════════════════════════════════════════════════════════════════════
// SMART PRINT MODAL
// ══════════════════════════════════════════════════════════════════════════════
function printModalHTML() {
  return `<div class="print-modal-overlay" id="printModalOverlay">
  <div class="print-modal">
    <div class="print-modal-header">
      <div class="print-modal-title">${I.print} Smart Print</div>
      <button class="print-modal-close" id="closeModal">&#x2715;</button>
    </div>
    <div class="print-modal-body">

      <!-- LIVE PREVIEW -->
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:20px;">
        <div style="font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px;">Live Page Preview</div>
        <div style="display:flex;gap:14px;align-items:flex-start;">
          <div id="miniPaper" class="preview-paper"></div>
          <div id="previewInfo" style="font-size:12px;color:#374151;line-height:2;"></div>
        </div>
      </div>

      <!-- LAYOUT -->
      <div class="print-option-group">
        <div class="print-option-label">Layout — labels per page</div>
        <div class="print-option-grid" id="layoutGrid">
          <button class="print-opt-btn" data-cols="1" data-rows="1" onclick="setLayout(this)"><div class="opt-num">1</div><div class="opt-lbl">Single</div></button>
          <button class="print-opt-btn selected" data-cols="2" data-rows="1" onclick="setLayout(this)"><div class="opt-num">2</div><div class="opt-lbl">Side by side</div></button>
          <button class="print-opt-btn" data-cols="1" data-rows="2" onclick="setLayout(this)"><div class="opt-num">2</div><div class="opt-lbl">Top / bottom</div></button>
          <button class="print-opt-btn" data-cols="2" data-rows="2" onclick="setLayout(this)"><div class="opt-num">4</div><div class="opt-lbl">2 × 2</div></button>
          <button class="print-opt-btn" data-cols="3" data-rows="2" onclick="setLayout(this)"><div class="opt-num">6</div><div class="opt-lbl">3 × 2</div></button>
          <button class="print-opt-btn" data-cols="4" data-rows="2" onclick="setLayout(this)"><div class="opt-num">8</div><div class="opt-lbl">4 × 2</div></button>
        </div>
      </div>

      <!-- PAPER SIZE -->
      <div class="print-option-group">
        <div class="print-option-label">Paper size</div>
        <div class="print-option-grid" id="paperGrid">
          <button class="print-opt-btn selected" data-pw="297" data-ph="210" data-pcss="size:297mm 210mm" onclick="setPaper(this)"><div class="opt-num" style="font-size:11px;">A4</div><div class="opt-lbl">Landscape</div></button>
          <button class="print-opt-btn" data-pw="210" data-ph="297" data-pcss="size:210mm 297mm" onclick="setPaper(this)"><div class="opt-num" style="font-size:11px;">A4</div><div class="opt-lbl">Portrait</div></button>
          <button class="print-opt-btn" data-pw="210" data-ph="148" data-pcss="size:210mm 148mm" onclick="setPaper(this)"><div class="opt-num" style="font-size:11px;">A5</div><div class="opt-lbl">Landscape</div></button>
          <button class="print-opt-btn" data-pw="148" data-ph="210" data-pcss="size:148mm 210mm" onclick="setPaper(this)"><div class="opt-num" style="font-size:11px;">A5</div><div class="opt-lbl">Portrait</div></button>
          <button class="print-opt-btn" data-pw="279" data-ph="216" data-pcss="size:279mm 216mm" onclick="setPaper(this)"><div class="opt-num" style="font-size:11px;">Ltr</div><div class="opt-lbl">Landscape</div></button>
          <button class="print-opt-btn" data-pw="216" data-ph="279" data-pcss="size:216mm 279mm" onclick="setPaper(this)"><div class="opt-num" style="font-size:11px;">Ltr</div><div class="opt-lbl">Portrait</div></button>
        </div>
      </div>

      <!-- MARGINS -->
      <div class="print-option-group">
        <div class="print-option-label">Page Margins (mm)</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
          <div style="text-align:center;">
            <div style="font-size:10px;font-weight:600;color:#6b7280;margin-bottom:4px;">TOP</div>
            <input type="number" id="mTop" class="margin-input" value="8" min="0" max="50" oninput="updatePreview()">
          </div>
          <div style="text-align:center;">
            <div style="font-size:10px;font-weight:600;color:#6b7280;margin-bottom:4px;">BOTTOM</div>
            <input type="number" id="mBottom" class="margin-input" value="8" min="0" max="50" oninput="updatePreview()">
          </div>
          <div style="text-align:center;">
            <div style="font-size:10px;font-weight:600;color:#6b7280;margin-bottom:4px;">LEFT</div>
            <input type="number" id="mLeft" class="margin-input" value="8" min="0" max="50" oninput="updatePreview()">
          </div>
          <div style="text-align:center;">
            <div style="font-size:10px;font-weight:600;color:#6b7280;margin-bottom:4px;">RIGHT</div>
            <input type="number" id="mRight" class="margin-input" value="8" min="0" max="50" oninput="updatePreview()">
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-size:11px;color:#9ca3af;">Quick:</span>
          <button class="margin-preset" onclick="setMargins(0,0,0,0)">No margin</button>
          <button class="margin-preset" onclick="setMargins(5,5,5,5)">5mm all</button>
          <button class="margin-preset" onclick="setMargins(8,8,8,8)">8mm all</button>
          <button class="margin-preset" onclick="setMargins(10,10,10,10)">10mm all</button>
          <button class="margin-preset" onclick="setMargins(5,5,15,5)">Left 15mm</button>
        </div>
      </div>

      <!-- COPIES -->
      <div class="print-option-group">
        <div class="print-option-label">Total copies to print</div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <input type="range" id="copiesRange" min="1" max="50" value="2" step="1" style="flex:1;" oninput="document.getElementById('copiesNum').textContent=this.value;updatePreview();">
          <span id="copiesNum" style="font-size:20px;font-weight:700;color:#111;min-width:28px;text-align:right;">2</span>
          <span style="font-size:12px;color:#9ca3af;">labels</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:5px;">
          <button class="print-opt-btn" onclick="setCopies(4)"><div class="opt-num" style="font-size:14px;">4</div></button>
          <button class="print-opt-btn" onclick="setCopies(8)"><div class="opt-num" style="font-size:14px;">8</div></button>
          <button class="print-opt-btn" onclick="setCopies(12)"><div class="opt-num" style="font-size:14px;">12</div></button>
          <button class="print-opt-btn" onclick="setCopies(16)"><div class="opt-num" style="font-size:14px;">16</div></button>
          <button class="print-opt-btn" onclick="setCopies(24)"><div class="opt-num" style="font-size:14px;">24</div></button>
        </div>
      </div>

      <!-- LABEL OPTIONS -->
      <div class="print-option-group">
        <div class="print-option-label">Label options</div>
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:0 12px;">
          <div class="print-toggle-row">
            <div class="print-toggle-info"><div class="ptl">Auto-fit to page</div><div class="pts">Labels fill paper exactly based on layout</div></div>
            <label class="toggle-switch"><input type="checkbox" id="togFit" checked onchange="updatePreview()"><span class="toggle-slider"></span></label>
          </div>
          <div class="print-toggle-row">
            <div class="print-toggle-info"><div class="ptl">Show QR code</div></div>
            <label class="toggle-switch"><input type="checkbox" id="togQR" checked onchange="updatePreview()"><span class="toggle-slider"></span></label>
          </div>
          <div class="print-toggle-row">
            <div class="print-toggle-info"><div class="ptl">Company header</div></div>
            <label class="toggle-switch"><input type="checkbox" id="togCompany" checked onchange="updatePreview()"><span class="toggle-slider"></span></label>
          </div>
          <div class="print-toggle-row">
            <div class="print-toggle-info"><div class="ptl">Show border</div></div>
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
  var ASSET=${JSON.stringify(assetJSON)};
  var QR=${JSON.stringify(qrDataUrl)};
  var st={cols:2,rows:1,pw:297,ph:210,pcss:'size:297mm 210mm',copies:2,fit:true,qr:true,co:true,border:true,mt:8,mb:8,ml:8,mr:8};

  window.setLayout=function(btn){
    document.querySelectorAll('#layoutGrid .print-opt-btn').forEach(function(b){b.classList.remove('selected');});
    btn.classList.add('selected');
    st.cols=parseInt(btn.dataset.cols);
    st.rows=parseInt(btn.dataset.rows);
    updatePreview();
  };
  window.setPaper=function(btn){
    document.querySelectorAll('#paperGrid .print-opt-btn').forEach(function(b){b.classList.remove('selected');});
    btn.classList.add('selected');
    st.pw=parseInt(btn.dataset.pw);
    st.ph=parseInt(btn.dataset.ph);
    st.pcss=btn.dataset.pcss;
    updatePreview();
  };
  window.setMargins=function(t,b,l,r){
    document.getElementById('mTop').value=t;
    document.getElementById('mBottom').value=b;
    document.getElementById('mLeft').value=l;
    document.getElementById('mRight').value=r;
    st.mt=t; st.mb=b; st.ml=l; st.mr=r;
    updatePreview();
  };
  window.setCopies=function(n){
    document.getElementById('copiesRange').value=n;
    document.getElementById('copiesNum').textContent=n;
    st.copies=n;
    updatePreview();
  };

  window.updatePreview=function(){
    st.copies=parseInt(document.getElementById('copiesRange').value)||2;
    st.fit=document.getElementById('togFit').checked;
    st.qr=document.getElementById('togQR').checked;
    st.co=document.getElementById('togCompany').checked;
    st.border=document.getElementById('togBorder').checked;
    st.mt=parseInt(document.getElementById('mTop').value)||0;
    st.mb=parseInt(document.getElementById('mBottom').value)||0;
    st.ml=parseInt(document.getElementById('mLeft').value)||0;
    st.mr=parseInt(document.getElementById('mRight').value)||0;

    var gap=3;
    var perPage=st.cols*st.rows;
    var pages=Math.ceil(st.copies/perPage);
    var usableW=st.pw-st.ml-st.mr;
    var usableH=st.ph-st.mt-st.mb;
    var lw=st.fit?Math.floor((usableW-gap*(st.cols-1))/st.cols):100;
    var lh=st.fit?Math.floor((usableH-gap*(st.rows-1))/st.rows):70;

    var SCALE=0.43;
    var paper=document.getElementById('miniPaper');
    paper.style.width=Math.round(st.pw*SCALE)+'px';
    paper.style.height=Math.round(st.ph*SCALE)+'px';
    paper.style.gridTemplateColumns='repeat('+st.cols+',1fr)';
    paper.style.gap='2px';
    paper.style.padding=Math.round(((st.mt+st.mb)/2)*SCALE)+'px '+Math.round(((st.ml+st.mr)/2)*SCALE)+'px';
    paper.innerHTML='';
    var shown=Math.min(perPage,st.copies);
    for(var i=0;i<perPage;i++){
      var c=document.createElement('div');
      c.className='preview-cell '+(i<shown?'filled':'empty');
      if(i<shown) c.textContent=i+1;
      paper.appendChild(c);
    }
    document.getElementById('previewInfo').innerHTML=
      '<b>'+shown+'</b> per page &nbsp;&middot;&nbsp; <b>'+pages+'</b> page'+(pages>1?'s':'')+'<br>'+
      'Label: <b>'+lw+' &times; '+lh+' mm</b><br>'+
      'Grid: <b>'+st.cols+' &times; '+st.rows+'</b><br>'+
      'Margins: T<b>'+st.mt+'</b> B<b>'+st.mb+'</b> L<b>'+st.ml+'</b> R<b>'+st.mr+'</b> mm';
  };

  function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

  function buildLabel(a,qr,showQR,showCo,border,inner,lw,lh){
    var mn=('0'+(a.month||'03')).slice(-2);
    var sc=Math.min(lw/105,lh/70);
    var fBase=Math.max(7,Math.round(10*sc));
    var fSm=Math.max(6,Math.round(7*sc));
    var fLg=Math.max(9,Math.round(13*sc));
    var fAmi=Math.max(12,Math.round(18*sc));
    var qrSz=Math.round(54*sc);
    var pad=Math.round(3*sc)+'px '+Math.round(7*sc)+'px';
    var btmH=Math.round(lh*0.32)+'mm';
    return '<div style="border:'+border+';font-family:Courier New,monospace;background:#fff;color:#111;'+
      'width:'+lw+'mm;height:'+lh+'mm;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;page-break-inside:avoid;break-inside:avoid;">'+
      (showCo?'<div style="display:flex;align-items:stretch;border-bottom:'+inner+';flex-shrink:0;">'+
        '<div style="flex:1;padding:'+pad+';border-right:'+inner+';">'+
          '<div style="font-size:'+fSm+'px;font-weight:bold;color:#555;">COMPANY</div>'+
          '<div style="font-size:'+fBase+'px;font-weight:bold;line-height:1.2;">'+esc(a.companyName.toUpperCase())+'</div>'+
        '</div>'+
        '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:'+pad+';border-right:'+inner+';min-width:'+Math.round(42*sc)+'px;text-align:center;">'+
          '<div style="font-size:'+fSm+'px;font-weight:bold;letter-spacing:0.1em;">* AMI *</div>'+
          '<div style="font-size:'+fAmi+'px;font-weight:bold;line-height:1;">'+mn+'</div>'+
        '</div>'+
        '<div style="display:flex;align-items:center;justify-content:center;padding:'+pad+';">'+
          '<div style="border:'+inner+';padding:2px 4px;font-size:'+fSm+'px;font-weight:bold;line-height:1.3;text-align:center;">ROHS 2<br>FREE</div>'+
        '</div>'+
      '</div>':'')+
      '<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:'+inner+';flex-shrink:0;">'+
        '<div style="padding:'+pad+';">'+
          '<div style="font-size:'+fSm+'px;font-weight:bold;color:#555;">PART NO.</div>'+
          '<div style="font-size:'+fBase+'px;font-weight:bold;font-family:Courier New,monospace;">'+esc(a.partNo)+'</div>'+
        '</div>'+
        '<div style="padding:'+pad+';border-left:'+inner+';">'+
          '<div style="font-size:'+fSm+'px;font-weight:bold;color:#555;">PART NAME</div>'+
          '<div style="font-size:'+fBase+'px;font-weight:bold;">'+esc(a.partName)+'</div>'+
        '</div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:'+inner+';flex-shrink:0;">'+
        '<div style="padding:'+pad+';">'+
          '<div style="font-size:'+fSm+'px;font-weight:bold;color:#555;">SIZE</div>'+
          '<div style="font-size:'+fBase+'px;font-weight:bold;">'+esc(a.size||'\u2014')+'</div>'+
        '</div>'+
        '<div style="padding:'+pad+';border-left:'+inner+';">'+
          '<div style="font-size:'+fSm+'px;font-weight:bold;color:#555;">LOT NO.</div>'+
          '<div style="font-size:'+fBase+'px;font-weight:bold;font-family:Courier New,monospace;">'+esc(a.lotNo)+'</div>'+
        '</div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:'+inner+';flex-shrink:0;">'+
        '<div style="padding:'+pad+';">'+
          '<div style="font-size:'+fSm+'px;font-weight:bold;color:#555;">QUANTITY</div>'+
          '<div style="font-size:'+fLg+'px;font-weight:bold;">'+esc(a.quantity)+'</div>'+
        '</div>'+
        '<div style="padding:'+pad+';border-left:'+inner+';">'+
          '<div style="font-size:'+fSm+'px;font-weight:bold;color:#555;">PACKER</div>'+
          '<div style="font-size:'+fBase+'px;font-weight:bold;">'+esc(a.packer)+'</div>'+
        '</div>'+
      '</div>'+
      '<div style="display:flex;align-items:stretch;height:'+btmH+';flex-shrink:0;">'+
        (showQR?
          '<div style="border-right:'+inner+';padding:3px 5px;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;">'+
            '<div style="font-size:6px;font-weight:bold;color:#555;margin-bottom:2px;">QR CODE</div>'+
            '<img src="'+qr+'" style="width:'+qrSz+'px;height:'+qrSz+'px;display:block;">'+
            '<div style="font-size:6px;color:#888;margin-top:1px;">SCAN FOR DETAILS</div>'+
          '</div>':'')+
        '<div style="flex:1;padding:'+pad+';display:flex;flex-direction:column;justify-content:center;">'+
          '<div style="font-size:'+fSm+'px;font-weight:bold;color:#555;">WO NO.</div>'+
          '<div style="font-size:'+fBase+'px;font-weight:bold;font-family:Courier New,monospace;word-break:break-all;">'+esc(a.woNo||'\u2014')+'</div>'+
        '</div>'+
      '</div>'+
    '</div>';
  }

  document.getElementById('openPrintModal').addEventListener('click',function(){
    document.getElementById('printModalOverlay').classList.add('open');
    updatePreview();
  });
  document.getElementById('closeModal').addEventListener('click',function(){document.getElementById('printModalOverlay').classList.remove('open');});
  document.getElementById('cancelPrintBtn').addEventListener('click',function(){document.getElementById('printModalOverlay').classList.remove('open');});
  document.getElementById('printModalOverlay').addEventListener('click',function(e){if(e.target===this)this.classList.remove('open');});

  document.getElementById('confirmPrintBtn').addEventListener('click',function(){
    var gap=3;
    var usableW=st.pw-st.ml-st.mr;
    var usableH=st.ph-st.mt-st.mb;
    var lw=st.fit?Math.floor((usableW-gap*(st.cols-1))/st.cols):100;
    var lh=st.fit?Math.floor((usableH-gap*(st.rows-1))/st.rows):70;
    var border=st.border?'1.5px solid #111':'1px solid #ccc';
    var inner=st.border?'1px solid #111':'0.5px solid #ddd';

    var html='';
    for(var i=0;i<st.copies;i++) html+=buildLabel(ASSET,QR,st.qr,st.co,border,inner,lw,lh);

    var old=document.getElementById('_pstyle');if(old)old.remove();
    var s=document.createElement('style');s.id='_pstyle';
    s.innerHTML='@media print{'+
      '@page{'+st.pcss+';margin-top:'+st.mt+'mm;margin-bottom:'+st.mb+'mm;margin-left:'+st.ml+'mm;margin-right:'+st.mr+'mm;}'+
      '*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}'+
      'html,body{margin:0!important;padding:0!important;}'+
      'body *{visibility:hidden!important;}'+
      '#_PS,#_PS *{visibility:visible!important;}'+
      '#_PS{position:fixed!important;top:0!important;left:0!important;'+
        'display:grid!important;'+
        'grid-template-columns:repeat('+st.cols+','+lw+'mm)!important;'+
        'grid-auto-rows:'+lh+'mm!important;'+
        'gap:'+gap+'mm!important;'+
        'margin:0!important;padding:0!important;background:#fff!important;}}';
    document.head.appendChild(s);

    var sheet=document.getElementById('_PS');
    if(!sheet){sheet=document.createElement('div');sheet.id='_PS';document.body.appendChild(sheet);}
    sheet.innerHTML=html;
    sheet.style.cssText='display:none;';
    document.getElementById('printModalOverlay').classList.remove('open');

    setTimeout(function(){
      sheet.style.display='grid';
      sheet.style.gridTemplateColumns='repeat('+st.cols+','+lw+'mm)';
      sheet.style.gridAutoRows=lh+'mm';
      sheet.style.gap=gap+'mm';
      requestAnimationFrame(function(){requestAnimationFrame(function(){
        window.print();
        setTimeout(function(){sheet.style.display='none';sheet.innerHTML='';},1500);
      });});
    },250);
  });

  updatePreview();
})();
<\/script>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// BULK PRINT MODAL
// ══════════════════════════════════════════════════════════════════════════════
function bulkPrintModalHTML() {
  return `<div class="print-modal-overlay" id="bulkPrintModalOverlay">
  <div class="print-modal">
    <div class="print-modal-header">
      <div class="print-modal-title">${I.print} Bulk Print</div>
      <button class="print-modal-close" id="closeBulkModal">&#x2715;</button>
    </div>
    <div class="print-modal-body">
      <div id="bulkSelectedSummary" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:7px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:#1d4ed8;font-weight:600;"></div>

      <!-- LIVE PREVIEW -->
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:20px;">
        <div style="font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px;">Live Preview</div>
        <div style="display:flex;gap:14px;align-items:flex-start;">
          <div id="bulkMiniPaper" class="preview-paper"></div>
          <div id="bulkPreviewInfo" style="font-size:12px;color:#374151;line-height:2;"></div>
        </div>
      </div>

      <div class="print-option-group">
        <div class="print-option-label">Layout</div>
        <div class="print-option-grid" id="bulkLayoutGrid">
          <button class="print-opt-btn" data-cols="1" data-rows="1" onclick="bulkSetLayout(this)"><div class="opt-num">1</div><div class="opt-lbl">Single</div></button>
          <button class="print-opt-btn selected" data-cols="2" data-rows="1" onclick="bulkSetLayout(this)"><div class="opt-num">2</div><div class="opt-lbl">Side by side</div></button>
          <button class="print-opt-btn" data-cols="1" data-rows="2" onclick="bulkSetLayout(this)"><div class="opt-num">2</div><div class="opt-lbl">Top/Bottom</div></button>
          <button class="print-opt-btn" data-cols="2" data-rows="2" onclick="bulkSetLayout(this)"><div class="opt-num">4</div><div class="opt-lbl">2 × 2</div></button>
          <button class="print-opt-btn" data-cols="3" data-rows="2" onclick="bulkSetLayout(this)"><div class="opt-num">6</div><div class="opt-lbl">3 × 2</div></button>
          <button class="print-opt-btn" data-cols="4" data-rows="2" onclick="bulkSetLayout(this)"><div class="opt-num">8</div><div class="opt-lbl">4 × 2</div></button>
        </div>
      </div>

      <div class="print-option-group">
        <div class="print-option-label">Paper size</div>
        <div class="print-option-grid" id="bulkPaperGrid">
          <button class="print-opt-btn selected" data-pw="297" data-ph="210" data-pcss="size:297mm 210mm" onclick="bulkSetPaper(this)"><div class="opt-num" style="font-size:11px;">A4</div><div class="opt-lbl">Landscape</div></button>
          <button class="print-opt-btn" data-pw="210" data-ph="297" data-pcss="size:210mm 297mm" onclick="bulkSetPaper(this)"><div class="opt-num" style="font-size:11px;">A4</div><div class="opt-lbl">Portrait</div></button>
          <button class="print-opt-btn" data-pw="210" data-ph="148" data-pcss="size:210mm 148mm" onclick="bulkSetPaper(this)"><div class="opt-num" style="font-size:11px;">A5</div><div class="opt-lbl">Landscape</div></button>
          <button class="print-opt-btn" data-pw="148" data-ph="210" data-pcss="size:148mm 210mm" onclick="bulkSetPaper(this)"><div class="opt-num" style="font-size:11px;">A5</div><div class="opt-lbl">Portrait</div></button>
          <button class="print-opt-btn" data-pw="279" data-ph="216" data-pcss="size:279mm 216mm" onclick="bulkSetPaper(this)"><div class="opt-num" style="font-size:11px;">Ltr</div><div class="opt-lbl">Landscape</div></button>
          <button class="print-opt-btn" data-pw="216" data-ph="279" data-pcss="size:216mm 279mm" onclick="bulkSetPaper(this)"><div class="opt-num" style="font-size:11px;">Ltr</div><div class="opt-lbl">Portrait</div></button>
        </div>
      </div>

      <div class="print-option-group">
        <div class="print-option-label">Margins (mm)</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
          <div style="text-align:center;"><div style="font-size:10px;font-weight:600;color:#6b7280;margin-bottom:4px;">TOP</div><input type="number" id="bmTop" class="margin-input" value="8" min="0" max="50" oninput="bulkUpdatePreview()"></div>
          <div style="text-align:center;"><div style="font-size:10px;font-weight:600;color:#6b7280;margin-bottom:4px;">BOTTOM</div><input type="number" id="bmBottom" class="margin-input" value="8" min="0" max="50" oninput="bulkUpdatePreview()"></div>
          <div style="text-align:center;"><div style="font-size:10px;font-weight:600;color:#6b7280;margin-bottom:4px;">LEFT</div><input type="number" id="bmLeft" class="margin-input" value="8" min="0" max="50" oninput="bulkUpdatePreview()"></div>
          <div style="text-align:center;"><div style="font-size:10px;font-weight:600;color:#6b7280;margin-bottom:4px;">RIGHT</div><input type="number" id="bmRight" class="margin-input" value="8" min="0" max="50" oninput="bulkUpdatePreview()"></div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-size:11px;color:#9ca3af;">Quick:</span>
          <button class="margin-preset" onclick="bulkSetMargins(0,0,0,0)">No margin</button>
          <button class="margin-preset" onclick="bulkSetMargins(5,5,5,5)">5mm all</button>
          <button class="margin-preset" onclick="bulkSetMargins(8,8,8,8)">8mm all</button>
          <button class="margin-preset" onclick="bulkSetMargins(10,10,10,10)">10mm all</button>
        </div>
      </div>

      <div class="print-option-group">
        <div class="print-option-label">Copies per label</div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <input type="range" id="bulkCopiesRange" min="1" max="20" value="1" step="1" style="flex:1;" oninput="document.getElementById('bulkCopiesNum').textContent=this.value;bulkUpdatePreview();">
          <span id="bulkCopiesNum" style="font-size:20px;font-weight:700;color:#111;min-width:24px;text-align:right;">1</span>
        </div>
      </div>

      <div class="print-option-group">
        <div class="print-option-label">Label options</div>
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:0 12px;">
          <div class="print-toggle-row"><div class="print-toggle-info"><div class="ptl">Auto-fit to page</div></div><label class="toggle-switch"><input type="checkbox" id="bulkTogFit" checked onchange="bulkUpdatePreview()"><span class="toggle-slider"></span></label></div>
          <div class="print-toggle-row"><div class="print-toggle-info"><div class="ptl">Show QR code</div></div><label class="toggle-switch"><input type="checkbox" id="bulkTogQR" checked onchange="bulkUpdatePreview()"><span class="toggle-slider"></span></label></div>
          <div class="print-toggle-row"><div class="print-toggle-info"><div class="ptl">Company header</div></div><label class="toggle-switch"><input type="checkbox" id="bulkTogCo" checked onchange="bulkUpdatePreview()"><span class="toggle-slider"></span></label></div>
          <div class="print-toggle-row"><div class="print-toggle-info"><div class="ptl">Show border</div></div><label class="toggle-switch"><input type="checkbox" id="bulkTogBorder" checked onchange="bulkUpdatePreview()"><span class="toggle-slider"></span></label></div>
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
  var bst={cols:2,rows:1,pw:297,ph:210,pcss:'size:297mm 210mm',cpl:1,fit:true,qr:true,co:true,border:true,mt:8,mb:8,ml:8,mr:8};
  var selectedKeys=[];

  function updateBulkBar(){
    var bar=document.getElementById('bulkBar');
    selectedKeys=[];
    document.querySelectorAll('.label-select-cb:checked').forEach(function(cb){selectedKeys.push(cb.dataset.key);});
    if(selectedKeys.length>0){
      bar.classList.add('visible');
      document.getElementById('bulkBarCount').textContent=selectedKeys.length+' selected';
    } else { bar.classList.remove('visible'); }
  }

  document.querySelectorAll('.label-select-cb').forEach(function(cb){
    cb.addEventListener('change',function(){
      var wrap=this.closest('.label-card-wrap');
      if(this.checked) wrap.classList.add('selected-card');
      else wrap.classList.remove('selected-card');
      updateBulkBar();
    });
  });

  var saCb=document.getElementById('selectAllCb');
  if(saCb) saCb.addEventListener('change',function(){
    document.querySelectorAll('.label-select-cb').forEach(function(cb){
      cb.checked=saCb.checked;
      var wrap=cb.closest('.label-card-wrap');
      if(saCb.checked) wrap.classList.add('selected-card');
      else wrap.classList.remove('selected-card');
    });
    updateBulkBar();
  });

  document.getElementById('bulkPrintBtn').addEventListener('click',function(){
    if(selectedKeys.length===0){alert('Please select at least one label.');return;}
    var names=selectedKeys.map(function(k){var a=BULK_ASSETS[k];return a?(a.partName+' ('+a.partNo+')'):k;});
    document.getElementById('bulkSelectedSummary').innerHTML='&#x2713; Printing <strong>'+selectedKeys.length+' label type'+(selectedKeys.length>1?'s':'')+'</strong>: '+names.join(', ');
    document.getElementById('bulkPrintModalOverlay').classList.add('open');
    bulkUpdatePreview();
  });

  document.getElementById('closeBulkModal').addEventListener('click',function(){document.getElementById('bulkPrintModalOverlay').classList.remove('open');});
  document.getElementById('cancelBulkPrintBtn').addEventListener('click',function(){document.getElementById('bulkPrintModalOverlay').classList.remove('open');});
  document.getElementById('bulkPrintModalOverlay').addEventListener('click',function(e){if(e.target===this)this.classList.remove('open');});

  window.bulkSetLayout=function(btn){
    document.querySelectorAll('#bulkLayoutGrid .print-opt-btn').forEach(function(b){b.classList.remove('selected');});
    btn.classList.add('selected');
    bst.cols=parseInt(btn.dataset.cols); bst.rows=parseInt(btn.dataset.rows);
    bulkUpdatePreview();
  };
  window.bulkSetPaper=function(btn){
    document.querySelectorAll('#bulkPaperGrid .print-opt-btn').forEach(function(b){b.classList.remove('selected');});
    btn.classList.add('selected');
    bst.pw=parseInt(btn.dataset.pw); bst.ph=parseInt(btn.dataset.ph); bst.pcss=btn.dataset.pcss;
    bulkUpdatePreview();
  };
  window.bulkSetMargins=function(t,b,l,r){
    document.getElementById('bmTop').value=t; document.getElementById('bmBottom').value=b;
    document.getElementById('bmLeft').value=l; document.getElementById('bmRight').value=r;
    bst.mt=t; bst.mb=b; bst.ml=l; bst.mr=r;
    bulkUpdatePreview();
  };

  window.bulkUpdatePreview=function(){
    bst.cpl=parseInt(document.getElementById('bulkCopiesRange').value)||1;
    bst.fit=document.getElementById('bulkTogFit').checked;
    bst.qr=document.getElementById('bulkTogQR').checked;
    bst.co=document.getElementById('bulkTogCo').checked;
    bst.border=document.getElementById('bulkTogBorder').checked;
    bst.mt=parseInt(document.getElementById('bmTop').value)||0;
    bst.mb=parseInt(document.getElementById('bmBottom').value)||0;
    bst.ml=parseInt(document.getElementById('bmLeft').value)||0;
    bst.mr=parseInt(document.getElementById('bmRight').value)||0;

    var gap=3;
    var perPage=bst.cols*bst.rows;
    var total=selectedKeys.length*bst.cpl;
    var pages=Math.ceil(total/perPage);
    var usableW=bst.pw-bst.ml-bst.mr;
    var usableH=bst.ph-bst.mt-bst.mb;
    var lw=bst.fit?Math.floor((usableW-gap*(bst.cols-1))/bst.cols):100;
    var lh=bst.fit?Math.floor((usableH-gap*(bst.rows-1))/bst.rows):70;

    var SCALE=0.43;
    var paper=document.getElementById('bulkMiniPaper');
    paper.style.width=Math.round(bst.pw*SCALE)+'px';
    paper.style.height=Math.round(bst.ph*SCALE)+'px';
    paper.style.gridTemplateColumns='repeat('+bst.cols+',1fr)';
    paper.style.gap='2px';
    paper.style.padding=Math.round(((bst.mt+bst.mb)/2)*SCALE)+'px '+Math.round(((bst.ml+bst.mr)/2)*SCALE)+'px';
    paper.innerHTML='';
    var shown=Math.min(perPage,total);
    for(var i=0;i<perPage;i++){
      var c=document.createElement('div');
      c.className='preview-cell '+(i<shown?'filled':'empty');
      if(i<shown) c.textContent=i+1;
      paper.appendChild(c);
    }
    document.getElementById('bulkPreviewInfo').innerHTML=
      '<b>'+selectedKeys.length+'</b> type &times; <b>'+bst.cpl+'</b> = <b>'+total+'</b> labels<br>'+
      '<b>'+pages+'</b> page'+(pages>1?'s':'')+'<br>'+
      'Label: <b>'+lw+' &times; '+lh+' mm</b>';
  };

  function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

  function buildBulkLabel(a,qr,showQR,showCo,border,inner,lw,lh){
    var mn=('0'+(a.month||'03')).slice(-2);
    var sc=Math.min(lw/105,lh/70);
    var fBase=Math.max(7,Math.round(10*sc));
    var fSm=Math.max(6,Math.round(7*sc));
    var fLg=Math.max(9,Math.round(13*sc));
    var fAmi=Math.max(12,Math.round(18*sc));
    var qrSz=Math.round(54*sc);
    var pad=Math.round(3*sc)+'px '+Math.round(7*sc)+'px';
    var btmH=Math.round(lh*0.32)+'mm';
    return '<div style="border:'+border+';font-family:Courier New,monospace;background:#fff;color:#111;'+
      'width:'+lw+'mm;height:'+lh+'mm;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;page-break-inside:avoid;break-inside:avoid;">'+
      (showCo?'<div style="display:flex;align-items:stretch;border-bottom:'+inner+';flex-shrink:0;">'+
        '<div style="flex:1;padding:'+pad+';border-right:'+inner+';">'+
          '<div style="font-size:'+fSm+'px;font-weight:bold;color:#555;">COMPANY</div>'+
          '<div style="font-size:'+fBase+'px;font-weight:bold;line-height:1.2;">'+esc(a.companyName.toUpperCase())+'</div>'+
        '</div>'+
        '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:'+pad+';border-right:'+inner+';min-width:'+Math.round(42*sc)+'px;text-align:center;">'+
          '<div style="font-size:'+fSm+'px;font-weight:bold;letter-spacing:0.1em;">* AMI *</div>'+
          '<div style="font-size:'+fAmi+'px;font-weight:bold;line-height:1;">'+mn+'</div>'+
        '</div>'+
        '<div style="display:flex;align-items:center;justify-content:center;padding:'+pad+';">'+
          '<div style="border:'+inner+';padding:2px 4px;font-size:'+fSm+'px;font-weight:bold;line-height:1.3;text-align:center;">ROHS 2<br>FREE</div>'+
        '</div>'+
      '</div>':'')+
      '<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:'+inner+';flex-shrink:0;">'+
        '<div style="padding:'+pad+';">'+
          '<div style="font-size:'+fSm+'px;font-weight:bold;color:#555;">PART NO.</div>'+
          '<div style="font-size:'+fBase+'px;font-weight:bold;font-family:Courier New,monospace;">'+esc(a.partNo)+'</div>'+
        '</div>'+
        '<div style="padding:'+pad+';border-left:'+inner+';">'+
          '<div style="font-size:'+fSm+'px;font-weight:bold;color:#555;">PART NAME</div>'+
          '<div style="font-size:'+fBase+'px;font-weight:bold;">'+esc(a.partName)+'</div>'+
        '</div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:'+inner+';flex-shrink:0;">'+
        '<div style="padding:'+pad+';">'+
          '<div style="font-size:'+fSm+'px;font-weight:bold;color:#555;">SIZE</div>'+
          '<div style="font-size:'+fBase+'px;font-weight:bold;">'+esc(a.size||'\u2014')+'</div>'+
        '</div>'+
        '<div style="padding:'+pad+';border-left:'+inner+';">'+
          '<div style="font-size:'+fSm+'px;font-weight:bold;color:#555;">LOT NO.</div>'+
          '<div style="font-size:'+fBase+'px;font-weight:bold;font-family:Courier New,monospace;">'+esc(a.lotNo)+'</div>'+
        '</div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:'+inner+';flex-shrink:0;">'+
        '<div style="padding:'+pad+';">'+
          '<div style="font-size:'+fSm+'px;font-weight:bold;color:#555;">QUANTITY</div>'+
          '<div style="font-size:'+fLg+'px;font-weight:bold;">'+esc(a.quantity)+'</div>'+
        '</div>'+
        '<div style="padding:'+pad+';border-left:'+inner+';">'+
          '<div style="font-size:'+fSm+'px;font-weight:bold;color:#555;">PACKER</div>'+
          '<div style="font-size:'+fBase+'px;font-weight:bold;">'+esc(a.packer)+'</div>'+
        '</div>'+
      '</div>'+
      '<div style="display:flex;align-items:stretch;height:'+btmH+';flex-shrink:0;">'+
        (showQR?
          '<div style="border-right:'+inner+';padding:3px 5px;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;">'+
            '<div style="font-size:6px;font-weight:bold;color:#555;margin-bottom:2px;">QR CODE</div>'+
            '<img src="'+qr+'" style="width:'+qrSz+'px;height:'+qrSz+'px;display:block;">'+
            '<div style="font-size:6px;color:#888;margin-top:1px;">SCAN FOR DETAILS</div>'+
          '</div>':'')+
        '<div style="flex:1;padding:'+pad+';display:flex;flex-direction:column;justify-content:center;">'+
          '<div style="font-size:'+fSm+'px;font-weight:bold;color:#555;">WO NO.</div>'+
          '<div style="font-size:'+fBase+'px;font-weight:bold;font-family:Courier New,monospace;word-break:break-all;">'+esc(a.woNo||'\u2014')+'</div>'+
        '</div>'+
      '</div>'+
    '</div>';
  }

  document.getElementById('confirmBulkPrintBtn').addEventListener('click',function(){
    var gap=3;
    var usableW=bst.pw-bst.ml-bst.mr;
    var usableH=bst.ph-bst.mt-bst.mb;
    var lw=bst.fit?Math.floor((usableW-gap*(bst.cols-1))/bst.cols):100;
    var lh=bst.fit?Math.floor((usableH-gap*(bst.rows-1))/bst.rows):70;
    var border=bst.border?'1.5px solid #111':'1px solid #ccc';
    var inner=bst.border?'1px solid #111':'0.5px solid #ddd';

    var html='';
    selectedKeys.forEach(function(k){
      var a=BULK_ASSETS[k];
      if(!a) return;
      for(var c=0;c<bst.cpl;c++) html+=buildBulkLabel(a,a._qrDataUrl,bst.qr,bst.co,border,inner,lw,lh);
    });

    var old=document.getElementById('_bpstyle');if(old)old.remove();
    var s=document.createElement('style');s.id='_bpstyle';
    s.innerHTML='@media print{'+
      '@page{'+bst.pcss+';margin-top:'+bst.mt+'mm;margin-bottom:'+bst.mb+'mm;margin-left:'+bst.ml+'mm;margin-right:'+bst.mr+'mm;}'+
      '*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}'+
      'html,body{margin:0!important;padding:0!important;}'+
      'body *{visibility:hidden!important;}'+
      '#_BPS,#_BPS *{visibility:visible!important;}'+
      '#_BPS{position:fixed!important;top:0!important;left:0!important;'+
        'display:grid!important;'+
        'grid-template-columns:repeat('+bst.cols+','+lw+'mm)!important;'+
        'grid-auto-rows:'+lh+'mm!important;'+
        'gap:'+gap+'mm!important;'+
        'margin:0!important;padding:0!important;background:#fff!important;}}';
    document.head.appendChild(s);

    var sheet=document.getElementById('_BPS');
    if(!sheet){sheet=document.createElement('div');sheet.id='_BPS';document.body.appendChild(sheet);}
    sheet.innerHTML=html;
    sheet.style.cssText='display:none;';
    document.getElementById('bulkPrintModalOverlay').classList.remove('open');

    setTimeout(function(){
      sheet.style.display='grid';
      sheet.style.gridTemplateColumns='repeat('+bst.cols+','+lw+'mm)';
      sheet.style.gridAutoRows=lh+'mm';
      sheet.style.gap=gap+'mm';
      requestAnimationFrame(function(){requestAnimationFrame(function(){
        window.print();
        setTimeout(function(){sheet.style.display='none';sheet.innerHTML='';},1500);
      });});
    },250);
  });
})();
<\/script>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// EXCEL IMPORT HELPERS
// ══════════════════════════════════════════════════════════════════════════════
const COL_MAP = {
  companyname:'companyName', company:'companyName', 'company name':'companyName',
  partno:'partNo', 'part no':'partNo', 'part no.':'partNo', 'part number':'partNo', partnumber:'partNo',
  partname:'partName', 'part name':'partName',
  size:'size',
  lotno:'lotNo', 'lot no':'lotNo', 'lot no.':'lotNo', lotnumber:'lotNo', 'lot number':'lotNo', lot:'lotNo',
  quantity:'quantity', qty:'quantity',
  wono:'woNo', 'wo no':'woNo', 'wo no.':'woNo', 'work order':'woNo', workorder:'woNo',
  month:'month', 'month (1-12)':'month',
};

function normalizeHeader(h) {
  return String(h).toLowerCase().trim().replace(/\s+/g,' ');
}

function parseExcelBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (rows.length < 2) return { records: [], errors: ['File has no data rows.'] };
  const headers = rows[0].map(normalizeHeader);
  const fieldMap = {};
  headers.forEach((h, i) => { if (COL_MAP[h]) fieldMap[i] = COL_MAP[h]; });
  const records = [], errors = [];
  rows.slice(1).forEach((row, ri) => {
    if (row.every(c => String(c).trim() === '')) return;
    const rec = {};
    Object.entries(fieldMap).forEach(([idx, field]) => {
      const val = row[idx];
      rec[field] = (val === null || val === undefined) ? '' : String(val).trim();
    });
    if (!rec.partNo) { errors.push(`Row ${ri+2}: Missing Part No.`); return; }
    if (!rec.companyName) { errors.push(`Row ${ri+2}: Missing Company Name.`); return; }
    if (rec.month) rec.month = ('0' + parseInt(rec.month || '1')).slice(-2);
    records.push(rec);
  });
  return { records, errors };
}

function buildExcelTemplate() {
  const wb = XLSX.utils.book_new();
  const headers = ['Company Name','Part No','Part Name','Size','Lot No','Quantity','WO No','Month (1-12)'];
  const sample = ['AMBER ENTERPRISES INDIA LIMITED','93198464460','FPE T3 200*100','3MMX100MMX200MM','28032601','100 Pcs','MFG-WO-2026-28032','3'];
  const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
  ws['!cols'] = [{wch:40},{wch:18},{wch:22},{wch:20},{wch:16},{wch:12},{wch:24},{wch:14}];
  XLSX.utils.book_append_sheet(wb, ws, 'AMI Parts Template');
  const ws2 = XLSX.utils.aoa_to_sheet([
    ['AMI QR System — Excel Import Instructions'],[''],
    ['COLUMN DESCRIPTIONS:'],
    ['Company Name','Full company name (required)'],
    ['Part No','Part number / article number (required)'],
    ['Part Name','Descriptive part name (required)'],
    ['Size','Physical size / dimensions (optional)'],
    ['Lot No','Lot or batch number (required for label generation)'],
    ['Quantity','Quantity with unit e.g. "100 Pcs" (required)'],
    ['WO No','Work Order number (required)'],
    ['Month (1-12)','Month number for AMI code (1=Jan, 12=Dec)'],
    [''],['NOTES:'],
    ['- Do not change the column headers in the template sheet.'],
    ['- Each row = one part entry in the catalog.'],
    ['- After upload, go to Generate Label and type a Part No. to see suggestions.'],
    ['- Packer name is entered manually on the Generate Label form.'],
  ]);
  ws2['!cols'] = [{wch:22},{wch:55}];
  XLSX.utils.book_append_sheet(wb, ws2, 'Instructions');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTOCOMPLETE SCRIPT
// ══════════════════════════════════════════════════════════════════════════════
function generateFormScript(catalogCount) {
  return `<script>
(function(){
  var ACT=null, ITEMS=[], hiIdx=-1, isFilled=false;
  function escH(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  var FILLABLE=['companyName','partNo','partName','size','lotNo','quantity','woNo'];
  function setFilled(yes){
    FILLABLE.forEach(function(id){var el=document.getElementById(id);if(!el)return;if(yes)el.classList.add('form-filled');else el.classList.remove('form-filled');});
    isFilled=yes;
    var banner=document.getElementById('catalogFillBanner');
    var clearBtn=document.getElementById('clearFillBtn');
    if(banner) banner.style.display=yes?'flex':'none';
    if(clearBtn) clearBtn.style.display=yes?'flex':'none';
  }
  window.fillFromCatalog=function(item){
    var fields={companyName:item.companyName,partNo:item.partNo,partName:item.partName,size:item.size,lotNo:item.lotNo,quantity:item.quantity,woNo:item.woNo};
    Object.keys(fields).forEach(function(id){var el=document.getElementById(id);if(el&&fields[id])el.value=fields[id];});
    if(item.month){var sel=document.getElementById('month');sel.value=('0'+parseInt(item.month)).slice(-2);}
    setFilled(true);
    closeAcList();
    var banner=document.getElementById('catalogFillBanner');
    if(banner) document.getElementById('fillSourceText').textContent=item.partNo+(item.partName?' \u2014 '+item.partName:'');
  };
  window.clearCatalogFill=function(){
    FILLABLE.forEach(function(id){var el=document.getElementById(id);if(el){el.value='';el.classList.remove('form-filled');}});
    var cur=new Date().getMonth()+1;
    document.getElementById('month').value=('0'+cur).slice(-2);
    setFilled(false);
  };
  function getAcContainer(){return document.getElementById('acList');}
  function closeAcList(){var list=getAcContainer();list.classList.remove('open');list.innerHTML='';ITEMS=[];hiIdx=-1;}
  function renderAcList(items){
    ITEMS=items;hiIdx=-1;
    var list=getAcContainer();
    if(!items.length){list.innerHTML='<div class="ac-no-results">No matches found in catalog</div>';list.classList.add('open');return;}
    var html='<div class="ac-header">'+items.length+' match'+(items.length>1?'es':'')+' from catalog</div>';
    html+=items.map(function(it,i){
      var icon=(it.partNo||'?').substring(0,2).toUpperCase();
      var main=escH(it.partNo);
      if(it.partName) main+=' &mdash; '+escH(it.partName);
      var tags=[];
      if(it.lotNo) tags.push(escH(it.lotNo));
      if(it.quantity) tags.push(escH(it.quantity));
      if(it.woNo) tags.push(escH(it.woNo));
      return '<div class="autocomplete-item" data-idx="'+i+'" onmousedown="fillFromCatalog(CATALOG_ITEMS['+i+'])" onmouseover="hiAcItem('+i+')">'
        +'<div class="ac-icon">'+icon+'</div>'
        +'<div class="ac-body">'
        +'<div class="ac-main">'+main+'</div>'
        +'<div class="ac-sub">'+escH(it.companyName||'')+'</div>'
        +(tags.length?'<div class="ac-tags">'+tags.map(function(t){return '<span class="ac-tag">'+t+'</span>';}).join('')+'</div>':'')
        +'</div></div>';
    }).join('');
    list.innerHTML=html;
    list.classList.add('open');
  }
  window.CATALOG_ITEMS=[];
  window.hiAcItem=function(i){hiIdx=i;document.querySelectorAll('.autocomplete-item').forEach(function(el,j){el.classList.toggle('highlighted',j===i);});};
  function triggerSearch(val,fieldEl){
    if(ACT) clearTimeout(ACT);
    if(!val||val.length<1){closeAcList();return;}
    ACT=setTimeout(function(){
      fetch('/api/catalog?q='+encodeURIComponent(val))
        .then(function(r){return r.json();})
        .then(function(items){window.CATALOG_ITEMS=items;renderAcList(items);})
        .catch(function(){closeAcList();});
    },160);
  }
  var searchFields=['partNo','partName','lotNo','companyName','woNo'];
  searchFields.forEach(function(id){
    var el=document.getElementById(id);
    if(!el) return;
    el.addEventListener('input',function(){triggerSearch(this.value,this);});
    el.addEventListener('focus',function(){if(this.value)triggerSearch(this.value,this);});
    el.addEventListener('keydown',function(e){onAcKeyDown(e);});
  });
  window.onAcKeyDown=function(e){
    var list=getAcContainer();
    if(!list.classList.contains('open')) return;
    if(e.key==='ArrowDown'){e.preventDefault();hiIdx=Math.min(hiIdx+1,ITEMS.length-1);document.querySelectorAll('.autocomplete-item').forEach(function(el,j){el.classList.toggle('highlighted',j===hiIdx);});}
    else if(e.key==='ArrowUp'){e.preventDefault();hiIdx=Math.max(hiIdx-1,0);document.querySelectorAll('.autocomplete-item').forEach(function(el,j){el.classList.toggle('highlighted',j===hiIdx);});}
    else if(e.key==='Enter'&&hiIdx>=0){e.preventDefault();if(CATALOG_ITEMS[hiIdx])fillFromCatalog(CATALOG_ITEMS[hiIdx]);}
    else if(e.key==='Escape'){closeAcList();}
  };
  document.addEventListener('mousedown',function(e){if(!e.target.closest('#acList')){closeAcList();}});
  window.quickUploadExcel=function(input){
    if(!input.files||!input.files[0]) return;
    var f=input.files[0];
    var st=document.getElementById('quickUploadStatus');
    st.innerHTML='<div class="alert alert-info" style="margin-bottom:12px;">&#x23F3; Uploading <strong>'+escH(f.name)+'</strong>&hellip;</div>';
    var fd=new FormData();
    fd.append('excelFile',f);
    fd.append('importMode','append');
    fetch('/upload-excel',{method:'POST',body:fd,redirect:'manual'})
      .then(function(){return fetch('/api/catalog');})
      .then(function(r){return r.json();})
      .then(function(items){
        var cnt=items.length;
        st.innerHTML='<div class="alert alert-success" style="margin-bottom:12px;">&#x2713; <strong>Catalog updated!</strong> '+cnt+' part'+(cnt!==1?'s':'')+' available.</div>';
        var mu=document.querySelector('.mu-info');
        if(mu) mu.innerHTML='&#x2728; Excel Catalog Active &mdash; <strong>'+cnt+' part'+(cnt!==1?'s':'')+' loaded</strong>';
        if(cnt===1&&items[0]) setTimeout(function(){fillFromCatalog(items[0]);},300);
      })
      .catch(function(){st.innerHTML='<div class="alert alert-error" style="margin-bottom:12px;">Upload failed. <a href="/excel-import">Try Excel Import page.</a></div>';});
    input.value='';
  };
})();
<\/script>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════════════════

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
  const catalogCount = await PartCatalog.countDocuments();
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
    <div class="stat-box"><div class="stat-label">Catalog Parts</div><div class="stat-number" style="color:#16a34a;">${catalogCount}</div><div class="stat-note"><a href="/excel-import" style="color:#16a34a;">manage catalog</a></div></div>
  </div>
  <div class="grid-2" style="margin-bottom:20px;">
    <div class="card" style="margin-bottom:0;"><div class="card-body">
      <p style="font-size:15px;font-weight:600;color:#111;margin-bottom:6px;">Generate QR Label</p>
      <p style="font-size:13px;color:#6b7280;margin-bottom:14px;">Create a new part label with auto-fill from Excel catalog.</p>
      <a href="/generate-form" class="btn btn-primary">${I.plus} Create Label</a>
    </div></div>
    <div class="card" style="margin-bottom:0;"><div class="card-body">
      <p style="font-size:15px;font-weight:600;color:#111;margin-bottom:6px;">Excel Import</p>
      <p style="font-size:13px;color:#6b7280;margin-bottom:14px;">Upload bulk part data for smart autocomplete.</p>
      <a href="/excel-import" class="btn btn-success">${I.excel} Open Excel Import</a>
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
    <div class="card card-body"><div class="alert alert-error">Invalid credentials.</div><a href="/" class="btn btn-secondary btn-block">&larr; Go Back</a></div>
  </div></div></body></html>`);
});

app.get('/logout', (req, res) => {
  const sid = req.headers.cookie?.split('sessionId=')[1]?.split(';')[0];
  if (sid) sessions.delete(sid);
  res.setHeader('Set-Cookie', 'sessionId=; Max-Age=0; HttpOnly; Path=/; SameSite=Lax');
  res.redirect('/');
});

app.get('/download-template', (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  try {
    const buf = buildExcelTemplate();
    res.setHeader('Content-Disposition', 'attachment; filename=AMI_Parts_Template.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch(e) { console.error(e); res.status(500).send('Template generation failed'); }
});

app.get('/excel-import', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  const catalog = await getAllCatalog();
  const msg = req.query.msg || '';
  const msgType = req.query.type || 'success';
  const msgHTML = msg ? `<div class="alert alert-${msgType}" style="margin-bottom:16px;">${decodeURIComponent(msg)}</div>` : '';
  const rows = catalog.map(c=>`<tr>
    <td><span class="badge badge-blue">${c.partNo||'&mdash;'}</span></td>
    <td>${c.partName||'&mdash;'}</td>
    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.companyName||'&mdash;'}</td>
    <td>${c.size||'&mdash;'}</td>
    <td style="font-family:monospace;font-size:12px;">${c.lotNo||'&mdash;'}</td>
    <td>${c.quantity||'&mdash;'}</td>
    <td style="font-family:monospace;font-size:12px;">${c.woNo||'&mdash;'}</td>
    <td>${c.month||'&mdash;'}</td>
    <td><a href="/catalog-delete/${c._id}" onclick="return confirm('Remove?')" class="btn btn-danger btn-sm">${I.trash}</a></td>
  </tr>`).join('');
  res.send(`${HEAD('Excel Import')}<body>${LAYOUT(`
  <div class="page-header">
    <div><h1 class="page-title">Excel Import</h1><p class="page-sub">Upload bulk part data &mdash; ${catalog.length} entries in catalog</p></div>
    <div style="display:flex;gap:8px;">
      <a href="/download-template" class="btn btn-success">${I.download} Download Template</a>
      ${catalog.length>0?`<a href="/catalog-clear" onclick="return confirm('Clear ALL catalog entries?')" class="btn btn-danger">${I.trash} Clear All</a>`:''}
    </div>
  </div>
  ${msgHTML}
  <div class="grid-2" style="margin-bottom:20px;align-items:start;">
    <div class="card" style="margin-bottom:0;">
      <div class="card-header"><span class="card-title">How It Works</span></div>
      <div class="card-body">
        <div class="step-row"><div class="step-badge">1</div><div class="step-content"><div class="step-title">Download the Template</div><div class="step-desc">Click <strong>Download Template</strong> above. Open in Excel or Google Sheets.</div></div></div>
        <div class="step-row"><div class="step-badge">2</div><div class="step-content"><div class="step-title">Fill in Your Part Data</div><div class="step-desc">One part per row. Fill all columns. <em>Leave Packer blank — entered manually.</em></div></div></div>
        <div class="step-row"><div class="step-badge">3</div><div class="step-content"><div class="step-title">Upload the Filled File</div><div class="step-desc">Use the upload box. Supports .xlsx, .xls, .csv files.</div></div></div>
        <div class="step-row" style="margin-bottom:0;"><div class="step-badge">4</div><div class="step-content"><div class="step-title">Smart Auto-fill on Generate Label</div><div class="step-desc">Go to <a href="/generate-form" style="color:#3b82f6;font-weight:600;">Generate Label</a>. Type any field to search &amp; auto-fill all fields instantly.</div></div></div>
      </div>
    </div>
    <div class="card" style="margin-bottom:0;">
      <div class="card-header"><span class="card-title">${I.upload} Upload Excel File</span></div>
      <div class="card-body">
        <form id="uploadForm" action="/upload-excel" method="POST" enctype="multipart/form-data">
          <div class="upload-zone" id="dropZone" onclick="document.getElementById('excelFile').click()">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            <p id="dropText">Drag &amp; drop your Excel file here, or <strong style="color:#3b82f6;">click to browse</strong></p>
            <small>Supports .xlsx, .xls, .csv &mdash; max 10 MB</small>
          </div>
          <input type="file" id="excelFile" name="excelFile" accept=".xlsx,.xls,.csv" style="display:none;" onchange="onFileSelected(this)">
          <div id="filePreview" style="display:none;margin-top:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;">
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <div><div style="font-size:13px;font-weight:700;color:#15803d;" id="fileName"></div><div style="font-size:11px;color:#4ade80;" id="fileSize"></div></div>
              <button type="button" onclick="clearFile()" style="font-size:11px;color:#dc2626;background:none;border:none;cursor:pointer;">&#x2715; Remove</button>
            </div>
          </div>
          <div style="display:flex;gap:10px;margin-top:14px;">
            <select name="importMode" style="flex:1;">
              <option value="append">Append to catalog (keep existing)</option>
              <option value="replace">Replace all catalog entries</option>
            </select>
            <button type="submit" id="uploadBtn" class="btn btn-primary" disabled>${I.upload} Upload</button>
          </div>
        </form>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-header"><span class="card-title">Part Catalog &mdash; ${catalog.length} entries</span>${catalog.length>0?`<a href="/generate-form" class="btn btn-primary btn-sm">${I.plus} Generate Label</a>`:''}</div>
    ${catalog.length===0?`<div class="empty">${I.excel}<p>No catalog entries yet.</p><a href="/download-template" class="btn btn-success">${I.download} Download Template</a></div>`
    :`<div class="table-wrap"><table><thead><tr><th>Part No.</th><th>Part Name</th><th>Company</th><th>Size</th><th>Lot No.</th><th>Quantity</th><th>WO No.</th><th>Month</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`}
  </div>
  <script>
    var dz=document.getElementById('dropZone');
    ['dragenter','dragover'].forEach(function(e){dz.addEventListener(e,function(ev){ev.preventDefault();dz.classList.add('drag-over');});});
    ['dragleave','drop'].forEach(function(e){dz.addEventListener(e,function(ev){ev.preventDefault();dz.classList.remove('drag-over');});});
    dz.addEventListener('drop',function(ev){ev.preventDefault();var f=ev.dataTransfer.files[0];if(f){var dt=new DataTransfer();dt.items.add(f);document.getElementById('excelFile').files=dt.files;onFileSelected(document.getElementById('excelFile'));}});
    function onFileSelected(input){if(!input.files||!input.files[0])return;var f=input.files[0];document.getElementById('fileName').textContent=f.name;document.getElementById('fileSize').textContent=(f.size/1024).toFixed(1)+' KB';document.getElementById('filePreview').style.display='block';document.getElementById('dropText').textContent='File selected: '+f.name;document.getElementById('uploadBtn').disabled=false;}
    function clearFile(){document.getElementById('excelFile').value='';document.getElementById('filePreview').style.display='none';document.getElementById('dropText').innerHTML='Drag &amp; drop your Excel file here, or <strong style="color:#3b82f6;">click to browse</strong>';document.getElementById('uploadBtn').disabled=true;}
  </script>
  `,'excel')}`);
});

app.post('/upload-excel', upload.single('excelFile'), async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  if (!req.file) return res.redirect('/excel-import?type=error&msg='+encodeURIComponent('No file uploaded.'));
  try {
    const { records, errors } = parseExcelBuffer(req.file.buffer);
    if (records.length===0) {
      const errMsg = errors.length ? errors.join(' | ') : 'No valid data rows found.';
      return res.redirect('/excel-import?type=error&msg='+encodeURIComponent(errMsg));
    }
    if (req.body.importMode==='replace') await clearCatalog();
    const now = new Date().toISOString();
    await PartCatalog.insertMany(records.map(r=>({...r,uploadedAt:now,source:'excel'})),{ordered:false});
    let msg=`&#x2713; Successfully imported <strong>${records.length} parts</strong> into catalog.`;
    if (errors.length) msg+=` <span style="color:#92400e;">${errors.length} row(s) skipped.</span>`;
    res.redirect('/excel-import?type=success&msg='+encodeURIComponent(msg));
  } catch(e) {
    console.error('Excel upload error:',e);
    res.redirect('/excel-import?type=error&msg='+encodeURIComponent('Failed to parse file: '+e.message));
  }
});

app.get('/catalog-delete/:id', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  await deleteCatalogItem(req.params.id);
  res.redirect('/excel-import?type=success&msg='+encodeURIComponent('Entry removed.'));
});

app.get('/catalog-clear', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  await clearCatalog();
  res.redirect('/excel-import?type=success&msg='+encodeURIComponent('All catalog entries cleared.'));
});

app.get('/api/catalog', async (req, res) => {
  if (!isAuthenticated(req)) return res.status(401).json({error:'Unauthorized'});
  const q = (req.query.q||'').trim();
  let filter={};
  if(q) filter={$or:[{partNo:{$regex:q,$options:'i'}},{partName:{$regex:q,$options:'i'}},{lotNo:{$regex:q,$options:'i'}},{companyName:{$regex:q,$options:'i'}},{woNo:{$regex:q,$options:'i'}}]};
  const items = await PartCatalog.find(filter).limit(20).lean();
  res.json(items.map(c=>({_id:c._id,companyName:c.companyName||'',partNo:c.partNo||'',partName:c.partName||'',size:c.size||'',lotNo:c.lotNo||'',quantity:c.quantity||'',woNo:c.woNo||'',month:c.month||''})));
});

app.get('/generate-form', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  const currentMonth = new Date().getMonth()+1;
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthOpts = MONTH_NAMES.map((n,i)=>{const v=String(i+1).padStart(2,'0');return `<option value="${v}"${i+1===currentMonth?' selected':''}>${v} &mdash; ${n}</option>`;}).join('');
  const catalogCount = await PartCatalog.countDocuments();
  res.send(`${HEAD('Generate Label')}<body>${LAYOUT(`
  <div class="page-header"><div><h1 class="page-title">Generate QR Label</h1><p class="page-sub">Fill in part details &mdash; type any field to search catalog</p></div></div>
  <div style="max-width:680px;">
    <div class="mini-upload-bar">
      <div>
        <div class="mu-info">&#x2728; Excel Catalog Active &mdash; <strong>${catalogCount} part${catalogCount!==1?'s':''} loaded</strong></div>
        <div class="mu-sub">Type in <strong>any field</strong> to search &amp; auto-fill &bull; <a href="/excel-import" style="color:#1d4ed8;">Manage catalog</a></div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <label for="quickExcelFile" class="btn btn-success btn-sm" style="cursor:pointer;">${I.upload} Quick Upload Excel</label>
        <input type="file" id="quickExcelFile" accept=".xlsx,.xls,.csv" style="display:none;" onchange="quickUploadExcel(this)">
      </div>
    </div>
    <div id="quickUploadStatus"></div>
    <div class="catalog-fill-banner" id="catalogFillBanner" style="display:none;">
      <div>
        <div style="font-size:12px;font-weight:700;color:#15803d;">&#x2713; All fields auto-filled from catalog</div>
        <div style="font-size:11px;color:#4ade80;margin-top:2px;" id="fillSourceText"></div>
      </div>
      <button id="clearFillBtn" onclick="clearCatalogFill()" class="btn btn-secondary btn-sm" style="display:none;flex-shrink:0;">&#x2715; Clear &amp; Reset</button>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Part Information</span><span style="font-size:11px;color:#9ca3af;">* Required</span></div>
      <div class="card-body">
        <form action="/generate" method="POST" id="genForm">
          <div id="acList" class="autocomplete-list" style="position:fixed;z-index:600;min-width:340px;border-radius:8px;border-top:1px solid #d1d5db;"></div>
          <div class="form-1">
            <label>Part No. *</label>
            <input type="text" name="partNo" id="partNo" placeholder="Type to search catalog by Part No&hellip;" required autocomplete="off">
          </div>
          <div class="form-1">
            <label>Company Name *</label>
            <input type="text" name="companyName" id="companyName" placeholder="Type to search or enter company name&hellip;" required autocomplete="off">
          </div>
          <div class="form-row">
            <div><label>Part Name *</label><input type="text" name="partName" id="partName" placeholder="Type to search by Part Name&hellip;" required autocomplete="off"></div>
            <div><label>Size</label><input type="text" name="size" id="size" placeholder="e.g. 3MMX100MMX200MM" autocomplete="off"></div>
          </div>
          <div class="form-row">
            <div><label>Lot No. *</label><input type="text" name="lotNo" id="lotNo" placeholder="Type to search by Lot No&hellip;" required autocomplete="off"></div>
            <div><label>Quantity *</label><input type="text" name="quantity" id="quantity" placeholder="e.g. 100 Pcs" required autocomplete="off"></div>
          </div>
          <div class="form-row">
            <div><label>Packer Name * <span style="font-weight:400;color:#9ca3af;">(enter manually)</span></label><input type="text" name="packer" id="packer" placeholder="Enter packer name or ID" required autocomplete="off"></div>
            <div><label>WO No. *</label><input type="text" name="woNo" id="woNo" placeholder="Type to search by WO No&hellip;" required autocomplete="off"></div>
          </div>
          <div class="form-row" style="margin-bottom:20px;">
            <div><label>Month * <span style="font-weight:400;color:#9ca3af;">(AMI number)</span></label><select name="month" id="month" required>${monthOpts}</select></div>
            <div style="display:flex;align-items:flex-end;"></div>
          </div>
          <button type="submit" class="btn btn-primary btn-block">${I.qr} Generate QR Label</button>
        </form>
      </div>
    </div>
  </div>
  ${generateFormScript(catalogCount)}
  <script>
  (function(){
    var acList=document.getElementById('acList');
    var searchFields=['partNo','partName','lotNo','companyName','woNo'];
    searchFields.forEach(function(id){
      var el=document.getElementById(id);
      if(!el) return;
      el.addEventListener('focus',function(){positionDropdown(this);});
      el.addEventListener('input',function(){positionDropdown(this);});
    });
    function positionDropdown(el){
      var rect=el.getBoundingClientRect();
      acList.style.top=(rect.bottom+window.scrollY)+'px';
      acList.style.left=rect.left+'px';
      acList.style.width=rect.width+'px';
    }
    window.addEventListener('scroll',function(){
      var active=document.activeElement;
      if(active&&searchFields.indexOf(active.id)!==-1) positionDropdown(active);
    });
  })();
  </script>
  `,'gen')}`);
});

app.post('/generate', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  const { companyName, partNo, partName, size, lotNo, quantity, packer, month, woNo } = req.body;
  if (!companyName||!partNo||!partName||!lotNo||!quantity||!packer||!month||!woNo) {
    return res.status(400).send(`${HEAD('Error')}<body><div class="auth-wrap"><div style="max-width:380px;width:100%;"><div class="card card-body">
      <div class="alert alert-error">Please fill in all required fields.</div>
      <a href="/generate-form" class="btn btn-secondary btn-block">&larr; Go Back</a>
    </div></div></div></body></html>`);
  }
  const assetKey = generateAssetKey(partNo, lotNo);
  const asset = {
    name:assetKey, companyName:companyName.trim(), partNo:partNo.trim(), partName:partName.trim(),
    size:size?.trim()||'', lotNo:lotNo.trim(), quantity:quantity.trim(), packer:packer.trim(),
    month:String(month).padStart(2,'0'), woNo:woNo.trim(), createdAt:new Date().toISOString(), scanHistory:[]
  };
  await upsertAsset(asset);
  const qrText = buildQrContent(asset);
  try {
    const qrDataUrl = await QRCode.toDataURL(qrText, {width:300,margin:1,color:{dark:'#000000',light:'#ffffff'},errorCorrectionLevel:'M'});
    res.send(`${HEAD('Label Created')}<body>${LAYOUT(`
    <div class="page-header">
      <div><h1 class="page-title">Label Created</h1><p class="page-sub">Saved successfully</p></div>
      <div style="display:flex;gap:8px;">
        <a href="/edit/${assetKey}" class="btn btn-warning">${I.edit} Edit</a>
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
          <div class="ami-wo-cell"><div><div class="wo-label">WO NO.</div><div class="wo-value">${woNo.trim()}</div></div></div>
        </div>
      </div>
    </div>
    <p style="font-size:12px;color:#64748b;margin-top:8px;">Click <strong>Print Label</strong> to choose layout &amp; copies.</p>
    <div class="grid-2" style="margin-top:16px;max-width:560px;">
      <a href="/generate-form" class="btn btn-secondary btn-block">${I.plus} Create Another Label</a>
      <a href="/labels" class="btn btn-secondary btn-block">${I.label} View All Labels</a>
    </div>
    ${printModalHTML()}
    `,'gen')}${printModalScript(qrDataUrl, asset)}`);
  } catch(err) { console.error(err); res.status(500).send('Error generating QR'); }
});

app.get('/edit/:id', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  const asset = await getAsset(req.params.id);
  if (!asset) return res.redirect('/labels');
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthOpts = MONTH_NAMES.map((n,i)=>{const v=String(i+1).padStart(2,'0');return `<option value="${v}"${v===asset.month?' selected':''}>${v} &mdash; ${n}</option>`;}).join('');
  const successMsg = req.query.success ? `<div class="alert alert-success" style="margin-bottom:16px;">&#x2713; Label updated! <a href="/labels" style="color:#15803d;font-weight:600;">View Labels</a></div>` : '';
  res.send(`${HEAD('Edit Label')}<body>${LAYOUT(`
  <div class="page-header">
    <div><h1 class="page-title">Edit Label</h1><p class="page-sub">${asset.partName} &middot; <span class="badge badge-blue">${asset.partNo}</span></p></div>
    <div style="display:flex;gap:8px;"><a href="/asset/${req.params.id}" class="btn btn-secondary">${I.eye} View</a><a href="/labels" class="btn btn-secondary">&larr; Labels</a></div>
  </div>
  <div style="max-width:640px;">${successMsg}
    <div class="card"><div class="card-header"><span class="card-title">Edit Part Information</span></div>
      <div class="card-body">
        <form action="/edit/${req.params.id}" method="POST">
          <div class="form-1"><label>Company Name *</label><input type="text" name="companyName" value="${asset.companyName}" required></div>
          <div class="form-row"><div><label>Part No. *</label><input type="text" name="partNo" value="${asset.partNo}" required></div><div><label>Part Name *</label><input type="text" name="partName" value="${asset.partName}" required></div></div>
          <div class="form-row"><div><label>Size</label><input type="text" name="size" value="${asset.size||''}"></div><div><label>Lot No. *</label><input type="text" name="lotNo" value="${asset.lotNo}" required></div></div>
          <div class="form-row"><div><label>Quantity *</label><input type="text" name="quantity" value="${asset.quantity}" required></div><div><label>Packer Name *</label><input type="text" name="packer" value="${asset.packer}" required></div></div>
          <div class="form-row" style="margin-bottom:20px;"><div><label>Month *</label><select name="month" required>${monthOpts}</select></div><div><label>WO No. *</label><input type="text" name="woNo" value="${asset.woNo||''}" required></div></div>
          <div style="display:flex;gap:10px;"><button type="submit" class="btn btn-primary" style="flex:1;">${I.edit} Save Changes</button><a href="/labels" class="btn btn-secondary">Cancel</a></div>
        </form>
      </div>
    </div>
  </div>
  `,'labels')}`);
});

app.post('/edit/:id', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  const oldKey = req.params.id;
  const oldAsset = await getAsset(oldKey);
  if (!oldAsset) return res.redirect('/labels');
  const { companyName, partNo, partName, size, lotNo, quantity, packer, month, woNo } = req.body;
  if (!companyName||!partNo||!partName||!lotNo||!quantity||!packer||!month||!woNo) return res.redirect(`/edit/${oldKey}`);
  const updated = {...oldAsset,companyName:companyName.trim(),partNo:partNo.trim(),partName:partName.trim(),
    size:size?.trim()||'',lotNo:lotNo.trim(),quantity:quantity.trim(),packer:packer.trim(),
    month:String(month).padStart(2,'0'),woNo:woNo.trim(),updatedAt:new Date().toISOString()};
  await upsertAsset(updated);
  res.redirect(`/edit/${oldKey}?success=1`);
});

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
  <div class="page-header"><div><h1 class="page-title">All Assets</h1><p class="page-sub">${assets.size} total record${assets.size!==1?'s':''}</p></div><a href="/generate-form" class="btn btn-primary">${I.plus} New Label</a></div>
  <div class="card">
    ${assets.size===0?`<div class="empty">${I.box}<p>No assets yet.</p><a href="/generate-form" class="btn btn-primary">Generate First Label</a></div>`
    :`<div class="table-wrap"><table><thead><tr><th>Part Name</th><th>Part No.</th><th>Company</th><th>Lot No.</th><th>Size</th><th>Qty</th><th>Packer</th><th>WO No.</th><th>Scans</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>`}
  </div>
  `,'list')}`);
});

app.get('/labels', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  const assets = await getAllAssets();
  let cards = '';
  const assetsWithQR = {};
  for (const [key, a] of assets) {
    const qrText = buildQrContent(a);
    try {
      const qrDataUrl = await QRCode.toDataURL(qrText, {width:200,margin:1,errorCorrectionLevel:'M'});
      assetsWithQR[key] = {...a, _qrDataUrl: qrDataUrl};
      const monthNum = String(a.month||'03').padStart(2,'0');
      cards += `<div class="label-card-wrap" data-key="${key}">
        <input type="checkbox" class="label-select-cb" data-key="${key}" title="Select for bulk print">
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
          <div style="padding:10px;background:#fafafa;border-bottom:1px solid #e5e7eb;">
            <div style="border:2px solid #111;font-family:'Courier New',monospace;font-size:10px;background:#fff;">
              <div style="display:flex;align-items:stretch;border-bottom:1.5px solid #111;">
                <div style="flex:1;padding:4px 7px;border-right:1.5px solid #111;"><div style="font-size:6px;font-weight:bold;color:#555;">COMPANY</div><div style="font-size:8px;font-weight:bold;">${a.companyName.toUpperCase()}</div></div>
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px 7px;border-right:1.5px solid #111;min-width:40px;text-align:center;"><div style="font-size:6px;font-weight:bold;">* AMI *</div><div style="font-size:14px;font-weight:bold;line-height:1;">${monthNum}</div></div>
                <div style="display:flex;align-items:center;justify-content:center;padding:4px 6px;"><div style="border:1.5px solid #111;padding:2px 3px;font-size:6px;font-weight:bold;line-height:1.3;text-align:center;">ROHS 2<br>FREE</div></div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1.5px solid #111;">
                <div style="padding:3px 7px;"><div style="font-size:6px;font-weight:bold;color:#555;">PART NO.</div><div style="font-size:8px;font-weight:bold;">${a.partNo}</div></div>
                <div style="padding:3px 7px;border-left:1.5px solid #111;"><div style="font-size:6px;font-weight:bold;color:#555;">PART NAME</div><div style="font-size:8px;font-weight:bold;">${a.partName}</div></div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1.5px solid #111;">
                <div style="padding:3px 7px;"><div style="font-size:6px;font-weight:bold;color:#555;">SIZE</div><div style="font-size:8px;font-weight:bold;">${a.size||'&mdash;'}</div></div>
                <div style="padding:3px 7px;border-left:1.5px solid #111;"><div style="font-size:6px;font-weight:bold;color:#555;">LOT NO.</div><div style="font-size:8px;font-weight:bold;">${a.lotNo}</div></div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;border-bottom:1.5px solid #111;">
                <div style="padding:3px 7px;"><div style="font-size:6px;font-weight:bold;color:#555;">QUANTITY</div><div style="font-size:9px;font-weight:bold;">${a.quantity}</div></div>
                <div style="padding:3px 7px;border-left:1.5px solid #111;"><div style="font-size:6px;font-weight:bold;color:#555;">PACKER</div><div style="font-size:8px;font-weight:bold;">${a.packer}</div></div>
              </div>
              <div style="display:flex;align-items:stretch;min-height:50px;">
                <div style="border-right:1.5px solid #111;padding:4px 5px;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                  <div style="font-size:5px;font-weight:bold;color:#555;margin-bottom:2px;">QR CODE</div>
                  <img src="${qrDataUrl}" style="width:38px;height:38px;display:block;">
                  <div style="font-size:5px;color:#888;margin-top:1px;">SCAN FOR DETAILS</div>
                </div>
                <div style="flex:1;padding:5px 7px;display:flex;flex-direction:column;justify-content:center;">
                  <div style="font-size:6px;font-weight:bold;color:#555;">WO NO.</div>
                  <div style="font-size:7px;font-weight:bold;">${a.woNo||'&mdash;'}</div>
                </div>
              </div>
            </div>
          </div>
          <div style="padding:9px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
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
  <div class="page-header"><div><h1 class="page-title">Labels</h1><p class="page-sub">${assets.size} label${assets.size!==1?'s':''} stored</p></div><a href="/generate-form" class="btn btn-primary">${I.plus} New Label</a></div>
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
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:16px;">${cards}</div>
  ${bulkPrintModalHTML()}
  `:`<div class="card"><div class="empty">${I.label}<p>No labels yet.</p><a href="/generate-form" class="btn btn-primary">Create First Label</a></div></div>`}
  `,'labels')}${assets.size>0?bulkPrintScript(assetsWithQR):''}`);
});

app.get('/print-label/:id', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  const asset = await getAsset(req.params.id);
  if (!asset) return res.status(404).send('Not found');
  const qrDataUrl = await QRCode.toDataURL(buildQrContent(asset), {width:300,margin:1,errorCorrectionLevel:'M'});
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
      <div class="ami-field-row cols-2"><div class="ami-field"><div class="f-label">Part No.</div><div class="f-value mono">${asset.partNo}</div></div><div class="ami-field"><div class="f-label">Part Name</div><div class="f-value">${asset.partName}</div></div></div>
      <div class="ami-field-row cols-2"><div class="ami-field"><div class="f-label">Size</div><div class="f-value">${asset.size||'&mdash;'}</div></div><div class="ami-field"><div class="f-label">Lot No.</div><div class="f-value mono">${asset.lotNo}</div></div></div>
      <div class="ami-field-row cols-2"><div class="ami-field"><div class="f-label">Quantity</div><div class="f-value large">${asset.quantity}</div></div><div class="ami-field"><div class="f-label">Packer</div><div class="f-value">${asset.packer}</div></div></div>
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

app.get('/qr/all', async (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  const assets = await getAllAssets();
  let cards = '';
  for (const [key, a] of assets) {
    try {
      const qr = await QRCode.toDataURL(buildQrContent(a), {width:200,margin:2,errorCorrectionLevel:'M'});
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

app.get('/asset/:id', async (req, res) => {
  const asset = await getAsset(req.params.id);
  if (!asset) return res.status(404).send(`${HEAD('Not Found')}<body><div class="auth-wrap">
    <div class="card card-body" style="max-width:320px;text-align:center;">
      <p style="color:#ef4444;font-weight:600;margin-bottom:12px;">Asset not found</p>
      <a href="/" class="btn btn-secondary btn-block">Go Home</a>
    </div></div></body></html>`);
  const isAdmin = isAuthenticated(req);
  if (!isAdmin) await pushScanHistory(req.params.id, {timestamp:new Date().toISOString(),device:req.headers['user-agent']||'Unknown'});
  const freshAsset = await getAsset(req.params.id);
  const qrText = buildQrContent(freshAsset);
  const qrDataUrl = await QRCode.toDataURL(qrText, {width:200,margin:2,errorCorrectionLevel:'M'});
  const scans = freshAsset.scanHistory?.length||0;
  const monthNum = String(freshAsset.month||'03').padStart(2,'0');
  const woNum = freshAsset.woNo||'&mdash;';
  const scanRows = (freshAsset.scanHistory||[]).slice(-10).reverse().map(s=>`<tr>
    <td style="font-family:monospace;font-size:12px;">${new Date(s.timestamp).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
    <td style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${(s.device||'Unknown').substring(0,80)}</td>
  </tr>`).join('');

  if (isAdmin) {
    const printQrUrl = await QRCode.toDataURL(qrText, {width:300,margin:1,errorCorrectionLevel:'M'});
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
      <div class="ami-field-row cols-2"><div class="ami-field"><div class="f-label">Part No.</div><div class="f-value mono">${freshAsset.partNo}</div></div><div class="ami-field"><div class="f-label">Part Name</div><div class="f-value">${freshAsset.partName}</div></div></div>
      <div class="ami-field-row cols-2"><div class="ami-field"><div class="f-label">Size</div><div class="f-value">${freshAsset.size||'&mdash;'}</div></div><div class="ami-field"><div class="f-label">Lot No.</div><div class="f-value mono">${freshAsset.lotNo}</div></div></div>
      <div class="ami-field-row cols-2"><div class="ami-field"><div class="f-label">Quantity</div><div class="f-value large">${freshAsset.quantity}</div></div><div class="ami-field"><div class="f-label">Packer</div><div class="f-value">${freshAsset.packer}</div></div></div>
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
  const qr = await QRCode.toDataURL(buildQrContent(asset), {width:300,margin:2,errorCorrectionLevel:'M'});
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
    const buf = await QRCode.toBuffer(buildQrContent(asset), {width:600,margin:3,errorCorrectionLevel:'M'});
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
  if (!asset) return res.status(404).json({error:'Not found'});
  res.json(asset);
});

app.get('/api/network-info', (req, res) => {
  res.json({detectedIP:getLocalNetworkIP(),port,localUrl:`http://${getLocalNetworkIP()}:${port}`,resolvedBaseUrl:getBaseUrl(req)});
});

app.listen(port, '0.0.0.0', () => {
  console.log(`\nAMI QR System running on port ${port}\n`);
});