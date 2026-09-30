// Screen recordings go to Google Drive through a tiny Google Apps Script "drop-box"
// that an admin deploys once from their own Google account (see Settings → Google Drive).
// The script saves each file in the folder "Autobot Feedback recordings", viewable by the company domain.

export const DRIVE_FOLDER = 'Autobot Feedback recordings'
const MAX_BYTES = 35 * 1024 * 1024 // Apps Script accepts ~50 MB per request; base64 adds a third

/** The script an admin pastes into script.google.com. */
export const buildDriveScript = (secret: string) => `// Autobot Feedback · recordings drop-box
// Saves uploaded screen recordings into the Drive folder "${DRIVE_FOLDER}",
// viewable by anyone in your Google Workspace domain. Only requests with the secret are accepted.

const SECRET = '${secret}';
const FOLDER_NAME = '${DRIVE_FOLDER}';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return reply({ ok: false, error: 'Wrong secret' });
    const folders = DriveApp.getFoldersByName(FOLDER_NAME);
    const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);
    const blob = Utilities.newBlob(Utilities.base64Decode(body.data), body.mimeType || 'video/mp4', body.name || 'recording.mp4');
    const file = folder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (err) {
      // Personal Google accounts have no domain; the file stays private to the owner.
    }
    return reply({ ok: true, id: file.getId(), url: 'https://drive.google.com/file/d/' + file.getId() + '/view' });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

function doGet() {
  return reply({ ok: true, ready: true, folder: FOLDER_NAME });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
`

function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(new Error('Couldn’t read the recording.'))
    r.readAsDataURL(file)
  })
}

/** Sends a (compressed) recording to the drop-box; returns its Drive link. */
export async function uploadRecording(scriptUrl: string, secret: string, file: File, name: string): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error('This recording is too long for one upload even after compressing. Please split it into shorter clips (under ~10 minutes each).')
  const data = await toBase64(file)
  // text/plain keeps this a "simple" request, which Apps Script accepts from any site
  const res = await fetch(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret, name, mimeType: file.type || 'video/mp4', data }),
  }).catch(() => {
    throw new Error('Couldn’t reach the Google Drive drop-box. Check the address in Settings → Google Drive.')
  })
  const out = await res.json().catch(() => ({}))
  if (!out.ok || !out.url) throw new Error(`Google Drive drop-box: ${out.error || 'upload failed'}`)
  return out.url
}

/** Settings "Test" button: is the script deployed and reachable? */
export async function testDriveScript(scriptUrl: string): Promise<boolean> {
  try {
    const out = await (await fetch(scriptUrl)).json()
    return Boolean(out.ready)
  } catch {
    return false
  }
}

export function driveFileId(url: string): string | null {
  return url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]{10,})/)?.[1] || null
}
