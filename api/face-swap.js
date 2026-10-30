// Submit a Magic Hour photo face-swap job using Magic Hour's own asset storage.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.MAGIC_HOUR_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Face swap is not configured. Please contact the site administrator.' });

  function decodeImage(data, label) {
    if (typeof data !== 'string') throw new Error(label + ' image is missing.');
    const match = data.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([\s\S]+)$/i);
    if (!match) throw new Error(label + ' image must be a PNG, JPG, or WebP file. Please re-save it in one of these formats.');
    const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
    const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) throw new Error(label + ' image is empty.');
    return { buffer, mime, extension };
  }

  async function uploadToMagicHour(file) {
    const urlResponse = await fetch('https://api.magichour.ai/v1/files/upload-urls', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ type: 'image', extension: file.extension }] })
    });
    const urlRaw = await urlResponse.text();
    let urlData;
    try { urlData = JSON.parse(urlRaw); } catch { throw new Error('Magic Hour returned an invalid upload response.'); }
    if (!urlResponse.ok) {
      throw new Error(urlData.message || urlData.error || 'Could not request a secure image upload from Magic Hour.');
    }
    const item = urlData.items?.[0];
    if (!item?.upload_url || !item?.file_path) throw new Error('Magic Hour did not return a valid image upload URL.');

    const putResponse = await fetch(item.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': file.mime },
      body: file.buffer
    });
    if (!putResponse.ok) {
      throw new Error('Uploading an image to Magic Hour failed (HTTP ' + putResponse.status + ').');
    }
    return item.file_path;
  }

  try {
    const body = req.body || {};
    if (!body.sourceImageBase64 || !body.targetImageBase64) {
      return res.status(400).json({ error: 'Upload both the source face and target photo.' });
    }

    const source = decodeImage(body.sourceImageBase64, 'Source');
    const target = decodeImage(body.targetImageBase64, 'Target');

    // Upload both original image byte streams directly to Magic Hour.
    const [sourcePath, targetPath] = await Promise.all([
      uploadToMagicHour(source),
      uploadToMagicHour(target)
    ]);

    const submitResponse = await fetch('https://api.magichour.ai/v1/face-swap-photo', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'LOOX Face Swap',
        assets: {
          face_swap_mode: 'all-faces',
          source_file_path: sourcePath,
          target_file_path: targetPath
        }
      })
    });

    const raw = await submitResponse.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { message: raw }; }
    if (!submitResponse.ok) {
      return res.status(submitResponse.status).json({
        error: data.message || data.error || 'Magic Hour rejected the face-swap request (HTTP ' + submitResponse.status + ').'
      });
    }
    if (!data.id) return res.status(502).json({ error: 'Magic Hour did not return a job ID. Please contact support before retrying.' });

    const { createHmac } = await import('node:crypto');
    const statusToken = createHmac('sha256', apiKey).update(String(data.id)).digest('hex');
    return res.status(202).json({
      jobId: data.id,
      statusToken,
      status: data.status || 'queued',
      message: 'Your face swap has been queued.'
    });
  } catch (error) {
    console.error('Face swap submission error:', error);
    return res.status(500).json({ error: error.message || 'Unable to start the face swap.' });
  }
}
