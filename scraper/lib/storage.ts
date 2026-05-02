import { createAdminClient } from '@/lib/supabase/admin';

const BUCKET = 'raw';

/**
 * Uploads raw bytes to Supabase Storage and returns the storage path.
 * Path format: raw/{sourceId}/{yyyy}/{mm}/{hash}.{ext}
 */
export async function uploadRaw(opts: {
  sourceId: string;
  contentHash: string;
  bytes: Buffer;
  mime: 'text/html' | 'application/pdf';
}): Promise<string> {
  const { sourceId, contentHash, bytes, mime } = opts;
  const ext = mime === 'application/pdf' ? 'pdf' : 'html';
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const path = `${sourceId}/${yyyy}/${mm}/${contentHash}.${ext}`;

  const supabase = createAdminClient();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: mime,
      upsert: false, // don't overwrite — hash collision means it's already there
    });

  // "already exists" is fine (same hash = same content), anything else is real error
  if (error && !error.message.includes('already exists')) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  return path;
}
