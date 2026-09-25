const pairPanel = document.querySelector('#pair-panel');
const uploadPanel = document.querySelector('#upload-panel');
const demoBanner = document.querySelector('#demo-banner');
const lanBanner = document.querySelector('#lan-banner');
const pilotBanner = document.querySelector('#pilot-banner');
const pairForm = document.querySelector('#pair-form');
const uploadForm = document.querySelector('#upload-form');
const cameraInput = document.querySelector('#camera-file');
const fileInput = document.querySelector('#receipt-file');
const preview = document.querySelector('#preview');
const previewImage = document.querySelector('#preview-image');
const previewName = document.querySelector('#preview-name');
const uploadButton = document.querySelector('#upload-button');
const message = document.querySelector('#message');
let pendingId;
let selectedFile;
let previewUrl;
let demoMode = false;
let lanPilotMode = false;
let pilotMode = false;
const config = window.R78_CONFIG || {mode: 'gateway'};
const TOKEN_KEY = 'r78_device_token';

// Browser storage can be missing (private mode) or cleared by the browser; the phone then pairs again.
function storedToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

function storeToken(value) {
  try { value ? localStorage.setItem(TOKEN_KEY, value) : localStorage.removeItem(TOKEN_KEY); } catch {}
}

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('לא ניתן לקרוא את הקובץ בטלפון.'));
    reader.readAsDataURL(file);
  });
}

// Apps Script web app (page hosted on GitHub Pages). text/plain keeps the request "simple", so the browser
// sends no CORS preflight, which web apps cannot answer. The device token travels in the body, not a cookie.
async function callWebApp(payload) {
  if (!config.apiUrl) throw new Error('הדף עדיין לא חובר לשרת ההעלאה. פנו למנהל.');
  const response = await fetch(config.apiUrl, {
    method: 'POST', headers: {'content-type': 'text/plain;charset=utf-8'},
    body: JSON.stringify(payload), cache: 'no-store', credentials: 'omit'
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('שרת ההעלאה לא ענה כראוי. נסו שוב.'); }
  if (result.code === 'unpaired') storeToken('');
  return result;
}

const api = config.mode === 'apps-script' ? {
  async session() {
    const result = await callWebApp({action: 'session', token: storedToken()});
    if (!result.ok) throw new Error(result.error);
    return result;
  },
  async pair(code) {
    const result = await callWebApp({action: 'pair', code});
    if (result.ok) storeToken(result.token);
    return result;
  },
  async upload(file, id) {
    const data = await fileAsBase64(file);
    return callWebApp({action: 'upload', token: storedToken(), submission_id: id, file_name: file.name, data});
  }
} : {
  async session() {
    const response = await fetch('/api/session', {cache: 'no-store'});
    return response.json();
  },
  async pair(code) {
    const response = await fetch('/api/pair', {
      method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({code})
    });
    return response.json();
  },
  async upload(file, id) {
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: {'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), 'x-submission-id': id},
      body: file
    });
    return response.json();
  }
};

function submissionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function showMessage(text, kind) {
  message.textContent = text;
  message.className = `show ${kind}`;
}

async function showSession() {
  try {
    const session = await api.session();
    demoMode = Boolean(session.preview);
    lanPilotMode = Boolean(session.lan_pilot);
    pilotMode = Boolean(session.pilot);
    demoBanner.hidden = !demoMode;
    lanBanner.hidden = !lanPilotMode;
    pilotBanner.hidden = !pilotMode;
    pairPanel.hidden = session.paired;
    uploadPanel.hidden = !session.paired;
  } catch (error) {
    showMessage(error instanceof TypeError || error instanceof SyntaxError || !error.message ? 'אין חיבור לשרת. בדקו את הרשת ונסו שוב.' : error.message, 'error');
  }
}

pairForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = pairForm.querySelector('button');
  button.disabled = true;
  try {
    const result = await api.pair(pairForm.elements.code.value);
    if (!result.ok) throw new Error(result.error);
    pairForm.reset();
    message.className = '';
    await showSession();
  } catch (error) {
    showMessage(error.message || 'לא ניתן לחבר את המכשיר.', 'error');
  } finally {
    button.disabled = false;
  }
});

function selectFile(file) {
  if (!file) return;
  selectedFile = file;
  pendingId = undefined;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
  preview.hidden = false;
  previewName.textContent = file.name;
  // Browser image preview is optional; HEIC support differs between phones.
  if (file.type === 'image/jpeg' || file.type === 'image/png') {
    previewUrl = URL.createObjectURL(file);
    previewImage.src = previewUrl;
    previewImage.hidden = false;
  } else {
    previewImage.removeAttribute('src');
    previewImage.hidden = true;
  }
  uploadButton.disabled = false;
  message.className = '';
}

cameraInput.addEventListener('change', () => selectFile(cameraInput.files?.[0]));
fileInput.addEventListener('change', () => selectFile(fileInput.files?.[0]));

uploadForm.addEventListener('submit', async event => {
  event.preventDefault();
  const file = selectedFile;
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) return showMessage('הקובץ גדול מדי. הגודל המרבי הוא 15 MB.', 'error');
  pendingId ||= submissionId();
  uploadButton.disabled = true;
  showMessage('הקבלה נשלחת…', 'info');
  try {
    const result = await api.upload(file, pendingId);
    if (result.code === 'unpaired') {
      uploadButton.disabled = false;
      await showSession();
      return showMessage(result.error || 'המכשיר אינו מוגדר. פנו למנהל.', 'error');
    }
    if (!result.ok) throw new Error(result.error);
    showMessage(demoMode
      ? `נשמרה בדיקה במחשב בלבד. מספר אסמכתה: ${result.reference}. לא נשלח ל-Drive.`
      : lanPilotMode || pilotMode
        ? `קובץ הבדיקה נשמר ב-Drive. מספר אסמכתה: ${result.reference}. טרם נרשמה הוצאה.`
        : `הקבלה התקבלה. מספר אסמכתה: ${result.reference}. אפשר למסור קבלה נוספת.`, 'success');
    uploadForm.reset();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
    previewImage.removeAttribute('src');
    preview.hidden = true;
    selectedFile = undefined;
    pendingId = undefined;
  } catch (error) {
    const reason = error instanceof TypeError ? 'אין חיבור לשרת.' : error.message || 'ההעלאה נכשלה.';
    showMessage(`${reason} לחצו שוב כדי לנסות עם אותה אסמכתה.`, 'error');
    uploadButton.disabled = false;
  }
});

showSession();
