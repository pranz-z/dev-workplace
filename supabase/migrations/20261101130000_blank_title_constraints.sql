-- schema.sql already declares these checks; no migration ever added them, so
-- databases built from migrations accepted blank titles. Validate immediately:
-- a blank row aborts the migration rather than being changed silently.
alter table public.milestones add constraint milestones_title_not_blank_check check (length(btrim(title)) > 0);
alter table public.tasks add constraint tasks_title_not_blank_check check (length(btrim(title)) > 0);
alter table public.plans add constraint plans_title_not_blank_check check (length(btrim(title)) > 0);
alter table public.notes add constraint notes_title_not_blank_check check (length(btrim(title)) > 0);
alter table public.technologies add constraint technologies_name_not_blank_check check (length(btrim(name)) > 0);
