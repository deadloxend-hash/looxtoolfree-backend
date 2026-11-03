-- Optional private prompt labels for the account-owned FLUX image history.
-- Existing historical jobs remain readable, but their original prompts cannot be reconstructed.
alter table public.loox_jobs add column if not exists prompt text;
alter table public.loox_jobs drop constraint if exists loox_jobs_prompt_length;
alter table public.loox_jobs add constraint loox_jobs_prompt_length
  check(prompt is null or (length(prompt) between 1 and 1200));
-- Existing table RLS already grants SELECT only for user_id=auth.uid().
