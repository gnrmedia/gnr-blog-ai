// Repo: gnr-blog-ai
// Path: functions/api/blog/_lib/publish/index.js

import { publishToGhl } from "./ghl.js";

export async function enqueuePublishJobsForDraft({ db, draft_id, location_id }) {
  // Find active targets for this location
  const targets = await db.prepare(`
    SELECT target_id, platform
    FROM publish_targets
    WHERE location_id = ?
      AND is_active = 1
  `).bind(location_id).all();

  if (!targets?.results?.length) return;

  for (const t of targets.results) {
    // Idempotency check
    const existing = await db.prepare(`
      SELECT 1
      FROM publish_ledger
      WHERE draft_id = ? AND platform = ? AND target_id = ?
      LIMIT 1
    `).bind(draft_id, t.platform, t.target_id).first();

    if (existing) continue;

    await db.prepare(`
      INSERT INTO publish_jobs (
        job_id, draft_id, location_id, platform, target_id,
        status, attempts, created_at
      ) VALUES (?, ?, ?, ?, ?, 'queued', 0, datetime('now'))
    `).bind(
      crypto.randomUUID(),
      draft_id,
      location_id,
      t.platform,
      t.target_id
    ).run();
  }
}

export async function runPublishJob({ db, job }) {
  if (job.platform === "ghl") {
    return publishToGhl({ db, job });
  }
  throw new Error(`Unsupported platform: ${job.platform}`);
}
