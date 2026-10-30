// Check or download an existing Magic Hour photo face-swap job.
import { createHmac, timingSafeEqual } from 'node:crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.MAGIC_HOUR_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Face swap is not configured.' });
  const jobId = String(req.query?.jobId || '');
  const token = String(req.query?.token || '');
  if (!jobId || !token) return res.status(400).json({ error: 'Missing job ID or status token.' });

  const expected = createHmac('sha256', apiKey).update(jobId).digest('hex');
  const receivedBytes = Buffer.from(token);
  const expectedBytes = Buffer.from(expected);
  if (receivedBytes.length !== expectedBytes.length || !timingSafeEqual(receivedBytes, expectedBytes)) {
    return res.status(403).json({ error: 'Invalid status token.' });
  }

  try {
    const response = await fetch('https://api.magichour.ai/v1/image-projects/' + encodeURIComponent(jobId), {
      headers: { Authorization: 'Bearer ' + apiKey }
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { message: raw }; }
    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || data.error || 'Unable to check face-swap status.' });
    }

    const state = String(data.status || 'processing').toLowerCase();
    const downloads = Array.isArray(data.downloads) ? data.downloads : [];
    const first = downloads[0];
    const imageUrl = typeof first === 'string' ? first : first?.url;

    if (state === 'complete' && imageUrl && req.query?.download === '1') {
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) return res.status(502).json({ error: 'The swap finished, but the result image could not be downloaded. Please try again.' });
      res.setHeader('Content-Type', imageResponse.headers.get('content-type') || 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(Buffer.from(await imageResponse.arrayBuffer()));
    }

    const terminal = ['complete', 'error', 'failed', 'canceled', 'cancelled'].includes(state);
    const message = state === 'complete'
      ? (imageUrl ? 'Your face swap is ready.' : 'Processing finished, but no download is available yet.')
      : state === 'error' || state === 'failed'
        ? (data.error?.message || data.error || data.message || 'Magic Hour could not process this image.')
        : state === 'canceled' || state === 'cancelled'
          ? 'This face-swap job was canceled.'
          : 'Your face swap is still processing.';
    return res.status(200).json({ jobId, status: state, message, ready: state === 'complete' && Boolean(imageUrl), terminal });
  } catch (error) {
    console.error('Face swap status error:', error);
    return res.status(502).json({ error: 'Could not check status. Your job may still be running; please check again.' });
  }
}
