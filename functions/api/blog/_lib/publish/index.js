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

// ------------------------------------------------------------
// Process queued publish jobs for a specific draft/location
// FAIL-OPEN: never throws out to caller
// ------------------------------------------------------------
export async function processQueuedPublishJobsForDraft({ db, draft_id, location_id, limit = 10 }) {
  try {
    const queued = await db.prepare(`
      SELECT job_id, draft_id, location_id, platform, target_id, attempts
      FROM publish_jobs
      WHERE draft_id = ?
        AND location_id = ?
        AND status = 'queued'
      ORDER BY created_at ASC
      LIMIT ?
    `).bind(draft_id, location_id, Number(limit) || 10).all();

    const jobs = queued?.results || [];
    for (const job of jobs) {
      await runOneJobFailOpen({ db, job });
    }
  } catch (_) {}
}

async function runOneJobFailOpen({ db, job }) {
  const job_id = String(job.job_id || "");
  try {
    await db.prepare(`
      UPDATE publish_jobs
      SET status='running', attempts=COALESCE(attempts,0)+1, updated_at=datetime('now')
      WHERE job_id=?
    `).bind(job_id).run();
  } catch (_) {}

  try {
    await runPublishJob({ db, job });

    await db.prepare(`
      UPDATE publish_jobs
      SET status='done', updated_at=datetime('now')
      WHERE job_id=?
    `).bind(job_id).run();

  } catch (e) {
    const msg = String(e?.message || e || "publish_failed");
    try {
      await db.prepare(`
        UPDATE publish_jobs
        SET status='failed', last_error=?, updated_at=datetime('now')
        WHERE job_id=?
      `).bind(msg, job_id).run();
    } catch (_) {}
  }
}

