-- Preserve policy roles/commands, admin claims, MFA and restrictive enrolled-MFA gates.
begin;
set local lock_timeout='1s';
set local statement_timeout='15s';
alter policy loox_admin_catalog_insert on public.loox_template_catalog with check ((coalesce(((select auth.jwt())->'app_metadata'->>'loox_template_admin'),'false')='true' and ((select auth.jwt())->>'aal')='aal2'));
alter policy loox_admin_catalog_read on public.loox_template_catalog using ((coalesce(((select auth.jwt())->'app_metadata'->>'loox_template_admin'),'false')='true' and ((select auth.jwt())->>'aal')='aal2'));
alter policy loox_admin_catalog_update on public.loox_template_catalog using ((coalesce(((select auth.jwt())->'app_metadata'->>'loox_template_admin'),'false')='true' and ((select auth.jwt())->>'aal')='aal2')) with check ((coalesce(((select auth.jwt())->'app_metadata'->>'loox_template_admin'),'false')='true' and ((select auth.jwt())->>'aal')='aal2'));
alter policy loox_admin_catalog_delete on public.loox_template_catalog using ((coalesce(((select auth.jwt())->'app_metadata'->>'loox_template_admin'),'false')='true' and ((select auth.jwt())->>'aal')='aal2'));
alter policy admin_add_categories on public.loox_template_categories with check ((coalesce(((select auth.jwt())->'app_metadata'->>'loox_template_admin'),'false')='true' and ((select auth.jwt())->>'aal')='aal2'));
alter policy admin_edit_categories on public.loox_template_categories using ((coalesce(((select auth.jwt())->'app_metadata'->>'loox_template_admin'),'false')='true' and ((select auth.jwt())->>'aal')='aal2')) with check ((coalesce(((select auth.jwt())->'app_metadata'->>'loox_template_admin'),'false')='true' and ((select auth.jwt())->>'aal')='aal2'));
alter policy admin_delete_categories on public.loox_template_categories using ((coalesce(((select auth.jwt())->'app_metadata'->>'loox_template_admin'),'false')='true' and ((select auth.jwt())->>'aal')='aal2'));
alter policy admin_add_styles on public.loox_template_styles with check ((coalesce(((select auth.jwt())->'app_metadata'->>'loox_template_admin'),'false')='true' and ((select auth.jwt())->>'aal')='aal2'));
alter policy admin_delete_styles on public.loox_template_styles using ((coalesce(((select auth.jwt())->'app_metadata'->>'loox_template_admin'),'false')='true' and ((select auth.jwt())->>'aal')='aal2'));
commit;
