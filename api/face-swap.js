// Async Magic Hour face-swap submission. Poll /api/face-swap-status with the returned jobId.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.MAGIC_HOUR_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Face swap is not configured. Please contact the site administrator.' });

  async function uploadImage(data, filename) {
    if (typeof data !== 'string') throw new Error('Invalid image data.');
    const match = data.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([\s\S]+)$/i);
    if (!match) throw new Error('Please upload a valid PNG, JPG, or WebP image.');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length) throw new Error('The uploaded image is empty.');
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: match[1] }), filename);
    const response = await fetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: form });
    if (!response.ok) throw new Error('Temporary image upload failed (HTTP ' + response.status + ').');
    const json = await response.json();
    if (!json?.data?.url) throw new Error('Temporary image host did not return an image URL.');
    return json.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
  }

  try {
    const body = req.body || {};
    if (!body.sourceImageBase64 || !body.targetImageBase64) {
      return res.status(400).json({ error: 'Upload both the source face and target photo.' });
    }
    const urls = await Promise.all([
      uploadImage(body.sourceImageBase64, 'loox-source.png'),
      uploadImage(body.targetImageBase64, 'loox-target.png')
    ]);
    const response = await fetch('https://api.magichour.ai/v1/face-swap-photo', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'LOOX Face Swap',
        assets: { face_swap_mode: 'all-faces', source_file_path: urls[0], target_file_path: urls[1] }
      })
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { message: raw }; }
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || data.error || 'Magic Hour rejected the request (HTTP ' + response.status + ').' });
    }
    if (!data.id) return res.status(502).json({ error: 'Magic Hour did not return a job ID. Check your Magic Hour projects before retrying.' });

    const { createHmac } = await import('node:crypto');
    const statusToken = createHmac('sha256', apiKey).update(String(data.id)).digest('hex');
    return res.status(202).json({ jobId: data.id, statusToken, status: data.status || 'queued', message: 'Your face swap has been queued.' });
  } catch (error) {
    console.error('Face swap submission error:', error);
    return res.status(500).json({ error: error.message || 'Unable to start the face swap.' });
  }
}
