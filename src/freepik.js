import axios from 'axios';
import { sleep } from './util.js';

const API_BASE = 'https://api.freepik.com/v1/ai';

function headers(apiKey) {
  return {
    'x-freepik-api-key': apiKey,
    'content-type': 'application/json'
  };
}

export async function createMysticTask({ apiKey, prompt, aspect_ratio = 'social_story_9_16' }) {
  const url = `${API_BASE}/mystic`;
  const { data } = await axios.post(
    url,
    { prompt, aspect_ratio },
    { headers: headers(apiKey), timeout: 30_000 }
  );
  if (!data?.data?.task_id) throw new Error('Freepik Mystic: bad response');
  return data.data;
}

export async function getMysticTask({ apiKey, taskId }) {
  const url = `${API_BASE}/mystic/${taskId}`;
  const { data } = await axios.get(url, { headers: headers(apiKey), timeout: 30_000 });
  return data?.data || data;
}

// Convenience: text->image with polling (returns { url })
export async function freepikMysticTextToImage({
  apiKey,
  prompt,
  aspect_ratio = 'social_story_9_16',
  timeoutMs = 70_000
}) {
  const task = await createMysticTask({ apiKey, prompt, aspect_ratio });
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await sleep(2500);
    const status = await getMysticTask({ apiKey, taskId: task.task_id });
    if (status.status === 'COMPLETED' && status.generated?.length) {
      return { url: status.generated[0], task_id: task.task_id };
    }
    if (status.status === 'FAILED') {
      throw new Error('freepik_mystic_failed');
    }
  }
  return { task_id: task.task_id, status: 'IN_PROGRESS' };
}

// Seedream v4 Edit (photo + prompt)
export async function createSeedreamV4EditTask({
  apiKey,
  prompt,
  aspect_ratio = 'social_story_9_16',
  referenceImageBase64,
  num_images = 1,
}) {
  const url = `${API_BASE}/text-to-image/seedream-v4-edit`;
  const body = {
    prompt,
    aspect_ratio,
    num_images,
    reference_images: referenceImageBase64 ? [referenceImageBase64] : [],
  };

  const { data } = await axios.post(url, body, {
    headers: headers(apiKey),
    timeout: 45_000,
  });

  if (!data?.data?.task_id) throw new Error('Freepik Seedream v4 Edit: bad response');
  return data.data;
}

export async function getSeedreamV4EditTask({ apiKey, taskId }) {
  const url = `${API_BASE}/text-to-image/seedream-v4-edit/${taskId}`;
  const { data } = await axios.get(url, { headers: headers(apiKey), timeout: 30_000 });
  return data?.data || data;
}

// Convenience: image+prompt -> image with polling
export async function freepikSeedreamEditImage({
  apiKey,
  prompt,
  referenceImageBase64,
  aspect_ratio = 'social_story_9_16',
  timeoutMs = 90_000
}) {
  const task = await createSeedreamV4EditTask({ apiKey, prompt, referenceImageBase64, aspect_ratio });
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await sleep(2500);
    const status = await getSeedreamV4EditTask({ apiKey, taskId: task.task_id });
    if ((status.status === 'COMPLETED' || status.status === 'DONE') && status.generated?.length) {
      return { url: status.generated[0], task_id: task.task_id };
    }
    if (status.status === 'FAILED') {
      throw new Error('freepik_seedream_failed');
    }
  }
  return { task_id: task.task_id, status: 'IN_PROGRESS' };
}

// helper: strip data-url prefix
export function normalizeBase64(input = '') {
  const str = String(input).trim();
  if (!str) return '';
  const m = str.match(/^data:[^;]+;base64,(.+)$/);
  return m ? m[1] : str;
}
export const freepikSeedreamEdit = freepikSeedreamEditImage;

