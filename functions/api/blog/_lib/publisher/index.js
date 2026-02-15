// Repo: gnr-blog-ai
// Path: functions/api/blog/_lib/publisher/index.js

import { publishToGhl } from "./platforms/ghl.js";

// -------------------------------------------
// Enqueue jobs for all active targets
// -------------------------------------------
export async function enqueuePublishJobsForDraft({ db, draft_id, location_id }) {
  try {
    const targets = await db.prepare(`
      SELECT target_id, platform
      FROM publish_targets
      WHERE location_id = ?
        AND (is_active = 1 OR is_active IS NULL)
    `).bind(location_id).all();

    console.log("ENQUEUE_TARGETS", location_id, (targets?.results || []).length);

    const rows = targets?.results || [];
    if (!rows.length) return;

    for (const t of rows) {
      const platform = String(t.platform || "").trim().toLowerCase();
      const target_id = String(t.target_id || "").trim();
      if (!platform || !target_id) continue;

      // Idempotency guard: if already published, do not enqueue
      const already = await db.prepare(`
        SELECT 1
        FROM publish_ledger
        WHERE draft_id = ? AND platform = ? AND target_id = ?
        LIMIT 1
      `).bind(draft_id, platform, target_id).first();

      if (already) continue;

      await db.prepare(`
        INSERT INTO publish_jobs (
          job_id, draft_id, location_id, platform, target_id,
          status, attempts, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 'queued', 0, datetime('now'), datetime('now'))
      `).bind(
        crypto.randomUUID(),
        draft_id,
        location_id,
        platform,
        target_id
      ).run();
    }
  } catch (e) {
    // fail-open
  }
}

// -------------------------------------------
// Process queued jobs for this draft
// -------------------------------------------
export async function processQueuedPublishJobsForDraft({ db, env, draft_id, location_id }) {
  try {
    const queued = await db.prepare(`
      SELECT job_id, draft_id, location_id, platform, target_id, attempts
      FROM publish_jobs
      WHERE draft_id = ?
        AND location_id = ?
        AND status = 'queued'
      ORDER BY created_at ASC
      LIMIT 10
    `).bind(draft_id, location_id).all();

    const jobs = queued?.results || [];
    for (const job of jobs) {
      await runOneJob({ db, env, job });
    }
  } catch (e) {
    // fail-open
  }
}

// -------------------------------------------
// Job runner (one job)
// -------------------------------------------
async function runOneJob({ db, env, job }) {
  const job_id = String(job.job_id || "");
  const platform = String(job.platform || "").toLowerCase();

  // mark running (best effort)
  try {
    await db.prepare(`
      UPDATE publish_jobs
      SET status='running', attempts=COALESCE(attempts,0)+1, updated_at=datetime('now')
      WHERE job_id=?
    `).bind(job_id).run();
  } catch (_) {}

  try {
    if (platform === "ghl") {
      await publishToGhl({ db, env, job });
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    await db.prepare(`
      UPDATE publish_jobs
      SET status='done', updated_at=datetime('now')
      WHERE job_id=?
    `).bind(job_id).run();

  } catch (e) {
    const msg = String(e?.message || e || "publish_failed");

    // mark failed (best effort)
    try {
      await db.prepare(`
        UPDATE publish_jobs
        SET status='failed', last_error=?, updated_at=datetime('now')
        WHERE job_id=?
      `).bind(msg, job_id).run();
    } catch (_) {}
  }
}
